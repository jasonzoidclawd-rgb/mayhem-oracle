"""
Mayhem Oracle — CommunityDragon first-hand augment source + hotfix detector
===========================================================================
Riot does NOT publish ARAM: Mayhem server-side hotfixes ("不停機更新") on the
English patch-notes page, so the scraper that reads `...-patch-X-Y-notes` pages
is structurally blind to them. The authoritative first-hand source is the live
game data, mirrored by CommunityDragon. ARAM Mayhem's internal codename is
"kiwi" (Arena is "cherry"); its augments live in the shared augment registry
under the `ARAM_` nameId prefix.

This script extracts the canonical Riot augment text + rarity for every Mayhem
augment, writes a snapshot, and — by diffing against the previously committed
snapshot — emits hotfix records when augment text/rarity changes while the
patch number is unchanged. That is the signal a server-side hotfix shipped.

Sources (CommunityDragon `latest`):
    roster + rarity : plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json
                      (filter augmentNameId starting "ARAM_")
    Riot tooltips   : game/en_us/data/menu/en_us/lol.stringtable.json
                      (keys matching kiwi_*_tooltip / _desc / _name)

Usage:
    python3 scripts/scrape_mayhem_augments_cdragon.py

Output:
    data/internal/cdragon-mayhem-augments.json   – canonical snapshot (committed)
    data/internal/mayhem-hotfixes.json           – detected hotfix events (committed)
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from data_paths import INTERNAL_DATA_DIR

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

SNAPSHOT_PATH = INTERNAL_DATA_DIR / "cdragon-mayhem-augments.json"
HOTFIX_PATH = INTERNAL_DATA_DIR / "mayhem-hotfixes.json"
BASE_CATALOG_PATH = INTERNAL_DATA_DIR / "augment-base-catalog.json"

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
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def norm(s: str) -> str:
    """Collapse a name/key to a comparable alphanumeric token."""
    return _NONALNUM.sub("", s.lower())


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
        low = key.lower()
        if not re.search(r"_(tooltip|desc)$", low):
            continue
        m = _KEY_PREFIX.match(low)
        if not m:
            continue
        priority = 1 if m.group(1) == "kiwi" else 0
        token = norm(_KEY_SUFFIX.sub("", _KEY_PREFIX.sub("", low)))
        if not token:
            continue
        cand = (priority, len(value), value.strip())
        if token not in best or cand[:2] > best[token][:2]:
            best[token] = cand
    return {tok: text for tok, (_p, _l, text) in best.items()}


def _source_priority(prefix: str) -> int:
    return 1 if prefix == "kiwi" else 0


def build_stringtable_definition_index(stringtable: dict) -> dict[str, dict[str, dict]]:
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
        low = key.lower()
        m = _KEY_PREFIX.match(low)
        if not m:
            continue
        body = _KEY_PREFIX.sub("", low)
        suffix = _KEY_SUFFIX.search(body)
        if suffix:
            kind = suffix.group(1)
            body = _KEY_SUFFIX.sub("", body)
        else:
            # Some Mayhem name keys are shaped like kiwi_aram_archmage.
            kind = "name"
        token = norm(body)
        if not token:
            continue
        cand = (_source_priority(m.group(1)), len(value), value.strip(), key)
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


def _stringtable_indexes(payloads: dict[str, dict | list]) -> dict[str, dict[str, dict[str, dict]]]:
    return {
        locale: build_stringtable_definition_index(_locale_payload(payloads, locale))
        for locale in CDRAGON_LOCALES
    }


def _arena_index(arena_en: dict | list) -> dict[str, list[dict]]:
    index: dict[str, list[dict]] = {}
    for row in _arena_augments(arena_en):
        for value in (row.get("apiName"), row.get("name")):
            token = norm(value or "")
            if token:
                index.setdefault(token, []).append(row)
    return index


def _roster_augments(roster: dict | list) -> list[dict]:
    augments = roster.get("augments", roster) if isinstance(roster, dict) else roster
    if not isinstance(augments, list):
        return []
    return [
        augment for augment in augments
        if isinstance(augment, dict) and augment.get("augmentNameId", "").startswith("ARAM_")
    ]


def _slug_from_name_id(name_id: str) -> str:
    core = name_id.removeprefix("ARAM_")
    return re.sub(r"(?<!^)(?=[A-Z])", "-", core).lower()


def _roster_tokens(augment: dict, stringtable_index: dict[str, dict]) -> list[str]:
    name_id = augment.get("augmentNameId", "")
    values = [
        name_id,
        name_id.removeprefix("ARAM_"),
        augment.get("nameTRA", ""),
        _slug_from_name_id(name_id),
    ]
    tokens = [norm(value) for value in values]
    for token in list(tokens):
        entry = stringtable_index.get(token, {}).get("name")
        if entry:
            tokens.append(norm(entry["value"]))
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
    fetched_at: str | None = None,
    source: str = CDRAGON,
) -> dict:
    """Build the Step 2 CDragon authoritative base catalog.

    This function is deliberately pure so unit tests can pass committed fixtures
    and never fetch live CommunityDragon.
    """
    stringtable_indexes = _stringtable_indexes(stringtables_by_locale)
    arena_en = _locale_payload(arena_by_locale, "en")
    arena_by_token = _arena_index(arena_en)
    augments: list[dict] = []

    for roster_row in _roster_augments(roster):
        augment_id = roster_row["augmentNameId"]
        tokens = _roster_tokens(roster_row, stringtable_indexes["en"])
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

        augments.append({
            "augmentId": augment_id,
            "cdragon": {
                "rosterId": roster_row.get("id"),
                "augmentNameId": augment_id,
                "arenaApiName": arena_row.get("apiName") if arena_row else None,
                "stringtableTokens": tokens,
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
            "Rows without an arenaApiName are registry/stringtable definitions with no rich arena dataValues/calculations in the fetched endpoint.",
        ],
        "counts": _catalog_counts(augments),
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


def write_base_catalog(path: Path = BASE_CATALOG_PATH) -> dict:
    roster, arena_by_locale, stringtables_by_locale = fetch_base_catalog_inputs()
    catalog = build_base_catalog(roster, arena_by_locale, stringtables_by_locale)
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
    roster: dict | list, tooltips: dict[str, str], names_idx: dict[str, dict[str, str]]
) -> list[dict]:
    augs = roster.get("augments", roster) if isinstance(roster, dict) else roster
    out: list[dict] = []
    for a in augs:
        name_id = a.get("augmentNameId", "")
        if not name_id.startswith("ARAM_"):
            continue
        core = name_id[len("ARAM_"):]
        token = norm(core)
        en_name = a.get("nameTRA") or core
        # Join to localized names; fall back to the English name per locale.
        names = dict(names_idx.get(token, {}))
        names.setdefault("en", en_name)
        out.append({
            "nameId": name_id,
            "name": en_name,
            "names": names,
            "slug": re.sub(r"(?<!^)(?=[A-Z])", "-", core).lower(),
            "rarity": RARITY_MAP.get(a.get("rarity", ""), a.get("rarity", "")),
            "tooltip": tooltips.get(token, ""),
        })
    out.sort(key=lambda x: x["nameId"])
    return out


def _change_record(aug: dict, ctype: str, **extra) -> dict:
    """One localized hotfix change row for the UI."""
    rec = {"slug": aug["slug"], "names": aug.get("names", {"en": aug["name"]}),
           "rarity": aug.get("rarity"), "type": ctype}
    rec.update(extra)
    return rec


def build_event(delta: dict, patch: str, when: str) -> dict:
    """Turn a raw augment diff into a localized, structured hotfix event."""
    changes: list[dict] = []
    for a in delta["added"]:
        changes.append(_change_record(a, "added"))
    for a in delta["removed"]:
        changes.append(_change_record(a, "removed"))
    for c in delta["changed"]:
        aug = c["new"]
        if "rarity" in c["fields"]:
            changes.append(_change_record(aug, "rarity",
                                          fromRarity=c["before"].get("rarity"),
                                          toRarity=c["after"].get("rarity")))
        if "tooltip" in c["fields"] or "name" in c["fields"]:
            changes.append(_change_record(aug, "effect"))
    return {"detected_at": when, "patch": patch, "date": when[:10], "changes": changes}


def diff_augments(old: list[dict], new: list[dict]) -> dict[str, list]:
    old_by = {a["nameId"]: a for a in old}
    new_by = {a["nameId"]: a for a in new}
    added = [new_by[k] for k in new_by.keys() - old_by.keys()]
    removed = [old_by[k] for k in old_by.keys() - new_by.keys()]
    changed = []
    for k in old_by.keys() & new_by.keys():
        o, n = old_by[k], new_by[k]
        fields = [f for f in ("rarity", "tooltip", "name") if o.get(f) != n.get(f)]
        if fields:
            changed.append({"nameId": k, "new": n, "fields": fields,
                            "before": {f: o.get(f) for f in fields},
                            "after": {f: n.get(f) for f in fields}})
    return {"added": added, "removed": removed, "changed": changed}


def load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def retire_observed_mechanism_events() -> None:
    """Remove retired downstream observed-live events from the hotfix feed."""

    hotfixes = load_json(HOTFIX_PATH)
    if not hotfixes:
        return

    changed = False
    events = []
    for event in hotfixes.get("events", []):
        changes = [
            change for change in event.get("changes", [])
            if change.get("type") != "mechanism" and change.get("status") != "bug_mechanism"
        ]
        if len(changes) != len(event.get("changes", [])):
            changed = True
        if changes:
            events.append({**event, "changes": changes})

    if not changed:
        return

    hotfixes["events"] = events
    HOTFIX_PATH.write_text(
        json.dumps(hotfixes, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("  Retired observed-live mechanism events from mayhem-hotfixes.json")


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

    if args.base_catalog_only:
        write_base_catalog()
        return

    meta = load_json(INTERNAL_DATA_DIR / "meta.json") or {}
    patch = meta.get("patch", "unknown")

    roster = fetch_json(ROSTER_URL)
    stringtable = fetch_json(STRINGTABLE_URL)
    tooltips = build_tooltip_index(stringtable)
    augments = extract_augments(roster, tooltips, localized_name_index())
    matched = sum(1 for a in augments if a["tooltip"])
    print(f"  Mayhem augments: {len(augments)} ({matched} with Riot tooltip)")

    prev = load_json(SNAPSHOT_PATH)
    now = datetime.now(timezone.utc).isoformat()

    if prev and prev.get("augments"):
        delta = diff_augments(prev["augments"], augments)
        n = len(delta["added"]) + len(delta["removed"]) + len(delta["changed"])
        if n and prev.get("patch") == patch:
            # Same patch, different augment data => server-side hotfix.
            event = build_event(delta, patch, now)
            hotfixes = load_json(HOTFIX_PATH) or {"events": []}
            hotfixes["patch"] = patch
            hotfixes["generated_at"] = now
            hotfixes["events"] = [
                e for e in hotfixes.get("events", []) if e.get("date") != event["date"]
            ] + [event]
            hotfixes["events"].sort(key=lambda e: e["detected_at"], reverse=True)
            HOTFIX_PATH.write_text(
                json.dumps(hotfixes, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(f"  ⚠ HOTFIX detected on patch {patch}: "
                  f"+{len(delta['added'])} -{len(delta['removed'])} "
                  f"~{len(delta['changed'])} augments → {HOTFIX_PATH.name}")
        elif n:
            print(f"  Patch changed ({prev.get('patch')} → {patch}); "
                  f"{n} augment deltas attributed to the patch, not a hotfix.")
        else:
            print("  No augment changes since last snapshot.")
    else:
        print("  No prior snapshot — establishing hotfix-detection baseline.")

    SNAPSHOT_PATH.write_text(
        json.dumps({"patch": patch, "fetched_at": now, "source": CDRAGON,
                    "augments": augments}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  → {SNAPSHOT_PATH.name} written")

    if args.base_catalog:
        write_base_catalog()

    retire_observed_mechanism_events()


if __name__ == "__main__":
    main()
