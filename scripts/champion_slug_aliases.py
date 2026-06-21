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
