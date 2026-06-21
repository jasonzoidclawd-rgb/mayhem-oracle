#!/usr/bin/env python3
"""Apply Riot-authored CommunityDragon Mayhem augment snapshot fields.

`scrape_mayhem_augments_cdragon.py` detects server-side hotfixes by diffing the
current CommunityDragon Mayhem augment roster against the committed snapshot.
This companion step makes the detector operational for the engine: rarity and
Riot tooltip changes are copied into `augments.json` before pool rules, combos,
and public exports are generated.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from data_paths import INTERNAL_DATA_DIR

SNAPSHOT_PATH = INTERNAL_DATA_DIR / "cdragon-mayhem-augments.json"
AUGMENTS_PATH = INTERNAL_DATA_DIR / "augments.json"
HOTFIX_PATH = INTERNAL_DATA_DIR / "mayhem-hotfixes.json"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def strip_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text).strip()


def effect_hotfix_slugs() -> set[str]:
    if not HOTFIX_PATH.exists():
        return set()
    hotfixes = read_json(HOTFIX_PATH)
    return {
        change["slug"]
        for event in hotfixes.get("events", [])
        for change in event.get("changes", [])
        if change.get("type") == "effect" and change.get("slug")
    }


def main() -> None:
    if not SNAPSHOT_PATH.exists():
        print("No CDragon Mayhem augment snapshot; skipped.")
        return

    snapshot = read_json(SNAPSHOT_PATH)
    augments_data = read_json(AUGMENTS_PATH)
    by_slug = {a.get("slug"): a for a in snapshot.get("augments", []) if a.get("slug")}
    effect_slugs = effect_hotfix_slugs()

    rarity_updates = 0
    tooltip_updates = 0
    for augment in augments_data.get("augments", []):
        source = by_slug.get(augment.get("slug"))
        if not source:
            continue

        source_rarity = source.get("rarity")
        if source_rarity and augment.get("rarity") != source_rarity:
            augment["rarity"] = source_rarity
            rarity_updates += 1

        tooltip = strip_tags(source.get("tooltip") or "") if augment.get("slug") in effect_slugs else ""
        if tooltip and augment.get("wikiDescription") != tooltip:
            augment["wikiDescription"] = tooltip
            tooltip_updates += 1

    write_json(AUGMENTS_PATH, augments_data)
    print(
        "Applied CDragon Mayhem augment snapshot: "
        f"rarity={rarity_updates}, tooltip={tooltip_updates}"
    )


if __name__ == "__main__":
    main()
