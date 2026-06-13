"""
Mayhem Oracle — LoL Wiki Enrichment Script
==========================================
Fetches passive/active effect text and gameplay notes from the LoL wiki
and merges them into data/internal/items.json.

KEY DESIGN RULE:
    wikiStats are NEVER stored.  The LoL wiki always reflects standard-mode
    item values which differ from ARAM Mayhem values (e.g. Rabadon's Deathcap
    gives 65 AP in Mayhem but the wiki shows 180 AP).  The `description` field
    from CommunityDragon is the authoritative source for Mayhem stat numbers.

    The wiki is used ONLY for:
      • wikiPassives  — passive/active ability text (mechanics still apply,
                        though some numeric thresholds may differ in Mayhem)
      • wikiNotes     — gameplay interaction bullet points

Usage:
    python scripts/enrich_wiki.py [--dry-run] [--force]

    --dry-run   Parse everything but do not write items.json
    --force     Re-fetch items that already have wikiPassives (refresh stale data)

Output:
    Updates data/internal/items.json in-place.
    Strips any existing wikiStats from all items.
    Adds/updates wikiPassives and wikiNotes for each Mayhem item.

Rate-limiting:
    1 request/second — the wiki asks bots to be polite.
"""

from __future__ import annotations

import html as _html
import json
import re
import sys
import time
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError
from html.parser import HTMLParser

from data_paths import INTERNAL_DATA_DIR

DATA_FILE = INTERNAL_DATA_DIR / "items.json"
WIKI_API  = "https://wiki.leagueoflegends.com/api.php"
HEADERS   = {"User-Agent": "MayhemOracleBot/1.0 (https://github.com/mayhem-oracle)"}

# Item tier sections on the /en-us/Item wiki list page that are relevant to Mayhem
WIKI_TIER_SECTIONS: dict[str, str] = {
    "starter items":   "starter",
    "basic items":     "basic",
    "epic items":      "epic",
    "legendary items": "legendary",
    "boots":           "boots",
}

# Items to skip — shop-UI placeholders, consumables, removed items
SKIP_IDS = {
    220000, 220001, 220002, 220003, 220004, 220005, 220006, 220007,
    2055, 6032, 550007, 3128, 2020, 2019, 2021,
    # Component-only items with no passives worth enriching
    221038,  # B. F. Sword
    224403,  # The Golden Spatula (quest-reward, no wiki article)
    224624,  # Pauldrons of Whiterock
    224627,  # Stirring Wardstone
    223047,  # Plated Steelcaps — boots with only a passive we can't extract cleanly
}

# Explicit wiki title overrides for items whose names don't map cleanly.
# Key = item name in items.json; value = exact wiki article title (underscores).
WIKI_ALIASES: dict[str, str] = {
    # Names that don't resolve via simple space→underscore replacement.
    # Use plain apostrophes here — urlencode() in fetch_wiki_parsed handles
    # encoding; putting %27 here causes double-encoding and 404 failures.
    "Blade of The Ruined King": "Blade_of_the_Ruined_King",
    "Navori Flickerblades":     "Navori_Flickerblade",
    "Wooglet's Witchcap":       "Wooglet's_Witchcap",
    "Rabadon's Deathcap":       "Rabadon's_Deathcap",
    "Nashor's Tooth":           "Nashor's_Tooth",
    "Zhonya's Hourglass":       "Zhonya's_Hourglass",
    "Banshee's Veil":           "Banshee's_Veil",
    "Seraph's Embrace":         "Seraph's_Embrace",
    "Archangel's Staff":        "Archangel's_Staff",
    "Warmog's Armor":           "Warmog's_Armor",
    "Atma's Reckoning":         "Atma's_Reckoning",
    "Rite of Ruin":             "Rite_of_Ruin",
    "Sword of Blossoming Dawn": "Sword_of_Blossoming_Dawn",
}

# Items whose wikiPassives are known stale and should be re-fetched even
# without --force (specific passive-text bugs caught in review).
STALE_IDS = {
    223115,  # Nashor's Tooth — stale "+20% CDR" text from old passive system
    223089,  # Rabadon's Deathcap — re-fetch with fixed apostrophe encoding
    223102,  # Banshee's Veil — re-fetch with fixed apostrophe encoding
    223157,  # Zhonya's Hourglass — re-fetch with fixed apostrophe encoding
    323003,  # Archangel's Staff — previously failed
    223003,  # Archangel's Staff (Mayhem) — previously failed
    443083,  # Warmog's Armor — re-fetch with fixed apostrophe encoding
}


# ── HTML stripping ─────────────────────────────────────────────────────────────

class _Stripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def get_text(self) -> str:
        return "".join(self._parts)


def strip_html(html: str) -> str:
    p = _Stripper()
    p.feed(html)
    return re.sub(r"\s+", " ", p.get_text()).strip()


# ── Wiki title resolution ──────────────────────────────────────────────────────

# Prepositions/articles that should be lowercased mid-title (Chicago style)
_SMALL_WORDS = {"of", "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "with", "by"}


def wiki_title_candidates(name: str) -> list[str]:
    """
    Return an ordered list of wiki article title candidates to try for an item name.
    The wiki uses inconsistent capitalisation; we try the most common variants.
    """
    # Candidate 1: direct replace (preserves original capitalisation)
    direct = name.replace(" ", "_")

    # Candidate 2: Chicago-style (lowercase prepositions/articles mid-title)
    words = name.split()
    chicago = "_".join(
        w if i == 0 else (w.lower() if w.lower() in _SMALL_WORDS else w)
        for i, w in enumerate(words)
    )

    # Candidate 3: Python title-case (every word capitalised)
    titled = name.title().replace(" ", "_")

    seen: list[str] = []
    for c in (direct, chicago, titled):
        if c not in seen:
            seen.append(c)
    return seen


def resolve_wiki_title(name: str) -> list[str]:
    """Return the list of title candidates to try, checking aliases first."""
    if name in WIKI_ALIASES:
        return [WIKI_ALIASES[name]]
    return wiki_title_candidates(name)


# ── Wiki fetch ─────────────────────────────────────────────────────────────────

def fetch_wiki_parsed(title: str, retries: int = 2) -> str | None:
    """
    Fetch the parsed HTML for a wiki page via the MediaWiki action=parse API.
    Returns the HTML string, or None on 404 / failure.
    """
    from urllib.parse import urlencode
    import socket
    params = urlencode({
        "action":        "parse",
        "page":          title,
        "prop":          "text",
        "format":        "json",
        "formatversion": "2",
        "redirects":     "1",
    })
    url = f"{WIKI_API}?{params}"
    for attempt in range(retries + 1):
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            # MediaWiki returns {"error": {"code": "missingtitle"}} for 404
            if "error" in data:
                return None
            return data.get("parse", {}).get("text", None)
        except (socket.timeout, TimeoutError):
            if attempt < retries:
                print("timeout, retrying...", end=" ", flush=True)
                time.sleep(3)
        except (HTTPError, URLError, json.JSONDecodeError):
            return None
    return None


def fetch_item_html(name: str) -> tuple[str | None, str | None]:
    """
    Try each wiki title candidate in order.
    Returns (html, resolved_title) on success, or (None, None) on failure.
    """
    for title in resolve_wiki_title(name):
        html = fetch_wiki_parsed(title)
        if html is not None:
            return html, title
        time.sleep(0.5)
    return None, None


def fetch_item_tiers() -> dict[str, str]:
    """
    Fetch the /en-us/Item wiki list page and return a mapping of
    lowercase item name -> tier string ("starter"|"basic"|"epic"|"legendary"|"boots").

    The page organises items under <dl><dt>TIER NAME</dt></dl><div class="tlist"><ul>...
    blocks, with each item represented as data-item="NAME" attributes.
    Returns an empty dict on failure.
    """
    html = fetch_wiki_parsed("Item")
    if not html:
        return {}

    list_idx = html.find('id="List_of_Items"')
    if list_idx < 0:
        return {}
    section_html = html[list_idx:]

    tier_map: dict[str, str] = {}
    for block in re.finditer(
        r"<dl><dt>(.*?)</dt></dl>\s*<div class=\"tlist\"><ul>(.*?)</ul>",
        section_html, re.DOTALL,
    ):
        raw_label = re.sub(r"<[^>]+>", "", block.group(1)).strip().lower()
        tier_value = WIKI_TIER_SECTIONS.get(raw_label)
        if not tier_value:
            continue
        for m in re.finditer(r'data-item="([^"]+)"', block.group(2)):
            name_key = _html.unescape(m.group(1)).lower()
            tier_map[name_key] = tier_value

    return tier_map


# ── Parse passives/actives from wiki HTML ─────────────────────────────────────

# "New " prefix appears on recently-changed passives in the wiki (e.g. "New Unique Passive - Icathian Bite:")
# We must match it; the "New " gets stripped from the displayed label.
_LABEL_PREFIX = r"(?:New\s+)?(?:Unique|Active|Passive|Aura|Consume)"


def _truncate_before_history(html: str) -> str:
    """
    Return only the portion of the wiki HTML BEFORE patch history / trivia.

    The wiki page structure is: infobox → description → Notes → Trivia → Patch History.
    Passive/active text in the Patch History section is stale (old patch versions)
    and must NOT be extracted.  Items that no longer have a passive will correctly
    return an empty list after truncation.
    """
    # Find the earliest boundary section that marks the end of current item data.
    # Notes section is fine — extract_notes handles it separately.
    # We cut before Trivia / Patch History / References.
    earliest = len(html)
    for marker in (
        'id="Patch_History"', 'id="Patch_history"',
        'id="Trivia"',
        'id="References"',
        'id="Old_Passives"',
        'id="Removed_effects"',
    ):
        idx = html.find(marker)
        if 0 < idx < earliest:
            earliest = idx
    return html[:earliest]


def extract_passives(html: str) -> list[dict]:
    """
    Extract passive/active ability blocks from the wiki item page HTML.

    Returns a list of { "label": str, "text": str }.

    Strategy (2026+):
      1. Primary: parse structured infobox sections (Passive / Active headers)
      2. Fallback: regex scan for <b>Unique/Active/Passive...</b> patterns,
         truncated before Patch History to avoid stale text.
    """
    # Truncate before patch history to avoid extracting stale passive text
    html = _truncate_before_history(html)
    passives: list[dict] = []

    # ── Primary: structured infobox extraction ────────────────────────────
    # The wiki renders passives inside:
    #   <div class="infobox-header">Passive</div>
    #   <div class="infobox-section"><div class="infobox-data-row">
    #     <div class="infobox-data-value">
    #       <span class="template_sbc"><b>Label:</b></span> Description.
    #     </div></div></div>
    for header in ("Passive", "Active"):
        header_pattern = re.compile(
            rf'<div class="infobox-header">{header}</div>\s*'
            r'<div class="infobox-section">(.*?)</div>\s*</div>\s*</div>',
            re.DOTALL,
        )
        for sec in header_pattern.finditer(html):
            for row in re.finditer(
                r'<div class="infobox-data-value">(.*?)</div>',
                sec.group(1), re.DOTALL,
            ):
                content = row.group(1)
                bold = re.search(r"<b>(.*?)</b>", content, re.DOTALL)
                if bold:
                    label = strip_html(bold.group(1))
                    body  = strip_html(content[bold.end():])
                else:
                    label = header
                    body  = strip_html(content)

                label = re.sub(r"[–—]", "-", label).strip()
                label = re.sub(r"^New\s+", "", label).strip()
                body  = re.sub(r"\s+", " ", body).strip()

                if not body or len(body) < 15:
                    continue
                passives.append({"label": label, "text": body})

    # ── Fallback: regex scan (older wiki format) ──────────────────────────
    if not passives:
        pattern = re.compile(
            r"<b>(" + _LABEL_PREFIX + r"(?:(?!</b>).){0,200})</b>\s*:?\s*"
            r"((?:(?!<b>" + _LABEL_PREFIX + r"|</div></div></div>).)*)",
            re.DOTALL,
        )

        for m in pattern.finditer(html):
            raw_label = m.group(1).strip()
            raw_body  = m.group(2)

            label = strip_html(raw_label)
            label = re.sub(r"[–—]", "-", label).strip()
            label = re.sub(r"^New\s+", "", label).strip()

            body = strip_html(raw_body)
            body = re.sub(r"\s+", " ", body).strip()
            body = re.split(
                r"\s*(?:References|Notes|Patch history|See also|Old:|V\d+\.\d+)\s*",
                body,
            )[0].strip()

            if len(body) < 15 or len(body) > 800:
                continue
            if re.match(r"^[\d%\+\- ]+$", body):
                continue
            if label.rstrip(":").strip().lower() in (
                "unique passive", "active", "passive", "unique active", "unique",
                "new unique passive", "new active", "new passive",
            ):
                continue
            if any(kw in body for kw in ("Ornn", "Master Craftsman", "Only available while", "Molten Edge")):
                continue
            if "New Effect:" in body or "Old Effect:" in body:
                continue
            if "cooldown reduction" in body.lower() and len(body) < 120:
                continue

            passives.append({"label": label, "text": body})

    # Deduplicate: keep FIRST match per label prefix
    seen: dict[str, dict] = {}
    for p in passives:
        key = re.sub(r"[^a-z]", "", p["label"][:25].lower())
        if key not in seen:
            seen[key] = p

    return list(seen.values())


# ── Notes extraction ──────────────────────────────────────────────────────────

def extract_notes(html: str) -> list[str]:
    """
    Extract bullet-point notes from the wiki item's Notes section.
    These contain critical gameplay interactions (e.g. recursive AP stacking,
    additive interaction with Infernal Might, execute thresholds, etc.)
    """
    notes_match = re.search(
        r'<span[^>]*id="Notes"[^>]*>.*?</span>.*?<ul>(.*?)</ul>',
        html, re.DOTALL | re.IGNORECASE,
    )
    if not notes_match:
        notes_match = re.search(
            r'<h[23][^>]*>\s*Notes\s*</h[23]>.*?<ul>(.*?)</ul>',
            html, re.DOTALL | re.IGNORECASE,
        )
    if not notes_match:
        return []

    ul_html = notes_match.group(1)
    notes = []
    for li in re.findall(r"<li>(.*?)(?:</li>|(?=<li>))", ul_html, re.DOTALL):
        text = strip_html(li)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) < 10 or len(text) > 500:
            continue
        if re.match(r"^V\d+\.\d+", text):
            continue
        notes.append(text)
    return notes


def extract_recipe(html: str) -> list[str]:
    """
    Extract build-path component names from the infobox Recipe section.

    The wiki renders recipes inside:
      <div class="infobox-header">Recipe</div>
      <div class="infobox-section">   ← present when components exist
        ... data-item="NAME" data-game="lol" ...
      </div>

    Pure basic items (no components) use infobox-section-cell instead of
    infobox-section, so they correctly return an empty list.
    Returns a list of component name strings (duplicates preserved, e.g. double NLR).
    """
    recipe_idx = html.find('<div class="infobox-header">Recipe</div>')
    if recipe_idx < 0:
        return []

    next_header = html.find('<div class="infobox-header">', recipe_idx + 1)
    recipe_html = html[recipe_idx: next_header if next_header > 0 else recipe_idx + 4000]

    # infobox-section-cell means no component items — only a gold cost cell
    if '<div class="infobox-section">' not in recipe_html[:200]:
        return []

    return [
        _html.unescape(m.group(1))
        for m in re.finditer(r'data-item="([^"]+)"\s+data-game="lol"', recipe_html)
    ]


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    dry_run = "--dry-run" in sys.argv
    force   = "--force"   in sys.argv

    print(f"Loading {DATA_FILE}...")
    with DATA_FILE.open() as f:
        data = json.load(f)

    all_items:        list[dict] = data.get("items", [])
    mayhem_exclusive: list[dict] = data.get("mayhemExclusive", [])

    # ── Step 0: strip all wikiStats from every item (they're standard-mode values,
    #            wrong for Mayhem — the description field has the real Mayhem stats)
    stripped = 0
    for item in all_items + mayhem_exclusive:
        if "wikiStats" in item:
            del item["wikiStats"]
            stripped += 1
    if stripped:
        print(f"Stripped wikiStats from {stripped} items (standard-mode values — not valid for Mayhem).")

    # ── Step 0.5: fetch item tier map from the /en-us/Item wiki list page (1 request)
    print("Fetching item tier map from wiki Item list page...")
    tier_map = fetch_item_tiers()
    print(f"  → {len(tier_map)} items with known tiers")
    time.sleep(1)

    # Apply tiers to all items via name lookup (no extra requests)
    tier_applied = 0
    for item in all_items + mayhem_exclusive:
        name_key = item.get("name", "").lower()
        tier = tier_map.get(name_key)
        if tier:
            item["tier"] = tier
            tier_applied += 1
        elif item.get("slug") and "tier" not in item:
            # Mayhem-exclusive items that don't appear on the standard wiki list
            item["tier"] = "legendary"
            tier_applied += 1
    print(f"  Applied tiers to {tier_applied} items.")

    # ── Step 1: build enrichment target list
    targets: list[dict] = list(mayhem_exclusive)
    targets += [
        i for i in all_items
        if (i.get("id") or 0) >= 200_000
        and (i.get("id") or 0) not in SKIP_IDS
    ]

    # Build lookup maps for in-place updates
    id_to_item:   dict[int, dict] = {i["id"]: i for i in all_items if i.get("id") is not None}
    slug_to_item: dict[str, dict] = {i["slug"]: i for i in mayhem_exclusive if i.get("slug")}

    print(f"Enriching {len(targets)} items from the LoL wiki (passives + notes only)...")

    updated = 0
    skipped = 0

    for item in targets:
        item_id   = item.get("id")
        item_name = item.get("name", "")
        if not item_name:
            skipped += 1
            continue

        # Skip if already fully enriched, unless --force or known-stale.
        # Items with passives but no recipe key are re-fetched once to backfill recipe.
        already_enriched = bool(item.get("wikiPassives")) and "recipe" in item
        is_stale = (item_id in STALE_IDS) if item_id else False
        if already_enriched and not force and not is_stale:
            continue

        print(f"  [{item_id or item.get('slug')}] {item_name}...", end=" ", flush=True)

        html, resolved = fetch_item_html(item_name)
        if not html:
            print("SKIP (not found on wiki)")
            skipped += 1
            time.sleep(1)
            continue

        if resolved != item_name.replace(" ", "_"):
            print(f"(resolved→{resolved}) ", end="", flush=True)

        passives = extract_passives(html)
        notes    = extract_notes(html)
        recipe   = extract_recipe(html)

        if not passives and not notes and not recipe:
            print("no data")
        else:
            print(f"{len(passives)} passives, {len(notes)} notes, recipe: {recipe if recipe else '—'}")

        # Merge into the live item object
        target_obj = (
            id_to_item.get(item_id) if item_id is not None
            else slug_to_item.get(item.get("slug", ""))
        )
        if target_obj is not None:
            target_obj["wikiPassives"] = passives  # always write (empty list = no passive)
            target_obj["wikiNotes"] = notes          # always write (empty list = no notes)
            # Always write recipe — empty list means "no components" (basic item)
            # Only overwrite if the item doesn't already have a manually curated recipe
            # (mayhemExclusive items have accurate Mayhem recipes set in the scraper)
            if "recipe" not in target_obj or not target_obj.get("mayhemTag"):
                target_obj["recipe"] = recipe
            updated += 1

        time.sleep(1)  # 1 req/s — be polite to the wiki

    print(f"\n{updated} items updated/refreshed, {skipped} skipped.")

    # ── Step 3: normalize all items to a unified data structure ──────────
    # Ensures every item has consistent fields (empty arrays for missing data)
    # so the frontend doesn't need to handle absent vs. undefined fields.
    normalized = 0
    for item in all_items + mayhem_exclusive:
        changed = False
        if "wikiPassives" not in item:
            item["wikiPassives"] = []
            changed = True
        if "wikiNotes" not in item:
            item["wikiNotes"] = []
            changed = True
        if "recipe" not in item:
            item["recipe"] = []
            changed = True
        if "categories" not in item:
            item["categories"] = []
            changed = True
        if "tier" not in item:
            item["tier"] = None
            changed = True
        if changed:
            normalized += 1
    if normalized:
        print(f"Normalized {normalized} items to unified data structure.")

    if dry_run:
        print("Dry run — no file written.")
        return

    with DATA_FILE.open("w") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"Saved {DATA_FILE}")


if __name__ == "__main__":
    main()
