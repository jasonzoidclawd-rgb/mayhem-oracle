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
    } & changed)
    pbe_internal_changed = "data/internal/pbe-preview.json" in changed
    public_changed = "public/data/patch-notes.json" in changed
    public_pbe_changed = "public/data/pbe-preview.json" in changed
    if internal_changed and not public_changed:
        raise PatchPublishError(
            "public patch-notes must be changed when internal patch event or metadata data changes",
        )
    if pbe_internal_changed and not public_pbe_changed:
        raise PatchPublishError(
            "public PBE preview must be changed when internal PBE preview data changes",
        )


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

    patch = data.get("patch")
    if not isinstance(patch, str) or not patch:
        raise PatchPublishError("public patch-notes patch is missing")

    if meta_path.exists():
        meta = load_json(meta_path)
        catalog_patch = meta.get("catalog_patch") if isinstance(meta, dict) else None
        if not isinstance(catalog_patch, str) or not catalog_patch:
            raise PatchPublishError("missing Riot patch authority: meta.catalog_patch")
        if catalog_patch != patch:
            raise PatchPublishError(
                "patch mismatch: "
                f"public patch-notes.patch={patch} meta.catalog_patch={catalog_patch}",
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

    return {
        "patch": patch,
        "scraped_at": scraped_at,
        "patches": len(patches),
        "totalChanges": total_changes,
        "zhTwText": zh_tw_text,
        "zhTwCoverage": round(zh_tw_coverage, 4),
        "kinds": kinds,
        "sourceStatus": source_status,
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
