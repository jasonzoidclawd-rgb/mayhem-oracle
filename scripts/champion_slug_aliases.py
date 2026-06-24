"""Canonical champion slug aliases.

arammayhem occasionally serves a champion under its *display* slug
(e.g. "wukong", "nunu-willump", "dr-mundo"), but every downstream join in this
project keys champions by the long-standing canonical slug used by our public
URLs, pool rules, and historical telemetry (e.g. "monkeyking", "nunu",
"drmundo"). When the two diverge, the tier-list source and search-index source
can produce two rows for the same champion, which then shows up as duplicate
localized names on /champions.

Canonicalising the slug at scrape ingestion keeps the entire pipeline stable
regardless of which slug arammayhem chooses, and is idempotent: an already-
internal slug passes through unchanged. Extend this map when Riot adds another
display/internal divergence.
"""

# display slug (as seen in arammayhem URLs) → canonical internal slug
CHAMPION_SLUG_ALIASES = {
    "wukong": "monkeyking",
    "nunu-willump": "nunu",
    "renata-glasc": "renata",
    "aurelion-sol": "aurelionsol",
    "dr-mundo": "drmundo",
    "jarvan-iv": "jarvaniv",
    "lee-sin": "leesin",
    "master-yi": "masteryi",
    "miss-fortune": "missfortune",
    "tahm-kench": "tahmkench",
    "twisted-fate": "twistedfate",
    "xin-zhao": "xinzhao",
}


def canonical_champion_slug(slug: str) -> str:
    """Map a (possibly display-form) champion slug to its canonical internal slug."""
    return CHAMPION_SLUG_ALIASES.get(slug, slug)


# canonical internal slug → Riot display name.
#
# The arammayhem scrape derives a champion's English `name` by title-casing its
# slug ("aurelion-sol" → "Aurelion Sol"). That is wrong for any champion whose
# canonical slug compacts spaces or drops punctuation ("drmundo" → "Drmundo",
# "monkeyking" → "Monkeyking", "kaisa" → "Kaisa"). List those here so the
# display name matches Riot's; champions whose title-cased slug is already
# correct are intentionally omitted.
CHAMPION_DISPLAY_NAMES = {
    "aurelionsol": "Aurelion Sol",
    "belveth": "Bel'Veth",
    "chogath": "Cho'Gath",
    "drmundo": "Dr. Mundo",
    "jarvaniv": "Jarvan IV",
    "kaisa": "Kai'Sa",
    "khazix": "Kha'Zix",
    "kogmaw": "Kog'Maw",
    "ksante": "K'Sante",
    "leblanc": "LeBlanc",
    "leesin": "Lee Sin",
    "masteryi": "Master Yi",
    "missfortune": "Miss Fortune",
    "monkeyking": "Wukong",
    "nunu": "Nunu & Willump",
    "reksai": "Rek'Sai",
    "renata": "Renata Glasc",
    "tahmkench": "Tahm Kench",
    "twistedfate": "Twisted Fate",
    "velkoz": "Vel'Koz",
    "xinzhao": "Xin Zhao",
}


def canonical_champion_name(slug: str, fallback: str) -> str:
    """Display name for a canonical champion slug, falling back to the
    scrape's title-cased slug for champions that don't need an override."""
    return CHAMPION_DISPLAY_NAMES.get(slug, fallback)
