/**
 * Smart Tailoring — ARAM Mayhem augment pool filtering
 *
 * In Mayhem, each champion sees a tailored augment pool filtered by
 * their characteristics: attack type, resource, damage type, and kit mechanics.
 *
 * Official pool data is not published. These rules are derived from
 * augment descriptions, ability stats, and verified game mechanics (GAME_MECHANICS.md §4).
 */

import type { AbilityProfile, AbilityStats } from "./types";
import type { ChampionBaseStats } from "./types";

// ── Champion resource type ──────────────────────────────────────────

export type ResourceType = "mana" | "energy" | "none";

/** Manaless champions (health-cost or resourceless). */
const MANALESS = new Set([
  "aatrox",
  "ambessa",
  "briar",
  "drmundo",
  "garen",
  "gnar",
  "katarina",
  "kled",
  "mordekaiser",
  "nilah",
  "reksai",
  "renekton",
  "rengar",
  "riven",
  "rumble",
  "sett",
  "shyvana",
  "tryndamere",
  "viego",
  "yasuo",
  "yone",
]);

/** Energy champions. */
const ENERGY = new Set(["akali", "kennen", "leesin", "shen", "zed"]);

export function getChampionResource(slug: string): ResourceType {
  if (MANALESS.has(slug)) return "none";
  if (ENERGY.has(slug)) return "energy";
  return "mana";
}

// ── Kit analysis for pool filtering ─────────────────────────────────

export interface ChampionPoolProfile {
  attackType: "melee" | "ranged";
  resource: ResourceType;
  /** Has at least one hard CC ability (stun, root, knockup, charm, suppress, fear, taunt) */
  hasHardCC: boolean;
  /** Has a dash/blink in kit */
  hasDash: boolean;
  /** Has spinning ability (Garen E, Wukong R, etc.) */
  hasSpinning: boolean;
  /** Primary damage type from ability stats */
  damageType: "magic" | "physical" | "mixed";
  /** Has on-hit abilities in kit */
  hasOnHit: boolean;
  /** Has heals or shields in kit description */
  hasHealShield: boolean;
  /** Total AP ratio across abilities */
  totalApRatio: number;
  /** Total AD ratio across abilities */
  totalAdRatio: number;
  /** Has crit scaling or synergy in kit */
  hasCritSynergy: boolean;
}

const HARD_CC_TYPES = new Set([
  "stun", "root", "knockup", "charm", "suppress", "fear", "taunt", "immobilize",
]);

const DASH_RE = /\bdash(?:es)?\b|\bblink\b|\bleap\b|\blunge\b|\bvault\b|\btumble\b|\broll\b|\brush\b/i;
const SPIN_RE = /spin(?:s|ning)?|whirl|rotat/i;
const HEAL_SHIELD_RE = /heal(?:s|ing)?|restore[sd]?\s+health|shield|barrier|protect(?:s|ing)?/i;
const CRIT_KIT_RE = /critical\s+strike|double\s+(?:the\s+)?critical|crit(?:ical)?\s+(?:damage|chance)/i;

export function buildPoolProfile(
  slug: string,
  abilityProfile?: AbilityProfile,
  baseStats?: ChampionBaseStats,
): ChampionPoolProfile {
  const resource = getChampionResource(slug);
  const attackType = abilityProfile?.attackType ?? "melee";
  const damageType = abilityProfile?.damageType ?? "mixed";

  let hasHardCC = false;
  let hasDash = false;
  let hasSpinning = false;
  let hasOnHit = false;
  let hasHealShield = false;
  let totalApRatio = 0;
  let totalAdRatio = 0;
  let hasCritSynergy = false;

  if (abilityProfile) {
    const allDesc = abilityProfile.abilities.map((a) => a.description).join(" ");

    for (const ab of abilityProfile.abilities) {
      const s = ab.stats;
      if (s?.ccType && HARD_CC_TYPES.has(s.ccType)) hasHardCC = true;
      if (s?.isOnHit) hasOnHit = true;
      if (s?.apRatio) totalApRatio += s.apRatio;
      if (s?.adRatio) totalAdRatio += s.adRatio;
      if (s?.totalAdRatio) totalAdRatio += s.totalAdRatio;
    }

    hasDash = DASH_RE.test(allDesc);
    hasSpinning = SPIN_RE.test(allDesc);
    hasHealShield = HEAL_SHIELD_RE.test(allDesc);
    hasCritSynergy = CRIT_KIT_RE.test(allDesc);
  }

  return {
    attackType,
    resource,
    hasHardCC,
    hasDash,
    hasSpinning,
    damageType,
    hasOnHit,
    hasHealShield,
    totalApRatio,
    totalAdRatio,
    hasCritSynergy,
  };
}

// ── Hard pool exclusions ────────────────────────────────────────────
// Augments that should NEVER be offered to incompatible champions.

/** Augments that only appear for ranged champions. */
const RANGED_ONLY = new Set([
  "draw-your-sword",      // "Become melee" — only for ranged
  "scopiest-weapons",     // +250 attack range — meaningless for melee
  "scopier-weapons",      // +200 attack range
  "scoped-weapons",       // +75 attack range
]);

/** Augments whose core mechanic requires mana as a resource. */
const MANA_REQUIRED = new Set([
  "juiced",               // consumes % max mana per attack
  "mind-to-matter",       // bonus HP = 50% max mana
  "overflow",             // doubles mana costs for bonus damage
  "ominous-pact",         // abilities cost health + scale with mana
]);

/** Augments that require hard CC (immobilize/ground) to function. */
const CC_REQUIRED = new Set([
  "cruelty",              // immobilizing summons comet
  "courage-of-the-colossus", // immobilizing grants shield
  "soul-eater",           // immobilizing grants bonus health stacks
  "slap-around",          // immobilizing grants AD/AP stacks
  "guilty-pleasure",      // immobilizing heals you
  "adamant",              // immobilizing grants armor/MR
  "tormentor",            // immobilizing inflicts burn
]);

/** Augments that require dash/blink in kit to function. */
const DASH_REQUIRED = new Set([
  "shadow-runner",        // after dashing/blinking gain movement speed
  "swift-and-safe",       // after dashing/blinking gain shield
  "outlaws-grit",         // dashing/blinking grants armor/MR stacks
  "dashing",              // abilities with dashes gain 175 AH
]);

/** Augments that require spinning abilities. */
const SPIN_REQUIRED = new Set([
  "spin-to-win",          // spinning abilities deal 30% more + reduced CD
]);

/** Augments that require heal/shield in kit to be useful. */
const HEAL_SHIELD_REQUIRED = new Set([
  "windspeakers-blessing", // heals/shields grant target armor/MR
  "empowered-by-the-faithful", // heal/shield on ally blesses them
  "all-for-you",          // heals/shields on allies +30%
  "sonic-boom",           // granting buff/heal/shield deals damage
  "crack-open-that-egg",  // shields detonate on expiry
]);

/**
 * Augments focused on basic attacks / on-hit / attack speed.
 * Excluded from pure mages (high AP ratio, magic damage, no on-hit).
 */
const AUTO_ATTACK_FOCUSED = new Set([
  "dual-wield",           // basic attacks launch bolt
  "tap-dancer",           // basic attacks on-hit grant MS
  "mystic-punch",         // basic attacks on-hit reduce cooldowns
  "gash",                 // basic attacks on-hit deal true damage
  "master-of-duality",    // basic attacks on-hit grant AP
  "twice-thrice",         // basic attacks generate stacks for on-hit
  "firebrand",            // basic attacks apply burn
  "shrink-ray",           // basic attacks on-hit reduce target damage
  "heavy-hitter",         // basic attacks deal bonus % max HP damage
  "typhoon",              // basic attacks launch firecracker
  "light-em-up",          // basic attacks generate stacks, 4th launches firecrackers
  "fan-the-hammer",       // next basic attack fires firecrackers
  "slow-and-steady",      // base AS set to static, attack rate capped
  "deft",                 // grants 60% bonus attack speed
  "lightning-strikes",    // bonus attack speed + at 1.75 AS bonus damage
  "soul-siphon",          // basic attacks that crit heal you
  "double-tap",           // basic attacks that crit apply on-hit again
  "critical-rhythm",      // crits grant attack speed stacks
  "cerberus",             // hail of blades + press the attack
  "symphony-of-war",      // conqueror + lethal tempo + attack range
]);

/**
 * Augments focused purely on ability power / casting.
 * Excluded from pure AD auto-attackers (no AP ratios).
 */
const ABILITY_CASTER_FOCUSED = new Set([
  "quest-wooglets-witchcap", // quest: obtain Rabadon's + Zhonya's
  "hat-on-a-hat",           // AP per headwear item
  "witchful-thinking",      // grants flat AP
  "big-brain",              // shield equal to 300% AP
  "adapt",                  // converts bonus AD into AP
  "eureka",                 // ability haste equal to 30% AP
]);

// ── Pool filter ─────────────────────────────────────────────────────

export interface AugmentPoolInput {
  slug: string;
  description: string;
}

/**
 * Returns true if the augment belongs in this champion's Smart Tailoring pool.
 *
 * Hard exclusions — augments that functionally cannot work or provide
 * near-zero value for the champion's kit.
 */
export function isInAugmentPool(
  augment: AugmentPoolInput,
  champion: ChampionPoolProfile,
): boolean {
  const { slug, description } = augment;
  const desc = description.toLowerCase();

  // ── Attack type exclusion ──
  if (RANGED_ONLY.has(slug) && champion.attackType === "melee") return false;
  if (/\bbecome melee\b/.test(desc) && champion.attackType === "melee") return false;
  if (/\bbecome ranged\b/.test(desc) && champion.attackType === "ranged") return false;

  // ── Mana exclusion ──
  if (champion.resource !== "mana") {
    if (MANA_REQUIRED.has(slug)) return false;
    // Heuristic: augments that consume or scale with mana as a core mechanic
    if (
      /consume[sd]?\s+\d[\d.]*%\s+(?:of\s+)?(?:your\s+)?(?:maximum\s+|current\s+)?mana\b/.test(desc)
    ) return false;
    if (
      /(?:equal to|based on)\s+\d[\d.]*%\s+(?:of\s+)?(?:your\s+)?(?:maximum\s+|bonus\s+)?mana\b/.test(desc)
    ) return false;
    if (/\bmana costs?\s+(?:are\s+)?(?:doubled|tripled|increased\s+by)\b/.test(desc))
      return false;
  }

  // ── CC exclusion ──
  // Augments that require immobilize/ground to trigger — useless without hard CC
  if (CC_REQUIRED.has(slug) && !champion.hasHardCC) return false;

  // ── Dash exclusion ──
  // Augments that trigger on dash/blink — useless without a dash
  if (DASH_REQUIRED.has(slug) && !champion.hasDash) return false;

  // ── Spin exclusion ──
  if (SPIN_REQUIRED.has(slug) && !champion.hasSpinning) return false;

  // ── Heal/Shield exclusion ──
  // Augments that enhance heals/shields — useless without any in kit
  if (HEAL_SHIELD_REQUIRED.has(slug) && !champion.hasHealShield) return false;

  // ── Auto-attack augments on pure mages ──
  // If champion is a pure caster (magic damage, high AP, no on-hit, no AD),
  // exclude basic-attack-focused augments
  if (AUTO_ATTACK_FOCUSED.has(slug)) {
    const isPureCaster = champion.damageType === "magic"
      && champion.totalApRatio >= 1.5
      && champion.totalAdRatio < 0.3
      && !champion.hasOnHit;
    if (isPureCaster) return false;
  }

  // ── AP caster augments on pure AD champs ──
  // If champion is pure AD (physical damage, high AD ratio, near-zero AP),
  // exclude AP-focused augments
  if (ABILITY_CASTER_FOCUSED.has(slug)) {
    const isPureAD = champion.damageType === "physical"
      && champion.totalAdRatio >= 1.0
      && champion.totalApRatio < 0.3;
    if (isPureAD) return false;
  }

  // ── escAPADe (convert AP → AD) only useful if you have AP ──
  if (slug === "escapade" && champion.totalApRatio < 0.3 && champion.damageType === "physical") return false;

  // ── ADAPt (convert AD → AP) only useful if you have AD ──
  if (slug === "adapt" && champion.totalAdRatio < 0.3 && champion.damageType === "magic") return false;

  return true;
}
