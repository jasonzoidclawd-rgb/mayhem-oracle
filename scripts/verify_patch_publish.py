#!/usr/bin/env python3
"""Validate public patch-notes data before the data publish commit."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from entity_presentation_projection import CANONICAL_AUGMENT_IDS


ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA_DIR = ROOT / "public" / "data"

ALLOWED_KINDS = {
    "added",
    "removed",
    "buffed",
    "nerfed",
    "changed",
    "fixed",
    "mechanism",
    "hotfix",
}
NON_GENERIC_KINDS = {"added", "buffed", "nerfed", "fixed", "removed"}


class PatchPublishError(Exception):
    """Raised when public patch-notes data is not safe to publish."""


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_timestamp(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def all_changes(data: dict[str, Any]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for patch in data.get("patches", []):
        if not isinstance(patch, dict):
            continue
        for section in patch.get("sections", []):
            if not isinstance(section, dict):
                continue
            for change in section.get("changes", []):
                if isinstance(change, dict):
                    changes.append(change)
    return changes


def git_diff_name_only(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only"],
        cwd=root,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def assert_publish_inclusion(changed_paths: list[str]) -> None:
    changed = {path.replace("\\", "/") for path in changed_paths}
    internal_changed = bool({
        "data/internal/patch-events.json",
        "data/internal/patch-metadata.json",
        "data/internal/augment-entity-links.json",
    } & changed)
    pbe_internal_changed = "data/internal/pbe-preview.json" in changed
    entity_internal_changed = any(
        path.startswith("data/internal/cdragon-")
        or path in {
            "data/internal/patch-events.json",
            "data/internal/pbe-preview.json",
            "data/internal/augment-entity-links.json",
            "data/internal/champions.json",
            "data/internal/augments.json",
            "data/internal/items.json",
        }
        for path in changed
    )
    public_changed = "public/data/patch-notes.json" in changed
    public_pbe_changed = "public/data/pbe-preview.json" in changed
    public_entity_changed = "public/data/entity-presentation.json" in changed
    if internal_changed and not public_changed:
        raise PatchPublishError(
            "public patch-notes must be changed when internal patch event or metadata data changes",
        )
    if pbe_internal_changed and not public_pbe_changed:
        raise PatchPublishError(
            "public PBE preview must be changed when internal PBE preview data changes",
        )
    if entity_internal_changed and not public_entity_changed:
        raise PatchPublishError(
            "public entity presentation must be changed when normalized entity or patch data changes",
        )


def _event_canonical_id(event: dict[str, Any]) -> str:
    if event.get("entity_type") == "augment":
        mapped = CANONICAL_AUGMENT_IDS.get(str(event.get("slug") or ""))
        if mapped:
            return mapped
    return str(event.get("canonical_id") or "")


def _public_ref_identity(ref: dict[str, Any]) -> tuple[str, str]:
    return str(ref.get("type") or ""), str(ref.get("canonicalId") or ref.get("id") or "")


def _public_change_matches(change: dict[str, Any], entity_type: str, canonical_id: str | set[str], *, related: bool = False) -> bool:
    refs = change.get("relatedEntities", []) if related else change.get("targets", [])
    identities = canonical_id if isinstance(canonical_id, set) else {canonical_id}
    return any(
        _public_ref_identity(ref)[0] == entity_type and _public_ref_identity(ref)[1] in identities
        for ref in refs
        if isinstance(ref, dict)
    )


def _entity_record_index(entity_data: dict[str, Any]) -> tuple[dict[tuple[str, str], list[dict[str, Any]]], dict[tuple[str, str], list[dict[str, Any]]]]:
    by_id: dict[tuple[str, str], list[dict[str, Any]]] = {}
    by_slug: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for record in entity_data.get("entities", []):
        if not isinstance(record, dict):
            continue
        entity_type = str(record.get("type") or "")
        canonical_id = str(record.get("canonical_id") or "")
        slug = str(record.get("slug") or "")
        if entity_type and canonical_id:
            by_id.setdefault((entity_type, canonical_id), []).append(record)
        if entity_type and slug:
            by_slug.setdefault((entity_type, slug), []).append(record)
    return by_id, by_slug


def _verify_current_entity_completeness(
    *,
    root: Path,
    patch: str,
    patch_notes: dict[str, Any],
    entity_data: dict[str, Any],
) -> dict[str, Any]:
    """Check every current internal event through public notes and detail data."""
    internal_path = root / "data" / "internal" / "patch-events.json"
    if not internal_path.exists():
        return {
            "officialEntityChanges": 0,
            "resolvedEntityChanges": 0,
            "projectedEntityChanges": 0,
            "unmatchedSubjects": [],
            "ambiguousSubjects": [],
            "missingProjections": [],
        }
    internal = load_json(internal_path)
    if not isinstance(internal, dict):
        raise PatchPublishError("internal patch-events must be an object")
    events = [
        event for event in internal.get("events", [])
        if isinstance(event, dict) and str(event.get("source_patch_label") or "") == patch
    ]
    by_id, by_slug = _entity_record_index(entity_data)
    public_changes = all_changes(patch_notes)
    unmatched: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    resolved = 0
    projected = 0
    for event in events:
        entity_type = str(event.get("entity_type") or "")
        canonical_id = _event_canonical_id(event)
        source_canonical_id = str(event.get("canonical_id") or "")
        public_subject_ids = {canonical_id, source_canonical_id}
        descriptor = {"type": entity_type, "canonicalId": canonical_id, "slug": str(event.get("slug") or "")}
        records = by_id.get((entity_type, canonical_id), [])
        if not records and descriptor["slug"]:
            records = by_slug.get((entity_type, descriptor["slug"]), [])
        if not records:
            unmatched.append(descriptor)
            continue
        if len(records) != 1:
            ambiguous.append(descriptor)
            continue
        resolved += 1
        roles = [{"type": entity_type, "canonical_id": canonical_id, "role": "subject"}]
        roles.extend(
            {"type": str(affected.get("entity_type") or ""), "canonical_id": str(affected.get("canonical_id") or ""), "role": "affected"}
            for affected in event.get("affected_entities", [])
            if isinstance(affected, dict)
        )
        event_complete = True
        for role in roles:
            role_type = role["type"]
            role_id = role["canonical_id"]
            role_records = by_id.get((role_type, role_id), [])
            if len(role_records) != 1:
                role_descriptor = {**descriptor, "role": role["role"], "affectedType": role_type, "affectedCanonicalId": role_id}
                if not role_records:
                    unmatched.append(role_descriptor)
                else:
                    ambiguous.append(role_descriptor)
                event_complete = False
                continue
            if role["role"] == "subject":
                notes_match = any(_public_change_matches(change, role_type, public_subject_ids) for change in public_changes)
            else:
                notes_match = any(_public_change_matches(change, role_type, role_id, related=True) for change in public_changes)
            if not notes_match:
                missing.append({**descriptor, "role": role["role"], "surface": "patch-notes"})
                event_complete = False
            record = role_records[0]
            if isinstance(event.get("change"), dict):
                expected_name = str(event["change"].get("name") or "")
                detail_match = any(
                    expected_name in str(change.get("after") or "")
                    and change.get("patch") == patch
                    for change in record.get("patch_changes", [])
                    if isinstance(change, dict)
                )
                if not detail_match:
                    missing.append({**descriptor, "role": role["role"], "surface": "detail-page"})
                    event_complete = False
        if event_complete:
            projected += 1
    summary = {
        "officialEntityChanges": len(events),
        "resolvedEntityChanges": resolved,
        "projectedEntityChanges": projected,
        "unmatchedSubjects": unmatched,
        "ambiguousSubjects": ambiguous,
        "missingProjections": missing,
    }
    if unmatched or ambiguous or missing or resolved != len(events) or projected != len(events):
        raise PatchPublishError("current-patch entity projection is incomplete: " + json.dumps(summary, sort_keys=True))
    return summary


def verify_patch_publish(
    *,
    root: Path = ROOT,
    changed_paths: list[str] | None = None,
) -> dict[str, Any]:
    public_dir = root / "public" / "data"
    patch_notes_path = public_dir / "patch-notes.json"
    meta_path = public_dir / "meta.json"

    if not patch_notes_path.exists() or patch_notes_path.stat().st_size == 0:
        raise PatchPublishError("missing public patch-notes file or file is empty")

    data = load_json(patch_notes_path)
    if not isinstance(data, dict):
        raise PatchPublishError("public patch-notes must be a JSON object")

    entity_path = public_dir / "entity-presentation.json"
    if not entity_path.exists() or entity_path.stat().st_size == 0:
        raise PatchPublishError("missing public entity presentation file or file is empty")
    entity_data = load_json(entity_path)
    if not isinstance(entity_data, dict) or entity_data.get("schema_version") != 1:
        raise PatchPublishError("public entity presentation schema is missing or invalid")
    if not isinstance(entity_data.get("entities"), list) or not entity_data["entities"]:
        raise PatchPublishError("public entity presentation has no entities")

    patch = data.get("patch")
    if not isinstance(patch, str) or not patch:
        raise PatchPublishError("public patch-notes patch is missing")

    if meta_path.exists():
        meta = load_json(meta_path)
        meta_patch = meta.get("patch") if isinstance(meta, dict) else None
        if isinstance(meta_patch, str) and meta_patch and meta_patch != patch:
            raise PatchPublishError(
                f"patch mismatch: public patch-notes={patch} meta={meta_patch}",
            )

    scraped_at = data.get("scraped_at")
    if not isinstance(scraped_at, str) or not scraped_at:
        raise PatchPublishError("scraped_at is missing")
    try:
        parse_timestamp(scraped_at)
    except ValueError as exc:
        raise PatchPublishError(f"scraped_at is not a timestamp: {scraped_at}") from exc

    patches = data.get("patches")
    if not isinstance(patches, list) or len(patches) < 3:
        raise PatchPublishError("patches count must be at least 3")

    source_kind = data.get("sourceKind")
    if source_kind != "cdragon-structured-diff-v1":
        raise PatchPublishError("public patch-notes must be projected from CDragon structured diffs")

    source_status = data.get("status")
    if source_status not in {"fresh", "stale", "unavailable", "not_yet_confirmed"}:
        raise PatchPublishError("public patch-notes source status is missing or invalid")

    changes = all_changes(data)
    total_changes = len(changes)
    if total_changes <= 0 and source_status != "fresh":
        raise PatchPublishError("no patch changes and the CDragon source is not fresh")

    raw_kinds = {change.get("kind") for change in changes}
    kinds = sorted(kind for kind in raw_kinds if isinstance(kind, str))
    invalid_kinds = sorted(str(kind) for kind in raw_kinds if kind not in ALLOWED_KINDS)
    if invalid_kinds:
        raise PatchPublishError(f"unsupported kind(s): {', '.join(map(str, invalid_kinds))}")
    if total_changes and not any(kind in NON_GENERIC_KINDS for kind in kinds):
        raise PatchPublishError("at least one deterministic non-generic kind is required")

    zh_tw_text = sum(
        1
        for change in changes
        if isinstance(change.get("text"), dict) and change["text"].get("zh-tw")
    )
    zh_tw_coverage = zh_tw_text / total_changes if total_changes else 1.0
    if total_changes and zh_tw_coverage < 0.9:
        raise PatchPublishError(
            f"zh-TW text coverage below 90%: {zh_tw_text}/{total_changes}",
        )

    assert_publish_inclusion(changed_paths if changed_paths is not None else git_diff_name_only(root))

    completeness = _verify_current_entity_completeness(
        root=root,
        patch=patch,
        patch_notes=data,
        entity_data=entity_data,
    )

    return {
        "patch": patch,
        "scraped_at": scraped_at,
        "patches": len(patches),
        "totalChanges": total_changes,
        "zhTwText": zh_tw_text,
        "zhTwCoverage": round(zh_tw_coverage, 4),
        "kinds": kinds,
        "sourceStatus": source_status,
        **completeness,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()

    try:
        summary = verify_patch_publish(root=args.root)
    except PatchPublishError as exc:
        print(json.dumps({"error": str(exc)}, sort_keys=True), file=sys.stderr)
        raise SystemExit(1)

    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
