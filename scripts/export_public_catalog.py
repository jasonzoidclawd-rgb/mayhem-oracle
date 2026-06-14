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
    }
    write_sanitized_json(
        internal_dir / "augments.json",
        public_dir / "augments.json",
        forbidden_telemetry,
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

    combos = read_json(internal_dir / "combos.json")
    combos["combos"] = []
    write_json(public_dir / "combos.json", combos)

    pool_rules = read_json(internal_dir / "pool-rules.json")
    for field in ("disabled", "mutually_exclusive", "item_exclusions", "ally_exclusions"):
        pool_rules[field] = []
    write_json(public_dir / "pool-rules.json", pool_rules)

    # Hotfix feed (public-safe: localized names, rarity, change type only).
    hotfixes = internal_dir / "mayhem-hotfixes.json"
    if hotfixes.exists():
        copy_json(hotfixes, public_dir / "mayhem-hotfixes.json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--internal-dir", type=Path, default=INTERNAL_DATA_DIR)
    parser.add_argument("--public-dir", type=Path, default=PUBLIC_DATA_DIR)
    args = parser.parse_args()

    export_public_catalog(args.internal_dir, args.public_dir)
    print(f"Exported sanitized public catalogs from {args.internal_dir} to {args.public_dir}")


if __name__ == "__main__":
    main()
