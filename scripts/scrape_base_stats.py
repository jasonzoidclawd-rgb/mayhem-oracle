"""
Mayhem Oracle — Champion Base Stats Scraper
============================================
Fetches champion base stats + per-level growth from Riot Data Dragon,
then merges them into public/data/champions.json.

Usage:
    python scripts/scrape_base_stats.py

Source: https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json
"""

from __future__ import annotations
import json
from pathlib import Path
from urllib.request import urlopen, Request

HEADERS = {"User-Agent": "Mozilla/5.0 (Mayhem-Oracle-Scraper/1.0)"}
OUT = Path(__file__).parent.parent / "public" / "data" / "champions.json"

# DDragon broke attackdamageperlevel in v16.5.1 (returns 0 for all champions).
# Use v16.4.1 for AD growth, latest version for everything else.
AD_GROWTH_FALLBACK_VERSION = "16.4.1"

# DDragon stat keys → our field names
STAT_MAP = {
    "hp":                  "baseHP",
    "hpperlevel":          "hpGrowth",
    "armor":               "baseArmor",
    "armorperlevel":       "armorGrowth",
    "spellblock":          "baseMR",
    "spellblockperlevel":  "mrGrowth",
    "attackdamage":        "baseAD",
    "attackdamageperlevel":"adGrowth",
    "attackspeed":         "baseAS",
    "attackspeedperlevel": "asGrowth",
    "attackrange":         "attackRange",
    "movespeed":           "moveSpeed",
    "mp":                  "baseMP",
    "mpperlevel":          "mpGrowth",
    "hpregen":             "baseHPRegen",
    "hpregenperlevel":     "hpRegenGrowth",
}


def fetch_json(url: str):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def main():
    # 1. Get latest DDragon version
    versions = fetch_json("https://ddragon.leagueoflegends.com/api/versions.json")
    version = versions[0]
    print(f"DDragon version: {version}")

    # 2. Fetch all champion stats (latest version)
    url = f"https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json"
    ddragon = fetch_json(url)
    champ_data = ddragon["data"]
    print(f"DDragon champions: {len(champ_data)}")

    # 2b. Check if adGrowth is broken (all zeros) — use fallback version if so
    ad_growth_broken = all(
        info["stats"].get("attackdamageperlevel", 0) == 0
        for info in champ_data.values()
    )
    ad_growth_data: dict[str, float] = {}
    if ad_growth_broken:
        print(f"  ⚠ adGrowth is 0 for all champions in {version}, using fallback {AD_GROWTH_FALLBACK_VERSION}")
        fb_url = f"https://ddragon.leagueoflegends.com/cdn/{AD_GROWTH_FALLBACK_VERSION}/data/en_US/champion.json"
        fb_data = fetch_json(fb_url)["data"]
        for key, info in fb_data.items():
            ad_growth_data[info["name"].lower()] = info["stats"].get("attackdamageperlevel", 0)
            ad_growth_data[key.lower()] = info["stats"].get("attackdamageperlevel", 0)

    # Build lookup: lowercase name → stats
    dd_by_name: dict[str, dict] = {}
    for key, info in champ_data.items():
        name = info["name"]
        raw_stats = info["stats"]
        mapped = {}
        for dd_key, our_key in STAT_MAP.items():
            if dd_key in raw_stats:
                mapped[our_key] = raw_stats[dd_key]
        # Fix adGrowth from fallback if broken
        if ad_growth_broken:
            fallback = ad_growth_data.get(name.lower(), ad_growth_data.get(key.lower(), 0))
            mapped["adGrowth"] = fallback
        # asGrowth is given as percent (e.g. 2.0 = 2%), keep as-is for clarity
        dd_by_name[name.lower()] = mapped
        # Also index by key (e.g. "MonkeyKing" for Wukong)
        dd_by_name[key.lower()] = mapped

    # 3. Load existing champions.json
    existing = json.loads(OUT.read_text("utf-8"))
    champions = existing["champions"]

    matched = 0
    unmatched = []
    for champ in champions:
        name = champ["name"].lower()
        slug = champ.get("slug", "").lower().replace("-", "").replace("'", "").replace(".", "").replace(" ", "")

        stats = dd_by_name.get(name)
        if not stats:
            # Try slug-based matching (e.g. "drmundo" → "dr. mundo")
            stats = dd_by_name.get(slug)
        if not stats:
            # Try removing spaces/punctuation from DDragon keys
            for dd_name, dd_stats in dd_by_name.items():
                clean = dd_name.replace("'", "").replace(".", "").replace(" ", "").replace("-", "")
                if clean == slug:
                    stats = dd_stats
                    break

        if stats:
            champ["baseStats"] = stats
            matched += 1
        else:
            unmatched.append(champ["name"])

    print(f"Matched: {matched}/{len(champions)}")
    if unmatched:
        print(f"Unmatched: {unmatched}")

    # 4. Write back
    OUT.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
