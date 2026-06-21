#!/usr/bin/env python3
"""Add deterministic tombstones for removed augments missing from live catalogs.

The arammayhem detail pages can outlive the actual live augment roster. When a
patch-note subject indicates an upgrade augment was removed, but the current
CommunityDragon Mayhem roster no longer contains it, keep a removed tombstone in
augments.json so OCR/history can resolve the name while pool rules and scoring
exclude it.

No LLM is used here. A small metadata table supplies fields unavailable from the
patch-note subject alone.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from data_paths import INTERNAL_DATA_DIR

AUGMENTS_PATH = INTERNAL_DATA_DIR / "augments.json"
PATCH_NOTES_PATH = INTERNAL_DATA_DIR / "patch-notes.json"
CDRAGON_SNAPSHOT_PATH = INTERNAL_DATA_DIR / "cdragon-mayhem-augments.json"


REMOVED_TOMBSTONES = {
    "upgrade-sword-of-blossoming-dawn": {
        "slug": "upgrade-sword-of-blossoming-dawn",
        "name": "Upgrade Sword of Blossoming Dawn",
        "rarity": "prismatic",
        "win_rate": None,
        "icon": "https://arammayhem.com/augments/Upgrade_Sword_of_Blossoming_Dawn_mayhem_augment.webp",
        "name_zh_CN": "升级：破晓绽放之剑",
        "name_zh_TW": "升級：破曉綻放之劍",
        "name_ja": "花咲く夜明けの剣 アップグレード",
        "name_ko": "Upgrade Sword of Blossoming Dawn",
        "wikiDescription": (
            "Gain 100% Attack Speed. When you have Sword of Blossoming Dawn, "
            "your attacks against champions deal 50% damage but increase "
            "Sword of Blossoming Dawn's healing by 250%."
        ),
        "kit_tags": ["attack", "on_hit", "heal_shield"],
        "flags": {
            "system_breaker": False,
            "lifecycle": "removed",
        },
        "type": "standalone",
    },
}


LOCALIZED_NAME_FIXES = {
    "upgrade-mikaels-blessing": {
        "name_zh_TW": "升級：米凱爾的祝福",
    },
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def slugify(value: str) -> str:
    text = value.strip().lower()
    text = re.sub(r"[''`]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def cdragon_live_slugs() -> set[str]:
    if not CDRAGON_SNAPSHOT_PATH.exists():
        return set()
    snapshot = read_json(CDRAGON_SNAPSHOT_PATH)
    return {
        augment["slug"]
        for augment in snapshot.get("augments", [])
        if augment.get("slug")
    }


def removed_patch_note_slugs() -> set[str]:
    patch_notes = read_json(PATCH_NOTES_PATH)
    slugs: set[str] = set()
    for patch in patch_notes.get("patches", []):
        for section in patch.get("sections", []):
            for change in section.get("changes", []):
                subject = (change.get("subject") or {}).get("en", "")
                text = (change.get("text") or {}).get("en", "").strip()
                if subject and text.lower().startswith("[removed]"):
                    slugs.add(slugify(subject))
    return slugs


def main() -> None:
    data = read_json(AUGMENTS_PATH)
    augments = data.get("augments", [])
    by_slug = {augment.get("slug"): augment for augment in augments}
    live_slugs = cdragon_live_slugs()
    removed_slugs = removed_patch_note_slugs()

    renamed = 0
    for slug, fixes in LOCALIZED_NAME_FIXES.items():
        augment = by_slug.get(slug)
        if not augment:
            continue
        for key, value in fixes.items():
            if augment.get(key) != value:
                augment[key] = value
                renamed += 1

    inserted = 0
    updated = 0
    skipped_live = 0
    for slug, tombstone in REMOVED_TOMBSTONES.items():
        if slug not in removed_slugs:
            continue
        if slug in live_slugs:
            skipped_live += 1
            continue

        existing = by_slug.get(slug)
        if existing:
            existing.update(tombstone)
            existing.setdefault("flags", {}).update(tombstone["flags"])
            updated += 1
        else:
            augments.append(dict(tombstone))
            inserted += 1

    write_json(AUGMENTS_PATH, data)
    print(
        "Applied removed augment tombstones: "
        f"inserted={inserted}, updated={updated}, renamed={renamed}, "
        f"skipped_live={skipped_live}"
    )


if __name__ == "__main__":
    main()
