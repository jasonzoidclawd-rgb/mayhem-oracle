"""Canonical champion slug aliases.

arammayhem occasionally serves a champion under its *display* slug
(e.g. "wukong", "nunu-willump", "renata-glasc"), but every downstream join in
this project keys champions by their Riot *internal* id slug — CommunityDragon
ability profiles (abilities.json), base stats, combos, pool construction, and
the public /champions/<slug> URLs all use the internal form ("monkeyking",
"nunu", "renata"). When the two diverge, the champion's ability profile lookup
returns empty, deterministic classification yields no kit_tags, and the daily
pipeline used to hard-fail on it.

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
}


def canonical_champion_slug(slug: str) -> str:
    """Map a (possibly display-form) champion slug to its canonical internal slug."""
    return CHAMPION_SLUG_ALIASES.get(slug, slug)
