#!/usr/bin/env python3
"""Assemble the internal augment catalog from authoritative Step 2-4 feeds.

Step 5 intentionally does not scrape. It composes committed artifacts:

- CDragon base catalog for definitions.
- Wiki feed for display text, notes, and availability evidence.
- arammayhem win-rate feed for win_rate only.
- Existing augments.json for classifier-owned / curated carry-forward fields.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
from collections import Counter
from pathlib import Path

from data_paths import INTERNAL_DATA_DIR


AUGMENTS_PATH = INTERNAL_DATA_DIR / "augments.json"
BASE_CATALOG_PATH = INTERNAL_DATA_DIR / "augment-base-catalog.json"
WIKI_FEED_PATH = INTERNAL_DATA_DIR / "augment-wiki-feed.json"
WINRATE_FEED_PATH = INTERNAL_DATA_DIR / "augment-winrate-feed.json"
IDENTITY_MAP_PATH = INTERNAL_DATA_DIR / "augment-identity-map.json"
PATCH_NOTES_PATH = INTERNAL_DATA_DIR / "patch-notes.json"

CDRAGON_CDN_BASE = (
    "https://raw.communitydragon.org/latest/plugins/"
    "rcp-be-lol-game-data/global/default/"
)

AVAILABILITY_STATUSES = {
    "confirmed_live",
    "candidate_registry_present",
    "disabled",
    "removed",
    "unverified_legacy",
    "conflict",
}

AVAILABILITY_STATUS_ORDER = [
    "confirmed_live",
    "candidate_registry_present",
    "disabled",
    "removed",
    "unverified_legacy",
    "conflict",
]

LOCALE_FIELDS = {
    "zh_cn": "name_zh_CN",
    "zh_tw": "name_zh_TW",
    "ja": "name_ja",
    "ko": "name_ko",
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def slugify(value: str) -> str:
    text = value.strip().lower()
    text = re.sub(r"[''`]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def slug_from_augment_id(augment_id: str) -> str:
    value = augment_id.removeprefix("ARAM_")
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", value)
    value = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1-\2", value)
    return slugify(value)


def cdragon_asset_url(path: str | None) -> str:
    if not path:
        return ""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    normalized = path.lstrip("/")
    if normalized.startswith("lol-game-data/assets/"):
        normalized = normalized[len("lol-game-data/assets/"):]
    return CDRAGON_CDN_BASE + normalized.lower()


def preferred_icon_url(icon: dict | str | None) -> str:
    if isinstance(icon, str):
        return cdragon_asset_url(icon)
    if not isinstance(icon, dict):
        return ""
    return cdragon_asset_url(icon.get("large") or icon.get("small") or icon.get("rosterSmall"))


def currently_disabled(notes: list[str]) -> bool:
    return any("currently disabled" in note.lower() for note in notes)


def wiki_signal(wiki_row: dict | None, definition_placeholder: bool) -> dict:
    if not isinstance(wiki_row, dict):
        return {
            "present": False,
            "status": "absent",
            "availabilityNotes": [],
            "hasDescription": False,
            "hasNotes": False,
            "wikiFetchedAt": None,
        }

    notes = wiki_row.get("wikiAvailabilityNotes") or []
    notes = notes if isinstance(notes, list) else []
    disabled = currently_disabled(notes)
    has_description = bool(wiki_row.get("wikiDescription"))
    has_notes = bool(wiki_row.get("wikiNotes"))
    has_rarity = bool(wiki_row.get("wikiRarity"))
    live_evidence = not definition_placeholder and not disabled and (
        has_description or has_notes or has_rarity or bool(notes)
    )
    status = "disabled" if disabled else "live" if live_evidence else "no_signal"

    return {
        "present": True,
        "status": status,
        "availabilityNotes": notes,
        "hasDescription": has_description,
        "hasNotes": has_notes,
        "wikiFetchedAt": wiki_row.get("wikiFetchedAt"),
    }


def resolve_availability(
    *,
    augment_id: str | None,
    slug: str,
    cdragon_present: bool,
    kiwi_present: bool = False,
    kiwi_keys: list[str] | None = None,
    kiwi_tokens: list[str] | None = None,
    wiki_row: dict | None,
    definition_placeholder: bool,
    tombstone_removed: bool,
    patch_removed: bool = False,
    tencent_status: str | None = None,
    telemetry_status: str | None = None,
    existing_lifecycle: str | None = None,
) -> dict:
    """Resolve availability.status according to the spec's ordering."""

    wiki = wiki_signal(wiki_row, definition_placeholder)
    live_sources: list[str] = []
    disabled_sources: list[str] = []
    removed_sources: list[str] = []
    stale_removed_sources: list[str] = []

    if tombstone_removed:
        stale_removed_sources.append("tombstone")
    if patch_removed:
        removed_sources.append("patch_notes")
    if wiki["status"] == "disabled":
        disabled_sources.append("wiki")
    elif wiki["status"] == "live":
        live_sources.append("wiki")
    if tencent_status == "removed":
        removed_sources.append("tencent")
    elif tencent_status == "disabled":
        disabled_sources.append("tencent")
    elif tencent_status == "live":
        live_sources.append("tencent")
    if telemetry_status == "removed":
        removed_sources.append("telemetry")
    elif telemetry_status == "disabled":
        disabled_sources.append("telemetry")
    elif telemetry_status in {"live", "observed_live", "observed_bug_mechanism"}:
        live_sources.append("telemetry")

    if definition_placeholder:
        status = "candidate_registry_present"
    elif patch_removed:
        status = "removed"
    elif (disabled_sources or removed_sources) and live_sources:
        status = "conflict"
    elif disabled_sources and not live_sources:
        status = "disabled"
    elif removed_sources and not live_sources:
        status = "removed"
    elif cdragon_present and wiki["status"] == "live":
        status = "confirmed_live"
    elif cdragon_present:
        status = "candidate_registry_present"
    elif wiki["status"] == "live":
        status = "conflict"
    elif stale_removed_sources:
        status = "removed"
    else:
        status = "unverified_legacy"

    signals = {
        "cdragon_registry": {
            "present": cdragon_present,
            "augmentId": augment_id,
            "definitionPlaceholder": definition_placeholder,
        },
        "kiwi": {
            "present": kiwi_present,
            "keys": kiwi_keys or [],
            "tokens": kiwi_tokens or [],
        },
        "wiki": wiki,
        "tencent": {"status": tencent_status},
        "telemetry": {"status": telemetry_status},
        "patch_notes": {"removed": patch_removed},
        "tombstone": {"removed": tombstone_removed},
        "existing_catalog": {"slug": slug, "lifecycle": existing_lifecycle},
        "resolution": {
            "liveSources": live_sources,
            "disabledSources": disabled_sources,
            "removedSources": removed_sources + stale_removed_sources,
        },
    }
    return {"status": status, "signals": signals}


def lifecycle_for_availability(status: str, *, definition_placeholder: bool = False) -> str:
    """Map resolved availability to the existing lifecycle vocabulary."""

    if status not in AVAILABILITY_STATUSES:
        raise ValueError(f"Unsupported availability.status: {status}")
    if status == "confirmed_live":
        return "active"
    if status in {"removed", "disabled", "unverified_legacy", "conflict", "candidate_registry_present"}:
        return "removed"
    raise ValueError(f"Unsupported availability.status: {status}")


def build_identity_indexes(identity_map: dict) -> tuple[dict[str, str], dict[str, str]]:
    slug_to_augment_id: dict[str, str] = {}
    primary_slug_by_id: dict[str, str] = {}

    for mapping in identity_map.get("mappings", []):
        augment_id = mapping.get("augmentId")
        if not augment_id:
            continue
        sources = (mapping.get("sources") or {}).get("internal_augments") or []
        cdragon = mapping.get("cdragon") if isinstance(mapping.get("cdragon"), dict) else {}
        cdragon_name = cdragon.get("name", "")

        for source in sources:
            slug = source.get("slug")
            if slug:
                slug_to_augment_id[slug] = augment_id

        if not sources:
            continue

        def source_rank(source: dict) -> tuple[int, int]:
            lifecycle = source.get("lifecycle")
            name_matches = normalize(source.get("name", "")) == normalize(cdragon_name)
            return (0 if lifecycle != "removed" else 1, 0 if name_matches else 1)

        primary = sorted(sources, key=source_rank)[0]
        if primary.get("slug"):
            primary_slug_by_id[augment_id] = primary["slug"]

    return slug_to_augment_id, primary_slug_by_id


def removed_patch_note_slugs(patch_notes: dict) -> set[str]:
    slugs: set[str] = set()
    for patch in patch_notes.get("patches", []):
        for section in patch.get("sections", []):
            for change in section.get("changes", []):
                subject = (change.get("subject") or {}).get("en", "")
                text = ((change.get("text") or {}).get("en") or "").strip().lower()
                if subject and text.startswith("[removed]"):
                    slugs.add(slugify(subject))
    return slugs


def preserved_flags(existing_row: dict | None, lifecycle: str) -> dict:
    existing_flags = copy.deepcopy((existing_row or {}).get("flags") or {})
    for key in (
        "lifecycle",
        "availability_override",
        "availability_label",
        "availability_source",
        "availability_observed_at",
    ):
        existing_flags.pop(key, None)
    existing_flags["system_breaker"] = bool(existing_flags.get("system_breaker"))
    existing_flags["lifecycle"] = lifecycle
    return existing_flags


def existing_removed_is_tombstone(existing_row: dict | None, slug: str, removed_slugs: set[str], wiki_row: dict | None) -> bool:
    """Treat old removed lifecycle as tombstone evidence unless wiki now says disabled."""

    if slug in removed_slugs:
        return True
    if not existing_row:
        return False
    existing_availability = existing_row.get("availability") if isinstance(existing_row.get("availability"), dict) else None
    existing_signals = existing_availability.get("signals") if isinstance(existing_availability, dict) else None
    existing_tombstone = existing_signals.get("tombstone") if isinstance(existing_signals, dict) else None
    if isinstance(existing_tombstone, dict) and isinstance(existing_tombstone.get("removed"), bool):
        return existing_tombstone["removed"]
    if existing_row.get("flags", {}).get("lifecycle") != "removed":
        return False
    notes = (wiki_row or {}).get("wikiAvailabilityNotes") or []
    return not currently_disabled(notes if isinstance(notes, list) else [])


def field_provenance(base_provenance: dict, wiki_row: dict | None, has_win_rate: bool, existing_row: dict | None) -> dict:
    provenance = copy.deepcopy(base_provenance)
    provenance["availability"] = "resolved:assemble_augments"
    provenance["wikiDescription"] = "wiki:augment-wiki-feed" if wiki_row and wiki_row.get("wikiDescription") else ""
    provenance["wikiNotes"] = "wiki:augment-wiki-feed" if wiki_row is not None else ""
    provenance["wikiAvailabilityNotes"] = "wiki:augment-wiki-feed" if wiki_row is not None else ""
    provenance["win_rate"] = "arammayhem:augment-winrate-feed" if has_win_rate else "arammayhem:augment-winrate-feed:null"
    provenance["kit_tags"] = "existing:data/internal/augments.json" if existing_row else "new:empty-unclassified"
    provenance["flags.system_breaker"] = "existing:data/internal/augments.json" if existing_row else "new:false"
    provenance["flags.lifecycle"] = "derived:availability.status"
    provenance["type"] = "existing:data/internal/augments.json" if existing_row else "new:standalone-default"
    return provenance


def build_cdragon_row(
    *,
    base: dict,
    existing_row: dict | None,
    slug: str,
    wiki_row: dict | None,
    win_rate: float | int | None,
    has_win_rate: bool,
    availability: dict,
) -> dict:
    names = base.get("names") if isinstance(base.get("names"), dict) else {}
    lifecycle = lifecycle_for_availability(
        availability["status"],
        definition_placeholder=bool(base.get("definitionPlaceholder")),
    )
    row = {
        "augmentId": base["augmentId"],
        "slug": slug,
        "name": base.get("name", ""),
        "displayName": (existing_row or {}).get("name", base.get("name", "")),
        "rarity": base.get("rarity", ""),
        "cdragonRarity": base.get("rarity", ""),
        "icon": preferred_icon_url(base.get("icon")),
        "cdragonIcon": copy.deepcopy(base.get("icon", {})),
        "names": copy.deepcopy(names),
        "effectText": copy.deepcopy(base.get("effectText", {})),
        "effectTextByLocale": copy.deepcopy(base.get("effectTextByLocale", {})),
        "canonicalTooltip": (base.get("effectText") or {}).get("tooltip", ""),
        "dataValues": copy.deepcopy(base.get("dataValues", {})),
        "calculations": copy.deepcopy(base.get("calculations", {})),
        "definitionPlaceholder": bool(base.get("definitionPlaceholder")),
        "wikiNotes": copy.deepcopy((wiki_row or {}).get("wikiNotes", [])),
        "wikiAvailabilityNotes": copy.deepcopy((wiki_row or {}).get("wikiAvailabilityNotes", [])),
        "wikiFetchedAt": (wiki_row or {}).get("wikiFetchedAt"),
        "win_rate": win_rate if has_win_rate else None,
        "kit_tags": copy.deepcopy((existing_row or {}).get("kit_tags") or []),
        "flags": preserved_flags(existing_row, lifecycle),
        "type": (existing_row or {}).get("type", "standalone"),
        "availability": availability,
        "cdragon": copy.deepcopy(base.get("cdragon", {})),
        "provenance": field_provenance(base.get("provenance", {}), wiki_row, has_win_rate, existing_row),
    }
    for locale, output_field in LOCALE_FIELDS.items():
        existing_localized = (existing_row or {}).get(output_field, "")
        if availability["status"] == "removed" and existing_localized:
            row[output_field] = existing_localized
        else:
            row[output_field] = names.get(locale) or existing_localized
    if wiki_row and wiki_row.get("wikiDescription"):
        row["wikiDescription"] = wiki_row["wikiDescription"]
    if wiki_row and wiki_row.get("wikiRarity"):
        row["wikiRarity"] = wiki_row["wikiRarity"]
    return row


def build_legacy_row(
    *,
    existing_row: dict,
    augment_id: str | None,
    cdragon_present: bool,
    wiki_row: dict | None,
    win_rate: float | int | None,
    has_win_rate: bool,
    availability: dict,
) -> dict:
    definition_placeholder = bool(
        ((availability.get("signals") or {}).get("cdragon_registry") or {}).get("definitionPlaceholder")
    )
    lifecycle = lifecycle_for_availability(
        availability["status"],
        definition_placeholder=definition_placeholder,
    )
    row = copy.deepcopy(existing_row)
    if augment_id:
        row["augmentId"] = augment_id
    row["win_rate"] = win_rate if has_win_rate else None
    row["kit_tags"] = copy.deepcopy(row.get("kit_tags") or [])
    row["flags"] = preserved_flags(row, lifecycle)
    row["type"] = row.get("type", "standalone")
    row["availability"] = availability
    row["legacyCatalogRow"] = True
    row["provenance"] = {
        "definition": "existing:data/internal/augments.json",
        "availability": "resolved:assemble_augments",
        "win_rate": "arammayhem:augment-winrate-feed" if has_win_rate else "arammayhem:augment-winrate-feed:null",
        "kit_tags": "existing:data/internal/augments.json",
        "flags.system_breaker": "existing:data/internal/augments.json",
        "flags.lifecycle": "derived:availability.status",
        "type": "existing:data/internal/augments.json",
        "wikiDescription": "existing:data/internal/augments.json",
        "cdragon_registry": "matched" if cdragon_present else "absent",
    }
    if wiki_row:
        row["wikiNotes"] = copy.deepcopy(wiki_row.get("wikiNotes", []))
        row["wikiAvailabilityNotes"] = copy.deepcopy(wiki_row.get("wikiAvailabilityNotes", []))
        row["wikiFetchedAt"] = wiki_row.get("wikiFetchedAt")
    else:
        row.setdefault("wikiNotes", [])
        row.setdefault("wikiAvailabilityNotes", [])
    return row


def kiwi_signal_from_base(base: dict | None) -> dict:
    if not isinstance(base, dict):
        return {"present": False, "keys": [], "tokens": []}
    cdragon = base.get("cdragon") if isinstance(base.get("cdragon"), dict) else {}
    kiwi = cdragon.get("kiwi") if isinstance(cdragon.get("kiwi"), dict) else {}
    return {
        "present": bool(kiwi.get("present")),
        "keys": list(kiwi.get("keys") or []),
        "tokens": list(kiwi.get("tokens") or []),
    }


def assemble_catalog(
    *,
    existing_catalog: dict,
    base_catalog: dict,
    wiki_feed: dict,
    winrate_feed: dict,
    identity_map: dict,
    removed_slugs: set[str] | None = None,
) -> dict:
    removed_slugs = removed_slugs or set()
    base_by_id = {row["augmentId"]: row for row in base_catalog.get("augments", [])}
    wiki_by_id = wiki_feed.get("augments", {})
    win_rates = winrate_feed.get("win_rates", {})
    slug_to_augment_id, primary_slug_by_id = build_identity_indexes(identity_map)
    existing_by_slug = {row.get("slug"): row for row in existing_catalog.get("augments", []) if row.get("slug")}
    emitted_base_ids: set[str] = set()
    rows: list[dict] = []

    for existing_row in existing_catalog.get("augments", []):
        slug = existing_row.get("slug") or slugify(existing_row.get("name", ""))
        mapped_augment_id = slug_to_augment_id.get(slug)
        existing_augment_id = existing_row.get("augmentId")
        augment_id = mapped_augment_id
        if not augment_id and existing_augment_id in base_by_id:
            augment_id = existing_augment_id
        base = base_by_id.get(augment_id) if augment_id else None
        primary_slug = primary_slug_by_id.get(augment_id) if augment_id else None
        is_primary = bool(
            base and (
                primary_slug == slug or
                (primary_slug is None and existing_augment_id == augment_id)
            )
        )
        wiki_row = wiki_by_id.get(augment_id) if augment_id else None
        has_win_rate = bool(augment_id in win_rates)
        win_rate = win_rates.get(augment_id) if augment_id else None
        tombstone_removed = existing_removed_is_tombstone(existing_row, slug, removed_slugs, wiki_row)

        if base and is_primary:
            kiwi_signal = kiwi_signal_from_base(base)
            availability = resolve_availability(
                augment_id=augment_id,
                slug=slug,
                cdragon_present=True,
                kiwi_present=kiwi_signal["present"],
                kiwi_keys=kiwi_signal["keys"],
                kiwi_tokens=kiwi_signal["tokens"],
                wiki_row=wiki_row,
                definition_placeholder=bool(base.get("definitionPlaceholder")),
                tombstone_removed=tombstone_removed,
                patch_removed=slug in removed_slugs,
                existing_lifecycle=existing_row.get("flags", {}).get("lifecycle"),
            )
            rows.append(build_cdragon_row(
                base=base,
                existing_row=existing_row,
                slug=slug,
                wiki_row=wiki_row,
                win_rate=win_rate,
                has_win_rate=has_win_rate,
                availability=availability,
            ))
            emitted_base_ids.add(augment_id)
            continue

        kiwi_signal = kiwi_signal_from_base(base)
        availability = resolve_availability(
            augment_id=augment_id,
            slug=slug,
            cdragon_present=bool(base),
            kiwi_present=kiwi_signal["present"],
            kiwi_keys=kiwi_signal["keys"],
            kiwi_tokens=kiwi_signal["tokens"],
            wiki_row=wiki_row,
            definition_placeholder=bool(base.get("definitionPlaceholder")) if base else False,
            tombstone_removed=tombstone_removed,
            patch_removed=slug in removed_slugs,
            existing_lifecycle=existing_row.get("flags", {}).get("lifecycle"),
        )
        rows.append(build_legacy_row(
            existing_row=existing_row,
            augment_id=augment_id,
            cdragon_present=bool(base),
            wiki_row=wiki_row,
            win_rate=win_rate,
            has_win_rate=has_win_rate,
            availability=availability,
        ))

    for augment_id, base in base_by_id.items():
        if augment_id in emitted_base_ids:
            continue
        if any(row.get("augmentId") == augment_id for row in rows):
            continue
        wiki_row = wiki_by_id.get(augment_id)
        has_win_rate = augment_id in win_rates
        slug = slugify(base.get("name", "")) or slug_from_augment_id(augment_id)
        while slug in existing_by_slug or any(row.get("slug") == slug for row in rows):
            slug = f"{slug_from_augment_id(augment_id)}-{len(rows)}"
        kiwi_signal = kiwi_signal_from_base(base)
        availability = resolve_availability(
            augment_id=augment_id,
            slug=slug,
            cdragon_present=True,
            kiwi_present=kiwi_signal["present"],
            kiwi_keys=kiwi_signal["keys"],
            kiwi_tokens=kiwi_signal["tokens"],
            wiki_row=wiki_row,
            definition_placeholder=bool(base.get("definitionPlaceholder")),
            tombstone_removed=False,
            patch_removed=slug in removed_slugs,
        )
        rows.append(build_cdragon_row(
            base=base,
            existing_row=None,
            slug=slug,
            wiki_row=wiki_row,
            win_rate=win_rates.get(augment_id),
            has_win_rate=has_win_rate,
            availability=availability,
        ))
        emitted_base_ids.add(augment_id)

    status_counts = Counter(row["availability"]["status"] for row in rows)
    return {
        "patch": existing_catalog.get("patch", "26.12"),
        "scraped_at": base_catalog.get("generated_at") or existing_catalog.get("scraped_at"),
        "schemaVersion": "augment-truth-step5",
        "sources": {
            "definition": "data/internal/augment-base-catalog.json",
            "display": "data/internal/augment-wiki-feed.json",
            "win_rate": "data/internal/augment-winrate-feed.json",
            "preserved": "data/internal/augments.json@pre-step5",
        },
        "counts": {
            "augments": len(rows),
            "availability": {status: status_counts.get(status, 0) for status in AVAILABILITY_STATUS_ORDER},
            "winRateCoverage": sum(1 for row in rows if isinstance(row.get("win_rate"), (int, float))),
        },
        "augments": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--existing", type=Path, default=AUGMENTS_PATH)
    parser.add_argument("--output", type=Path, default=AUGMENTS_PATH)
    args = parser.parse_args()

    existing_catalog = read_json(args.existing)
    base_catalog = read_json(BASE_CATALOG_PATH)
    wiki_feed = read_json(WIKI_FEED_PATH)
    winrate_feed = read_json(WINRATE_FEED_PATH)
    identity_map = read_json(IDENTITY_MAP_PATH)
    removed_slugs = removed_patch_note_slugs(read_json(PATCH_NOTES_PATH)) if PATCH_NOTES_PATH.exists() else set()

    output = assemble_catalog(
        existing_catalog=existing_catalog,
        base_catalog=base_catalog,
        wiki_feed=wiki_feed,
        winrate_feed=winrate_feed,
        identity_map=identity_map,
        removed_slugs=removed_slugs,
    )
    write_json(args.output, output)

    counts = output["counts"]["availability"]
    print(
        "Assembled augments.json: "
        f"rows={output['counts']['augments']} "
        f"confirmed_live={counts['confirmed_live']} "
        f"candidate_registry_present={counts['candidate_registry_present']} "
        f"disabled={counts['disabled']} "
        f"removed={counts['removed']} "
        f"unverified_legacy={counts['unverified_legacy']} "
        f"conflict={counts['conflict']} "
        f"win_rate={output['counts']['winRateCoverage']}"
    )


if __name__ == "__main__":
    main()
