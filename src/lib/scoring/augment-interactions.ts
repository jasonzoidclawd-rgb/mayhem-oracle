/**
 * Augment–Ability Mechanical Interaction Analysis
 *
 * Detects strong synergies and traps between augment mechanics
 * and champion ability kits using structured ability stats (ratios,
 * cooldowns, damage types, CC) from CommunityDragon.
 *
 * Unlike the curated combos (combos.json), these are computed
 * from actual ability data — WHY a combo works or doesn't.
 */

import type { AbilityProfile, AbilityStats, ChampionBaseStats } from "../types";

// ─── Augment Mechanic Tags ──────────────────────────────────────────────────

export type AugmentMechanic =
  | "ABILITY_CRIT"       // abilities can critically strike
  | "ON_HIT"             // triggers on basic attacks / on-hit effects
  | "ATTACK_SPEED"       // grants or scales with attack speed
  | "DOT_SYNERGY"        // works with damage-over-time / burn
  | "ULT_POWER"          // empowers champion after/during ultimate
  | "ULT_SEALED"         // seals ultimate permanently
  | "ABILITY_HASTE"      // grants large ability haste / cooldown reduction
  | "ON_CAST"            // triggers when casting abilities
  | "DASH_SYNERGY"       // triggers on dash/blink/leap
  | "EXECUTE"            // bonus damage to low-health targets
  | "LIFESTEAL"          // life steal / omnivamp
  | "TRUE_DAMAGE"        // deals or converts to true damage
  | "MANA_SCALING"       // scales with mana pool
  | "SIZE_CHANGE"        // changes champion size
  | "SHIELD"             // grants shields
  | "SUMMON_REPLACE"     // replaces summoner spell
  | "MELEE_CONVERT"      // converts ranged to melee
  | "AD_SCALING"         // scales with or grants AD
  | "AP_SCALING"         // scales with or grants AP
  | "IMMOBILIZE_TRIGGER"; // triggers when immobilizing enemy

// ─── Champion Kit Analysis (stats-based) ────────────────────────────────────

export interface KitAnalysis {
  /** Total AP ratio across all non-passive abilities */
  totalApRatio: number;
  /** Total AD ratio (bonus + total) across abilities */
  totalAdRatio: number;
  /** Shortest non-ult cooldown at max rank */
  shortestCD: number;
  /** Average non-ult cooldown at rank 1 */
  avgCD: number;
  /** Number of abilities with CC */
  ccCount: number;
  /** Specific CC types in kit */
  ccTypes: string[];
  /** Hard CC abilities (stun, root, knockup, charm, suppress, fear, taunt) */
  hardCCCount: number;
  /** Number of abilities that are DoT */
  dotCount: number;
  /** Number of abilities that are on-hit */
  onHitCount: number;
  /** Number of abilities that are AoE */
  aoeCount: number;
  /** Whether kit has a dash (from description keyword) */
  hasDash: boolean;
  /** Primary damage type from ability stats */
  primaryDamageType: "magic" | "physical" | "mixed" | "true";
  /** R ability stats */
  ultStats: AbilityStats | undefined;
  /** Whether champion uses mana */
  usesMana: boolean;
  /** Whether champion is melee */
  isMelee: boolean;
  /** Total mana cost of full rotation at rank 1 */
  rotationManaCost: number;
  /** Abilities with AP ratios */
  apAbilities: string[];
  /** Abilities with AD ratios */
  adAbilities: string[];
  /** Abilities with on-hit */
  onHitAbilities: string[];
  /** Abilities with DoT */
  dotAbilities: string[];
  /** Abilities with CC */
  ccAbilities: string[];
}

const HARD_CC_TYPES = new Set([
  "stun", "root", "knockup", "charm", "suppress", "fear", "taunt", "immobilize",
]);

const DASH_RE = /\bdash(?:es)?\b|\bblink\b|\bleap\b|\blunge\b|\bvault\b|\btumble\b|\broll\b|\brush\b/i;

export function analyzeKit(
  profile: AbilityProfile,
  baseStats: ChampionBaseStats,
): KitAnalysis {
  const abilities = profile.abilities;
  const qwer = abilities.filter((a) => a.key !== "passive");

  let totalApRatio = 0;
  let totalAdRatio = 0;
  let ccCount = 0;
  const ccTypes: string[] = [];
  let hardCCCount = 0;
  let dotCount = 0;
  let onHitCount = 0;
  let aoeCount = 0;
  let rotationManaCost = 0;
  const apAbilities: string[] = [];
  const adAbilities: string[] = [];
  const onHitAbilities: string[] = [];
  const dotAbilities: string[] = [];
  const ccAbilities: string[] = [];
  const cooldowns: number[] = [];
  let magicDmgCount = 0;
  let physicalDmgCount = 0;

  for (const ab of qwer) {
    const s = ab.stats;
    if (!s) continue;

    if (s.apRatio) {
      totalApRatio += s.apRatio;
      apAbilities.push(ab.key);
    }
    if (s.adRatio || s.totalAdRatio) {
      totalAdRatio += (s.adRatio ?? 0) + (s.totalAdRatio ?? 0);
      adAbilities.push(ab.key);
    }
    if (s.ccType) {
      ccCount++;
      ccTypes.push(s.ccType);
      ccAbilities.push(ab.key);
      if (HARD_CC_TYPES.has(s.ccType)) hardCCCount++;
    }
    if (s.isDot) {
      dotCount++;
      dotAbilities.push(ab.key);
    }
    if (s.isOnHit) {
      onHitCount++;
      onHitAbilities.push(ab.key);
    }
    if (s.isAoe) aoeCount++;
    if (s.manaCost?.length) rotationManaCost += s.manaCost[0];
    if (s.cooldown?.length && ab.key !== "R") {
      const cd = s.cooldown[0];
      if (cd >= 1) cooldowns.push(cd); // skip toggled abilities (CD < 1s)
    }
    if (s.damageType === "magic") magicDmgCount++;
    if (s.damageType === "physical") physicalDmgCount++;
  }

  // Also check passive for DoT/on-hit
  const passive = abilities.find((a) => a.key === "passive");
  if (passive?.stats?.isDot) {
    dotCount++;
    dotAbilities.push("passive");
  }
  if (passive?.stats?.isOnHit) {
    onHitCount++;
    onHitAbilities.push("passive");
  }

  const shortestCD = cooldowns.length > 0 ? Math.min(...cooldowns) : 10;
  const avgCD = cooldowns.length > 0
    ? cooldowns.reduce((a, b) => a + b, 0) / cooldowns.length
    : 10;

  const hasDash = abilities.some((a) => DASH_RE.test(a.description));

  let primaryDamageType: "magic" | "physical" | "mixed" | "true" = "mixed";
  if (magicDmgCount > physicalDmgCount + 1) primaryDamageType = "magic";
  else if (physicalDmgCount > magicDmgCount + 1) primaryDamageType = "physical";
  // Also use profile's damageType as tiebreaker
  if (primaryDamageType === "mixed") primaryDamageType = profile.damageType === "mixed" ? "mixed" : profile.damageType;

  const ult = abilities.find((a) => a.key === "R");

  return {
    totalApRatio: round(totalApRatio),
    totalAdRatio: round(totalAdRatio),
    shortestCD,
    avgCD: round(avgCD),
    ccCount,
    ccTypes,
    hardCCCount,
    dotCount,
    onHitCount,
    aoeCount,
    hasDash,
    primaryDamageType,
    ultStats: ult?.stats,
    usesMana: baseStats.baseMP > 0,
    isMelee: profile.attackType === "melee",
    rotationManaCost,
    apAbilities,
    adAbilities,
    onHitAbilities,
    dotAbilities,
    ccAbilities,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Interaction Result ─────────────────────────────────────────────────────

export type InteractionType = "synergy" | "trap";

export interface MechanicalInteraction {
  type: InteractionType;
  augmentSlug: string;
  augmentName: string;
  /** Strength 1-3 (1=minor, 2=moderate, 3=strong) */
  strength: 1 | 2 | 3;
  /** What mechanic drives this interaction */
  mechanic: AugmentMechanic;
  /** Which abilities are involved (empty = general kit) */
  abilities: string[];
  /** Human-readable explanation */
  reason: string;
}

// re-export for backward compat
export type AugmentMechanicTag = AugmentMechanic;

// ─── Augment Mechanic Detection ─────────────────────────────────────────────

export function detectAugmentMechanics(description: string): AugmentMechanic[] {
  const d = description.toLowerCase();
  const tags: AugmentMechanic[] = [];

  if (/abilities?\s+(?:can\s+)?(?:now\s+)?critically?\s+strike/.test(d)) tags.push("ABILITY_CRIT");
  if (/damage\s+over\s+time\s+effects?\s+(?:can\s+)?(?:now\s+)?crit/.test(d)) tags.push("ABILITY_CRIT");
  if (/on[- ]?hit/.test(d) || /basic\s+attack[s]?\s+(?:on[- ]?hit\s+)?deal/.test(d)) tags.push("ON_HIT");
  if (/attack\s+speed/.test(d) && !/reduce[sd]?\s+attack\s+speed/.test(d)) tags.push("ATTACK_SPEED");
  if (/burn|damage\s+over\s+time|stacking\s+infinitely.*damage/.test(d)) tags.push("DOT_SYNERGY");
  if (/(?:after|casting)\s+(?:your\s+)?ultimate|ult(?:imate)?\s+(?:cast|empowers)/.test(d)) tags.push("ULT_POWER");
  if (/ultimate\s+(?:is\s+)?(?:permanently\s+)?sealed|cannot\s+(?:use|cast)\s+(?:your\s+)?ultimate/.test(d)) tags.push("ULT_SEALED");
  if (/ability\s+haste|\bcooldown\s+reduction\b|\d+\s+(?:ability\s+)?haste/.test(d) && !/item\s+haste/.test(d)) tags.push("ABILITY_HASTE");
  if (/(?:dealing|damaging)\s+(?:with\s+)?(?:an?\s+)?abilit(?:y|ies)|(?:ability|spell)\s+(?:cast|hit|damage)/.test(d)) tags.push("ON_CAST");
  if (/dash|blink|leap|teleport/.test(d) && !/snowball/.test(d)) tags.push("DASH_SYNERGY");
  if (/execut(?:e|ing)|below\s+\d+%\s+(?:max(?:imum)?\s+)?health.*bonus\s+damage/.test(d)) tags.push("EXECUTE");
  if (/life\s+steal|omnivamp/.test(d)) tags.push("LIFESTEAL");
  if (/true\s+damage/.test(d)) tags.push("TRUE_DAMAGE");
  if (/(?:equal\s+to|based\s+on|scales?\s+with).*mana|(?:total|maximum|bonus)\s+mana/.test(d)) tags.push("MANA_SCALING");
  if (/(?:increased?|reduce[sd]?|bonus)\s+size|become\s+(?:tiny|large|small)/.test(d)) tags.push("SIZE_CHANGE");
  if (/\bshield\b/.test(d) && !/spell\s*shield/.test(d) && !/through\s+shields/.test(d)) tags.push("SHIELD");
  if (/replace\s+(?:a\s+)?summoner/.test(d)) tags.push("SUMMON_REPLACE");
  if (/become\s+melee/.test(d)) tags.push("MELEE_CONVERT");
  // AD_SCALING: match "bonus AD", "attack damage", standalone "AD" — but NOT "base AD" (inherent, not buildable)
  if (/(?:bonus\s+)?attack\s+damage|(?<!base\s)\b(?:b?ad)\b|\bphysical\s+damage\b/.test(d) && !/reduce[sd]/.test(d) && !/per\s+\d+\s+base\s+ad\b/.test(d)) tags.push("AD_SCALING");
  // AP_SCALING: match "ability power", "AP" — but NOT "magic damage" alone (many augments deal magic damage without scaling AP)
  if (/ability\s+power|\bap\b/.test(d) && !/reduce[sd]/.test(d)) tags.push("AP_SCALING");
  if (/immobiliz(?:e|ing)|ground(?:ing)?.*(?:grant|trigger|cause)/.test(d)) tags.push("IMMOBILIZE_TRIGGER");

  return Array.from(new Set(tags));
}

// ─── Interaction Rules (stats-driven) ───────────────────────────────────────

interface InteractionRule {
  mechanic: AugmentMechanic;
  type: InteractionType;
  /** Condition on kit analysis — return strength 0 to skip */
  evaluate: (kit: KitAnalysis, profile: AbilityProfile) => {
    strength: 0 | 1 | 2 | 3;
    abilities: string[];
    reason: string;
  };
}

function fmt(n: number): string {
  return (n * 100).toFixed(0) + "%";
}

const RULES: InteractionRule[] = [
  // ─── SYNERGIES ───

  // Ability Crit + high AP ratios on ability-focused champs
  {
    mechanic: "ABILITY_CRIT",
    type: "synergy",
    evaluate: (kit) => {
      // Physical champs with incidental AP ratios on utility spells don't benefit much
      if (kit.primaryDamageType === "physical" && kit.totalAdRatio > kit.totalApRatio) return { strength: 0, abilities: [], reason: "" };
      if (kit.totalApRatio < 1.0 && kit.aoeCount < 2) return { strength: 0, abilities: [], reason: "" };
      const str = kit.totalApRatio >= 2.0 || kit.aoeCount >= 3 ? 3 : kit.totalApRatio >= 1.5 ? 2 : 1;
      return {
        strength: str as 1 | 2 | 3,
        abilities: kit.apAbilities,
        reason: `${fmt(kit.totalApRatio)} total AP ratio across ${kit.apAbilities.join("/")} — ability crit amplifies every cast`,
      };
    },
  },
  // Ability Crit + DoT
  {
    mechanic: "ABILITY_CRIT",
    type: "synergy",
    evaluate: (kit) => {
      if (kit.dotCount === 0) return { strength: 0, abilities: [], reason: "" };
      return {
        strength: 3,
        abilities: kit.dotAbilities,
        reason: `DoT ticks on ${kit.dotAbilities.join("/")} can crit — massively amplifies sustained damage`,
      };
    },
  },
  // On-Hit + on-hit kit (must actually be auto-attack focused)
  {
    mechanic: "ON_HIT",
    type: "synergy",
    evaluate: (kit) => {
      // Mages with incidental on-hit passives don't benefit
      if (kit.primaryDamageType === "magic" && kit.totalApRatio > kit.totalAdRatio) return { strength: 0, abilities: [], reason: "" };
      if (kit.onHitCount >= 2) return {
        strength: 3,
        abilities: kit.onHitAbilities,
        reason: `${kit.onHitCount} on-hit abilities (${kit.onHitAbilities.join("/")}) — on-hit augments stack with every attack`,
      };
      if (kit.onHitCount >= 1 && kit.primaryDamageType === "physical") return {
        strength: 2,
        abilities: kit.onHitAbilities,
        reason: `Auto-attack focused kit benefits from on-hit effects`,
      };
      if (kit.primaryDamageType === "physical" && kit.totalAdRatio >= 0.5) return {
        strength: 1,
        abilities: [],
        reason: `Physical damage kit gets value from on-hit effects`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // Attack Speed + on-hit or physical (not mages)
  {
    mechanic: "ATTACK_SPEED",
    type: "synergy",
    evaluate: (kit) => {
      if (kit.primaryDamageType === "magic" && kit.totalApRatio > kit.totalAdRatio) return { strength: 0, abilities: [], reason: "" };
      if (kit.onHitCount >= 2 && kit.primaryDamageType !== "magic") return {
        strength: 3,
        abilities: kit.onHitAbilities,
        reason: `${kit.onHitCount} on-hit effects scale directly with attack speed — more autos = more procs`,
      };
      if (kit.primaryDamageType === "physical") return {
        strength: 2,
        abilities: kit.onHitAbilities.length ? kit.onHitAbilities : [],
        reason: `Physical DPS scales with attack speed`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // DoT synergy
  {
    mechanic: "DOT_SYNERGY",
    type: "synergy",
    evaluate: (kit) => {
      if (kit.dotCount === 0) return { strength: 0, abilities: [], reason: "" };
      return {
        strength: kit.dotCount >= 2 ? 3 : 2,
        abilities: kit.dotAbilities,
        reason: `${kit.dotCount} DoT(s) in kit (${kit.dotAbilities.join("/")}) — burn augments stack multiplicatively with existing damage`,
      };
    },
  },
  // Ability Haste + low cooldowns (spell spam)
  {
    mechanic: "ABILITY_HASTE",
    type: "synergy",
    evaluate: (kit) => {
      if (kit.totalApRatio < 0.5 && kit.primaryDamageType === "physical") return { strength: 0, abilities: [], reason: "" };
      if (kit.avgCD <= 7) return {
        strength: 3,
        abilities: kit.apAbilities.length ? kit.apAbilities : [],
        reason: `Avg ${kit.avgCD.toFixed(1)}s CD — haste creates more spell rotations for ${fmt(kit.totalApRatio)} total AP ratio`,
      };
      if (kit.avgCD <= 10 && kit.totalApRatio >= 1.0) return {
        strength: 2,
        abilities: kit.apAbilities,
        reason: `${fmt(kit.totalApRatio)} AP ratio with ${kit.avgCD.toFixed(1)}s avg CD benefits from haste`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // On-Cast + frequent casters
  {
    mechanic: "ON_CAST",
    type: "synergy",
    evaluate: (kit) => {
      if (kit.shortestCD <= 4) return {
        strength: 3,
        abilities: [],
        reason: `Shortest CD ${kit.shortestCD}s — on-cast effects trigger constantly in teamfights`,
      };
      if (kit.avgCD <= 8 || kit.aoeCount >= 3) return {
        strength: 2,
        abilities: [],
        reason: `Avg ${kit.avgCD.toFixed(1)}s CD with ${kit.aoeCount} AoE abilities — frequent on-cast triggers`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // Dash synergy
  {
    mechanic: "DASH_SYNERGY",
    type: "synergy",
    evaluate: (kit) => {
      if (!kit.hasDash) return { strength: 0, abilities: [], reason: "" };
      return {
        strength: 2,
        abilities: [],
        reason: `Dash in kit — dash-triggered augments activate during normal gameplay`,
      };
    },
  },
  // Immobilize trigger + hard CC
  {
    mechanic: "IMMOBILIZE_TRIGGER",
    type: "synergy",
    evaluate: (kit) => {
      if (kit.hardCCCount === 0) return { strength: 0, abilities: [], reason: "" };
      const str = kit.hardCCCount >= 3 ? 3 : kit.hardCCCount >= 2 ? 2 : 1;
      return {
        strength: str as 1 | 2 | 3,
        abilities: kit.ccAbilities,
        reason: `${kit.hardCCCount} hard CC (${kit.ccTypes.filter(t => HARD_CC_TYPES.has(t)).join(", ")}) on ${kit.ccAbilities.join("/")} — reliably triggers immobilize effects`,
      };
    },
  },
  // Mana scaling + high mana usage
  {
    mechanic: "MANA_SCALING",
    type: "synergy",
    evaluate: (kit) => {
      if (!kit.usesMana) return { strength: 0, abilities: [], reason: "" };
      if (kit.rotationManaCost >= 250) return {
        strength: 2,
        abilities: [],
        reason: `${kit.rotationManaCost} mana full rotation — high mana pool maximizes mana-scaling value`,
      };
      return { strength: 1, abilities: [], reason: `Uses mana — mana-scaling provides some value` };
    },
  },
  // Melee convert for ranged auto-attackers
  {
    mechanic: "MELEE_CONVERT",
    type: "synergy",
    evaluate: (kit) => {
      if (kit.isMelee || kit.primaryDamageType === "magic") return { strength: 0, abilities: [], reason: "" };
      return {
        strength: 2,
        abilities: [],
        reason: `Ranged → melee conversion grants massive stat buffs to trade for range`,
      };
    },
  },
  // Execute + burst
  {
    mechanic: "EXECUTE",
    type: "synergy",
    evaluate: (kit) => {
      if (kit.totalApRatio + kit.totalAdRatio < 1.5) return { strength: 0, abilities: [], reason: "" };
      return {
        strength: 2,
        abilities: [],
        reason: `${fmt(kit.totalApRatio + kit.totalAdRatio)} total scaling — execute augments finish off high-damage rotations`,
      };
    },
  },
  // Lifesteal + auto-attackers
  {
    mechanic: "LIFESTEAL",
    type: "synergy",
    evaluate: (kit) => {
      if (kit.onHitCount >= 1 || kit.primaryDamageType === "physical") return {
        strength: kit.onHitCount >= 2 ? 2 : 1,
        abilities: kit.onHitAbilities,
        reason: `Auto-attack focused kit heals effectively with lifesteal`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },

  // ─── TRAPS ───

  // Ability Crit on auto-attackers with no AP ratios
  {
    mechanic: "ABILITY_CRIT",
    type: "trap",
    evaluate: (kit) => {
      if (kit.totalApRatio >= 0.8 || kit.dotCount > 0) return { strength: 0, abilities: [], reason: "" };
      if (kit.primaryDamageType === "physical" && kit.totalApRatio < 0.3) return {
        strength: 2,
        abilities: [],
        reason: `Only ${fmt(kit.totalApRatio)} total AP ratio — ability crit barely amplifies anything`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // On-Hit on pure mages
  {
    mechanic: "ON_HIT",
    type: "trap",
    evaluate: (kit) => {
      if (kit.onHitCount > 0 || kit.primaryDamageType === "physical") return { strength: 0, abilities: [], reason: "" };
      if (kit.totalApRatio >= 1.5 && kit.primaryDamageType === "magic") return {
        strength: 2,
        abilities: kit.apAbilities,
        reason: `Pure caster with ${fmt(kit.totalApRatio)} AP ratio — rarely auto-attacks, on-hit effects wasted`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // Attack Speed on pure mages
  {
    mechanic: "ATTACK_SPEED",
    type: "trap",
    evaluate: (kit) => {
      if (kit.onHitCount > 0 || kit.primaryDamageType !== "magic") return { strength: 0, abilities: [], reason: "" };
      if (kit.totalApRatio >= 1.5) return {
        strength: 2,
        abilities: [],
        reason: `${fmt(kit.totalApRatio)} AP ratio caster — attack speed doesn't scale spell damage`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // Ult Sealed — always bad if R has real damage/utility
  {
    mechanic: "ULT_SEALED",
    type: "trap",
    evaluate: (kit) => {
      const ult = kit.ultStats;
      if (!ult) return { strength: 2, abilities: ["R"], reason: `Seals ultimate permanently — losing R's utility is a major loss` };
      const ultRatio = (ult.apRatio ?? 0) + (ult.adRatio ?? 0) + (ult.totalAdRatio ?? 0);
      const hasDmg = (ult.baseDamage?.[4] ?? 0) > 100 || ultRatio > 0.3;
      const hasCC = !!ult.ccType;
      if (hasDmg && hasCC) return {
        strength: 3,
        abilities: ["R"],
        reason: `R has ${ult.baseDamage?.[4] ?? "?"} base + ${fmt(ultRatio)} ratio AND ${ult.ccType} — devastating loss`,
      };
      if (hasDmg) return {
        strength: 3,
        abilities: ["R"],
        reason: `R deals ${ult.baseDamage?.[4] ?? "?"} base + ${fmt(ultRatio)} scaling — sealing it removes major damage`,
      };
      return {
        strength: 2,
        abilities: ["R"],
        reason: `Losing ultimate hurts most champions significantly`,
      };
    },
  },
  // Mana Scaling on manaless
  {
    mechanic: "MANA_SCALING",
    type: "trap",
    evaluate: (kit) => {
      if (kit.usesMana) return { strength: 0, abilities: [], reason: "" };
      return {
        strength: 3,
        abilities: [],
        reason: `Manaless champion — mana-scaling augments give zero value`,
      };
    },
  },
  // AD Scaling on pure AP casters
  {
    mechanic: "AD_SCALING",
    type: "trap",
    evaluate: (kit) => {
      if (kit.totalAdRatio >= 0.3 || kit.primaryDamageType === "physical") return { strength: 0, abilities: [], reason: "" };
      if (kit.totalApRatio >= 1.5 && kit.totalAdRatio < 0.1) return {
        strength: 2,
        abilities: kit.apAbilities,
        reason: `${fmt(kit.totalApRatio)} AP ratio with only ${fmt(kit.totalAdRatio)} AD ratio — AD stats are wasted`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // AP Scaling on pure AD with no AP ratios
  {
    mechanic: "AP_SCALING",
    type: "trap",
    evaluate: (kit) => {
      if (kit.totalApRatio >= 0.3) return { strength: 0, abilities: [], reason: "" };
      if (kit.primaryDamageType === "physical" && kit.totalApRatio < 0.1) return {
        strength: 2,
        abilities: kit.adAbilities,
        reason: `${fmt(kit.totalAdRatio)} AD ratio with near-zero AP ratio — AP stats are wasted`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // Lifesteal on pure casters
  {
    mechanic: "LIFESTEAL",
    type: "trap",
    evaluate: (kit) => {
      if (kit.onHitCount > 0 || kit.primaryDamageType === "physical") return { strength: 0, abilities: [], reason: "" };
      if (kit.primaryDamageType === "magic" && kit.totalApRatio >= 1.5) return {
        strength: 2,
        abilities: [],
        reason: `Caster with ${fmt(kit.totalApRatio)} AP ratio rarely auto-attacks — lifesteal barely heals (use omnivamp)`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
  // Melee Convert on melee champs (already melee, wastes augment slot)
  {
    mechanic: "MELEE_CONVERT",
    type: "trap",
    evaluate: (kit) => {
      if (!kit.isMelee) return { strength: 0, abilities: [], reason: "" };
      return {
        strength: 2,
        abilities: [],
        reason: `Already melee — melee conversion augment wastes a slot`,
      };
    },
  },
  // On-Cast for auto-attackers with long CDs
  {
    mechanic: "ON_CAST",
    type: "trap",
    evaluate: (kit) => {
      if (kit.avgCD <= 10 || kit.totalApRatio >= 1.0) return { strength: 0, abilities: [], reason: "" };
      if (kit.primaryDamageType === "physical" && kit.avgCD > 10) return {
        strength: 1,
        abilities: [],
        reason: `${kit.avgCD.toFixed(1)}s avg CD — on-cast effects trigger too infrequently for auto-attackers`,
      };
      return { strength: 0, abilities: [], reason: "" };
    },
  },
];

// ─── Main Analysis Function ─────────────────────────────────────────────────

export function analyzeInteractions(
  champion: {
    name: string;
    slug: string;
    baseStats: ChampionBaseStats;
    abilityProfile: AbilityProfile;
  },
  augments: {
    slug: string;
    name: string;
    description: string;
    wikiDescription?: string;
  }[],
): MechanicalInteraction[] {
  const kit = analyzeKit(champion.abilityProfile, champion.baseStats);
  const interactions: MechanicalInteraction[] = [];

  for (const aug of augments) {
    const desc = aug.wikiDescription || aug.description || "";
    const mechanics = detectAugmentMechanics(desc);

    for (const mechanic of mechanics) {
      // Find all matching rules for this mechanic
      for (const rule of RULES) {
        if (rule.mechanic !== mechanic) continue;

        const result = rule.evaluate(kit, champion.abilityProfile);
        if (result.strength === 0) continue;

        interactions.push({
          type: rule.type,
          augmentSlug: aug.slug,
          augmentName: aug.name,
          strength: result.strength,
          mechanic,
          abilities: result.abilities,
          reason: result.reason,
        });

        // Only fire first matching rule per mechanic×type
        break;
      }
    }
  }

  // Deduplicate: keep strongest interaction per augment×type
  const byKey = new Map<string, MechanicalInteraction[]>();
  for (const i of interactions) {
    const key = `${i.augmentSlug}:${i.type}`;
    const arr = byKey.get(key) ?? [];
    arr.push(i);
    byKey.set(key, arr);
  }

  const deduped: MechanicalInteraction[] = [];
  for (const [, group] of Array.from(byKey)) {
    const seen = new Set<string>();
    const sorted = group.sort((a, b) => b.strength - a.strength);
    for (const i of sorted) {
      if (!seen.has(i.mechanic)) {
        seen.add(i.mechanic);
        deduped.push(i);
      }
    }
  }

  // Resolve conflicts: if an augment appears in both synergies AND traps,
  // keep only the stronger signal (or synergy wins on ties) to avoid confusion.
  const synBySlug = new Map<string, MechanicalInteraction>();
  const trapBySlug = new Map<string, MechanicalInteraction>();
  for (const i of deduped) {
    const map = i.type === "synergy" ? synBySlug : trapBySlug;
    const existing = map.get(i.augmentSlug);
    if (!existing || i.strength > existing.strength) {
      map.set(i.augmentSlug, i);
    }
  }
  const resolved: MechanicalInteraction[] = [];
  const allSlugs = new Set([...synBySlug.keys(), ...trapBySlug.keys()]);
  for (const slug of allSlugs) {
    const syn = synBySlug.get(slug);
    const trap = trapBySlug.get(slug);
    if (syn && trap) {
      // Conflict: same augment in both — keep the stronger one (synergy wins ties)
      resolved.push(syn.strength >= trap.strength ? syn : trap);
    } else {
      // Add all non-conflicting entries for this slug
      for (const i of deduped.filter((x) => x.augmentSlug === slug)) {
        resolved.push(i);
      }
    }
  }

  // Sort: synergies first (strong → weak), then traps (strong → weak)
  return resolved.sort((a, b) => {
    if (a.type !== b.type) return a.type === "synergy" ? -1 : 1;
    return b.strength - a.strength;
  });
}
