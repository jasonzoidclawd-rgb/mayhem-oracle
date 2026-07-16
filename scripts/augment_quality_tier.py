#!/usr/bin/env python3
"""Derive the bounded public augment quality tier from the canonical feed.

The calculation intentionally stays at the export boundary.  The internal
feed remains the source of truth for performance data; only the categorical
label returned by :func:`derive_quality_tiers` may cross into public data.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

from data_paths import ROOT


MIN_GLOBAL_AUGMENT_TIER_GAMES = 1000
PUBLIC_TIERS = ("S+", "S", "A", "B", "C")
GRADE_SOURCE_PATH = ROOT / "src" / "lib" / "decision" / "grade.ts"


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def _integer(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    parsed = int(value)
    return parsed if parsed == value else None


def grade_band_cut_points(source_path: Path = GRADE_SOURCE_PATH) -> tuple[float, ...]:
    """Read the existing TypeScript ``GRADE_BANDS`` contract.

    The exporter is Python, while the decision contract is TypeScript.  Read
    the existing declaration instead of maintaining a second set of
    thresholds.  The order is the source declaration order: hot, strong,
    steady, average, weak.  Those names are decision grades; this feature
    maps their population positions to S+, S, A, B, C respectively.
    """

    source = source_path.read_text(encoding="utf-8")
    block = re.search(r"export const GRADE_BANDS = \{(.*?)\n\}\s+as const;", source, re.DOTALL)
    if not block:
        raise ValueError("GRADE_BANDS declaration not found")
    values = tuple(
        float(match.group(1))
        for match in re.finditer(r"^\s*[A-Za-z]+:\s*\[[^,]+,\s*([0-9.]+)\],", block.group(1), re.MULTILINE)
    )
    if values != (0.1, 0.3, 0.6, 0.85, 1.0):
        raise ValueError(f"unexpected GRADE_BANDS cut points: {values!r}")
    return values


def _feed_value_map(feed: dict[str, Any], *keys: str) -> dict[str, Any]:
    for key in keys:
        value = feed.get(key)
        if isinstance(value, dict):
            return value
    return {}


def _feed_row(feed: dict[str, Any], canonical_id: str) -> dict[str, Any]:
    rows = feed.get("rows")
    if isinstance(rows, list):
        matches = [
            row for row in rows
            if isinstance(row, dict)
            and str(row.get("canonical_id") or row.get("augmentId") or row.get("id") or "") == canonical_id
        ]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            return {"_ambiguous": True}
    return {}


def _source_stats(feed: dict[str, Any], canonical_id: str) -> tuple[float | None, int | None, bool]:
    if canonical_id in {str(value) for value in feed.get("ambiguousAugmentIds", [])}:
        return None, None, True
    row = _feed_row(feed, canonical_id)
    if row.get("_ambiguous"):
        return None, None, True
    rates = _feed_value_map(feed, "win_rates", "winRates")
    games = _feed_value_map(feed, "sample_counts", "sampleCounts", "game_counts", "gameCounts", "games")
    rate = row.get("win_rate") if row else rates.get(canonical_id)
    game_count = (
        row.get("sample_count") if row else None
    )
    if game_count is None:
        game_count = row.get("sampleCount") if row else None
    if game_count is None:
        game_count = games.get(canonical_id)
    return _finite_number(rate), _integer(game_count), False


def _active_current(row: dict[str, Any], current_patch: str) -> bool:
    flags = row.get("flags") if isinstance(row.get("flags"), dict) else {}
    availability = row.get("availability") if isinstance(row.get("availability"), dict) else {}
    return (
        flags.get("lifecycle") in {"active", "added"}
        and availability.get("status") == "confirmed_live"
        and str(row.get("patch") or current_patch) == current_patch
    )


def _canonical_rows(catalog: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], set[str]]:
    by_id: dict[str, dict[str, Any]] = {}
    duplicates: set[str] = set()
    for row in catalog.get("augments", []):
        if not isinstance(row, dict):
            continue
        canonical_id = str(row.get("augmentId") or "").strip()
        if not canonical_id:
            continue
        if canonical_id in by_id:
            duplicates.add(canonical_id)
        else:
            by_id[canonical_id] = row
    return by_id, duplicates


def _active_rows(catalog: dict[str, Any], current_patch: str) -> dict[str, dict[str, Any]]:
    """Join current lifecycle state to the unique CDragon identity roster."""

    active: dict[str, dict[str, Any]] = {}
    for row in catalog.get("augments", []):
        if not isinstance(row, dict) or not _active_current(row, current_patch):
            continue
        canonical_id = str(row.get("augmentId") or "").strip()
        if canonical_id:
            active.setdefault(canonical_id, row)
    return active


def _ranked_tier(rank: int, population: int, cut_points: tuple[float, ...]) -> str:
    """Map a zero-based rank using ceil cumulative boundaries.

    ``ceil`` is deliberate: every non-empty eligible population gives its
    highest-ranked augment the first band, and a boundary belongs to the next
    band (rank < cumulative cutoff).  For example, n=20 allocates
    2/4/6/5/3 records across S+/S/A/B/C; n=1 allocates the sole record to S+.
    """

    for tier, boundary in zip(PUBLIC_TIERS, cut_points[:-1]):
        if rank < math.ceil(population * boundary):
            return tier
    return PUBLIC_TIERS[-1]


def derive_quality_tiers(
    *,
    catalog: dict[str, Any],
    feed: dict[str, Any],
    current_patch: str,
    identity_catalog: dict[str, Any] | None = None,
    grade_source_path: Path = GRADE_SOURCE_PATH,
) -> tuple[dict[str, str | None], dict[str, Any]]:
    """Return canonical-ID tiers and a non-public calculation summary."""

    cut_points = grade_band_cut_points(grade_source_path)
    canonical_rows, duplicates = _canonical_rows(identity_catalog or catalog)
    active_rows = _active_rows(catalog, current_patch)
    feed_patch = str(feed.get("patch") or "")
    patch_is_current = feed_patch == current_patch
    # Some canonical current-patch feeds publish real global win rates but do
    # not publish sample counts at all. Treat that as a feed-level contract,
    # not as 120 independently missing values. If the feed publishes any
    # sample counts, every row still has to meet the normal safety threshold.
    published_sample_counts = _feed_value_map(
        feed, "sample_counts", "sampleCounts", "game_counts", "gameCounts", "games"
    )
    rows = feed.get("rows") if isinstance(feed.get("rows"), list) else []
    feed_has_sample_counts = bool(published_sample_counts) or any(
        isinstance(row, dict)
        and (row.get("sample_count") is not None or row.get("sampleCount") is not None)
        for row in rows
    )
    eligible: list[tuple[str, float]] = []
    summary: dict[str, Any] = {
        "totalAugments": len(canonical_rows),
        "eligibleAugments": 0,
        "neutralAugments": len(canonical_rows),
        "tiers": {tier: 0 for tier in PUBLIC_TIERS},
        "ineligibleReasons": {},
        "feedPatch": feed_patch,
        "currentPatch": current_patch,
        "minimumGames": MIN_GLOBAL_AUGMENT_TIER_GAMES,
        "eligibilityPolicy": "sample-threshold" if feed_has_sample_counts else "current-patch-global-rank",
    }
    tiers = {canonical_id: None for canonical_id in canonical_rows}

    def reject(reason: str) -> None:
        reasons = summary["ineligibleReasons"]
        reasons[reason] = reasons.get(reason, 0) + 1

    for canonical_id, row in canonical_rows.items():
        if canonical_id in duplicates:
            reject("duplicate-canonical-identity")
            continue
        if canonical_id not in active_rows:
            reject("inactive-or-not-current")
            continue
        if not patch_is_current:
            reject("stale-or-missing-feed-patch")
            continue
        win_rate, game_count, ambiguous_feed_row = _source_stats(feed, canonical_id)
        if ambiguous_feed_row:
            reject("ambiguous-feed-row")
            continue
        if win_rate is None:
            reject("missing-or-invalid-win-rate")
            continue
        if feed_has_sample_counts and game_count is None:
            reject("missing-or-invalid-sample-count")
            continue
        if feed_has_sample_counts and game_count < MIN_GLOBAL_AUGMENT_TIER_GAMES:
            reject("insufficient-sample-count")
            continue
        eligible.append((canonical_id, win_rate))

    eligible.sort(key=lambda entry: (-entry[1], entry[0]))
    for rank, (canonical_id, _win_rate) in enumerate(eligible):
        tier = _ranked_tier(rank, len(eligible), cut_points)
        tiers[canonical_id] = tier
        summary["tiers"][tier] += 1
    summary["eligibleAugments"] = len(eligible)
    summary["neutralAugments"] = len(canonical_rows) - len(eligible)
    return tiers, summary
