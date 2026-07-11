"""Shared, deterministic CDragon snapshot and lifecycle primitives.

This module intentionally contains no network or presentation code.  Entity
adapters supply normalized records, and the pipeline decides which complete
branch transaction to promote.  Keeping the primitives pure makes fixture
coverage independent of CommunityDragon availability.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shutil
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable

try:
    import fcntl
except ImportError:  # pragma: no cover - the production runners are POSIX
    fcntl = None


ENTITY_TYPES = frozenset({"augment", "champion", "item"})
BRANCHES = frozenset({"latest", "pbe"})
PUBLIC_EVENT_FIELDS = (
    "entity_type",
    "canonical_id",
    "slug",
    "names",
    "branch",
    "lane",
    "change_kind",
    "fields_changed",
    "before",
    "after",
    "detected_at",
    "source_patch_label",
    "landed",
    "is_hotfix",
)


class SnapshotValidationError(ValueError):
    """A source snapshot is incomplete, contradictory, or unsafe to promote."""


def snapshot_filename(entity_type: str, branch: str) -> str:
    if entity_type not in ENTITY_TYPES:
        raise SnapshotValidationError(f"unsupported entity type: {entity_type}")
    if branch not in BRANCHES:
        raise SnapshotValidationError(f"unsupported CDragon branch: {branch}")
    return f"cdragon-{entity_type}-{branch}.json"


def _stable(value: Any) -> Any:
    """Deep-copy JSON data through a stable encoding before persistence."""
    return json.loads(json.dumps(value, ensure_ascii=False, sort_keys=True))


def _lane_for_branch(branch: str) -> str:
    return "live" if branch == "latest" else "preview"


def build_snapshot(
    *,
    entity_type: str,
    branch: str,
    source_version: str,
    source_patch_label: str,
    observed_at: str,
    entities: Iterable[dict[str, Any]],
    source_url: str = "",
) -> dict[str, Any]:
    """Create a canonical, stably ordered snapshot from normalized entities."""
    rows = [_stable(row) for row in entities]
    rows.sort(key=lambda row: (str(row.get("id", "")), str(row.get("slug", ""))))
    snapshot = {
        "schema_version": 1,
        "entity_type": entity_type,
        "branch": branch,
        "lane": _lane_for_branch(branch),
        "source_version": source_version,
        "source_patch_label": source_patch_label,
        "observed_at": observed_at,
        "source_url": source_url,
        "entities": rows,
    }
    validate_snapshot(snapshot)
    return snapshot


def _version_parts(value: str) -> tuple[int, ...] | None:
    numbers = re.findall(r"\d+", value)
    return tuple(int(number) for number in numbers) if numbers else None


def _assert_entity(entity: Any) -> None:
    if not isinstance(entity, dict):
        raise SnapshotValidationError("snapshot entity must be an object")
    for field in ("id", "slug"):
        if not isinstance(entity.get(field), str) or not entity[field].strip():
            raise SnapshotValidationError(f"snapshot entity missing canonical {field}")
    if not isinstance(entity.get("names"), dict):
        raise SnapshotValidationError("snapshot entity names must be an object")
    if not isinstance(entity.get("fields"), dict):
        raise SnapshotValidationError("snapshot entity fields must be an object")


def validate_snapshot(
    snapshot: dict[str, Any],
    *,
    previous: dict[str, Any] | None = None,
    max_coverage_loss_ratio: float = 0.2,
) -> None:
    """Fail closed before a snapshot can enter a branch lineage."""
    required = {
        "schema_version",
        "entity_type",
        "branch",
        "lane",
        "source_version",
        "source_patch_label",
        "observed_at",
        "entities",
    }
    missing = sorted(required - set(snapshot))
    if missing:
        raise SnapshotValidationError(f"snapshot missing required field(s): {', '.join(missing)}")
    if snapshot["entity_type"] not in ENTITY_TYPES:
        raise SnapshotValidationError(f"unsupported entity type: {snapshot['entity_type']}")
    if snapshot["schema_version"] != 1:
        raise SnapshotValidationError(f"unsupported snapshot schema_version: {snapshot['schema_version']}")
    if snapshot["branch"] not in BRANCHES:
        raise SnapshotValidationError(f"unsupported CDragon branch: {snapshot['branch']}")
    if snapshot["lane"] != _lane_for_branch(snapshot["branch"]):
        raise SnapshotValidationError("lane mismatch for CDragon branch")
    if not isinstance(snapshot["source_version"], str) or not snapshot["source_version"].strip():
        raise SnapshotValidationError("snapshot source_version is missing")
    if not isinstance(snapshot["source_patch_label"], str) or not snapshot["source_patch_label"].strip():
        raise SnapshotValidationError("snapshot source_patch_label is missing")
    if not isinstance(snapshot["observed_at"], str) or not snapshot["observed_at"].strip():
        raise SnapshotValidationError("snapshot observed_at is missing")
    if not isinstance(snapshot["entities"], list) or not snapshot["entities"]:
        raise SnapshotValidationError("snapshot entities are missing or empty")

    canonical_ids: set[str] = set()
    for entity in snapshot["entities"]:
        _assert_entity(entity)
        if entity["id"] in canonical_ids:
            raise SnapshotValidationError(f"duplicate canonical id: {entity['id']}")
        canonical_ids.add(entity["id"])

    if previous is None:
        return
    if previous.get("entity_type") != snapshot["entity_type"]:
        raise SnapshotValidationError("entity type changed within a snapshot lineage")
    if previous.get("branch") != snapshot["branch"]:
        raise SnapshotValidationError("branch changed within a snapshot lineage")

    old_version = _version_parts(str(previous.get("source_version", "")))
    new_version = _version_parts(snapshot["source_version"])
    if old_version and new_version and new_version < old_version:
        raise SnapshotValidationError(
            "version regression: "
            f"{snapshot['source_version']} < {previous.get('source_version')}",
        )

    previous_rows = previous.get("entities")
    if isinstance(previous_rows, list) and previous_rows:
        minimum = len(previous_rows) * (1 - max_coverage_loss_ratio)
        if len(snapshot["entities"]) < minimum:
            raise SnapshotValidationError(
                "abrupt coverage loss: "
                f"{len(snapshot['entities'])}/{len(previous_rows)} entities",
            )


def _flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    if isinstance(value, dict):
        if not value and prefix:
            return {prefix: {}}
        flattened: dict[str, Any] = {}
        for key in sorted(value):
            child = f"{prefix}.{key}" if prefix else str(key)
            flattened.update(_flatten(value[key], child))
        return flattened
    return {prefix: _stable(value)}


def _numeric_value(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, list):
        return all(_numeric_value(entry) for entry in value)
    return False


def _change_kind(fields: list[str], before: dict[str, Any], after: dict[str, Any]) -> str:
    if fields == ["rarity"]:
        return "rarity"
    values = [before.get(field) for field in fields] + [after.get(field) for field in fields]
    return "numeric" if values and all(_numeric_value(value) for value in values) else "text"


def _event_sort_key(event: dict[str, Any]) -> tuple[str, str, str, tuple[str, ...]]:
    return (
        str(event.get("entity_type", "")),
        str(event.get("slug", "")),
        str(event.get("change_kind", "")),
        tuple(event.get("fields_changed", [])),
    )


def compare_snapshots(
    previous: dict[str, Any],
    current: dict[str, Any],
    *,
    detected_at: str,
    comparison_base: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Compare two validated snapshots into ordered, source-attributed events."""
    validate_snapshot(previous)
    if previous["entity_type"] != current["entity_type"]:
        raise SnapshotValidationError("snapshots must share an entity type")
    # A PBE preview is deliberately allowed to compare the PBE target against
    # a read-only latest baseline.  That relationship is explicit in
    # `comparison`; it never promotes latest data into the PBE lineage.
    if previous["branch"] == current["branch"]:
        validate_snapshot(current, previous=previous)
    elif comparison_base is not None:
        validate_snapshot(current)
    else:
        raise SnapshotValidationError("cross-lane comparison requires explicit provenance")

    old_by_id = {row["id"]: row for row in previous["entities"]}
    new_by_id = {row["id"]: row for row in current["entities"]}
    comparison = {
        "base_branch": (comparison_base or {}).get("branch", previous["branch"]),
        "base_version": (comparison_base or {}).get("source_version", previous["source_version"]),
        "target_branch": current["branch"],
        "target_version": current["source_version"],
    }
    events: list[dict[str, Any]] = []

    for entity_id in sorted(new_by_id.keys() - old_by_id.keys()):
        row = new_by_id[entity_id]
        events.append({
            "entity_type": current["entity_type"],
            "canonical_id": entity_id,
            "slug": row["slug"],
            "names": _stable(row["names"]),
            "branch": current["branch"],
            "lane": current["lane"],
            "change_kind": "added",
            "fields_changed": [],
            "before": {},
            "after": _stable(row["fields"]),
            "detected_at": detected_at,
            "source_patch_label": current["source_patch_label"],
            "landed": False,
            "is_hotfix": False,
            "comparison": comparison,
        })

    for entity_id in sorted(old_by_id.keys() - new_by_id.keys()):
        row = old_by_id[entity_id]
        events.append({
            "entity_type": current["entity_type"],
            "canonical_id": entity_id,
            "slug": row["slug"],
            "names": _stable(row["names"]),
            "branch": current["branch"],
            "lane": current["lane"],
            "change_kind": "removed",
            "fields_changed": [],
            "before": _stable(row["fields"]),
            "after": {},
            "detected_at": detected_at,
            "source_patch_label": current["source_patch_label"],
            "landed": False,
            "is_hotfix": False,
            "comparison": comparison,
        })

    for entity_id in sorted(old_by_id.keys() & new_by_id.keys()):
        old = old_by_id[entity_id]
        new = new_by_id[entity_id]
        old_fields = _flatten(old["fields"])
        new_fields = _flatten(new["fields"])
        fields = sorted(
            field for field in old_fields.keys() | new_fields.keys()
            if old_fields.get(field) != new_fields.get(field)
        )
        if not fields:
            continue
        before = {field: old_fields.get(field) for field in fields}
        after = {field: new_fields.get(field) for field in fields}
        events.append({
            "entity_type": current["entity_type"],
            "canonical_id": entity_id,
            "slug": new["slug"],
            "names": _stable(new["names"]),
            "branch": current["branch"],
            "lane": current["lane"],
            "change_kind": _change_kind(fields, before, after),
            "fields_changed": fields,
            "before": before,
            "after": after,
            "detected_at": detected_at,
            "source_patch_label": current["source_patch_label"],
            "landed": False,
            "is_hotfix": (
                current["branch"] == "latest"
                and previous["source_patch_label"] == current["source_patch_label"]
            ),
            "comparison": comparison,
        })

    return sorted(events, key=_event_sort_key)


def _event_identity(event: dict[str, Any]) -> tuple[str, str, str, tuple[str, ...]]:
    return (
        str(event.get("entity_type", "")),
        str(event.get("canonical_id", "")),
        str(event.get("change_kind", "")),
        tuple(event.get("fields_changed", [])),
    )


def _has_landed(preview: dict[str, Any], latest_events: Iterable[dict[str, Any]]) -> bool:
    for live in latest_events:
        if (live.get("entity_type"), live.get("canonical_id")) != (
            preview.get("entity_type"),
            preview.get("canonical_id"),
        ):
            continue
        if live.get("change_kind") != preview.get("change_kind"):
            continue
        if preview.get("change_kind") in {"added", "removed"}:
            return True
        if live.get("after") == preview.get("after"):
            return True
    return False


def advance_preview_lifecycle(
    previous_archive: dict[str, Any] | None,
    preview_events: Iterable[dict[str, Any]],
    latest_events: Iterable[dict[str, Any]],
    current_cycle: str,
    observed_at: str,
    *,
    max_open_cycles: int = 2,
) -> dict[str, Any]:
    """Merge one PBE observation, reconcile actual live landings, and age safely."""
    old_events = (previous_archive or {}).get("events", [])
    by_identity = {
        _event_identity(event): copy.deepcopy(event)
        for event in old_events
        if isinstance(event, dict)
    }
    incoming = sorted((_stable(event) for event in preview_events), key=_event_sort_key)
    seen: set[tuple[str, str, str, tuple[str, ...]]] = set()

    for event in incoming:
        identity = _event_identity(event)
        seen.add(identity)
        existing = by_identity.get(identity)
        if existing is None:
            existing = event
            existing["landed"] = False
            existing["lifecycle"] = "upcoming"
            existing["first_seen_cycle"] = current_cycle
            existing["observed_cycles"] = 1
        else:
            existing.update(event)
            if existing.get("last_seen_cycle") != current_cycle:
                existing["observed_cycles"] = int(existing.get("observed_cycles", 1)) + 1
            if existing.get("lifecycle") == "aged_out":
                existing["lifecycle"] = "upcoming"
                existing["landed"] = False
        existing["last_seen_cycle"] = current_cycle
        existing["last_seen_at"] = observed_at
        by_identity[identity] = existing

    for identity, event in by_identity.items():
        if identity in seen or event.get("lifecycle") != "upcoming":
            continue
        if event.get("last_seen_cycle") != current_cycle:
            event["observed_cycles"] = int(event.get("observed_cycles", 1)) + 1
            event["last_seen_cycle"] = current_cycle
        if int(event.get("observed_cycles", 1)) > max_open_cycles:
            event["lifecycle"] = "aged_out"

    live = list(latest_events)
    for event in by_identity.values():
        if event.get("lifecycle") == "upcoming" and _has_landed(event, live):
            event["landed"] = True
            event["lifecycle"] = "landed"
            event["landed_at"] = observed_at

    events = sorted(by_identity.values(), key=_event_sort_key)
    return {
        "schema_version": 1,
        "branch": "pbe",
        "lane": "preview",
        "source_patch_label": current_cycle,
        "observed_at": observed_at,
        "status": "fresh",
        "events": events,
    }


def build_public_preview_projection(archive: dict[str, Any] | None) -> dict[str, Any]:
    """Expose only the current open PBE cycle; raw snapshots and history stay private."""
    if not archive:
        return {
            "schema_version": 1,
            "branch": "pbe",
            "lane": "preview",
            "status": "unavailable",
            "events": [],
        }
    events = []
    for event in archive.get("events", []):
        if event.get("lifecycle") != "upcoming" or event.get("landed"):
            continue
        if event.get("source_patch_label") != archive.get("source_patch_label"):
            continue
        events.append({field: _stable(event[field]) for field in PUBLIC_EVENT_FIELDS if field in event})
    return {
        "schema_version": 1,
        "branch": "pbe",
        "lane": "preview",
        "status": archive.get("status", "unavailable"),
        "source_patch_label": archive.get("source_patch_label", ""),
        "observed_at": archive.get("observed_at", ""),
        "events": sorted(events, key=_event_sort_key),
    }


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _journal_path(root: Path) -> Path:
    return root / ".cdragon-pipeline-transaction.json"


@contextmanager
def _promotion_lock(root: Path):
    """Serialize promotions that share a journal, including local/manual runs."""
    lock_id = hashlib.sha256(str(root.resolve()).encode("utf-8")).hexdigest()
    lock_path = Path(tempfile.gettempdir()) / f"mayhem-cdragon-pipeline-{lock_id}.lock"
    with lock_path.open("a+", encoding="utf-8") as handle:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def recover_pending_transaction(root: Path) -> None:
    """Restore pre-promotion files when an earlier process died mid-transaction."""
    journal_path = _journal_path(root)
    if not journal_path.exists():
        return
    journal = json.loads(journal_path.read_text(encoding="utf-8"))
    stage = Path(journal["stage"])
    for entry in journal.get("targets", []):
        target = Path(entry["target"])
        backup = Path(entry["backup"])
        if backup.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(backup, target)
        elif target.exists():
            target.unlink()
    shutil.rmtree(stage, ignore_errors=True)
    journal_path.unlink(missing_ok=True)


def _atomic_write_many_unlocked(
    values: dict[Path, Any],
    *,
    root: Path,
    fail_after: int | None = None,
) -> None:
    """Promote a complete branch update or recover the previous file set intact."""
    if not values:
        return
    recover_pending_transaction(root)
    stage = root / f".cdragon-pipeline-stage-{uuid.uuid4().hex}"
    payload_dir = stage / "payload"
    backup_dir = stage / "backup"
    journal_path = _journal_path(root)
    entries = []
    try:
        for index, (target, value) in enumerate(sorted(values.items(), key=lambda pair: str(pair[0]))):
            payload = payload_dir / f"{index}.json"
            backup = backup_dir / f"{index}.json"
            _write_json(payload, value)
            if target.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(target, backup)
            entries.append({"target": str(target.resolve()), "backup": str(backup.resolve())})
        _write_json(journal_path, {"stage": str(stage.resolve()), "targets": entries})
        for index, entry in enumerate(entries):
            if fail_after is not None and index >= fail_after:
                raise OSError("fixture failure during atomic CDragon promotion")
            target = Path(entry["target"])
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(payload_dir / f"{index}.json", target)
    except Exception:
        recover_pending_transaction(root)
        raise
    else:
        journal_path.unlink(missing_ok=True)
        shutil.rmtree(stage, ignore_errors=True)


def atomic_write_many(
    values: dict[Path, Any],
    *,
    fail_after: int | None = None,
) -> None:
    """Promote a complete branch update while serializing shared journals."""
    if not values:
        return
    parents = [str(path.parent.resolve()) for path in values]
    root = Path(os.path.commonpath(parents))
    with _promotion_lock(root):
        _atomic_write_many_unlocked(values, root=root, fail_after=fail_after)
