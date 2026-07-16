#!/usr/bin/env python3
"""Export sanitized public catalogs from full internal generated data."""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
from pathlib import Path

from assemble_augments import preferred_icon_url
from augment_quality_tier import derive_quality_tiers
from cdragon_entity_adapters import is_non_mayhem_item_id
from data_paths import INTERNAL_DATA_DIR, ROOT
from entity_presentation_projection import MAYHEM_CANONICAL_ITEM_IDS, build_entity_presentation
from patch_event_projection import build_patch_notes_projection, build_preview_projection
from cdragon_snapshot_diff import atomic_write_many

PUBLIC_DATA_DIR = ROOT / "public" / "data"
COPY_FILES = ("abilities.json", "champions.json", "meta.json")
LOCALIZED_AUGMENT_DESCRIPTION_FIELDS = {
    "zh_tw": "description_zh_TW",
    "zh_cn": "description_zh_CN",
    "ja": "description_ja",
    "ko": "description_ko",
}
TAG_RE = re.compile(r"<[^>]+>")
BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
WHITESPACE_RE = re.compile(r"\s+")
PUBLIC_TIER_FORBIDDEN_KEYS = {
    "win_rate", "winRate", "raw_win_rate", "rawWinRate", "wins", "wins_count", "winsCount",
    "sample", "sample_count", "sampleCount", "sample_size", "sampleSize",
    "games", "game_count", "gameCount", "games_count", "gamesCount", "match_count", "matchCount",
    "percentile", "percentile_rank", "percentileRank", "rank", "numerical_rank",
    "numericalRank", "band", "band_threshold", "bandThreshold", "threshold",
    "thresholds", "threshold_inputs", "thresholdInputs", "calculation_inputs",
    "calculationInputs", "confidence", "confidence_interval", "confidenceInterval",
    "confidence_internals", "confidenceInternals", "scoring_inputs", "scoringInputs",
    "score", "score_breakdown", "scoreBreakdown", "source_record", "sourceRecord",
    "feed_provenance", "feedProvenance",
}
PUBLIC_ITEM_ICON_OVERRIDES = {
    # The committed snapshot predates CDragon's corrected Void Immolation
    # filename. Keep the public projection on the canonical live asset until
    # the next full acquisition refresh replaces the internal row.
    "223069": (
        "https://raw.communitydragon.org/latest/plugins/"
        "rcp-be-lol-game-data/global/default/assets/items/icons2d/"
        "223069_kiwi_voidimmolation.png"
    ),
}


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


def sanitized_description(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = BR_RE.sub(" ", value)
    text = TAG_RE.sub("", text)
    text = html.unescape(text)
    text = WHITESPACE_RE.sub(" ", text).strip()
    return text or None


def add_public_localized_augment_descriptions(augment: dict) -> None:
    by_locale = augment.get("effectTextByLocale")
    if not isinstance(by_locale, dict):
        return

    for locale_key, public_field in LOCALIZED_AUGMENT_DESCRIPTION_FIELDS.items():
        localized = by_locale.get(locale_key)
        if not isinstance(localized, dict):
            continue
        description = sanitized_description(localized.get("desc"))
        if description:
            augment[public_field] = description


def project_augment_icons(augments: dict) -> dict:
    """Use the valid CDragon small asset without mutating internal input."""
    projected = json.loads(json.dumps(augments))
    for augment in projected.get("augments", []):
        if not isinstance(augment, dict):
            continue
        corrected = preferred_icon_url(augment.get("cdragonIcon"))
        if corrected:
            augment["icon"] = corrected
    return projected


def build_public_augments(internal_dir: Path, forbidden: set[str]) -> dict:
    augments = project_augment_icons(read_json(internal_dir / "augments.json"))
    quality_tiers: dict[str, str | None] = {}
    feed_path = internal_dir / "augment-winrate-feed.json"
    identity_path = internal_dir / "augment-base-catalog.json"
    if feed_path.exists() and identity_path.exists():
        feed = read_json(feed_path)
        identity_catalog = read_json(identity_path)
        current_patch = str(augments.get("patch") or "")
        quality_tiers, _summary = derive_quality_tiers(
            catalog=augments,
            identity_catalog=identity_catalog,
            feed=feed,
            current_patch=current_patch,
        )
    pool_rules = read_json(internal_dir / "pool-rules.json")
    lifecycle = pool_rules.get("lifecycle", {}) if isinstance(pool_rules, dict) else {}
    removed_patches = lifecycle.get("removed", {}) if isinstance(lifecycle, dict) else {}
    added_patches = lifecycle.get("added", {}) if isinstance(lifecycle, dict) else {}

    for augment in augments.get("augments", []):
        slug = augment.get("slug")
        if not slug:
            continue
        augment["quality_tier"] = quality_tiers.get(str(augment.get("augmentId") or ""))
        add_public_localized_augment_descriptions(augment)
        canonical_alias = (
            ((augment.get("availability") or {}).get("signals") or {})
            .get("canonical_alias")
        )
        if isinstance(canonical_alias, dict) and canonical_alias.get("canonicalSlug"):
            augment.setdefault("flags", {})["replacement_slug"] = canonical_alias["canonicalSlug"]
        patch = removed_patches.get(slug) or added_patches.get(slug)
        if patch and (augment.get("flags") or {}).get("lifecycle") == "removed":
            augment.setdefault("flags", {})["lifecycle_patch"] = patch
        elif isinstance(augment.get("flags"), dict):
            # A current CDragon row can reappear after a stale removal event.
            # Do not let the old/addition patch leak into the public lifecycle
            # field where detail pages and archives interpret it as removal.
            augment["flags"].pop("lifecycle_patch", None)

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


def build_live_entity_lookup(internal_dir: Path) -> dict[str, set[str]]:
    """PBE cards may link only to entities already present in the live catalog."""
    champions = read_json(internal_dir / "champions.json")
    augments = read_json(internal_dir / "augments.json")
    items = read_json(internal_dir / "items.json")
    return {
        "champion": {
            str(row["slug"])
            for row in champions.get("champions", [])
            if isinstance(row, dict) and row.get("slug")
        },
        "augment": {
            str(row["slug"])
            for row in augments.get("augments", [])
            if isinstance(row, dict) and row.get("slug")
        },
        "item": {
            str(row["id"])
            for row in [*items.get("items", []), *items.get("mayhemExclusive", [])]
            if isinstance(row, dict) and row.get("id") is not None
        },
    }


def enrich_public_items(items: dict) -> dict:
    """Attach IDs and remove regular rows shadowed by Mayhem variants.

    Older internal snapshots contain both the regular CDragon row and the
    curated Mayhem row for seven canonical IDs. The regular row is not a
    second entity: it is the non-Mayhem representation of the same ID. Keep
    the curated Mayhem row and remove the shadowed regular row at the explicit
    public projection boundary. The scraper now applies the same rule at
    acquisition time; this defensive projection keeps previously generated
    internal artifacts safe until the next full refresh.
    """
    enriched = json.loads(json.dumps(items))
    enriched["items"] = [
        row for row in enriched.get("items", [])
        if not (
            isinstance(row, dict)
            and row.get("id") is not None
            and is_non_mayhem_item_id(row["id"])
        )
    ]
    for row in enriched.get("mayhemExclusive", []):
        if not isinstance(row, dict) or row.get("id") is not None:
            continue
        canonical_id = MAYHEM_CANONICAL_ITEM_IDS.get(str(row.get("slug") or ""))
        if canonical_id:
            row["id"] = int(canonical_id)

    mayhem_ids = {
        str(row.get("id"))
        for row in enriched.get("mayhemExclusive", [])
        if isinstance(row, dict) and row.get("id") is not None
    }
    regular_by_id = {
        str(row.get("id")): row
        for row in enriched.get("items", [])
        if isinstance(row, dict) and row.get("id") is not None
    }
    for row in enriched.get("mayhemExclusive", []):
        if not isinstance(row, dict) or row.get("id") is None:
            continue
        shadow = regular_by_id.get(str(row["id"]))
        if not shadow:
            continue
        # The old regular row is removed, but its Data Dragon locale fields
        # remain valid presentation metadata for the same canonical entity.
        for key, value in shadow.items():
            if key.startswith("name_") and not row.get(key) and value:
                row[key] = value
    regular_rows = []
    seen_regular_ids: set[str] = set()
    for row in enriched.get("items", []):
        if not isinstance(row, dict):
            regular_rows.append(row)
            continue
        canonical_id = row.get("id")
        if canonical_id is not None:
            key = str(canonical_id)
            if key in mayhem_ids or key in seen_regular_ids:
                continue
            seen_regular_ids.add(key)
        regular_rows.append(row)
    enriched["items"] = regular_rows
    for row in [*enriched.get("items", []), *enriched.get("mayhemExclusive", [])]:
        if isinstance(row, dict) and str(row.get("id")) in PUBLIC_ITEM_ICON_OVERRIDES:
            row["icon"] = PUBLIC_ITEM_ICON_OVERRIDES[str(row["id"])]
    return enriched


def export_public_catalog(
    internal_dir: Path = INTERNAL_DATA_DIR,
    public_dir: Path = PUBLIC_DATA_DIR,
) -> None:
    # Build every public file in memory first.  The final promotion is a
    # journaled all-files transaction so a failed projection cannot leave a
    # mixed-version public/data directory behind.
    outputs: dict[Path, object] = {}
    for filename in COPY_FILES:
        # Preserve byte-identical generated catalogs (including their existing
        # newline convention) while still staging them in the same transaction.
        outputs[public_dir / filename] = (internal_dir / filename).read_bytes()

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
    } | PUBLIC_TIER_FORBIDDEN_KEYS
    forbidden_augment_telemetry = forbidden_telemetry | {
        "counts",
        "sources",
        "wikiNotes",
        "winRateCoverage",
    }
    public_augments = build_public_augments(
        internal_dir,
        forbidden_augment_telemetry,
    )
    outputs[public_dir / "augments.json"] = public_augments
    raw_items = (internal_dir / "items.json").read_bytes()
    original_items = read_json(internal_dir / "items.json")
    parsed_items = enrich_public_items(original_items)
    sanitized_items = strip_keys(parsed_items, forbidden_telemetry)
    outputs[public_dir / "items.json"] = raw_items if sanitized_items == original_items else sanitized_items
    # One explicit projection boundary for patch data.  The browser consumes
    # these bounded presentation files, never internal CDragon snapshots or
    # event-history/provenance archives.
    known_entities = {
        **build_live_entity_lookup(internal_dir),
        "item": {
            str(row["id"])
            for row in [*parsed_items.get("items", []), *parsed_items.get("mayhemExclusive", [])]
            if isinstance(row, dict) and row.get("id") is not None
        },
    }
    patch_events = read_json(internal_dir / "patch-events.json")
    patch_metadata = read_json(internal_dir / "patch-metadata.json")
    pbe_archive = read_json(internal_dir / "pbe-preview.json")
    snapshots = {
        entity_type: read_json(internal_dir / f"cdragon-{entity_type}-latest.json")
        for entity_type in ("augment", "champion", "item")
    }
    projected_augments = project_augment_icons(read_json(internal_dir / "augments.json"))
    public_tier_by_id = {
        str(row.get("augmentId") or ""): row.get("quality_tier")
        for row in public_augments.get("augments", [])
        if isinstance(row, dict) and row.get("augmentId")
    }
    for row in projected_augments.get("augments", []):
        if isinstance(row, dict):
            row["quality_tier"] = public_tier_by_id.get(str(row.get("augmentId") or ""))
    public_item_rows = [
        {**row, "_route_identifier": str(row["id"])}
        for row in parsed_items.get("items", [])
        if isinstance(row, dict) and row.get("id") is not None
    ]
    public_item_rows.extend(
        {**row, "_route_identifier": str(row["slug"])}
        for row in parsed_items.get("mayhemExclusive", [])
        if isinstance(row, dict) and row.get("slug")
    )
    # Preserve localized identity/icon metadata for a source row that is known
    # to CDragon but deliberately has no Mayhem detail route. This lets the
    # bounded PBE projection explain the change without creating a soft 404.
    presentation_item_rows = [*public_item_rows]
    presentation_item_rows.extend(
        {**row, "_route_identifier": ""}
        for row in original_items.get("items", [])
        if isinstance(row, dict) and is_non_mayhem_item_id(row.get("id"))
    )
    catalogs = {
        "champion": {"rows": read_json(internal_dir / "champions.json").get("champions", [])},
        # Merge the exact bounded public tier into the structural internal
        # projection. This keeps placeholder/lifecycle evidence available for
        # fail-closed links while making every public frame use one tier label.
        "augment": {"rows": projected_augments.get("augments", [])},
        "item": {"rows": presentation_item_rows},
    }
    entity_presentation = build_entity_presentation(
        snapshots=snapshots,
        catalogs=catalogs,
        patch_events=patch_events,
        pbe_archive=pbe_archive,
    )
    entity_records = {
        entity_type: {
            row["canonical_id"]: row
            for row in entity_presentation["entities"]
            if row["type"] == entity_type
        }
        for entity_type in ("augment", "champion", "item")
    }
    outputs[public_dir / "patch-notes.json"] = build_patch_notes_projection(
        patch_events,
        patch_metadata,
        known=known_entities,
        pbe_archive=pbe_archive,
        entity_records=entity_records,
    )
    outputs[public_dir / "pbe-preview.json"] = build_preview_projection(
        pbe_archive,
        known_entities,
        entity_records,
    )

    # Shared EntityRef/stat presentation boundary.  This is built from the
    # normalized CDragon snapshots and bounded current-cycle events, not from
    # prose or raw internal snapshot payloads.
    outputs[public_dir / "entity-presentation.json"] = entity_presentation

    # Freemium combo teaser: publish a small slice of the headline S-tier
    # "strong combos" (champion/augment/tier only) for SEO + AI-citability and
    # as a conversion hook. The full 575-combo set, C-tier traps, oracle scores,
    # and the curated internal `ref` stay member-only.
    combos = read_json(internal_dir / "combos.json")
    combos["combos"] = build_combo_teaser(combos.get("combos", []))
    outputs[public_dir / "combos.json"] = combos

    pool_rules = read_json(internal_dir / "pool-rules.json")
    for field in ("disabled", "mutually_exclusive", "item_exclusions", "ally_exclusions"):
        pool_rules[field] = []
    pool_rules["lifecycle"] = {"added": {}, "removed": {}}
    pool_rules.pop("availability", None)
    pool_rules.pop("availability_overrides", None)
    outputs[public_dir / "pool-rules.json"] = pool_rules

    # `patch-events.json` is the authoritative hotfix feed.  The legacy
    # mayhem-hotfixes file is intentionally not exported or consumed here.
    atomic_write_many(outputs)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--internal-dir", type=Path, default=INTERNAL_DATA_DIR)
    parser.add_argument("--public-dir", type=Path, default=PUBLIC_DATA_DIR)
    args = parser.parse_args()

    export_public_catalog(args.internal_dir, args.public_dir)
    print(f"Exported sanitized public catalogs from {args.internal_dir} to {args.public_dir}")


if __name__ == "__main__":
    main()
