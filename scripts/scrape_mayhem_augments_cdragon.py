"""
Mayhem Oracle — CommunityDragon Mayhem augment base-catalog source
===============================================================
The source-versioned hotfix detector now lives in
`cdragon_patch_pipeline.py`, shared by augments, champions, and items across
both latest and PBE. This module remains the authoritative base-catalog
extractor for ARAM Mayhem's internal `kiwi` augment definitions.
"kiwi" (Arena is "cherry"); its augment definitions live in the shared augment
registry and are identified by `kiwi_*` stringtable definition keys.

This script extracts the canonical Riot augment text + rarity for every Mayhem
augment and writes the base catalog used by the normalizer.

Sources (CommunityDragon `latest`):
    roster + rarity : plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json
                      (match kiwi stringtable definition tokens to augmentNameId)
    Riot tooltips   : game/en_us/data/menu/en_us/lol.stringtable.json
                      (keys matching kiwi_*_tooltip / _desc / _name)

Usage:
    python3 scripts/scrape_mayhem_augments_cdragon.py --base-catalog-only

Output:
    data/internal/augment-base-catalog.json
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from cdragon_entity_adapters import normalize_augment_entities
from cdragon_snapshot_diff import build_snapshot, compare_snapshots
from data_paths import INTERNAL_DATA_DIR
from safe_http import read_limited_response

CDRAGON = "https://raw.communitydragon.org/latest"
ROSTER_URL = f"{CDRAGON}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json"
STRINGTABLE_URL = f"{CDRAGON}/game/en_us/data/menu/en_us/lol.stringtable.json"
ARENA_URL_TEMPLATE = f"{CDRAGON}/cdragon/arena/{{locale}}.json"
STRINGTABLE_URL_TEMPLATE = f"{CDRAGON}/game/{{locale}}/data/menu/en_us/lol.stringtable.json"

HEADERS = {"User-Agent": "MayhemOracle/1.0 (data pipeline)"}

RARITY_MAP = {"kSilver": "silver", "kGold": "gold", "kPrismatic": "prismatic"}
ARENA_RARITY_MAP = {0: "silver", 1: "gold", 2: "prismatic"}
CDRAGON_LOCALES = {
    "en": "en_us",
    "zh_cn": "zh_cn",
    "zh_tw": "zh_tw",
    "ja": "ja_jp",
    "ko": "ko_kr",
}

BASE_CATALOG_PATH = INTERNAL_DATA_DIR / "augment-base-catalog.json"
IDENTITY_ALIAS_PATH = INTERNAL_DATA_DIR / "augment-identity-aliases.json"

_NONALNUM = re.compile(r"[^a-z0-9]")
# stringtable key noise stripped before matching to an augment nameId. Mayhem
# augments are keyed kiwi_*; augments converted from Arena keep a shared cherry_*
# tooltip. We index both and prefer kiwi_ (it reflects Mayhem-specific tuning).
_KEY_PREFIX = re.compile(r"^(kiwi|cherry)_(aram_)?(augment_)?")
_KEY_SUFFIX = re.compile(r"_(tooltip|desc|summary|name)$")


def fetch_json(url: str) -> dict | list:
    print(f"  Fetching {url} ...")
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=120) as resp:
        return json.loads(read_limited_response(resp).decode("utf-8", errors="replace"))


def norm(s: str) -> str:
    """Collapse a name/key to a comparable alphanumeric token."""
    return _NONALNUM.sub("", s.lower())


def registry_token(s: str) -> str:
    """Normalize registry/stringtable tokens for CDragon augmentNameId matching."""
    token = norm(s)
    return token[4:] if token.startswith("aram") else token


def _stringtable_key_parts(key: str) -> tuple[str, str, str] | None:
    low = key.lower()
    m = _KEY_PREFIX.match(low)
    if not m:
        return None
    body = low[m.end():]
    suffix = _KEY_SUFFIX.search(body)
    if suffix:
        kind = suffix.group(1)
        body = _KEY_SUFFIX.sub("", body)
    elif m.group(2) == "aram_" and "_" not in body:
        # Some Mayhem name keys are shaped like kiwi_aram_archmage.
        kind = "name"
    else:
        return None
    token = registry_token(body)
    if not token:
        return None
    return m.group(1), token, kind


def _base_stringtable_key_parts(
    key: str, registry_tokens: frozenset[str] | None
) -> tuple[str, str, str] | None:
    """Parse an UNPREFIXED Riot string key, e.g. `upgrade_ravenous_name`.

    Some Mayhem augments publish their display text with no `kiwi_`/`cherry_`
    prefix at all. Those are still Riot-authored strings and are the only ones
    those augments have. The stringtable also holds >130k unrelated game
    strings, so an unprefixed key is read ONLY when its token is a known
    registry token -- never on shape alone.
    """
    if not registry_tokens:
        return None
    low = key.lower()
    suffix = _KEY_SUFFIX.search(low)
    if not suffix:
        return None
    token = registry_token(_KEY_SUFFIX.sub("", low))
    if token not in registry_tokens:
        return None
    return "base", token, suffix.group(1)


def build_tooltip_index(stringtable: dict) -> dict[str, str]:
    """Map normalized augment token → best Riot-authored tooltip/description.

    kiwi_ keys (Mayhem-specific) win over cherry_ keys (Arena shared); within a
    source, the longest text wins (tooltip over a terse desc).
    """
    entries = stringtable.get("entries", stringtable)
    if not isinstance(entries, dict):
        return {}
    # token -> (priority, length, text); higher priority/length replaces.
    best: dict[str, tuple[int, int, str]] = {}
    for key, value in entries.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        if not re.search(r"_(tooltip|desc)$", key.lower()):
            continue
        parts = _stringtable_key_parts(key)
        if not parts:
            continue
        prefix, token, _kind = parts
        priority = 1 if prefix == "kiwi" else 0
        cand = (priority, len(value), value.strip())
        if token not in best or cand[:2] > best[token][:2]:
            best[token] = cand
    return {tok: text for tok, (_p, _l, text) in best.items()}


def _source_priority(prefix: str) -> int:
    if prefix == "kiwi":
        return 1
    # An unprefixed Riot key is a real string but the weakest evidence: it only
    # applies when no namespaced key exists for the token.
    return -1 if prefix == "base" else 0


def build_stringtable_definition_index(
    stringtable: dict, registry_tokens: frozenset[str] | None = None
) -> dict[str, dict[str, dict]]:
    """Map normalized CDragon augment token to localized stringtable fields.

    The index keeps the selected value and the exact stringtable key. kiwi_* rows
    beat cherry_* rows; ties keep the longer text, which favors tooltip prose
    over short aliases without requiring a brittle key allowlist.
    """
    entries = stringtable.get("entries", stringtable)
    if not isinstance(entries, dict):
        return {}

    best: dict[str, dict[str, tuple[int, int, str, str]]] = {}
    for key, value in entries.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        parts = _stringtable_key_parts(key) or _base_stringtable_key_parts(key, registry_tokens)
        if not parts:
            continue
        prefix, token, kind = parts
        cand = (_source_priority(prefix), len(value), value.strip(), key)
        current = best.setdefault(token, {}).get(kind)
        if current is None or cand[:2] > current[:2]:
            best[token][kind] = cand

    return {
        token: {
            kind: {"value": text, "key": key, "source": f"cdragon:stringtable:{key}"}
            for kind, (_priority, _length, text, key) in fields.items()
        }
        for token, fields in best.items()
    }


def _arena_augments(payload: dict | list) -> list[dict]:
    if isinstance(payload, dict):
        data = payload.get("augments", [])
    else:
        data = payload
    return data if isinstance(data, list) else []


def _locale_payload(payloads: dict[str, dict | list], locale: str) -> dict | list:
    return payloads.get(locale) or payloads.get(CDRAGON_LOCALES[locale]) or {}


def _stringtable_indexes(
    payloads: dict[str, dict | list], registry_tokens: frozenset[str] | None = None
) -> dict[str, dict[str, dict[str, dict]]]:
    return {
        locale: build_stringtable_definition_index(
            _locale_payload(payloads, locale), registry_tokens
        )
        for locale in CDRAGON_LOCALES
    }


def _kiwi_definition_index(stringtable: dict | list) -> dict[str, dict]:
    entries = stringtable.get("entries", stringtable) if isinstance(stringtable, dict) else {}
    if not isinstance(entries, dict):
        return {}

    definitions: dict[str, dict] = {}
    for key, value in entries.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        parts = _stringtable_key_parts(key)
        if not parts:
            continue
        prefix, token, kind = parts
        if prefix != "kiwi":
            continue
        row = definitions.setdefault(token, {"token": token, "keys": set(), "kinds": set()})
        row["keys"].add(key)
        row["kinds"].add(kind)

    return {
        token: {
            "token": token,
            "keys": sorted(info["keys"]),
            "kinds": sorted(info["kinds"]),
        }
        for token, info in sorted(definitions.items())
        if "name" in info["kinds"]
    }


def _arena_index(arena_en: dict | list) -> dict[str, list[dict]]:
    index: dict[str, list[dict]] = {}
    for row in _arena_augments(arena_en):
        for value in (row.get("apiName"), row.get("name")):
            token = norm(value or "")
            if token:
                index.setdefault(token, []).append(row)
    return index


def is_kiwi_asset_row(augment: dict) -> bool:
    """Riot ships ARAM Mayhem augment art under /UX/Kiwi/ and Arena's under
    /UX/Cherry/. The asset namespace is Riot's own mode marker and, unlike a
    `kiwi_` display string, it does not depend on whether Mayhem-specific text
    was authored."""
    return "/ux/kiwi/" in str(augment.get("augmentSmallIconPath", "")).lower()


def _roster_rows(roster: dict | list) -> list[dict]:
    augments = roster.get("augments", roster) if isinstance(roster, dict) else roster
    if not isinstance(augments, list):
        return []
    return [augment for augment in augments if isinstance(augment, dict) and augment.get("augmentNameId")]


def _mayhem_roster_augments(
    roster: dict | list,
    kiwi_definitions: dict[str, dict],
    registry_token_aliases: dict[str, str] | None = None,
) -> tuple[list[tuple[dict, dict]], dict]:
    registry_by_token: dict[str, list[dict]] = {}
    registry_by_id: dict[str, dict] = {}
    for augment in _roster_rows(roster):
        augment_id = augment.get("augmentNameId", "")
        if augment_id:
            registry_by_id[augment_id] = augment
        token = registry_token(augment.get("augmentNameId", ""))
        if token:
            registry_by_token.setdefault(token, []).append(augment)

    aliases = {
        registry_token(token): augment_id
        for token, augment_id in (registry_token_aliases or {}).items()
        if registry_token(token) and augment_id
    }
    matched_by_id: dict[str, tuple[dict, dict]] = {}
    unmatched: list[dict] = []
    ambiguous: list[dict] = []
    disambiguated: list[dict] = []
    aliased: list[dict] = []
    duplicate_registry_ids: list[dict] = []

    for token, definition in sorted(kiwi_definitions.items()):
        matches = registry_by_token.get(token, [])
        if not matches:
            alias_target = aliases.get(token)
            if alias_target and alias_target in registry_by_id:
                matches = [registry_by_id[alias_target]]
                aliased.append({
                    "token": token,
                    "selectedAugmentNameId": alias_target,
                    "keys": definition["keys"],
                })
            elif alias_target:
                unmatched.append({
                    "token": token,
                    "keys": definition["keys"],
                    "aliasTargetMissing": alias_target,
                })
                continue
        if not matches:
            unmatched.append({"token": token, "keys": definition["keys"]})
            continue
        if len(matches) > 1:
            aram_matches = [
                match for match in matches
                if str(match.get("augmentNameId", "")).startswith("ARAM_")
            ]
            if len(aram_matches) != 1:
                ambiguous.append({
                    "token": token,
                    "keys": definition["keys"],
                    "augmentNameIds": sorted(match.get("augmentNameId", "") for match in matches),
                })
                continue
            matches = aram_matches
            disambiguated.append({
                "token": token,
                "selectedAugmentNameId": matches[0].get("augmentNameId", ""),
                "candidateAugmentNameIds": sorted(match.get("augmentNameId", "") for match in registry_by_token[token]),
                "reason": "preferred existing ARAM_ registry row over duplicate bare codename row",
            })

        augment = matches[0]
        augment_id = augment.get("augmentNameId", "")
        existing = matched_by_id.get(augment_id)
        if existing:
            duplicate_registry_ids.append({
                "augmentNameId": augment_id,
                "tokens": sorted([*existing[1]["tokens"], token]),
            })
            existing[1]["tokens"].append(token)
            existing[1]["keys"] = sorted({*existing[1]["keys"], *definition["keys"]})
            existing[1]["kinds"] = sorted({*existing[1]["kinds"], *definition["kinds"]})
            continue

        matched_by_id[augment_id] = (
            augment,
            {
                "present": True,
                "tokens": [token],
                "keys": list(definition["keys"]),
                "kinds": list(definition["kinds"]),
                "membership": "kiwi-stringtable",
            },
        )

    # Membership is not a localization question. An augment whose art lives in
    # Riot's Kiwi (Mayhem) asset namespace is Mayhem content even when Riot
    # never authored a `kiwi_` display string for it -- Upgrade_Ravenous,
    # Quest_UltraHydra, Upgrade_SunderedSky and Upgrade_DeathDance are all in
    # that position. Admission runs through the SAME token dedupe as above, so
    # a duplicate bare-codename row (Quest_VoidImmolation beside
    # ARAM_Quest_VoidImmolation) can never publish a second canonical augment.
    asset_admitted: list[dict] = []
    matched_tokens = {
        token for _augment, meta in matched_by_id.values() for token in meta["tokens"]
    }
    for token in sorted(registry_by_token):
        if token in matched_tokens:
            continue
        candidates = [row for row in registry_by_token[token] if is_kiwi_asset_row(row)]
        if not candidates:
            continue
        if len(candidates) > 1:
            aram_rows = [
                row for row in candidates
                if str(row.get("augmentNameId", "")).startswith("ARAM_")
            ]
            if len(aram_rows) != 1:
                ambiguous.append({
                    "token": token,
                    "keys": [],
                    "augmentNameIds": sorted(row.get("augmentNameId", "") for row in candidates),
                })
                continue
            candidates = aram_rows
        augment = candidates[0]
        augment_id = augment.get("augmentNameId", "")
        if not augment_id or augment_id in matched_by_id:
            continue
        matched_by_id[augment_id] = (
            augment,
            {
                "present": False,
                "tokens": [token],
                "keys": [],
                "kinds": [],
                "membership": "kiwi-asset-namespace",
            },
        )
        asset_admitted.append({"token": token, "augmentNameId": augment_id})

    matched = sorted(matched_by_id.values(), key=lambda item: item[0].get("augmentNameId", ""))
    return matched, {
        "definitionTokens": len(kiwi_definitions),
        "matchedRegistryRows": len(matched),
        "assetNamespaceAdmitted": asset_admitted,
        "unmatchedTokens": unmatched,
        "ambiguousTokens": ambiguous,
        "disambiguatedTokens": disambiguated,
        "aliasedTokens": aliased,
        "duplicateRegistryIds": duplicate_registry_ids,
    }


def _kiwi_metadata(kiwi_definition: dict | None) -> dict:
    if not kiwi_definition:
        return {"present": False, "tokens": [], "keys": [], "kinds": []}
    return {
        "present": bool(kiwi_definition.get("present", True)),
        "tokens": list(kiwi_definition.get("tokens", [])),
        "keys": list(kiwi_definition.get("keys", [])),
        "kinds": list(kiwi_definition.get("kinds", [])),
    }


def _slug_from_name_id(name_id: str) -> str:
    core = name_id.removeprefix("ARAM_")
    return re.sub(r"(?<!^)(?=[A-Z])", "-", core).lower()


def _roster_tokens(
    augment: dict, stringtable_index: dict[str, dict], kiwi_definition: dict | None = None
) -> list[str]:
    name_id = augment.get("augmentNameId", "")
    values = [
        name_id,
        name_id.removeprefix("ARAM_"),
        augment.get("nameTRA", ""),
        _slug_from_name_id(name_id),
    ]
    tokens = [registry_token(value) for value in values]
    tokens.extend(kiwi_definition.get("tokens", []) if kiwi_definition else [])
    for token in list(tokens):
        entry = stringtable_index.get(token, {}).get("name")
        if entry:
            tokens.append(registry_token(entry["value"]))
    seen: set[str] = set()
    out: list[str] = []
    for token in tokens:
        if token and token not in seen:
            seen.add(token)
            out.append(token)
    return out


def _best_string_entry(
    stringtable_index: dict[str, dict[str, dict]], tokens: list[str], kinds: tuple[str, ...]
) -> dict | None:
    for token in tokens:
        fields = stringtable_index.get(token, {})
        for kind in kinds:
            entry = fields.get(kind)
            if entry and entry.get("value"):
                return entry
    return None


def _match_arena_row(augment: dict, arena_by_token: dict[str, list[dict]], tokens: list[str]) -> dict | None:
    for token in tokens:
        matches = arena_by_token.get(token, [])
        if not matches:
            continue
        exact_api = [row for row in matches if norm(row.get("apiName", "")) == token]
        if exact_api:
            return sorted(exact_api, key=lambda row: row.get("apiName", ""))[0]
        exact_name = [row for row in matches if norm(row.get("name", "")) == token]
        if exact_name:
            return sorted(exact_name, key=lambda row: row.get("apiName", ""))[0]
        return sorted(matches, key=lambda row: row.get("apiName", ""))[0]
    return None


def _arena_row_by_api(payload: dict | list) -> dict[str, dict]:
    return {
        row.get("apiName"): row
        for row in _arena_augments(payload)
        if isinstance(row.get("apiName"), str)
    }


def _localized_names(
    augment: dict,
    arena_row: dict | None,
    arena_by_locale: dict[str, dict | list],
    stringtable_indexes: dict[str, dict[str, dict[str, dict]]],
    tokens: list[str],
) -> tuple[dict[str, str], dict[str, str]]:
    names: dict[str, str] = {}
    provenance: dict[str, str] = {}
    arena_api = arena_row.get("apiName") if arena_row else None

    for locale in CDRAGON_LOCALES:
        entry = _best_string_entry(stringtable_indexes[locale], tokens, ("name",))
        if entry:
            names[locale] = entry["value"]
            provenance[locale] = entry["source"]
            continue

        localized_row = None
        if arena_api:
            localized_row = _arena_row_by_api(_locale_payload(arena_by_locale, locale)).get(arena_api)
        if localized_row and localized_row.get("name"):
            names[locale] = localized_row["name"]
            provenance[locale] = f"cdragon:arena:{CDRAGON_LOCALES[locale]}.name"
            continue

        names[locale] = augment.get("nameTRA") or augment.get("augmentNameId", "").removeprefix("ARAM_")
        provenance[locale] = "cdragon:cherry-augments.nameTRA"

    return names, provenance


def _normalize_rarity(roster_rarity, arena_rarity=None) -> str:
    if roster_rarity in RARITY_MAP:
        return RARITY_MAP[roster_rarity]
    if arena_rarity in ARENA_RARITY_MAP:
        return ARENA_RARITY_MAP[arena_rarity]
    return str(roster_rarity or arena_rarity or "")


def _effect_text(
    arena_row: dict | None, stringtable_index: dict[str, dict[str, dict]], tokens: list[str]
) -> tuple[dict[str, str], dict[str, str]]:
    desc_entry = _best_string_entry(stringtable_index, tokens, ("desc", "summary"))
    tooltip_entry = _best_string_entry(stringtable_index, tokens, ("tooltip", "desc", "summary"))

    desc = arena_row.get("desc", "") if arena_row else ""
    desc_source = "cdragon:arena:en_us.desc" if desc else ""
    if not desc and desc_entry:
        desc = desc_entry["value"]
        desc_source = desc_entry["source"]

    tooltip = tooltip_entry["value"] if tooltip_entry else ""
    tooltip_source = tooltip_entry["source"] if tooltip_entry else ""
    if not tooltip and arena_row:
        tooltip = arena_row.get("tooltip", "")
        tooltip_source = "cdragon:arena:en_us.tooltip" if tooltip else ""

    return {"desc": desc, "tooltip": tooltip}, {"desc": desc_source, "tooltip": tooltip_source}


def _localized_effect_text(
    arena_row: dict | None,
    arena_by_locale: dict[str, dict | list],
    stringtable_indexes: dict[str, dict[str, dict[str, dict]]],
    tokens: list[str],
) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    localized: dict[str, dict[str, str]] = {}
    provenance: dict[str, dict[str, str]] = {}
    arena_api = arena_row.get("apiName") if arena_row else None

    for locale in CDRAGON_LOCALES:
        localized_arena = None
        if arena_api:
            localized_arena = _arena_row_by_api(_locale_payload(arena_by_locale, locale)).get(arena_api)

        desc_entry = _best_string_entry(stringtable_indexes[locale], tokens, ("desc", "summary"))
        tooltip_entry = _best_string_entry(
            stringtable_indexes[locale], tokens, ("tooltip", "desc", "summary")
        )

        desc = localized_arena.get("desc", "") if localized_arena else ""
        desc_source = f"cdragon:arena:{CDRAGON_LOCALES[locale]}.desc" if desc else ""
        if desc_entry:
            desc = desc_entry["value"]
            desc_source = desc_entry["source"]

        tooltip = localized_arena.get("tooltip", "") if localized_arena else ""
        tooltip_source = f"cdragon:arena:{CDRAGON_LOCALES[locale]}.tooltip" if tooltip else ""
        if tooltip_entry:
            tooltip = tooltip_entry["value"]
            tooltip_source = tooltip_entry["source"]

        localized[locale] = {"desc": desc, "tooltip": tooltip}
        provenance[locale] = {"desc": desc_source, "tooltip": tooltip_source}

    return localized, provenance


def _is_placeholder(augment_id: str, names: dict[str, str], effect: dict[str, str], arena_row: dict | None) -> bool:
    if augment_id == "ARAM_MissingPingAugment":
        return True
    name = names.get("en", "").strip()
    return name and set(name) <= {"?"} and not arena_row and not effect.get("desc") and not effect.get("tooltip")


def _catalog_counts(augments: list[dict]) -> dict:
    return {
        "augments": len(augments),
        "richEndpointMatches": sum(1 for augment in augments if augment["cdragon"].get("arenaApiName")),
        "definitionPlaceholders": sum(1 for augment in augments if augment.get("definitionPlaceholder")),
        "withIconLarge": sum(1 for augment in augments if augment["icon"].get("large")),
        "withIconSmall": sum(1 for augment in augments if augment["icon"].get("small")),
        "withRosterSmallIcon": sum(1 for augment in augments if augment["icon"].get("rosterSmall")),
        "withDataValues": sum(1 for augment in augments if bool(augment.get("dataValues"))),
        "withCalculations": sum(1 for augment in augments if bool(augment.get("calculations"))),
        "withTooltip": sum(1 for augment in augments if bool(augment["effectText"].get("tooltip"))),
        "withAllLocaleNames": sum(
            1 for augment in augments
            if all(augment["names"].get(locale) for locale in CDRAGON_LOCALES)
        ),
    }


def build_base_catalog(
    roster: dict | list,
    arena_by_locale: dict[str, dict | list],
    stringtables_by_locale: dict[str, dict | list],
    registry_token_aliases: dict[str, str] | None = None,
    fetched_at: str | None = None,
    source: str = CDRAGON,
) -> dict:
    """Build the Step 2 CDragon authoritative base catalog.

    This function is deliberately pure so unit tests can pass committed fixtures
    and never fetch live CommunityDragon.
    """
    registry_tokens = frozenset(
        token
        for token in (
            registry_token(row.get("augmentNameId", "")) for row in _roster_rows(roster)
        )
        if token
    )
    stringtable_indexes = _stringtable_indexes(stringtables_by_locale, registry_tokens)
    arena_en = _locale_payload(arena_by_locale, "en")
    arena_by_token = _arena_index(arena_en)
    kiwi_definitions = _kiwi_definition_index(_locale_payload(stringtables_by_locale, "en"))
    mayhem_roster, kiwi_report = _mayhem_roster_augments(
        roster,
        kiwi_definitions,
        registry_token_aliases=registry_token_aliases,
    )
    augments: list[dict] = []

    for roster_row, kiwi_definition in mayhem_roster:
        augment_id = roster_row["augmentNameId"]
        tokens = _roster_tokens(roster_row, stringtable_indexes["en"], kiwi_definition)
        arena_row = _match_arena_row(roster_row, arena_by_token, tokens)
        names, names_provenance = _localized_names(
            roster_row, arena_row, arena_by_locale, stringtable_indexes, tokens
        )
        effect, effect_provenance = _effect_text(arena_row, stringtable_indexes["en"], tokens)
        localized_effect, localized_effect_provenance = _localized_effect_text(
            arena_row, arena_by_locale, stringtable_indexes, tokens
        )

        data_values = arena_row.get("dataValues") if arena_row else {}
        calculations = arena_row.get("calculations") if arena_row else {}
        data_values = data_values if isinstance(data_values, dict) else {}
        calculations = calculations if isinstance(calculations, dict) else {}

        icon_large = arena_row.get("iconLarge", "") if arena_row else ""
        icon_small = arena_row.get("iconSmall", "") if arena_row else ""
        roster_small = roster_row.get("augmentSmallIconPath", "")
        if not icon_small:
            icon_small = roster_small
        slug = _slug_from_name_id(augment_id)

        augments.append({
            "augmentId": augment_id,
            "slug": slug,
            "cdragon": {
                "rosterId": roster_row.get("id"),
                "augmentNameId": augment_id,
                "arenaApiName": arena_row.get("apiName") if arena_row else None,
                "stringtableTokens": tokens,
                "kiwi": _kiwi_metadata(kiwi_definition),
                "mayhem": {
                    "member": True,
                    "evidence": (kiwi_definition or {}).get("membership", "kiwi-stringtable"),
                },
            },
            "name": names.get("en") or roster_row.get("nameTRA", ""),
            "names": names,
            "rarity": _normalize_rarity(
                roster_row.get("rarity"), arena_row.get("rarity") if arena_row else None
            ),
            "icon": {
                "large": icon_large,
                "small": icon_small,
                "rosterSmall": roster_small,
            },
            "effectText": effect,
            "effectTextByLocale": localized_effect,
            "dataValues": data_values,
            "calculations": calculations,
            "definitionPlaceholder": _is_placeholder(augment_id, names, effect, arena_row),
            "provenance": {
                "definition": "cdragon",
                "augmentId": "cdragon:cherry-augments.augmentNameId",
                "name": names_provenance.get("en", ""),
                "names": names_provenance,
                "rarity": "cdragon:cherry-augments.rarity",
                "icon": {
                    "large": "cdragon:arena:en_us.iconLarge" if icon_large else "",
                    "small": (
                        "cdragon:arena:en_us.iconSmall"
                        if arena_row and arena_row.get("iconSmall")
                        else "cdragon:cherry-augments.augmentSmallIconPath"
                    ),
                    "rosterSmall": "cdragon:cherry-augments.augmentSmallIconPath",
                },
                "effectText": effect_provenance,
                "effectTextByLocale": localized_effect_provenance,
                "dataValues": "cdragon:arena:en_us.dataValues" if arena_row else "",
                "calculations": "cdragon:arena:en_us.calculations" if arena_row else "",
            },
        })

    augments.sort(key=lambda augment: augment["augmentId"])
    return {
        "schemaVersion": 1,
        "identity_key": "CDragon augmentNameId",
        "generated_at": fetched_at or datetime.now(timezone.utc).isoformat(),
        "source": source,
        "sources": {
            "roster": ROSTER_URL,
            "arena": {
                locale: ARENA_URL_TEMPLATE.format(locale=cdragon_locale)
                for locale, cdragon_locale in CDRAGON_LOCALES.items()
            },
            "stringtable": {
                locale: STRINGTABLE_URL_TEMPLATE.format(locale=cdragon_locale)
                for locale, cdragon_locale in CDRAGON_LOCALES.items()
            },
        },
        "notes": [
            "CDragon registry presence is definition only; this catalog does not set live availability.",
            "Rows are matched from kiwi stringtable definition tokens to CDragon augmentNameId; kiwi presence is Mayhem definition evidence only.",
            "Rows without an arenaApiName are registry/stringtable definitions with no rich arena dataValues/calculations in the fetched endpoint.",
        ],
        "counts": {
            **_catalog_counts(augments),
            "kiwiDefinitionTokens": kiwi_report["definitionTokens"],
            "kiwiUnmatchedTokens": len(kiwi_report["unmatchedTokens"]),
            "kiwiAmbiguousTokens": len(kiwi_report["ambiguousTokens"]),
            "kiwiAliasedTokens": len(kiwi_report["aliasedTokens"]),
        },
        "reports": {"kiwiDefinitions": kiwi_report},
        "augments": augments,
    }


def fetch_base_catalog_inputs() -> tuple[dict | list, dict[str, dict | list], dict[str, dict | list]]:
    roster = fetch_json(ROSTER_URL)
    arena_by_locale = {
        locale: fetch_json(ARENA_URL_TEMPLATE.format(locale=cdragon_locale))
        for locale, cdragon_locale in CDRAGON_LOCALES.items()
    }
    stringtables_by_locale = {
        locale: fetch_json(STRINGTABLE_URL_TEMPLATE.format(locale=cdragon_locale))
        for locale, cdragon_locale in CDRAGON_LOCALES.items()
    }
    return roster, arena_by_locale, stringtables_by_locale


def registry_token_aliases_from_table(alias_table: dict | None) -> dict[str, str]:
    aliases: dict[str, str] = {}
    entries = alias_table.get("registry_token_aliases", []) if isinstance(alias_table, dict) else []
    if not isinstance(entries, list):
        return aliases
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        token = registry_token(entry.get("token", ""))
        augment_id = entry.get("augmentNameId", "")
        if token and augment_id:
            aliases[token] = augment_id
    return aliases


def write_base_catalog(path: Path = BASE_CATALOG_PATH) -> dict:
    roster, arena_by_locale, stringtables_by_locale = fetch_base_catalog_inputs()
    alias_table = load_json(IDENTITY_ALIAS_PATH) or {}
    catalog = build_base_catalog(
        roster,
        arena_by_locale,
        stringtables_by_locale,
        registry_token_aliases=registry_token_aliases_from_table(alias_table),
    )
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"  Mayhem base catalog: {catalog['counts']['augments']} augments; "
        f"{catalog['counts']['richEndpointMatches']} rich endpoint matches; "
        f"{catalog['counts']['withTooltip']} with tooltip"
    )
    print(f"  → {path.name} written")
    return catalog


# UI locale key → augments.json localized-name field.
_NAME_FIELDS = {"en": "name", "zh-TW": "name_zh_TW", "zh-CN": "name_zh_CN",
                "ja": "name_ja", "ko": "name_ko"}


def localized_name_index() -> dict[str, dict[str, str]]:
    """norm(slug)/norm(name) → {locale: localized augment name} from augments.json."""
    data = load_json(INTERNAL_DATA_DIR / "augments.json") or {}
    index: dict[str, dict[str, str]] = {}
    for a in data.get("augments", []):
        names = {loc: a[field] for loc, field in _NAME_FIELDS.items() if a.get(field)}
        if not names:
            continue
        for key in (a.get("slug"), a.get("name")):
            if key:
                index.setdefault(norm(key), names)
    return index


def extract_augments(
    roster: dict | list,
    tooltips: dict[str, str],
    names_idx: dict[str, dict[str, str]],
    stringtable: dict | None = None,
    registry_token_aliases: dict[str, str] | None = None,
) -> list[dict]:
    out: list[dict] = []
    if stringtable is None:
        roster_rows = [
            (augment, None)
            for augment in _roster_rows(roster)
            if augment.get("augmentNameId", "").startswith("ARAM_")
        ]
        stringtable_index: dict[str, dict[str, dict]] = {}
    else:
        roster_rows, _kiwi_report = _mayhem_roster_augments(
            roster,
            _kiwi_definition_index(stringtable),
            registry_token_aliases=registry_token_aliases,
        )
        stringtable_index = build_stringtable_definition_index(stringtable)

    for a, kiwi_definition in roster_rows:
        name_id = a.get("augmentNameId", "")
        core = name_id.removeprefix("ARAM_")
        tokens = _roster_tokens(a, stringtable_index, kiwi_definition)
        token = tokens[0] if tokens else registry_token(core)
        name_entry = _best_string_entry(stringtable_index, tokens, ("name",))
        en_name = (name_entry or {}).get("value") or a.get("nameTRA") or core
        # Join to localized names; fall back to the English name per locale.
        names = dict(names_idx.get(token, {}))
        names.setdefault("en", en_name)
        out.append({
            "nameId": name_id,
            "name": en_name,
            "names": names,
            "slug": _slug_from_name_id(name_id),
            "rarity": RARITY_MAP.get(a.get("rarity", ""), a.get("rarity", "")),
            "tooltip": tooltips.get(token, ""),
        })
    out.sort(key=lambda x: x["nameId"])
    return out


def diff_augments(old: list[dict], new: list[dict]) -> dict[str, list]:
    """Compatibility projection over the shared normalized entity comparator.

    The established hotfix feed keeps its legacy delta shape while the actual
    canonical-id comparison is now shared with champions and items.
    """
    old_by = {a["nameId"]: a for a in old}
    new_by = {a["nameId"]: a for a in new}
    if not old_by and not new_by:
        return {"added": [], "removed": [], "changed": []}
    old_snapshot = build_snapshot(
        entity_type="augment",
        branch="latest",
        source_version="legacy-augment-diff",
        source_patch_label="legacy-augment-diff",
        observed_at="1970-01-01T00:00:00Z",
        entities=normalize_augment_entities(old),
    )
    new_snapshot = build_snapshot(
        entity_type="augment",
        branch="latest",
        source_version="legacy-augment-diff",
        source_patch_label="legacy-augment-diff",
        observed_at="1970-01-01T00:00:00Z",
        entities=normalize_augment_entities(new),
    )
    events = compare_snapshots(old_snapshot, new_snapshot, detected_at="1970-01-01T00:00:00Z")
    added = [new_by[event["canonical_id"]] for event in events if event["change_kind"] == "added"]
    removed = [old_by[event["canonical_id"]] for event in events if event["change_kind"] == "removed"]
    changed = []
    for event in events:
        if event["change_kind"] in {"added", "removed"}:
            continue
        fields = [field for field in ("rarity", "tooltip", "name") if field in event["fields_changed"]]
        if fields:
            name_id = event["canonical_id"]
            changed.append({
                "nameId": name_id,
                "new": new_by[name_id],
                "fields": fields,
                "before": {field: old_by[name_id].get(field) for field in fields},
                "after": {field: new_by[name_id].get(field) for field in fields},
            })
    return {"added": added, "removed": removed, "changed": changed}


def load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-catalog-only",
        action="store_true",
        help="Fetch CDragon and write only data/internal/augment-base-catalog.json.",
    )
    parser.add_argument(
        "--base-catalog",
        action="store_true",
        help="Also write data/internal/augment-base-catalog.json after the hotfix snapshot.",
    )
    args = parser.parse_args()

    if args.base_catalog_only or args.base_catalog:
        write_base_catalog()
        return

    raise SystemExit(
        "Augment hotfix detection moved to cdragon_patch_pipeline.py; "
        "use --base-catalog-only for this base-catalog extractor."
    )


if __name__ == "__main__":
    main()
