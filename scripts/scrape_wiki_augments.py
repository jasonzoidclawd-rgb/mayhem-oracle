"""
Mayhem Oracle — Wiki Augment Scraper
=====================================
Fetches augment descriptions from wiki.leagueoflegends.com/en-us/ARAM:_Mayhem/Augments
and enriches public/data/augments.json with wiki-sourced descriptions.

Uses curl for HTTP (wiki blocks Python urllib redirects).

Usage:
    python scripts/scrape_wiki_augments.py
"""

from __future__ import annotations
import html as _html
import json
import re
import subprocess
from pathlib import Path

OUT = Path(__file__).parent.parent / "public" / "data" / "augments.json"

WIKI_API = "https://wiki.leagueoflegends.com/api.php"


def fetch_wiki_html(page_title: str) -> str | None:
    url = f"{WIKI_API}?action=parse&page={page_title}&prop=text&format=json"
    result = subprocess.run(
        ["curl", "-sL", url, "-H", "User-Agent: Mozilla/5.0"],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        print(f"  ✗ curl failed: {result.stderr}")
        return None
    data = json.loads(result.stdout)
    if "error" in data:
        print(f"  ✗ API error: {data['error'].get('info', '')}")
        return None
    return data.get("parse", {}).get("text", {}).get("*", "")


def extract_augments(html: str) -> list[dict]:
    """Parse augment table rows from wiki HTML.

    Each augment row: <td id="NAME">icon</td><td>description</td><td>tier</td><td>set</td>
    """
    augments: list[dict] = []

    pattern = re.compile(
        r'<td[^>]*id="([^"]+)"[^>]*>'  # td with id = augment name
        r'(.*?)</td>\s*'                 # icon cell content
        r'<td[^>]*>(.*?)</td>\s*'        # description cell
        r'<td[^>]*>(.*?)</td>\s*'        # tier cell
        r'<td[^>]*>(.*?)</td>',          # set cell
        re.DOTALL,
    )

    for m in pattern.finditer(html):
        # Extract name from icon title attribute
        name_match = re.search(
            r'title="An icon for the ARAM:? Mayhem augment ([^"]+)"',
            m.group(2),
        )
        name = (
            _html.unescape(name_match.group(1)).strip()
            if name_match
            else _html.unescape(m.group(1)).replace("_", " ").strip()
        )

        # Description: strip HTML
        desc = re.sub(r"<[^>]+>", " ", m.group(3))
        desc = _html.unescape(desc).strip()
        desc = re.sub(r"\s+", " ", desc)

        # Tier
        tier_text = re.sub(r"<[^>]+>", "", m.group(4)).strip().lower()
        rarity = "silver"
        if "gold" in tier_text:
            rarity = "gold"
        elif "prismatic" in tier_text:
            rarity = "prismatic"

        # Set
        set_name = re.sub(r"<[^>]+>", "", m.group(5)).strip()
        if set_name == "-":
            set_name = ""

        if name and desc:
            augments.append({
                "name": name,
                "rarity": rarity,
                "wikiDescription": desc,
                "wikiSet": set_name,
            })

    return augments


def main():
    print("Fetching ARAM:_Mayhem/Augments from wiki...")
    html = fetch_wiki_html("ARAM:_Mayhem/Augments")
    if not html:
        print("Failed to fetch wiki page")
        return

    print(f"  HTML length: {len(html)}")

    wiki_augments = extract_augments(html)
    print(f"  Extracted {len(wiki_augments)} augments from wiki")

    if not wiki_augments:
        print("  ⚠ No augments extracted — wiki page format may have changed")
        return

    # Load existing augments.json
    existing = json.loads(OUT.read_text("utf-8"))
    augments = existing.get("augments", [])

    # Build lookup by normalized name
    by_name: dict[str, dict] = {}
    for aug in augments:
        by_name[aug["name"].lower().strip()] = aug

    matched = 0
    new_augments = []
    for wiki_aug in wiki_augments:
        name_key = wiki_aug["name"].lower().strip()
        existing_aug = by_name.get(name_key)
        if existing_aug:
            existing_aug["wikiDescription"] = wiki_aug["wikiDescription"]
            if wiki_aug["wikiSet"]:
                existing_aug["wikiSet"] = wiki_aug["wikiSet"]
            matched += 1
        else:
            # New augment not in existing data
            new_augments.append(wiki_aug["name"])

    print(f"  Matched: {matched}/{len(wiki_augments)}")
    if new_augments:
        print(f"  New (wiki only, {len(new_augments)}): {new_augments[:10]}{'...' if len(new_augments) > 10 else ''}")

    # Write back
    OUT.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"  Wrote {OUT}")


if __name__ == "__main__":
    main()
