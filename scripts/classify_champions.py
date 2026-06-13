#!/usr/bin/env python3
"""
classify_champions.py — Derive champion kit_tags from AbilityProfile data.

Extends data/internal/champions.json in-place with:
  kit_tags: ChampionTag[]  — mirrors the 12-value enum in types.ts

Derivation is deterministic from abilities.json profiles.
LLM fallback (groq-fast) used only for champions that produce 0 tags.

Usage:
  python3 scripts/classify_champions.py [--dry-run] [--show-all]
"""

import argparse
import json
import os
import re
import sys
import urllib.request
import time
from pathlib import Path

from data_paths import INTERNAL_DATA_DIR

# ─── Config ───────────────────────────────────────────────────────────────────

CHAMPIONS_PATH = INTERNAL_DATA_DIR / "champions.json"
ABILITIES_PATH = INTERNAL_DATA_DIR / "abilities.json"
LITELLM_URL = os.getenv("CLASSIFIER_URL", "https://api.groq.com/openai/v1/chat/completions")
LITELLM_MODEL = os.getenv("CLASSIFIER_MODEL", "llama-3.3-70b-versatile")
LITELLM_KEY = os.getenv("GROQ_API_KEY", "sk-litellm-local")

VALID_TAGS = [
    "attack", "ability", "on_hit", "crit", "movement",
    "haste", "tank", "heal_shield", "dot", "cc", "mana", "manaless",
]

# ─── Resource sets (mirrored from augment-tailoring.ts) ──────────────────────

MANALESS = {
    "aatrox", "ambessa", "briar", "drmundo", "garen", "gnar", "katarina",
    "kled", "mordekaiser", "nilah", "reksai", "renekton", "rengar", "riven",
    "rumble", "sett", "shyvana", "tryndamere", "viego", "yasuo", "yone",
}

ENERGY = {"akali", "kennen", "leesin", "shen", "zed"}

# ─── Regex patterns (mirrored from augment-tailoring.ts) ─────────────────────

HARD_CC = {"stun", "root", "knockup", "charm", "suppress", "fear", "taunt", "immobilize"}
HEAL_SHIELD_RE = re.compile(
    r"\bheal(?:s|ing)?\b|restore[sd]?\s+health|grant[sd]?\s+a?\s*shield\w*|\bshield(?:s|ed|ing)?\b|barrier", re.I
)
CRIT_KIT_RE = re.compile(
    r"critical(?:ly)?\s+strik\w*|double\s+(?:the\s+)?critical|crit(?:ical)?\s+(?:damage|chance)", re.I
)
DOT_RE = re.compile(r"\bburn(?:s|ing)?\b|\bpoison(?:s|ed)?\b|\bbleed(?:s|ing)?\b|\bblaze\b", re.I)
MS_SELF_BUFF_RE = re.compile(
    r"gain(?:s|ing)?\s+[\d\.\s]*%?\s*(?:bonus\s+)?(?:movement|move)\s*speed"
    r"|increased\s+(?:movement|move)\s*speed"
    r"|grants?\s+[\d\.\s]*%?\s*(?:bonus\s+)?(?:movement|move)\s*speed",
    re.I,
)

# ─── Derivation ───────────────────────────────────────────────────────────────

ENCHANTERS = {
    "soraka", "nami", "lulu", "janna", "yuumi", "karma", "seraphine", "milio",
    "renata", "taric", "rakan", "bard", "sona", "ivern", "nidalee",
}


def derive_kit_tags(slug: str, profile: dict, riot_tags: list) -> list:
    """Pure deterministic derivation from AbilityProfile signals.

    kit_tags drive Layer 3 (tag intersection) of the augment pool orchestrator.
    Resource gating (mana / manaless / energy) happens at Layer 2 via the
    MANA_REQUIRED hard-exclusion set, so these tags are intentionally omitted
    from the kit_tags output (they would be dead weight here).
    """
    tags = set()
    if not profile:
        return []

    attack_type = profile.get("attackType", "melee")
    playstyle = profile.get("playstyle", {})
    abilities = profile.get("abilities", [])

    mob = playstyle.get("mobility", 0)
    dur = playstyle.get("durability", 0)
    dmg = playstyle.get("damage", 0)

    is_mage      = "mage"     in riot_tags
    is_tank_role = "tank"     in riot_tags
    is_fighter   = "fighter"  in riot_tags
    is_marksman  = "marksman" in riot_tags
    is_assassin  = "assassin" in riot_tags
    is_pure_mage = is_mage and not is_tank_role and not is_fighter

    # ── Aggregate ability signals ──
    total_ap = 0.0
    total_ad = 0.0
    has_on_hit = False
    has_dot = False
    has_hard_cc = False
    cc_count = 0
    has_dash_tag = False
    has_teleport_tag = False
    has_attack_reset = False
    has_empower_attack = False
    has_self_ms_buff = False

    desc_parts = []
    for ab in abilities:
        s = ab.get("stats") or {}
        total_ap += s.get("apRatio", 0) or 0
        total_ad += (s.get("adRatio", 0) or 0) + (s.get("totalAdRatio", 0) or 0)
        if s.get("isOnHit"):
            has_on_hit = True
        if s.get("isDot"):
            has_dot = True
        cc = s.get("ccType")
        if cc:
            cc_count += 1
            if cc in HARD_CC:
                has_hard_cc = True
        for t in (s.get("tags") or []):
            if "Immobiliz" in t or "CC" in t:
                has_hard_cc = True
            if t == "Trait_PlayerSelectedDashDirection":
                has_dash_tag = True
            elif t == "PositiveEffect_Teleport":
                has_teleport_tag = True
            elif t == "Trait_AttackReset":
                has_attack_reset = True
            elif t == "PositiveEffect_EmpowerAttack":
                has_empower_attack = True
        d = ab.get("description") or ""
        desc_parts.append(d)
        if MS_SELF_BUFF_RE.search(d) and ab.get("key") in {"passive", "W", "E", "R"}:
            has_self_ms_buff = True

    all_desc = " ".join(desc_parts)
    has_heal_shield = bool(HEAL_SHIELD_RE.search(all_desc))
    has_crit_kit    = bool(CRIT_KIT_RE.search(all_desc))
    if not has_dot:
        has_dot = bool(DOT_RE.search(all_desc))

    # ── attack: marksmen, AD assassins, AA-reset bruisers, or AD≥1.0 non-mages ──
    if (
        is_marksman
        or (is_assassin and total_ad >= 0.5)
        or (is_fighter and attack_type == "melee" and (has_attack_reset or has_empower_attack))
        or (total_ad >= 1.0 and not is_pure_mage)
    ):
        tags.add("attack")

    # ── ability: pure mages, AP-leaning mages, or high-AP non-marksmen ──
    if is_pure_mage \
       or (is_mage and total_ap >= 1.0) \
       or (total_ap >= 2.0 and not is_marksman):
        tags.add("ability")

    # ── on_hit: explicit on-hit kit, or AA-reset/empower bruisers ──
    if (has_on_hit and not is_pure_mage) \
       or ((has_attack_reset or has_empower_attack) and total_ad >= 0.5 and not is_pure_mage):
        tags.add("on_hit")

    # ── crit: explicit crit kit (regex) or AD marksmen ──
    if has_crit_kit or (is_marksman and total_ad >= 1.0):
        tags.add("crit")

    # ── movement: meaningful mobility, dash/teleport tags, or self MS buff ──
    if mob >= 2 or has_dash_tag or has_teleport_tag or has_self_ms_buff:
        tags.add("movement")

    # ── haste: ability-cycling mages, or very high-AP champs ──
    if (is_mage and dmg >= 2) or total_ap >= 3.0:
        tags.add("haste")

    # ── tank: tank-role, very durable, or durable fighters ──
    if is_tank_role or dur >= 4 or (is_fighter and dur >= 3):
        tags.add("tank")

    # ── heal_shield: any heal/shield in kit, or known enchanter ──
    if has_heal_shield or slug in ENCHANTERS:
        tags.add("heal_shield")

    # ── dot: structured isDot or DoT-keyword in description ──
    if has_dot:
        tags.add("dot")

    # ── cc: hard CC in kit, or ≥2 abilities with any CC ──
    if has_hard_cc or cc_count >= 2:
        tags.add("cc")

    return sorted(tags)


# ─── LLM fallback ─────────────────────────────────────────────────────────────

LLM_SYSTEM = f"""You are classifying League of Legends champions for ARAM Mayhem augment pool construction.

For each champion, assign kit_tags from: {VALID_TAGS}

Rules:
- ability: champion primarily deals damage through abilities / AP scaling
- attack: champion primarily deals damage through basic attacks / AD scaling
- on_hit: champion has on-hit effects in kit
- crit: champion has critical strike synergy (marksmen, Yasuo/Yone, Tryndamere)
- movement: champion has dashes, blinks, or mobility as kit identity
- haste: champion benefits significantly from ability haste (ability spammers, CC bots)
- tank: champion is built around durability / tankiness
- heal_shield: champion has heals or shields in kit
- dot: champion has damage-over-time (burn, bleed, poison) in kit
- cc: champion has hard crowd control (stun, root, knockup, charm)
- mana: champion uses mana as resource
- manaless: champion has no mana bar (regen, no resource, health costs)

Return JSON object keyed by slug with value "kit_tags": [...].
No markdown, no explanation."""


def call_groq(prompt: str, retries: int = 3) -> str:
    body = json.dumps({
        "model": LITELLM_MODEL,
        "messages": [
            {"role": "system", "content": LLM_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
    }).encode()

    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                LITELLM_URL, data=body,
                headers={"Authorization": f"Bearer {LITELLM_KEY}", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                return data["choices"][0]["message"]["content"]
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise


def parse_llm_json(raw: str) -> dict:
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print results without writing")
    parser.add_argument("--show-all", action="store_true", help="Print all champion tags")
    parser.add_argument("--allow-partial", action="store_true", help="Write output even if some champions still have empty kit_tags")
    args = parser.parse_args()

    ab_raw  = json.loads(ABILITIES_PATH.read_text("utf-8"))
    profiles = ab_raw["profiles"]  # dict: slug → AbilityProfile

    ch_raw    = json.loads(CHAMPIONS_PATH.read_text("utf-8"))
    champions = ch_raw.get("champions", ch_raw) if isinstance(ch_raw, dict) else ch_raw
    is_dict   = isinstance(ch_raw, dict) and "champions" in ch_raw

    print(f"Loaded {len(champions)} champions, {len(profiles)} ability profiles")

    # Derive tags deterministically
    needs_llm = []
    for champ in champions:
        slug     = champ["slug"]
        profile  = profiles.get(slug, {})
        riot_tags = champ.get("tags", [])
        kit_tags = derive_kit_tags(slug, profile, riot_tags)
        champ["kit_tags"] = kit_tags

        if not kit_tags:
            needs_llm.append(champ)

        if args.show_all:
            print(f"  {slug}: {kit_tags}")

    det_count = sum(1 for c in champions if c.get("kit_tags"))
    print(f"Deterministic coverage: {det_count}/{len(champions)}")
    print(f"Need LLM fallback: {len(needs_llm)}")

    # LLM fallback for zero-tag champions
    llm_failures = 0
    if needs_llm and not args.dry_run:
        batch_size = 10
        batches = [needs_llm[i:i+batch_size] for i in range(0, len(needs_llm), batch_size)]
        slug_map = {c["slug"]: c for c in champions}
        for i, batch in enumerate(batches):
            items = [{"slug": c["slug"], "name": c["name"], "tags": c.get("tags", [])} for c in batch]
            prompt = f"Classify these champions:\n{json.dumps(items, indent=2)}"
            print(f"  LLM batch {i+1}/{len(batches)}: {[b['slug'] for b in batch]}", end="", flush=True)
            try:
                raw = call_groq(prompt)
                parsed = parse_llm_json(raw)
                for slug, data in parsed.items():
                    if slug in slug_map:
                        llm_tags = data if isinstance(data, list) else data.get("kit_tags", [])
                        slug_map[slug]["kit_tags"] = [t for t in llm_tags if t in VALID_TAGS]
                print(" ✓")
            except Exception as e:
                print(f" ✗ {e}")
                llm_failures += 1

    # Print summary stats
    tag_counts = {}
    for champ in champions:
        for t in (champ.get("kit_tags") or []):
            tag_counts[t] = tag_counts.get(t, 0) + 1

    print("\nTag distribution:")
    for tag in VALID_TAGS:
        n = tag_counts.get(tag, 0)
        bar = "█" * (n // 3)
        print(f"  {tag:<12} {n:>3}  {bar}")

    # Spot-check a few known champions
    spot = ["brand", "malphite", "ezreal", "ashe", "garen", "katarina", "soraka", "zed", "yasuo"]
    slug_map = {c["slug"]: c for c in champions}
    print("\nSpot-check:")
    for s in spot:
        c = slug_map.get(s)
        if c:
            print(f"  {s}: {c.get('kit_tags')}")

    if args.dry_run:
        print("\n[DRY RUN — nothing written]")
        return

    # Fail if LLM outage left champions with empty kit_tags
    zero_tag = [c["slug"] for c in champions if not c.get("kit_tags")]
    if zero_tag and not args.allow_partial:
        print(f"\n✗ {len(zero_tag)} champions have empty kit_tags after LLM fallback: {zero_tag[:10]}")
        print("  Pass --allow-partial to write anyway (e.g. during a network outage).")
        sys.exit(1)
    if llm_failures:
        print(f"  ⚠ {llm_failures} LLM batch(es) failed; {len(zero_tag)} champions remain untagged")

    # Write back
    if is_dict:
        ch_raw["champions"] = champions
        out = ch_raw
    else:
        out = champions

    CHAMPIONS_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), "utf-8")
    print(f"\nWrote {CHAMPIONS_PATH}")


if __name__ == "__main__":
    main()
