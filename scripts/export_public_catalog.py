#!/usr/bin/env python3
"""Export sanitized public catalogs from full internal generated data."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from data_paths import INTERNAL_DATA_DIR, ROOT

PUBLIC_DATA_DIR = ROOT / "public" / "data"
COPY_FILES = ("abilities.json", "champions.json", "meta.json")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def copy_json(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def write_sanitized_json(source: Path, destination: Path, forbidden: set[str]) -> None:
    original = read_json(source)
    sanitized = strip_keys(original, forbidden)
    if sanitized == original:
        copy_json(source, destination)
    else:
        write_json(destination, sanitized)


def strip_keys(value, forbidden: set[str]):
    if isinstance(value, list):
        return [strip_keys(entry, forbidden) for entry in value]
    if isinstance(value, dict):
        return {
            key: strip_keys(entry, forbidden)
            for key, entry in value.items()
            if key not in forbidden
        }
    return value


def build_public_augments(internal_dir: Path, forbidden: set[str]) -> dict:
    augments = read_json(internal_dir / "augments.json")
    pool_rules = read_json(internal_dir / "pool-rules.json")
    lifecycle = pool_rules.get("lifecycle", {}) if isinstance(pool_rules, dict) else {}
    removed_patches = lifecycle.get("removed", {}) if isinstance(lifecycle, dict) else {}
    added_patches = lifecycle.get("added", {}) if isinstance(lifecycle, dict) else {}

    for augment in augments.get("augments", []):
        slug = augment.get("slug")
        if not slug:
            continue
        patch = removed_patches.get(slug) or added_patches.get(slug)
        if patch:
            augment.setdefault("flags", {})["lifecycle_patch"] = patch

    return strip_keys(augments, forbidden)


PUBLIC_COMBO_TIERS = {"S"}
MAX_TEASER_PER_CHAMPION = 3


def build_combo_teaser(combos: list[dict]) -> list[dict]:
    """Top S-tier combos per champion, names + tier only (no internal ref)."""
    teaser: list[dict] = []
    per_champion: dict[str, int] = {}
    for combo in combos:
        if combo.get("tier") not in PUBLIC_COMBO_TIERS:
            continue
        champion = combo.get("champion")
        augment = combo.get("augment")
        if not (champion and augment):
            continue
        if per_champion.get(champion, 0) >= MAX_TEASER_PER_CHAMPION:
            continue
        per_champion[champion] = per_champion.get(champion, 0) + 1
        teaser.append({
            "champion": champion,
            "augment": augment,
            "tier": combo["tier"],
        })
    return teaser


def build_public_hotfixes(hotfixes: dict) -> dict:
    events = []
    for event in hotfixes.get("events", []):
        changes = [
            change for change in event.get("changes", [])
            if change.get("type") != "mechanism" and change.get("status") != "bug_mechanism"
        ]
        if changes:
            events.append({**event, "changes": changes})
    return {**hotfixes, "events": events}


def export_public_catalog(
    internal_dir: Path = INTERNAL_DATA_DIR,
    public_dir: Path = PUBLIC_DATA_DIR,
) -> None:
    for filename in COPY_FILES:
        copy_json(internal_dir / filename, public_dir / filename)

    forbidden_telemetry = {
        "win_rate",
        "winRate",
        "oracleScore",
        "modelWeights",
        "scoreBreakdown",
        "availability",
        "signals",
        "provenance",
        "dataValues",
        "calculations",
        "wikiAvailabilityNotes",
        "wikiFetchedAt",
        "cdragon",
        "cdragonIcon",
        "cdragonRarity",
        "canonicalTooltip",
        "effectText",
        "effectTextByLocale",
        "definitionPlaceholder",
        "legacyCatalogRow",
    }
    forbidden_augment_telemetry = forbidden_telemetry | {"wikiNotes"}
    write_json(
        public_dir / "augments.json",
        build_public_augments(internal_dir, forbidden_augment_telemetry),
    )
    write_sanitized_json(
        internal_dir / "items.json",
        public_dir / "items.json",
        forbidden_telemetry,
    )
    write_sanitized_json(
        internal_dir / "patch-notes.json",
        public_dir / "patch-notes.json",
        forbidden_telemetry,
    )

    # Freemium combo teaser: publish a small slice of the headline S-tier
    # "strong combos" (champion/augment/tier only) for SEO + AI-citability and
    # as a conversion hook. The full 575-combo set, C-tier traps, oracle scores,
    # and the curated internal `ref` stay member-only.
    combos = read_json(internal_dir / "combos.json")
    combos["combos"] = build_combo_teaser(combos.get("combos", []))
    write_json(public_dir / "combos.json", combos)

    pool_rules = read_json(internal_dir / "pool-rules.json")
    for field in ("disabled", "mutually_exclusive", "item_exclusions", "ally_exclusions"):
        pool_rules[field] = []
    pool_rules["lifecycle"] = {"added": {}, "removed": {}}
    pool_rules.pop("availability", None)
    pool_rules.pop("availability_overrides", None)
    write_json(public_dir / "pool-rules.json", pool_rules)

    # Hotfix feed (public-safe: localized names, rarity, change type only).
    hotfixes = internal_dir / "mayhem-hotfixes.json"
    if hotfixes.exists():
        write_json(public_dir / "mayhem-hotfixes.json", build_public_hotfixes(read_json(hotfixes)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--internal-dir", type=Path, default=INTERNAL_DATA_DIR)
    parser.add_argument("--public-dir", type=Path, default=PUBLIC_DATA_DIR)
    args = parser.parse_args()

    export_public_catalog(args.internal_dir, args.public_dir)
    print(f"Exported sanitized public catalogs from {args.internal_dir} to {args.public_dir}")


if __name__ == "__main__":
    main()
