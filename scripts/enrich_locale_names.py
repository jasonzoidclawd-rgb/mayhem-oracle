"""
Mayhem Oracle — localized champion & item names from Data Dragon
================================================================
The augments pipeline carries localized names (name_zh_TW/…), so the augments
page renders in every locale. Champions and items only had English `name`, so
the tier-list, champion, and item pages showed English regardless of the chosen
locale. Data Dragon publishes per-locale champion/item data; this enriches the
internal champions.json and items.json in place with name_<locale> fields using
the same convention as augments.

Champions are matched to Data Dragon by the numeric key embedded in their icon
URL (…/champion-icons/<key>.png). Items are matched by numeric id. Records with
no Data Dragon match (e.g. Mayhem-exclusive items) keep English only.

Usage:
    python3 scripts/enrich_locale_names.py

Output (in place):
    data/internal/champions.json   – name_zh_TW / name_zh_CN / name_ja / name_ko
    data/internal/items.json       – same, for catalog items
"""

from __future__ import annotations

import json
import re
from urllib.request import Request, urlopen

from data_paths import INTERNAL_DATA_DIR

DDRAGON = "https://ddragon.leagueoflegends.com"
HEADERS = {"User-Agent": "MayhemOracle/1.0 (data pipeline)"}

# Our locale field suffix → Data Dragon locale code. en is the existing `name`.
LOCALES = {"zh_TW": "name_zh_TW", "zh_CN": "name_zh_CN",
           "ja_JP": "name_ja", "ko_KR": "name_ko"}

_ICON_KEY_RE = re.compile(r"/(\d+)\.png$")


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
    m = _ICON_KEY_RE.search(rec.get("icon", "") or "")
    return m.group(1) if m else None


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

    item_path = INTERNAL_DATA_DIR / "items.json"
    items = json.loads(item_path.read_text(encoding="utf-8"))
    n = enrich(items["items"], lambda r: str(r.get("id", "")) or None, item_maps)
    item_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  items.json: localized {n}/{len(items['items'])} catalog items "
          f"({len(items.get('mayhemExclusive', []))} Mayhem-exclusive stay English)")


if __name__ == "__main__":
    main()
