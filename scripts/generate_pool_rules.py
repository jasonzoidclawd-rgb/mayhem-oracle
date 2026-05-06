#!/usr/bin/env python3
"""
generate_pool_rules.py — Extract patch-sensitive pool-shaping rules from patch-notes.json.

Reads public/data/patch-notes.json (all patches) and accumulates rules that affect
champion augment pool composition:
  - item_exclusions: augment not offered if player owns specific item
  - mutually_exclusive: augment pairs that can never both be offered
  - ally_exclusions: chain-heal/buff sources that skip targets with specific augment
  - disabled: augments explicitly removed from pool
  - lifecycle: augments added or removed per patch

Writes: public/data/pool-rules.json (current-patch snapshot)

Usage:
  python3 scripts/generate_pool_rules.py [--dry-run]
"""

import argparse
import json
import re
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "public" / "data"
PATCH_NOTES_PATH = DATA_DIR / "patch-notes.json"
AUGMENTS_PATH    = DATA_DIR / "augments.json"
ITEMS_PATH       = DATA_DIR / "items.json"
OUTPUT_PATH      = DATA_DIR / "pool-rules.json"

# ─── Regex patterns (Layer A) ─────────────────────────────────────────────────

# "X is no longer offered if you have Y."
ITEM_EXCL_RE = re.compile(
    r"([A-Za-z ''\-]+?) is no longer offered if you have ([A-Za-z ''\-]+?)\.",
    re.I,
)

# "X and Y are now mutually exclusive"
MUTUAL_EXCL_RE = re.compile(
    r"([A-Za-z ''\-]+?) and ([A-Za-z ''\-]+?) are now mutually exclusive",
    re.I,
)

# "X no longer targets champions with Y" (chain-heal carve-outs)
ALLY_EXCL_RE = re.compile(
    r"([A-Za-z ''\-]+?) no longer targets? (?:champions?|allied champions?) with ([A-Za-z ''\-]+?)\.",
    re.I,
)

# ─── Name → slug normalization ────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Best-effort: lowercase, strip apostrophes/quotes, replace spaces with hyphens."""
    s = name.strip().lower()
    s = re.sub(r"[''`]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def build_augment_name_map(augments: list) -> dict:
    """Map lowercase name variants → slug."""
    m = {}
    for a in augments:
        slug = a["slug"]
        m[a["name"].lower()] = slug
        m[slug] = slug  # slug maps to itself
        # Also add slugified version of name
        m[_slugify(a["name"])] = slug
    return m


def build_item_name_map(items_raw) -> dict:
    if isinstance(items_raw, dict) and "items" in items_raw:
        items = items_raw["items"]
    elif isinstance(items_raw, list):
        items = items_raw
    else:
        return {}
    m = {}
    for item in items:
        name = item.get("name") or ""
        slug = item.get("slug") or _slugify(name)
        m[name.lower()] = slug
        m[_slugify(name)] = slug
    return m


def resolve_name(name: str, name_map: dict, fallback_slug: bool = True) -> str:
    """Resolve a raw name to a slug. Falls back to slugification."""
    key = name.strip().lower()
    if key in name_map:
        return name_map[key]
    slg = _slugify(name)
    if slg in name_map:
        return name_map[slg]
    return slg if fallback_slug else ""


# ─── Main extraction ──────────────────────────────────────────────────────────

def extract_rules(patches: list, aug_map: dict, item_map: dict) -> dict:
    """
    Scan all patches and accumulate pool-shaping rules.
    Rules are additive — once introduced they remain unless explicitly reverted.
    (Reversions are not currently tracked; assumed not to exist in the dataset.)
    """
    item_exclusions   = {}   # (aug_slug, item_slug) → True
    mutual_exclusive  = set()  # frozenset of (a, b) pairs
    ally_exclusions   = {}   # (source_slug, target_aug_slug) → True
    disabled          = set()
    lifecycle_added   = {}   # slug → patch_version
    lifecycle_removed = {}   # slug → patch_version

    for patch in patches:
        pv = patch["version"]
        for sec in patch["sections"]:
            for ch in sec["changes"]:
                text = ch["text"].get("en", "").strip()
                subj = ch["subject"].get("en", "").strip()

                # ── Item exclusions ──
                m = ITEM_EXCL_RE.search(text)
                if m:
                    aug_slug  = resolve_name(m.group(1), aug_map)
                    item_slug = resolve_name(m.group(2), item_map)
                    item_exclusions[(aug_slug, item_slug)] = True

                # ── Mutual exclusions ──
                m = MUTUAL_EXCL_RE.search(text)
                if m:
                    a = resolve_name(m.group(1), aug_map)
                    b = resolve_name(m.group(2), aug_map)
                    mutual_exclusive.add(frozenset([a, b]))

                # ── Ally exclusions (chain-heal carve-outs) ──
                m = ALLY_EXCL_RE.search(text)
                if m:
                    source = resolve_name(subj or m.group(1), aug_map)
                    target = resolve_name(m.group(2), aug_map)
                    ally_exclusions[(source, target)] = True

                # ── Lifecycle: NEW augments ──
                if text.startswith("• NEW:") or text.startswith("NEW:"):
                    if subj:
                        slug = resolve_name(subj, aug_map)
                        lifecycle_added.setdefault(slug, pv)

    return {
        "item_exclusions":  [
            {"augment": aug, "blocked_by_item": item}
            for (aug, item) in sorted(item_exclusions)
        ],
        "mutually_exclusive": [
            sorted(pair) for pair in sorted(mutual_exclusive)
        ],
        "ally_exclusions": [
            {"source": src, "skips_allies_with": tgt}
            for (src, tgt) in sorted(ally_exclusions)
        ],
        "disabled": sorted(disabled),
        "lifecycle": {
            "added":   dict(sorted(lifecycle_added.items())),
            "removed": dict(sorted(lifecycle_removed.items())),
        },
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    pn_raw  = json.loads(PATCH_NOTES_PATH.read_text("utf-8"))
    patches = pn_raw["patches"]
    current_patch = pn_raw.get("patch", patches[0]["version"] if patches else "unknown")
    scraped_at    = pn_raw.get("scraped_at", "")

    aug_raw  = json.loads(AUGMENTS_PATH.read_text("utf-8"))
    augments = aug_raw["augments"] if isinstance(aug_raw, dict) and "augments" in aug_raw else aug_raw
    aug_map  = build_augment_name_map(augments)

    item_raw = json.loads(ITEMS_PATH.read_text("utf-8"))
    item_map = build_item_name_map(item_raw)

    rules = extract_rules(patches, aug_map, item_map)

    output = {
        "patch":      current_patch,
        "scraped_at": scraped_at,
        **rules,
    }

    print(f"Pool rules extracted for patch {current_patch}:")
    print(f"  item_exclusions:    {len(rules['item_exclusions'])}")
    print(f"  mutually_exclusive: {len(rules['mutually_exclusive'])}")
    print(f"  ally_exclusions:    {len(rules['ally_exclusions'])}")
    print(f"  disabled:           {len(rules['disabled'])}")
    print(f"  lifecycle.added:    {len(rules['lifecycle']['added'])}")

    print("\nItem exclusions:")
    for r in rules["item_exclusions"]:
        print(f"  {r['augment']} ← blocked if owns {r['blocked_by_item']}")

    print("\nMutual exclusions:")
    for pair in rules["mutually_exclusive"]:
        print(f"  {pair[0]} ↔ {pair[1]}")

    print("\nAlly exclusions (chain-heal carve-outs):")
    for r in rules["ally_exclusions"]:
        print(f"  {r['source']} skips allies with {r['skips_allies_with']}")

    if args.dry_run:
        print("\n[DRY RUN — nothing written]")
        return

    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), "utf-8")
    print(f"\nWrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
