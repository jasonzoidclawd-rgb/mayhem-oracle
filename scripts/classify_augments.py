#!/usr/bin/env python3
"""
classify_augments.py — Augment tag/set/flags classifier via groq-fast (Llama 3.3 70B)

Extends public/data/augments.json in-place with:
  kit_tags: ChampionTag[]  — which kit properties the augment synergizes with
  set: AugmentSet | null   — one of the 9 Hextech Augment Synergies
  flags: { system_breaker, lifecycle }

Usage:
  python3 scripts/classify_augments.py [--dry-run] [--batch-size N]
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

# ─── Config ───────────────────────────────────────────────────────────────────

AUGMENTS_PATH = Path(__file__).parent.parent / "public/data/augments.json"
LITELLM_URL = os.getenv("CLASSIFIER_URL", "https://api.groq.com/openai/v1/chat/completions")
LITELLM_MODEL = os.getenv("CLASSIFIER_MODEL", "llama-3.3-70b-versatile")
LITELLM_KEY = os.getenv("GROQ_API_KEY", "sk-litellm-local")

VALID_TAGS = [
    "attack", "ability", "on_hit", "crit", "movement",
    "haste", "tank", "heal_shield", "dot", "cc", "mana", "manaless",
]

VALID_SETS = [
    "archmage", "dive_bomb", "firecracker", "fully_automated",
    "high_roller", "make_it_rain", "snowday", "stackosaurus_rex", "wee_woo",
]

# Qualitative change augments — transcend tier, rewrite mechanics
SYSTEM_BREAKERS = {
    "jeweled-gauntlet",    # abilities can now crit
    "vulnerability",       # enemies take increased damage type
    "tap-dancer",          # become melee, new mechanics
    "mystic-punch",        # AD abilities count as AP
    "draw-your-sword",     # ability damage converted to physical
    "master-of-duality",   # both AP and AD scale
    "slow-and-steady",     # shields count as HP permanently
    "marksmage",           # abilities scale with AD+AP
}

# Normalize wikiSet strings (some augments belong to two sets — take first)
WIKI_SET_MAP = {
    "Archmage":                         "archmage",
    "Dive Bomb":                        "dive_bomb",
    "Dive Bomb Fully Automated":        "dive_bomb",
    "Firecracker":                      "firecracker",
    "Fully Automated":                  "fully_automated",
    "Fully Automated Wee Woo Wee Woo":  "fully_automated",
    "High Roller":                      "high_roller",
    "Make it Rain":                     "make_it_rain",
    "Snowday":                          "snowday",
    "Stackosaurus Rex":                 "stackosaurus_rex",
    "Wee Woo Wee Woo":                  "wee_woo",
}

# ─── Few-shot exemplars ────────────────────────────────────────────────────────

FEW_SHOT = [
    {
        "slug": "jeweled-gauntlet",
        "name": "Jeweled Gauntlet",
        "rarity": "prismatic",
        "wikiDescription": "Your abilities can now critically strike for (145% + bonus critical damage) damage. Additionally, gain 25% (+ 4.5% per 100 AP) critical strike chance.",
        "result": {"kit_tags": ["ability", "crit"], "set": None},
    },
    {
        "slug": "fan-the-hammer",
        "name": "Fan the Hammer",
        "rarity": "gold",
        "wikiDescription": "Basic attacks fire three projectiles, each dealing 30% physical damage. The extra projectiles can critically strike.",
        "result": {"kit_tags": ["attack", "crit", "on_hit"], "set": "firecracker"},
    },
    {
        "slug": "windspeakers-blessing",
        "name": "Windspeaker's Blessing",
        "rarity": "gold",
        "wikiDescription": "Your heals and shields on allies are 30% stronger. Shielded allies gain 10% movement speed.",
        "result": {"kit_tags": ["heal_shield"], "set": "wee_woo"},
    },
    {
        "slug": "overflow",
        "name": "Overflow",
        "rarity": "gold",
        "wikiDescription": "Your maximum mana is increased by 20%. When you reach maximum mana, the excess flows into damage on your next ability.",
        "result": {"kit_tags": ["ability", "mana"], "set": "archmage"},
    },
    {
        "slug": "biggest-snowball-ever",
        "name": "Biggest Snowball Ever!",
        "rarity": "prismatic",
        "wikiDescription": "Gain a Snowball that can be rolled around the map. The snowball grows larger as it rolls and deals damage when it hits an enemy champion.",
        "result": {"kit_tags": ["movement", "cc"], "set": "snowday"},
    },
    {
        "slug": "red-envelopes",
        "name": "Red Envelopes",
        "rarity": "prismatic",
        "wikiDescription": "Red envelopes will randomly appear around you every 25 – 15 seconds. Pick them up by walking over them, granting 8–46 gold.",
        "result": {"kit_tags": [], "set": "make_it_rain"},
    },
    {
        "slug": "absorb-life",
        "name": "Absorb Life",
        "rarity": "silver",
        "wikiDescription": "Kills restore 8 / 14 / 20 (based on augment tier) (+3% AP) health.",
        "result": {"kit_tags": ["ability", "heal_shield"], "set": None},
    },
    {
        "slug": "goliath",
        "name": "Goliath",
        "rarity": "prismatic",
        "wikiDescription": "Grants 35% bonus health, 15% adaptive force, and 50% increased size.",
        "result": {"kit_tags": ["tank"], "set": None},
    },
]

SYSTEM_PROMPT = f"""You are classifying ARAM Mayhem augments for a League of Legends decision engine.

For each augment, output ONLY valid JSON with these fields:
  "kit_tags": array of 0–4 tags from {VALID_TAGS}
  "set": one of {VALID_SETS} or null

kit_tags rules:
- "ability" — augment buffs/scales with AP or spells
- "attack" — augment buffs/scales with AD, basic attacks, attack speed
- "on_hit" — augment triggers on-hit effects or amplifies them
- "crit" — augment interacts with critical strikes (grant, scale, or enable crits)
- "movement" — augment grants or synergizes with movement speed / dashes
- "haste" — augment grants ability haste or synergizes with cooldown reduction
- "tank" — augment grants HP, armor, MR, or reduces damage taken
- "heal_shield" — augment heals, shields, or amplifies healing/shielding
- "dot" — augment deals damage over time (poison, burn, bleed)
- "cc" — augment applies or synergizes with crowd control
- "mana" — augment scales with mana pool or restores mana
- "manaless" — augment explicitly applies to champions without mana bars
- EMPTY ARRAY [] for gold/economy augments or purely passive stat augments that fit any champion equally

Few-shot examples (slug → result):
{json.dumps({e['slug']: e['result'] for e in FEW_SHOT}, indent=2)}

When set is already provided in the input, keep it in your output unchanged.
Output a JSON object keyed by slug. No markdown, no explanation."""


# ─── LLM call ─────────────────────────────────────────────────────────────────

def call_groq(prompt: str, retries: int = 3) -> str:
    body = json.dumps({
        "model": LITELLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
    }).encode()

    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                LITELLM_URL,
                data=body,
                headers={
                    "Authorization": f"Bearer {LITELLM_KEY}",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                return data["choices"][0]["message"]["content"]
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise RuntimeError(f"LLM call failed after {retries} attempts: {e}")


def parse_llm_json(raw: str) -> dict:
    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


# ─── Deterministic pre-processing ─────────────────────────────────────────────

def normalize_set(wiki_set) -> "str | None":
    if not wiki_set:
        return None
    return WIKI_SET_MAP.get(wiki_set)


def build_input_block(aug: dict) -> dict:
    return {
        "slug": aug["slug"],
        "name": aug["name"],
        "rarity": aug["rarity"],
        "wikiDescription": (aug.get("wikiDescription") or "")[:400],
    }


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print first batch prompt and exit")
    parser.add_argument("--batch-size", type=int, default=10, help="Augments per LLM call (default 10)")
    parser.add_argument("--skip-classified", action="store_true", help="Skip augments that already have kit_tags (CI mode)")
    parser.add_argument("--allow-partial", action="store_true", help="Write output even if batches fail or coverage is low")
    args = parser.parse_args()

    raw = json.loads(AUGMENTS_PATH.read_text(encoding="utf-8"))
    augments = raw["augments"] if isinstance(raw, dict) and "augments" in raw else raw
    is_dict_root = isinstance(raw, dict) and "augments" in raw

    total = len(augments)
    print(f"Loaded {total} augments from {AUGMENTS_PATH.name}")

    # Phase 1: deterministic fields
    for aug in augments:
        aug["set"] = aug.get("set") or normalize_set(aug.get("wikiSet"))
        aug.setdefault("flags", {})
        aug["flags"]["system_breaker"] = aug["slug"] in SYSTEM_BREAKERS
        aug["flags"]["lifecycle"] = aug["flags"].get("lifecycle", "active")
        aug.setdefault("kit_tags", aug.get("tags", []))

    already_tagged = sum(1 for a in augments if a.get("kit_tags"))
    print(f"Already have kit_tags: {already_tagged}/{total}")
    print(f"Have set: {sum(1 for a in augments if a.get('set'))}/{total}")

    # Phase 2: LLM classification for tags (all augments) and missing sets
    # When skipping classified augments, validate existing tags — augments with only
    # unknown/legacy tags are treated as needing reclassification.
    def _has_valid_tags(aug: dict) -> bool:
        return bool([t for t in (aug.get("kit_tags") or []) if t in VALID_TAGS])

    to_classify = [a for a in augments if not _has_valid_tags(a)] if args.skip_classified else augments

    batches = [to_classify[i:i + args.batch_size] for i in range(0, len(to_classify), args.batch_size)]
    print(f"Will run {len(batches)} LLM batches of up to {args.batch_size} augments each")

    if args.dry_run:
        if not batches:
            print("Nothing to classify.")
            return
        first_batch = batches[0]
        prompt = "Classify these augments:\n" + json.dumps(
            [build_input_block(a) for a in first_batch], indent=2
        )
        print("\n--- DRY RUN: first batch prompt ---")
        print(SYSTEM_PROMPT[:500] + "...")
        print("\nUser message:")
        print(prompt[:800])
        return

    results: dict[str, dict] = {}
    failed_batches: list[int] = []
    for i, batch in enumerate(batches):
        slugs = [a["slug"] for a in batch]
        prompt = "Classify these augments:\n" + json.dumps(
            [build_input_block(a) for a in batch], indent=2
        )
        print(f"  Batch {i+1}/{len(batches)}: {slugs[0]}…{slugs[-1]}", end="", flush=True)
        raw_resp = call_groq(prompt)
        try:
            parsed = parse_llm_json(raw_resp)
            results.update(parsed)
            print(f" ✓ ({len(parsed)} classified)")
        except json.JSONDecodeError as e:
            print(f" ✗ JSON parse failed: {e}")
            print("Raw:", raw_resp[:200])
            failed_batches.append(i + 1)
            continue

    # Phase 3: merge results back into augments
    slug_to_aug = {a["slug"]: a for a in augments}
    applied = 0
    for slug, classification in results.items():
        aug = slug_to_aug.get(slug)
        if not aug:
            continue
        # Validate and apply kit_tags
        raw_tags = classification.get("kit_tags", [])
        aug["kit_tags"] = [t for t in raw_tags if t in VALID_TAGS]
        # Apply set only if not already known from wikiSet (trust wikiSet over LLM)
        if not aug.get("set") and classification.get("set") in VALID_SETS:
            aug["set"] = classification["set"]
        applied += 1

    print(f"\nApplied classifications to {applied}/{total} augments")
    final_tagged = sum(1 for a in augments if _has_valid_tags(a))
    print(f"Final kit_tags coverage: {final_tagged}/{total}")
    print(f"Final set coverage: {sum(1 for a in augments if a.get('set'))}/{total}")

    if failed_batches and not args.allow_partial:
        print(f"\n✗ {len(failed_batches)} batch(es) failed (batch numbers: {failed_batches}). Pass --allow-partial to write anyway.")
        sys.exit(1)

    # Phase 4: write back
    if is_dict_root:
        raw["augments"] = augments
        output = raw
    else:
        output = augments

    AUGMENTS_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {AUGMENTS_PATH}")


if __name__ == "__main__":
    main()
