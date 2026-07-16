#!/usr/bin/env python3
"""Build the internal augment win-rate feed keyed by CDragon augmentNameId."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from augment_identity_resolver import normalize_identity_key
from data_paths import INTERNAL_DATA_DIR


IDENTITY_MAP_PATH = INTERNAL_DATA_DIR / "augment-identity-map.json"
UNMATCHED_REPORT_PATH = INTERNAL_DATA_DIR / "augment-identity-unmatched-report.json"
BASE_CATALOG_PATH = INTERNAL_DATA_DIR / "augment-base-catalog.json"
WIN_RATE_FEED_PATH = INTERNAL_DATA_DIR / "augment-winrate-feed.json"
IDENTITY_SOURCE = "arammayhem_win_rate"
FEED_SOURCE = "arammayhem"
IDENTITY_KEY = "CDragon augmentNameId"


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _numeric_win_rate(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).rstrip("%"))
    except (TypeError, ValueError):
        return None


def _identity_lookup(identity_map: dict[str, Any]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for mapping in identity_map.get("mappings", []):
        augment_id = mapping.get("augmentId")
        if not augment_id:
            continue
        for source in (mapping.get("sources") or {}).get(IDENTITY_SOURCE, []):
            for field in ("sourceKey", "slug"):
                token = normalize_identity_key(source.get(field))
                if token:
                    lookup[token] = augment_id
    return lookup


def _base_augment_ids(base_catalog: dict[str, Any] | None) -> list[str]:
    if not base_catalog:
        return []
    return sorted(
        augment["augmentId"]
        for augment in base_catalog.get("augments", [])
        if augment.get("augmentId")
    )


def _feed_row(source_key: Any, win_rate: Any) -> dict[str, Any]:
    row: dict[str, Any] = {"sourceKey": str(source_key or "")}
    parsed = _numeric_win_rate(win_rate)
    if parsed is not None:
        row["win_rate"] = parsed
    return row


def _source_sample_count(row: dict[str, Any]) -> int | None:
    for key in ("sample_count", "sampleCount", "games", "game_count", "gameCount"):
        value = row.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        parsed = int(value)
        if parsed == value and parsed >= 0:
            return parsed
    return None


def _unmatched_row(source_key: Any, win_rate: Any, reason: str) -> dict[str, Any]:
    row = _feed_row(source_key, win_rate)
    row["reason"] = reason
    return row


def build_arammayhem_win_rate_feed(
    *,
    rows: list[dict[str, Any]],
    identity_map: dict[str, Any],
    base_catalog: dict[str, Any] | None = None,
    patch: str | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    lookup = _identity_lookup(identity_map)
    win_rates: dict[str, float] = {}
    sample_counts: dict[str, int] = {}
    duplicate_ids: set[str] = set()
    unmatched: list[dict[str, Any]] = []
    rows_without_win_rate = 0

    for row in rows:
        source_key = row.get("sourceKey")
        win_rate = _numeric_win_rate(row.get("win_rate"))
        if win_rate is None:
            rows_without_win_rate += 1
            continue

        augment_id = lookup.get(normalize_identity_key(source_key))
        if not augment_id:
            unmatched.append(
                _unmatched_row(
                    source_key,
                    win_rate,
                    "no Step 1 arammayhem_win_rate mapping",
                )
            )
            continue

        if augment_id in win_rates:
            duplicate_ids.add(augment_id)
        win_rates[augment_id] = win_rate
        sample_count = _source_sample_count(row)
        if sample_count is not None:
            sample_counts[augment_id] = sample_count

    base_ids = _base_augment_ids(base_catalog)
    missing_ids = sorted(set(base_ids) - set(win_rates))

    return {
        "schemaVersion": 1,
        "identity_key": IDENTITY_KEY,
        "source": FEED_SOURCE,
        "patch": patch or "",
        "generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
        "counts": {
            "sourceRows": len(rows),
            "matchedAugmentIds": len(win_rates),
            "baseCatalogAugmentIds": len(base_ids),
            "missingWinRateAugmentIds": len(missing_ids),
            "unmatchedSourceRows": len(unmatched),
            "sourceRowsWithoutWinRate": rows_without_win_rate,
        },
        "win_rates": dict(sorted(win_rates.items())),
        "sample_counts": dict(sorted(sample_counts.items())),
        "ambiguousAugmentIds": sorted(duplicate_ids),
        "missingAugmentIds": missing_ids,
        "unmatched": unmatched,
        "notes": [
            "This feed is telemetry-style data only; CDragon remains augment definition authority.",
            "Unmatched arammayhem rows are report-only and do not block downstream null win_rate handling.",
        ],
    }


def rows_from_step1_reports(
    identity_map: dict[str, Any],
    unmatched_report: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for mapping in identity_map.get("mappings", []):
        for source in (mapping.get("sources") or {}).get(IDENTITY_SOURCE, []):
            if source.get("sourceKey"):
                rows.append({
                    **_feed_row(source.get("sourceKey"), source.get("win_rate")),
                    **{key: source[key] for key in ("sample_count", "sampleCount", "games", "game_count", "gameCount") if key in source},
                })

    sources = (unmatched_report or {}).get("sources") or {}
    for source in sources.get(IDENTITY_SOURCE, []):
        if source.get("sourceKey"):
            rows.append({
                **_feed_row(source.get("sourceKey"), source.get("win_rate")),
                **{key: source[key] for key in ("sample_count", "sampleCount", "games", "game_count", "gameCount") if key in source},
            })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity-map", type=Path, default=IDENTITY_MAP_PATH)
    parser.add_argument("--unmatched-report", type=Path, default=UNMATCHED_REPORT_PATH)
    parser.add_argument("--base-catalog", type=Path, default=BASE_CATALOG_PATH)
    parser.add_argument("--out", type=Path, default=WIN_RATE_FEED_PATH)
    args = parser.parse_args()

    identity_map = load_json(args.identity_map)
    unmatched_report = load_json(args.unmatched_report) if args.unmatched_report.exists() else None
    base_catalog = load_json(args.base_catalog) if args.base_catalog.exists() else None
    meta_path = INTERNAL_DATA_DIR / "meta.json"
    meta = load_json(meta_path) if meta_path.exists() else {}
    feed = build_arammayhem_win_rate_feed(
        rows=rows_from_step1_reports(identity_map, unmatched_report),
        identity_map=identity_map,
        base_catalog=base_catalog,
        patch=str(meta.get("patch") or ""),
    )
    write_json(args.out, feed)
    print(
        "augment win-rate feed: "
        f"{feed['counts']['matchedAugmentIds']} augmentIds with win_rate; "
        f"{feed['counts']['missingWinRateAugmentIds']} missing; "
        f"{feed['counts']['unmatchedSourceRows']} unmatched rows"
    )


if __name__ == "__main__":
    main()
