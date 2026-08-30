"""
Mayhem Oracle — localized champion, ability & item names from Data Dragon
========================================================================
The augments pipeline carries localized names (name_zh_TW/…), so the augments
page renders in every locale. Champions, abilities, and items only had English
`name`, so the tier-list, champion, and item pages showed English regardless of
the chosen locale. Data Dragon publishes per-locale champion/ability/item data;
this enriches the internal generated files in place with name_<locale> fields
using the same convention as augments.

Champions are matched to Data Dragon by the numeric key embedded in their icon
URL (…/champion-icons/<key>.png). Abilities are matched by champion slug plus
ability key. Items are matched by numeric id. Records with no Data Dragon match
(e.g. Mayhem-exclusive items) keep English only.

Usage:
    python3 scripts/enrich_locale_names.py

Output (in place):
    data/internal/champions.json   – name_zh_TW / name_zh_CN / name_ja / name_ko
    data/internal/abilities.json   – localized ability names/descriptions
    data/internal/items.json       – same, for catalog items
"""

from __future__ import annotations

import html as html_module
import json
import re
from urllib.request import Request, urlopen

from data_paths import INTERNAL_DATA_DIR

DDRAGON = "https://ddragon.leagueoflegends.com"
HEADERS = {"User-Agent": "MayhemOracle/1.0 (data pipeline)"}

# Our locale field suffix → Data Dragon locale code. en is the existing `name`.
LOCALES = {"zh_TW": "name_zh_TW", "zh_CN": "name_zh_CN",
           "ja_JP": "name_ja", "ko_KR": "name_ko"}

# Data Dragon locale → our field suffix (for abilities: name_<suffix> / description_<suffix>).
LOCALE_SUFFIX = {"zh_TW": "zh_TW", "zh_CN": "zh_CN", "ja_JP": "ja", "ko_KR": "ko"}

# Our ability key → index into Data Dragon's spells[] (passive is separate).
SPELL_INDEX = {"Q": 0, "W": 1, "E": 2, "R": 3}

# CommunityDragon champion icons ONLY: the trailing number there is the Riot
# champion key. Anchored to the champion-icons segment on purpose - an
# unanchored trailing-number match silently accepts an image size (BUG-4).
_ICON_KEY_RE = re.compile(r"/champion-icons/(\d+)\.png$")
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def clean(text: str) -> str:
    """Strip Data Dragon's inline HTML/markup to match our plain ability text."""
    return _WS_RE.sub(" ", html_module.unescape(_TAG_RE.sub(" ", text or ""))).strip()


def fetch_json(url: str) -> dict:
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def latest_version() -> str:
    return fetch_json(f"{DDRAGON}/api/versions.json")[0]


def champion_names(version: str, dd_locale: str) -> dict[str, str]:
    """Data Dragon champion key (numeric str) → localized name."""
    data = fetch_json(f"{DDRAGON}/cdn/{version}/data/{dd_locale}/champion.json")["data"]
    return {c["key"]: c["name"] for c in data.values()}


def item_names(version: str, dd_locale: str) -> dict[str, str]:
    """Data Dragon item id (str) → localized name."""
    data = fetch_json(f"{DDRAGON}/cdn/{version}/data/{dd_locale}/item.json")["data"]
    return {item_id: entry["name"] for item_id, entry in data.items()}


def enrich(records: list[dict], key_of, name_maps: dict[str, dict[str, str]]) -> int:
    """Localize records in place, keyed by an authoritative upstream identifier.

    Two rows resolving to one source key means identity has collapsed upstream;
    last-write-wins would publish one champion's names on another's row, which
    is the failure this whole module now guards (BUG-4). Fail closed instead.
    """
    seen: dict[str, dict] = {}
    for rec in records:
        key = key_of(rec)
        if not key:
            continue
        if key in seen:
            raise ValueError(
                f"source identity {key!r} claimed by two records: "
                f"{seen[key].get('slug') or seen[key].get('id')!r} and "
                f"{rec.get('slug') or rec.get('id')!r}"
            )
        seen[key] = rec

    enriched = 0
    for rec in records:
        key = key_of(rec)
        if not key:
            continue
        hit = False
        for dd_locale, field in LOCALES.items():
            name = name_maps[dd_locale].get(key)
            if name:
                rec[field] = name
                hit = True
        enriched += hit
    return enriched


def champion_key(rec: dict) -> str | None:
    """Riot champion key for a catalog row, from the authoritative field.

    `champion_key` is written by `scrape_base_stats.py` (step 7) straight from
    Data Dragon's `info.key`, so it is Riot's own identifier and it is already
    present by the time this runs (step 10b).

    The icon URL is a LAST RESORT, kept only for the CommunityDragon form whose
    final path component genuinely is the champion key. arammayhem's newer CDN
    ends its icons in the image SIZE instead (.../icons/aatrox/64.png), and 64
    is Lee Sin, so trusting any trailing number collapsed 171 champions onto him
    (BUG-4). The fallback therefore matches the champion-icons path explicitly
    rather than "the last number in the URL".
    """
    key = rec.get("champion_key")
    if isinstance(key, (str, int)) and str(key).isdigit():
        return str(key)
    m = _ICON_KEY_RE.search(rec.get("icon", "") or "")
    return m.group(1) if m else None


def champion_abilities(version: str, dd_locale: str) -> dict[str, dict]:
    """Data Dragon champion key → {ability key → {name, description}} (localized)."""
    data = fetch_json(f"{DDRAGON}/cdn/{version}/data/{dd_locale}/championFull.json")["data"]
    out: dict[str, dict] = {}
    for champ in data.values():
        abilities = {"passive": {"name": champ["passive"]["name"],
                                 "description": clean(champ["passive"]["description"])}}
        for ability_key, idx in SPELL_INDEX.items():
            spell = champ["spells"][idx]
            abilities[ability_key] = {"name": spell["name"],
                                      "description": clean(spell["description"])}
        out[champ["key"]] = abilities
    return out


def enrich_abilities(profiles: dict, slug_to_key: dict[str, str],
                     ability_maps: dict[str, dict[str, dict]]) -> int:
    enriched = 0
    for slug, profile in profiles.items():
        key = slug_to_key.get(slug)
        if not key:
            continue
        hit = False
        for ability in profile.get("abilities", []):
            for dd_locale, suffix in LOCALE_SUFFIX.items():
                loc_ability = ability_maps[dd_locale].get(key, {}).get(ability["key"])
                if not loc_ability:
                    continue
                ability[f"name_{suffix}"] = loc_ability["name"]
                if loc_ability["description"]:
                    ability[f"description_{suffix}"] = loc_ability["description"]
                hit = True
        enriched += hit
    return enriched


def main() -> None:
    version = latest_version()
    print(f"  Data Dragon version: {version}")

    champ_maps = {loc: champion_names(version, loc) for loc in LOCALES}
    item_maps = {loc: item_names(version, loc) for loc in LOCALES}

    champ_path = INTERNAL_DATA_DIR / "champions.json"
    champs = json.loads(champ_path.read_text(encoding="utf-8"))
    n = enrich(champs["champions"], champion_key, champ_maps)
    champ_path.write_text(json.dumps(champs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  champions.json: localized {n}/{len(champs['champions'])}")

    ability_maps = {loc: champion_abilities(version, loc) for loc in LOCALE_SUFFIX}
    slug_to_key = {
        champ["slug"]: key
        for champ in champs["champions"]
        if (key := champion_key(champ))
    }
    abilities_path = INTERNAL_DATA_DIR / "abilities.json"
    abilities = json.loads(abilities_path.read_text(encoding="utf-8"))
    n = enrich_abilities(abilities["profiles"], slug_to_key, ability_maps)
    abilities_path.write_text(
        json.dumps(abilities, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  abilities.json: localized {n}/{len(abilities['profiles'])} profiles")

    item_path = INTERNAL_DATA_DIR / "items.json"
    items = json.loads(item_path.read_text(encoding="utf-8"))
    n = enrich(items["items"], lambda r: str(r.get("id", "")) or None, item_maps)
    item_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  items.json: localized {n}/{len(items['items'])} catalog items "
          f"({len(items.get('mayhemExclusive', []))} Mayhem-exclusive stay English)")


if __name__ == "__main__":
    main()
