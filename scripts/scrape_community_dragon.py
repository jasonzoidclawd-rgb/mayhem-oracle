"""
Mayhem Oracle — CommunityDragon Scraper
========================================
Fetches champion ability profiles and item catalog from CommunityDragon.

Usage:
    python scripts/scrape_community_dragon.py

Output files:
    data/internal/abilities.json  — champion P/Q/W/E/R with playstyle info
    data/internal/items.json      — item catalog + Mayhem-exclusive items
"""

from __future__ import annotations
import re
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

from data_paths import INTERNAL_DATA_DIR
from cdragon_entity_adapters import is_mayhem_item_row
from entity_presentation_projection import MAYHEM_CANONICAL_ITEM_IDS

CDN_BASE = (
    "https://raw.communitydragon.org/latest/plugins/"
    "rcp-be-lol-game-data/global/default/"
)
HEADERS = {"User-Agent": "Mozilla/5.0 (Mayhem-Oracle-Scraper/1.0)"}
OUT_DIR = INTERNAL_DATA_DIR


# ── Mayhem-exclusive item data (from wiki.leagueoflegends.com/en-us/ARAM:_Mayhem) ──

MAYHEM_EXCLUSIVE_ITEMS: list[dict] = [
    {
        "id": 223039,
        "slug": "atmas-reckoning",
        "name": "Atma's Reckoning",
        "cost": 2900,
        "recipe": ["Giant's Belt", "Cloak of Agility", "Giant's Belt"],
        "stats": "700 Health, 20% Critical Strike Chance, 10 Ability Haste",
        "categories": ["Health", "CriticalStrike", "AbilityHaste"],
        "description": "Mode-exclusive legendary item. Passive: Big Hands grants crit chance from bonus health.",
        "mayhemTag": "exclusive",
    },
    {
        "id": 3430,
        "slug": "rite-of-ruin",
        "name": "Rite of Ruin",
        "cost": 3000,
        "recipe": ["Cloak of Agility", "Aether Wisp", "Fiendish Codex"],
        "stats": "50 Ability Power, 15 Ability Haste, 25% Critical Strike Chance",
        "categories": ["SpellDamage", "AbilityHaste", "CriticalStrike"],
        "description": (
            "Mode-exclusive legendary item. "
            "Wrath and Ruin stacks crit chance on ability cast; "
            "Salvage the Wreckage grants shields based on crit chance."
        ),
        "mayhemTag": "exclusive",
    },
    {
        "id": 4011,
        "slug": "sword-of-blossoming-dawn",
        "name": "Sword of Blossoming Dawn",
        "cost": 2350,
        "recipe": ["Forbidden Idol", "Amplifying Tome", "Kindlegem"],
        "stats": "45 Ability Power, 15 Ability Haste, 200 Health, 12% Heal and Shield Power",
        "categories": ["SpellDamage", "AbilityHaste", "Health"],
        "description": "Mode-exclusive legendary support item. On-hit heals the most wounded nearby ally.",
        "mayhemTag": "exclusive",
    },
    {
        "id": 4403,
        "slug": "the-golden-spatula",
        "name": "The Golden Spatula",
        "cost": 0,
        "recipe": [],
        "stats": "90 Attack Damage, 110 Ability Power, 40% Attack Speed, 20 Armor, 20 Magic Resist, 10% Move Speed, 15% Critical Strike Chance, 200 Health, 10% Life Steal",
        "categories": ["Damage", "SpellDamage", "AttackSpeed", "CriticalStrike", "Health"],
        "description": (
            "Obtained from Quest: Urf's Champion augment. "
            "Burn radius 400 units, increased mana regen 10%, energy regen 20%."
        ),
        "mayhemTag": "quest-reward",
    },
    {
        "id": 223095,
        "slug": "stormrazor",
        "name": "Stormrazor",
        "cost": 3000,
        "recipe": ["B.F. Sword", "Cloak of Agility", "Scout's Slingshot"],
        "stats": "50 Attack Damage, 20% Attack Speed, 25% Critical Strike Chance",
        "categories": ["Damage", "AttackSpeed", "CriticalStrike"],
        "description": "Mode-specific recipe. Energized attacks deal 100 bonus magic damage and grant 45% move speed.",
        "mayhemTag": "modified",
    },
    {
        "id": 223084,
        "slug": "heartsteel",
        "name": "Heartsteel",
        "cost": 3000,
        "recipe": ["Giant's Belt", "Crystalline Bracer", "Giant's Belt"],
        "stats": "900 Health, 100% Base Health Regen",
        "categories": ["Health", "HealthRegen"],
        "description": "Mode-specific adjustment: Colossal Consumption grants 8% permanent bonus health (reverts the ARAM nerf to 5%).",
        "mayhemTag": "modified",
    },
    {
        "id": 228002,
        "slug": "wooglets-witchcap",
        "name": "Wooglet's Witchcap",
        "cost": 0,
        "recipe": [],
        "stats": "300 Ability Power, 20 Ability Haste, 50 Armor",
        "categories": ["SpellDamage", "AbilityHaste", "Armor"],
        "description": "Quest reward. Magical Opus increases AP by 50%. Active: Stasis (2.5s, 20s cooldown).",
        "mayhemTag": "modified",
    },
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def fetch_json(url: str) -> object:
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=30) as resp:
        return json.load(resp)


def cdn_url(path: str) -> str:
    """Convert a /lol-game-data/assets/... path to a CDN URL."""
    path = path.lstrip("/")
    if path.startswith("lol-game-data/assets/"):
        path = path[len("lol-game-data/assets/"):]
    return CDN_BASE + path.lower()


def strip_tags(html: str) -> str:
    """Strip HTML and custom ability tags from description text."""
    return re.sub(r"<[^>]+>", "", html).strip()


def normalize(s: str) -> str:
    """Lowercase + remove punctuation for fuzzy name matching."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def map_damage_type(raw: str) -> str:
    mapping = {"kmagic": "magic", "kphysical": "physical", "kmixed": "mixed"}
    return mapping.get(raw.lower(), "mixed")


def map_attack_type(raw: str) -> str:
    return "ranged" if raw.lower() == "ranged" else "melee"


# ── Abilities ──────────────────────────────────────────────────────────────────

def build_ability_profiles(champion_slugs: list[str]) -> dict:
    print("  Fetching champion summary...")
    summary = fetch_json(CDN_BASE + "v1/champion-summary.json")

    # Build normalized-alias → {id, alias} lookup
    alias_lookup: dict[str, dict] = {}
    for entry in summary:
        if entry.get("id", -1) <= 0:
            continue
        key = normalize(entry["alias"])
        alias_lookup[key] = {"id": entry["id"], "alias": entry["alias"]}

    profiles: dict[str, object] = {}
    spell_keys = ["Q", "W", "E", "R"]

    for slug in champion_slugs:
        norm = normalize(slug)
        match = alias_lookup.get(norm)
        if match is None:
            print(f"  [WARN] No CommunityDragon match for slug '{slug}'")
            continue

        champ_id = match["id"]
        url = CDN_BASE + f"v1/champions/{champ_id}.json"
        try:
            data = fetch_json(url)
        except URLError as e:
            print(f"  [WARN] Could not fetch champion {champ_id}: {e}")
            continue

        tactical = data.get("tacticalInfo", {})
        playstyle_raw = data.get("playstyleInfo", {})

        playstyle = {
            "damage":       playstyle_raw.get("damage", 3),
            "durability":   playstyle_raw.get("durability", 3),
            "crowdControl": playstyle_raw.get("crowdControl", 3),
            "mobility":     playstyle_raw.get("mobility", 3),
            "utility":      playstyle_raw.get("utility", 3),
        }

        abilities = []

        # Passive
        passive = data.get("passive")
        if passive:
            abilities.append({
                "key":         "passive",
                "name":        passive.get("name", ""),
                "icon":        cdn_url(passive.get("abilityIconPath", "")),
                "description": strip_tags(passive.get("description", "")),
            })

        # Q W E R
        for i, spell in enumerate(data.get("spells", [])[:4]):
            abilities.append({
                "key":         spell_keys[i],
                "name":        spell.get("name", ""),
                "icon":        cdn_url(spell.get("abilityIconPath", "")),
                "description": strip_tags(spell.get("description", "")),
            })

        profiles[slug] = {
            "damageType": map_damage_type(tactical.get("damageType", "")),
            "attackType": map_attack_type(tactical.get("attackType", "")),
            "playstyle":  playstyle,
            "abilities":  abilities,
        }

        time.sleep(0.05)  # gentle rate limiting

    return profiles


# ── Items ──────────────────────────────────────────────────────────────────────

# CommunityDragon sometimes returns stale descriptions for Mayhem items (e.g. the
# Arena variant's 55 AD instead of ARAM's 75 AD for Infinity Edge).  This dict
# overrides the CDN description with the correct Mayhem stat line.
# Format: item_id → cleaned description string (same format as strip_tags output).
MAYHEM_DESCRIPTION_OVERRIDES: dict[int, str] = {
    223031: "75 Attack Damage 25% Critical Strike Chance 30% Critical Strike Damage",  # V26.01+
}


# In-game Mayhem prices sourced from arammayhem.com (CDN priceTotal defaults to 2500 for all
# modified legendaries; actual Mayhem shop prices vary per item).
# Generated by comparing public/data/items.json against arammayhem.com/items.
MAYHEM_PRICE_OVERRIDES: dict[int, int] = {
    221011: 900,   # Giant's Belt
    221026: 850,   # Blasting Wand
    221031: 800,   # Chain Vest
    221043: 700,   # Recurve Bow
    221053: 900,   # Vampiric Scepter
    221057: 850,   # Negatron Cloak
    221058: 1200,  # Needlessly Large Rod
    222051: 950,   # Guardian's Horn
    222065: 2200,  # Shurelya's Battlesong
    222141: 300,   # Cappa Juice
    222502: 2800,  # Unending Despair
    222503: 2800,  # Blackfire Torch
    222504: 2900,  # Kaenic Rookern
    222510: 3100,  # Dusk and Dawn
    222512: 2650,  # Fiendhunter Bolts
    222517: 3000,  # Endless Hunger
    222522: 3100,  # Actualizer
    222523: 2800,  # Hexoptics C44
    222524: 2000,  # Bandlepipes
    222526: 2250,  # Whispering Circlet
    222530: 2250,  # Diadem of Songs
    223002: 2400,  # Trailblazer
    223003: 2900,  # Archangel's Staff
    223004: 2900,  # Manamune
    223006: 1100,  # Berserker's Greaves
    223009: 1000,  # Boots of Swiftness
    223020: 1100,  # Sorcerer's Shoes
    223031: 3500,  # Infinity Edge
    223032: 3100,  # Yun Tal Wildarrows
    223033: 3000,  # Mortal Reminder
    223036: 3300,  # Lord Dominik's Regards
    223039: 2900,  # Atma's Reckoning
    223046: 2650,  # Phantom Dancer
    223047: 1200,  # Plated Steelcaps
    223050: 2200,  # Zeke's Convergence
    223053: 3200,  # Sterak's Gage
    223057: 900,   # Sheen
    223065: 2700,  # Spirit Visage
    223067: 800,   # Kindlegem
    223068: 2700,  # Sunfire Aegis
    223071: 3000,  # Black Cleaver
    223072: 3400,  # Bloodthirster
    223073: 3000,  # Experimental Hexplate
    223074: 3300,  # Ravenous Hydra
    223075: 2450,  # Thornmail
    223078: 3333,  # Trinity Force
    223084: 3000,  # Heartsteel
    223085: 2650,  # Runaan's Hurricane
    223087: 2700,  # Statikk Shiv
    223089: 3500,  # Rabadon's Deathcap
    223091: 2800,  # Wit's End
    223094: 2650,  # Rapid Firecannon
    223100: 2900,  # Lich Bane
    223102: 3000,  # Banshee's Veil
    223107: 2300,  # Redemption
    223109: 2300,  # Knight's Vow
    223111: 1250,  # Mercury's Treads
    223112: 950,   # Guardian's Orb
    223115: 2900,  # Nashor's Tooth
    223116: 2600,  # Rylai's Crystal Scepter
    223118: 2700,  # Malignance
    223119: 2400,  # Winter's Approach
    223121: 2400,  # Fimbulwinter
    223124: 3000,  # Guinsoo's Rageblade
    223135: 3000,  # Void Staff
    223137: 3000,  # Cryptbloom
    223139: 3200,  # Mercurial Scimitar
    223142: 2800,  # Youmuu's Ghostblade
    223143: 2700,  # Randuin's Omen
    223146: 3000,  # Hextech Gunblade
    223152: 2650,  # Hextech Rocketbelt
    223153: 3200,  # Blade of The Ruined King
    223156: 3100,  # Maw of Malmortius
    223157: 3250,  # Zhonya's Hourglass
    223158: 900,   # Ionian Boots of Lucidity
    223161: 3100,  # Spear of Shojin
    223165: 2850,  # Morellonomicon
    223177: 950,   # Guardian's Blade
    223181: 3000,  # Hullbreaker
    223184: 950,   # Guardian's Hammer
    223190: 2200,  # Locket of the Iron Solari
    223222: 2300,  # Mikael's Blessing
    223302: 3000,  # Terminus
    223504: 2200,  # Ardent Censer
    223508: 2900,  # Essence Reaver
    223742: 2900,  # Dead Man's Plate
    223748: 3300,  # Titanic Hydra
    223814: 3000,  # Edge of Night
    224004: 2800,  # Spectral Cutlass
    224005: 2250,  # Imperial Mandate
    224401: 2800,  # Force of Nature
    224628: 2700,  # Horizon Focus
    224629: 3000,  # Cosmic Drive
    224633: 3100,  # Riftmaker
    224645: 3200,  # Shadowflame
    224646: 2800,  # Stormsurge
    226333: 3300,  # Death's Dance
    226609: 3100,  # Chempunk Chainsword
    226610: 3100,  # Sundered Sky
    226616: 2250,  # Staff of Flowing Water
    226617: 2200,  # Moonstone Renewer
    226620: 2200,  # Echoes of Helia
    226631: 3300,  # Stridebreaker
    226653: 3000,  # Liandry's Torment
    226655: 2750,  # Luden's Echo
    226657: 2600,  # Rod of Ages
    226662: 2900,  # Iceborn Gauntlet
    226664: 2800,  # Hollow Radiance
    226665: 3200,  # Jak'Sho, The Protean
    226672: 3000,  # Kraken Slayer
    226673: 3000,  # Immortal Shieldbow
    226675: 2650,  # Navori Flickerblade
    226676: 3000,  # The Collector
    226692: 2900,  # Eclipse
    226694: 3000,  # Serylda's Grudge
    226696: 2750,  # Axiom Arc
    226698: 2850,  # Profane Hydra
    226699: 3000,  # Voltaic Cyclosword
    226701: 2700,  # Opportunity
    228020: 2650,  # Abyssal Mask
}


def build_items() -> tuple[list[dict], list[dict]]:
    print("  Fetching items catalog...")
    raw_items: list[dict] = fetch_json(CDN_BASE + "v1/items.json")

    # Build name→icon lookup for Mayhem exclusive item enrichment
    name_to_icon: dict[str, str] = {}

    catalog: list[dict] = []
    for item in raw_items:
        if not is_mayhem_item_row(item):
            continue  # mode-gated items that cannot be purchased in Mayhem
        name = item.get("name", "").strip()
        if not name:
            continue
        if not item.get("inStore", False):
            continue
        if item.get("requiredChampion", ""):
            continue  # champion-specific items
        total_cost = item.get("priceTotal", 0)
        if total_cost <= 0:
            continue

        icon_path = item.get("iconPath", "")
        icon = cdn_url(icon_path) if icon_path else ""

        # Track name→icon for Mayhem exclusive lookup
        name_to_icon[name.lower()] = icon

        raw_desc = item.get("description", "")
        description = strip_tags(raw_desc)

        item_id = item.get("id")
        description = MAYHEM_DESCRIPTION_OVERRIDES.get(item_id, description)
        cost = MAYHEM_PRICE_OVERRIDES.get(item_id, total_cost)
        catalog.append({
            "id":          item_id,
            "name":        name,
            "cost":        cost,
            "icon":        icon,
            "categories":  item.get("categories", []),
            "description": description,
        })

    # Sort by cost descending (completed items first)
    catalog.sort(key=lambda x: x["cost"], reverse=True)

    # Enrich Mayhem-exclusive items with icons from the catalog and attach the
    # stable ID used by CDragon snapshot matching. Exclude the regular row for
    # the same ID: it is a non-Mayhem variant and would otherwise produce
    # duplicate canonical entities in public catalogs and route projections.
    mayhem = []
    for item in MAYHEM_EXCLUSIVE_ITEMS:
        enriched = dict(item)
        enriched["id"] = int(MAYHEM_CANONICAL_ITEM_IDS[item["slug"]])
        icon = name_to_icon.get(item["name"].lower(), "")
        enriched["icon"] = icon
        mayhem.append(enriched)

    catalog = remove_mayhem_duplicate_rows(catalog, mayhem)

    return mayhem, catalog


def remove_mayhem_duplicate_rows(catalog: list[dict], mayhem: list[dict]) -> list[dict]:
    """Keep one canonical catalog row, preferring the curated Mayhem row."""
    mayhem_ids = {
        str(item["id"])
        for item in mayhem
        if isinstance(item, dict) and item.get("id") is not None
    }
    seen: set[str] = set()
    result: list[dict] = []
    for item in catalog:
        canonical_id = item.get("id") if isinstance(item, dict) else None
        if canonical_id is not None:
            key = str(canonical_id)
            if key in mayhem_ids or key in seen:
                continue
            seen.add(key)
        result.append(item)
    return result


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load champion slugs from existing champions.json
    champs_path = OUT_DIR / "champions.json"
    if not champs_path.exists():
        print("[ERROR] champions.json not found. Run scrape_arammayhem.py first.")
        return

    with open(champs_path, encoding="utf-8") as f:
        champ_data = json.load(f)
    champion_slugs = [c["slug"] for c in champ_data.get("champions", [])]
    print(f"Loaded {len(champion_slugs)} champion slugs from champions.json")

    # ── Abilities ──
    print("\n[1/2] Building ability profiles...")
    profiles = build_ability_profiles(champion_slugs)
    print(f"  → {len(profiles)} profiles built")

    scraped_at = datetime.now(timezone.utc).isoformat()

    (OUT_DIR / "abilities.json").write_text(
        json.dumps({"scraped_at": scraped_at, "profiles": profiles}, indent=2),
        encoding="utf-8",
    )
    print(f"  → abilities.json written")

    # ── Items ──
    print("\n[2/2] Building item catalog...")
    mayhem_items, item_catalog = build_items()
    print(f"  → {len(item_catalog)} catalog items, {len(mayhem_items)} Mayhem-exclusive")

    (OUT_DIR / "items.json").write_text(
        json.dumps(
            {
                "scraped_at":      scraped_at,
                "mayhemExclusive": mayhem_items,
                "items":           item_catalog,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"  → items.json written")

    print(f"\nDone. Files written to {OUT_DIR}/")


if __name__ == "__main__":
    main()
