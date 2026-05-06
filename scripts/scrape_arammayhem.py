"""
Mayhem Oracle — arammayhem.com Scraper
=======================================
Fetches champion tier list, augments, and combos from arammayhem.com.
Outputs static JSON to public/data/ for use by the Next.js app.

Usage:
    python scripts/scrape_arammayhem.py

Output files:
    public/data/champions.json   — tier list with win rates
    public/data/augments.json    — augment catalog with rarities
    public/data/combos.json      — champion × augment synergies
    public/data/meta.json        — patch version + scrape timestamp
"""

from __future__ import annotations
import re
import json
import time
import html as html_module
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

BASE_URL = "https://arammayhem.com"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}
OUT_DIR = Path(__file__).parent.parent / "public" / "data"


def fetch(path: str) -> str:
    url = BASE_URL + path
    print(f"  Fetching {url} ...")
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def unescape(s: str) -> str:
    return html_module.unescape(s).strip()


# ── Tier List ──────────────────────────────────────────────────────────────

def parse_tier_list(html: str) -> list[dict]:
    champions = []

    # Split into tier sections using data-tier attribute
    # Each section: <div ... data-tier="S+"> ... </div>
    section_pattern = re.compile(
        r'data-tier="([^"]+)">(.*?)(?=data-tier="|</main>)',
        re.DOTALL,
    )

    for m in section_pattern.finditer(html):
        tier = m.group(1)
        section_html = m.group(2)

        # Find all champion cards in this section
        card_pattern = re.compile(
            r'href="/champions/([^"]+)"[^>]*class="champion-card[^"]*"'
            r'\s+data-search="([^"]+)"\s+data-tags="([^"]*)"\s+title="([^"]*)"'
            r'.*?<img src="([^"]+)"',
            re.DOTALL,
        )

        for card in card_pattern.finditer(section_html):
            slug = card.group(1)
            search_text = card.group(2)
            tags = [t.strip() for t in card.group(3).split(",") if t.strip()]
            title = unescape(card.group(4))
            img_url = card.group(5)

            # Parse title: "brandnRank: #1nWin Rate: 56.29%nPick Rate: 13.42%"
            name_match = re.match(r'^([^\n]+)', title)
            rank_match = re.search(r'Rank:\s*#(\d+)', title)
            wr_match = re.search(r'Win Rate:\s*([\d.]+)%', title)
            pr_match = re.search(r'Pick Rate:\s*([\d.]+)%', title)

            # Title-case from slug (e.g. "aurelion-sol" → "Aurelion Sol")
            display_name = " ".join(w.capitalize() for w in slug.split("-"))

            champions.append({
                "slug": slug,
                "name": display_name,
                "tier": tier,
                "rank": int(rank_match.group(1)) if rank_match else None,
                "win_rate": float(wr_match.group(1)) if wr_match else None,
                "pick_rate": float(pr_match.group(1)) if pr_match else None,
                "tags": tags,
                "icon": img_url,
            })

    return champions


# ── Augments ───────────────────────────────────────────────────────────────

def parse_augments(html: str) -> list[dict]:
    augments = []

    # Split into individual augment card blocks first
    # Cards start with <a href="/augments/..." class="augment-card ..."
    card_starts = [m.start() for m in re.finditer(r'href="/augments/[^"]+"\s+class="augment-card', html)]

    for i, start in enumerate(card_starts):
        end = card_starts[i + 1] if i + 1 < len(card_starts) else start + 2000
        block = html[start:end]

        slug_m = re.search(r'href="/augments/([^"]+)"', block)
        rarity_m = re.search(r'data-rarity="([^"]+)"', block)
        # Win rate badge: ">59.03<!-- -->%"
        wr_m = re.search(r'">([\d.]+)<!-- -->%', block)
        img_m = re.search(r'<img src="([^"]+)"[^>]*alt="([^"]+)"', block)

        if not (slug_m and rarity_m and img_m):
            continue

        icon = img_m.group(1)
        if icon.startswith("/"):
            icon = BASE_URL + icon

        augments.append({
            "slug": slug_m.group(1),
            "name": unescape(img_m.group(2)),
            "rarity": rarity_m.group(1),
            "win_rate": float(wr_m.group(1)) if wr_m else None,
            "icon": icon,
        })

    return augments


# ── Combos ─────────────────────────────────────────────────────────────────

def parse_combos(html: str) -> list[dict]:
    combos = []

    # <div class="combo-card ..." data-tier="S" data-champion="shaco"
    #      data-augment="executioner" data-combo-ref="curated:shaco-executioner">
    card_pattern = re.compile(
        r'class="combo-card[^"]*"\s+'
        r'data-tier="([^"]+)"\s+'
        r'data-champion="([^"]+)"\s+'
        r'data-augment="([^"]+)"\s+'
        r'data-combo-ref="([^"]+)"',
        re.DOTALL,
    )

    seen = set()
    for m in card_pattern.finditer(html):
        tier = m.group(1)
        champion = m.group(2)
        augment = m.group(3)
        combo_ref = m.group(4)
        key = (champion, augment)
        if key in seen:
            continue
        seen.add(key)

        combos.append({
            "champion": champion,
            "augment": augment,
            "tier": tier,
            "ref": combo_ref,
        })

    return combos


# ── Patch version ──────────────────────────────────────────────────────────

def extract_patch(html: str) -> str | None:
    m = re.search(r'[Pp]atch\s+([\d.]+)', html)
    return m.group(1).rstrip(".") if m else None


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Scraping arammayhem.com...")

    # Tier list
    print("\n[1/3] Champion tier list")
    tier_html = fetch("/tier-list/")
    champions = parse_tier_list(tier_html)
    patch = extract_patch(tier_html)
    print(f"  → {len(champions)} champions, patch {patch}")

    # Augments
    print("\n[2/3] Augments")
    time.sleep(1)
    aug_html = fetch("/augments/")
    augments = parse_augments(aug_html)
    print(f"  → {len(augments)} augments")

    # Augment locale names
    print("\n[3/5] Augment locale names")
    by_slug = {a["slug"]: a for a in augments}
    locale_configs = [
        ("zh-cn", "name_zh_CN", r'data-name="([^"]+)"\s+data-name-en="([^"]+)"', True),
        ("ja-jp", "name_ja", None, False),
        ("ko-kr", "name_ko", None, False),
    ]
    for locale_code, field, pattern, has_en_attr in locale_configs:
        time.sleep(0.8)
        try:
            locale_html = fetch(f"/{locale_code}/augments/")
        except Exception as e:
            print(f"  {locale_code}: skipped ({e})")
            continue
        matched = 0
        if has_en_attr and pattern:
            # zh-cn: data-name="珠光护手" data-name-en="jeweled gauntlet"
            for loc_name, en_name in re.findall(pattern, locale_html):
                slug = en_name.replace(" ", "-")
                if slug in by_slug:
                    by_slug[slug][field] = unescape(loc_name)
                    matched += 1
        else:
            # ja/ko: href="/ja-jp/augments/{slug}" ... data-name="{localized} {en}"
            for slug, combined in re.findall(
                rf'href="/{locale_code}/augments/([^"]+)"\s+class="augment-card[^"]*"\s+data-name="([^"]+)"',
                locale_html,
            ):
                if slug not in by_slug:
                    continue
                en_part = slug.replace("-", " ")
                localized = re.sub(re.escape(en_part), "", combined, flags=re.IGNORECASE).strip()
                if localized:
                    by_slug[slug][field] = unescape(localized)
                    matched += 1
        print(f"  {locale_code}: {matched} names")

    # Traditional Chinese names from CommunityDragon
    print("\n[4/5] Traditional Chinese augment names")
    try:
        zh_tw_url = (
            "https://raw.communitydragon.org/latest/plugins/"
            "rcp-be-lol-game-data/global/zh_tw/v1/cherry-augments.json"
        )
        req = __import__("urllib.request", fromlist=["Request"]).Request(
            zh_tw_url, headers={"User-Agent": "Mozilla/5.0"}
        )
        import urllib.request as _ur
        with _ur.urlopen(req, timeout=30) as r:
            import json as _json
            zh_tw_data = _json.load(r)

        def _norm(s: str) -> str:
            return re.sub(r"[^a-z]", "", s.lower())

        zh_tw_lookup = {}
        for entry in zh_tw_data:
            if not entry.get("nameTRA"):
                continue
            stem = entry["augmentSmallIconPath"].split("/")[-1].replace("_small.png", "")
            zh_tw_lookup[_norm(stem)] = entry["nameTRA"]

        zh_tw_matched = 0
        for aug in augments:
            key = _norm(aug["slug"])
            name = zh_tw_lookup.get(key) or zh_tw_lookup.get(_norm(aug["name"]))
            if name:
                aug["name_zh_TW"] = name
                zh_tw_matched += 1
        print(f"  → {zh_tw_matched} Traditional Chinese names")
    except Exception as e:
        print(f"  Skipped: {e}")

    # Combos
    print("\n[5/5] Combos")
    time.sleep(1)
    combo_html = fetch("/combo/")
    combos = parse_combos(combo_html)
    print(f"  → {len(combos)} combos")

    # Write output
    scraped_at = datetime.now(timezone.utc).isoformat()

    (OUT_DIR / "champions.json").write_text(
        json.dumps({"patch": patch, "scraped_at": scraped_at, "champions": champions}, indent=2),
        encoding="utf-8",
    )
    (OUT_DIR / "augments.json").write_text(
        json.dumps({"patch": patch, "scraped_at": scraped_at, "augments": augments}, indent=2),
        encoding="utf-8",
    )
    (OUT_DIR / "combos.json").write_text(
        json.dumps({"patch": patch, "scraped_at": scraped_at, "combos": combos}, indent=2),
        encoding="utf-8",
    )
    (OUT_DIR / "meta.json").write_text(
        json.dumps({"patch": patch, "scraped_at": scraped_at, "source": BASE_URL}, indent=2),
        encoding="utf-8",
    )

    print(f"\nDone. Files written to {OUT_DIR}/")
    print(f"  champions.json  ({len(champions)} entries)")
    print(f"  augments.json   ({len(augments)} entries, with locale names)")
    print(f"  combos.json     ({len(combos)} entries)")
    print(f"  meta.json")


if __name__ == "__main__":
    main()
