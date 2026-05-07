#!/usr/bin/env python3
"""
audit_kit_tags.py — Per-champion audit of current vs proposed kit_tags.

Reads:
  public/data/abilities.json
  public/data/champions.json
  public/data/augments.json
  public/data/pool-rules.json

Writes nothing. Prints:
  - per-champion: current tags, proposed tags, removed/added
  - current pool size N, projected pool size N (after applying proposed tags)
  - sortable by delta
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
ABILITIES = json.loads((ROOT / "public/data/abilities.json").read_text("utf-8"))
CHAMPIONS = json.loads((ROOT / "public/data/champions.json").read_text("utf-8"))["champions"]
AUGMENTS  = json.loads((ROOT / "public/data/augments.json").read_text("utf-8"))["augments"]
POOL_RULES = json.loads((ROOT / "public/data/pool-rules.json").read_text("utf-8"))

PROFILES = ABILITIES["profiles"]

# ── Mirrored hard-exclusion sets (subset needed for pool sim) ───────
MANALESS = {
    "aatrox","ambessa","briar","drmundo","garen","gnar","katarina","kled","mordekaiser",
    "nilah","reksai","renekton","rengar","riven","rumble","sett","shyvana","tryndamere",
    "viego","yasuo","yone",
}
ENERGY = {"akali","kennen","leesin","shen","zed"}

RANGED_ONLY      = {"draw-your-sword","scopiest-weapons","scopier-weapons","scoped-weapons"}
MANA_REQUIRED    = {"juiced","mind-to-matter","overflow","ominous-pact"}
CC_REQUIRED      = {"cruelty","courage-of-the-colossus","soul-eater","slap-around","guilty-pleasure","adamant","tormentor"}
DASH_REQUIRED    = {"shadow-runner","swift-and-safe","outlaws-grit","dashing"}
SPIN_REQUIRED    = {"spin-to-win"}
HEAL_SHIELD_REQ  = {"windspeakers-blessing","empowered-by-the-faithful","all-for-you","sonic-boom","crack-open-that-egg"}
AUTO_ATTACK_FOC  = {
    "dual-wield","tap-dancer","mystic-punch","gash","master-of-duality","twice-thrice",
    "firebrand","shrink-ray","heavy-hitter","typhoon","light-em-up","fan-the-hammer",
    "slow-and-steady","deft","lightning-strikes","soul-siphon","double-tap","critical-rhythm",
    "cerberus","symphony-of-war",
}
ABILITY_FOC = {"quest-wooglets-witchcap","hat-on-a-hat","witchful-thinking","big-brain","adapt","eureka"}

ENCHANTERS = {"soraka","nami","lulu","janna","yuumi","karma","seraphine","milio",
              "renata","taric","rakan","bard","sona","ivern","nidalee"}

HARD_CC = {"stun","root","knockup","charm","suppress","fear","taunt","immobilize"}
HEAL_SHIELD_RE = re.compile(
    r"\bheal(?:s|ing)?\b|restore[sd]?\s+health|grant[sd]?\s+a?\s*shield\w*|\bshield(?:s|ed|ing)?\b|barrier",
    re.I,
)
CRIT_KIT_RE = re.compile(r"critical(?:ly)?\s+strik\w*|double\s+(?:the\s+)?critical|crit(?:ical)?\s+(?:damage|chance)", re.I)
DOT_RE = re.compile(r"\bburn(?:s|ing)?\b|\bpoison(?:s|ed)?\b|\bbleed(?:s|ing)?\b|\bblaze\b", re.I)
DASH_DESC_RE = re.compile(r"\bdash(?:es)?\b|\bblink\b|\bleap\b|\blunge\b|\bvault\b|\btumble\b", re.I)
SPIN_RE = re.compile(r"spin(?:s|ning)?|whirl|rotat", re.I)
MS_SELF_BUFF_RE = re.compile(
    r"gain(?:s|ing)?\s+[\d\.\s]*%?\s*(?:bonus\s+)?(?:movement|move)\s*speed"
    r"|increased\s+(?:movement|move)\s*speed"
    r"|grants?\s+[\d\.\s]*%?\s*(?:bonus\s+)?(?:movement|move)\s*speed",
    re.I,
)


# ── New derivation ──────────────────────────────────────────────────
def derive_proposed(slug, profile, riot_tags):
    tags = set()
    if not profile:
        return []

    damage_type = profile.get("damageType","mixed")
    attack_type = profile.get("attackType","melee")
    playstyle   = profile.get("playstyle", {})
    abilities   = profile.get("abilities", [])

    mob = playstyle.get("mobility", 0)
    dur = playstyle.get("durability", 0)
    dmg = playstyle.get("damage", 0)

    is_mage     = "mage"     in riot_tags
    is_tank     = "tank"     in riot_tags
    is_fighter  = "fighter"  in riot_tags
    is_marksman = "marksman" in riot_tags
    is_support  = "support"  in riot_tags
    is_assassin = "assassin" in riot_tags
    is_pure_mage = is_mage and not is_tank and not is_fighter

    # Aggregate
    total_ap = 0.0
    total_ad = 0.0
    has_on_hit = False
    has_dot = False
    cc_count = 0
    has_hard_cc = False
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
            if "Immobiliz" in t:
                has_hard_cc = True
            if t == "Trait_PlayerSelectedDashDirection":
                has_dash_tag = True
            if t == "PositiveEffect_Teleport":
                has_teleport_tag = True
            if t == "Trait_AttackReset":
                has_attack_reset = True
            if t == "PositiveEffect_EmpowerAttack":
                has_empower_attack = True
        d = ab.get("description") or ""
        desc_parts.append(d)
        if MS_SELF_BUFF_RE.search(d) and ab.get("key") in {"passive","W","E","R"}:
            has_self_ms_buff = True
    all_desc = " ".join(desc_parts)
    has_heal_shield = bool(HEAL_SHIELD_RE.search(all_desc))
    has_crit_kit    = bool(CRIT_KIT_RE.search(all_desc))
    if not has_dot:
        has_dot = bool(DOT_RE.search(all_desc))
    has_spin = bool(SPIN_RE.search(all_desc))

    # ── attack ──
    if (
        is_marksman
        or (is_assassin and total_ad >= 0.5)
        or (is_fighter and attack_type == "melee" and (has_attack_reset or has_empower_attack))
        or (total_ad >= 1.0 and not is_pure_mage)
    ):
        tags.add("attack")

    # ── ability ──
    if is_pure_mage \
       or (is_mage and total_ap >= 1.0) \
       or (total_ap >= 2.0 and not is_marksman):
        tags.add("ability")

    # ── on_hit ──
    if (has_on_hit and not is_pure_mage) \
       or ((has_attack_reset or has_empower_attack) and total_ad >= 0.5 and not is_pure_mage):
        tags.add("on_hit")

    # ── crit ──
    if has_crit_kit or (is_marksman and total_ad >= 1.0):
        tags.add("crit")

    # ── movement ──
    if mob >= 2 or has_dash_tag or has_teleport_tag or has_self_ms_buff:
        tags.add("movement")

    # ── haste ──
    if (is_mage and dmg >= 2) or total_ap >= 3.0:
        tags.add("haste")

    # ── tank ──
    if is_tank or dur >= 4 or (is_fighter and dur >= 3):
        tags.add("tank")

    # ── heal_shield ──
    if has_heal_shield or slug in ENCHANTERS:
        tags.add("heal_shield")

    # ── dot ──
    if has_dot:
        tags.add("dot")

    # ── cc ──
    if has_hard_cc or cc_count >= 2:
        tags.add("cc")

    return sorted(tags)


# ── Pool simulator ──────────────────────────────────────────────────
def is_in_pool_hard(slug, desc, profile, attack_type, resource, has_hard_cc, has_dash, has_spin, has_heal_shield, total_ad, total_ap, damage_type, has_on_hit):
    """Simulate isInAugmentPool from augment-tailoring.ts."""
    desc_l = desc.lower()
    if slug in RANGED_ONLY and attack_type == "melee":
        return False, "ranged-only"
    if "become melee" in desc_l and attack_type == "melee":
        return False, "become-melee"
    if "become ranged" in desc_l and attack_type == "ranged":
        return False, "become-ranged"
    if resource != "mana":
        if slug in MANA_REQUIRED:
            return False, "mana-required"
        if re.search(r"consume[sd]?\s+\d[\d.]*%\s+(?:of\s+)?(?:your\s+)?(?:maximum\s+|current\s+)?mana\b", desc_l):
            return False, "mana-consume"
        if re.search(r"(?:equal to|based on)\s+\d[\d.]*%\s+(?:of\s+)?(?:your\s+)?(?:maximum\s+|bonus\s+)?mana\b", desc_l):
            return False, "mana-scale"
        if re.search(r"\bmana costs?\s+(?:are\s+)?(?:doubled|tripled|increased\s+by)\b", desc_l):
            return False, "mana-cost"
    if slug in CC_REQUIRED and not has_hard_cc:
        return False, "cc-required"
    if slug in DASH_REQUIRED and not has_dash:
        return False, "dash-required"
    if slug in SPIN_REQUIRED and not has_spin:
        return False, "spin-required"
    if slug in HEAL_SHIELD_REQ and not has_heal_shield:
        return False, "heal-shield-required"
    if slug in AUTO_ATTACK_FOC:
        is_pure_caster = damage_type == "magic" and total_ap >= 1.5 and total_ad < 0.3 and not has_on_hit
        if is_pure_caster:
            return False, "auto-attack-on-mage"
    if slug in ABILITY_FOC:
        is_pure_ad = damage_type == "physical" and total_ad >= 1.0 and total_ap < 0.3
        if is_pure_ad:
            return False, "ap-on-pure-ad"
    if slug == "escapade" and total_ap < 0.3 and damage_type == "physical":
        return False, "escapade-no-ap"
    if slug == "adapt" and total_ad < 0.3 and damage_type == "magic":
        return False, "adapt-no-ad"
    return True, None


def get_resource(slug):
    if slug in MANALESS: return "none"
    if slug in ENERGY: return "energy"
    return "mana"


def simulate_pool(slug, kit_tags, profile):
    """Return (total_n, by_rarity, exclude_breakdown)."""
    if not profile:
        return 0, {"silver":0,"gold":0,"prismatic":0}, {}

    abilities = profile.get("abilities", [])
    attack_type = profile.get("attackType","melee")
    damage_type = profile.get("damageType","mixed")
    resource = get_resource(slug)

    has_hard_cc = False
    has_on_hit = False
    has_dash_tag = False
    total_ap = 0.0
    total_ad = 0.0
    desc_parts = []
    for ab in abilities:
        s = ab.get("stats") or {}
        total_ap += s.get("apRatio",0) or 0
        total_ad += (s.get("adRatio",0) or 0) + (s.get("totalAdRatio",0) or 0)
        if s.get("isOnHit"): has_on_hit = True
        cc = s.get("ccType")
        if cc and cc in HARD_CC: has_hard_cc = True
        for t in (s.get("tags") or []):
            if "Immobiliz" in t: has_hard_cc = True
            if t in ("Trait_PlayerSelectedDashDirection", "PositiveEffect_Teleport"):
                has_dash_tag = True
        d = ab.get("description") or ""
        desc_parts.append(d)
    all_desc = " ".join(desc_parts)
    has_dash = has_dash_tag or bool(DASH_DESC_RE.search(all_desc))
    has_spin = bool(SPIN_RE.search(all_desc))
    has_heal_shield = bool(HEAL_SHIELD_RE.search(all_desc))

    disabled = set(POOL_RULES.get("disabled", []))
    removed  = set(POOL_RULES.get("lifecycle", {}).get("removed", {}).keys())
    # item_exclusions depend on which items the player owns — not applied in a champion-only audit

    by_rarity = {"silver":0,"gold":0,"prismatic":0}
    excluded = {}
    total = 0
    for a in AUGMENTS:
        s = a["slug"]
        if s in disabled: excluded["disabled"] = excluded.get("disabled",0)+1; continue
        if s in removed:  excluded["removed"]  = excluded.get("removed",0)+1;  continue
        ok, reason = is_in_pool_hard(s, a.get("wikiDescription") or "", profile, attack_type, resource, has_hard_cc, has_dash, has_spin, has_heal_shield, total_ad, total_ap, damage_type, has_on_hit)
        if not ok:
            excluded[reason or "hard"] = excluded.get(reason or "hard",0)+1
            continue
        aug_tags = a.get("kit_tags") or []
        if aug_tags:
            if not any(t in kit_tags for t in aug_tags):
                excluded["tag-mismatch"] = excluded.get("tag-mismatch",0)+1
                continue
        # passes
        by_rarity[a["rarity"]] = by_rarity.get(a["rarity"],0)+1
        total += 1
    return total, by_rarity, excluded


# ── Main ──────────────────────────────────────────────────────────────
def main():
    rows = []
    for c in CHAMPIONS:
        slug = c["slug"]
        profile = PROFILES.get(slug, {})
        riot_tags = c.get("tags", [])
        current = c.get("kit_tags", []) or []
        proposed = derive_proposed(slug, profile, riot_tags)
        # remove dead mana/manaless from current side for delta clarity
        current_no_dead = [t for t in current if t not in {"mana","manaless"}]
        added = sorted(set(proposed) - set(current_no_dead))
        removed = sorted(set(current_no_dead) - set(proposed))
        cur_n, _, _   = simulate_pool(slug, current, profile)
        prop_n, _, _  = simulate_pool(slug, proposed, profile)
        rows.append({
            "slug": slug,
            "riot": riot_tags,
            "current": current,
            "proposed": proposed,
            "added": added,
            "removed": removed,
            "cur_n": cur_n,
            "prop_n": prop_n,
            "delta": prop_n - cur_n,
        })

    rows.sort(key=lambda r: (-r["delta"], r["slug"]))

    # Header
    print(f"{'slug':16} {'role':24} {'cur N':>5}  {'new N':>5}  {'Δ':>4}  {'-removed':40}  {'+added':40}  proposed")
    print("─" * 200)
    for r in rows:
        role = ",".join(r["riot"])[:24]
        rem = ",".join(r["removed"]) or "·"
        add = ",".join(r["added"])   or "·"
        prop = ",".join(r["proposed"])
        print(f"{r['slug']:16} {role:24} {r['cur_n']:5d}  {r['prop_n']:5d}  {r['delta']:>+4d}  -{rem:39}  +{add:39}  {prop}")

    # Summary
    print("\n=== SUMMARY ===")
    bigwin = [r for r in rows if r['delta'] >= 60]
    midwin = [r for r in rows if 20 <= r['delta'] < 60]
    nochange = [r for r in rows if r['delta'] == 0 and not r['added'] and not r['removed']]
    regressions = [r for r in rows if r['delta'] < 0]
    print(f"  Pool +60 or more:     {len(bigwin)}")
    print(f"  Pool +20..59:         {len(midwin)}")
    print(f"  No pool change & no tag change: {len(nochange)}")
    print(f"  Pool shrinks (delta<0): {len(regressions)}")
    if regressions:
        print("  Regressions:")
        for r in regressions[:10]:
            print(f"    {r['slug']:14} delta={r['delta']:+d}  removed={r['removed']}  added={r['added']}")

    # Tag delta totals
    from collections import Counter
    add_c = Counter(t for r in rows for t in r['added'])
    rem_c = Counter(t for r in rows for t in r['removed'])
    print("\n  Tags added (most common):")
    for t,n in add_c.most_common():
        print(f"    +{t:12s} {n}")
    print("\n  Tags removed (most common):")
    for t,n in rem_c.most_common():
        print(f"    -{t:12s} {n}")


if __name__ == "__main__":
    main()
