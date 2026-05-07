import type { ItemStats, DamageProfile, MagicDamageProfile } from "../types";

// Matches: optional sign, number (with optional decimal), optional "%", whitespace, stat name
const STAT_RE = /^([+-]?\d+(?:\.\d+)?)(%)?\s+(.+)$/i;

/**
 * Parse a list of stat-line strings (from wikiStats or parseDescription statLines)
 * into a structured ItemStats object with typed numeric values.
 *
 * Percent values are stored on a 0–1 scale (e.g. 25% critChance → 0.25).
 * Flat values are stored as-is.
 */
export function parseItemStats(statLines: string[]): ItemStats {
  const stats: ItemStats = {};

  for (const line of statLines) {
    const m = line.trim().match(STAT_RE);
    if (!m) continue;

    const value = parseFloat(m[1]);
    const isPercent = !!m[2];
    const name = m[3].trim().toLowerCase();

    if (name === "attack damage") {
      stats.attackDamage = (stats.attackDamage ?? 0) + value;
    } else if (name === "ability power") {
      stats.abilityPower = (stats.abilityPower ?? 0) + value;
    } else if (name === "lethality") {
      stats.lethality = (stats.lethality ?? 0) + value;
    } else if (name === "armor penetration" && isPercent) {
      stats.armorPenPct = (stats.armorPenPct ?? 0) + value / 100;
    } else if (name === "magic penetration") {
      if (isPercent) stats.magicPenPct = (stats.magicPenPct ?? 0) + value / 100;
      else stats.magicPenFlat = (stats.magicPenFlat ?? 0) + value;
    } else if (name === "critical strike chance") {
      stats.critChance = (stats.critChance ?? 0) + value / 100;
    } else if (name === "critical strike damage" || name === "critical strike") {
      // "Critical Strike" (% only) = bonus crit damage from IE-style passives
      // Flat "Critical Strike" is a scraper artifact — skip it
      if (isPercent) stats.critDamage = (stats.critDamage ?? 0) + value / 100;
    } else if (name === "attack speed") {
      stats.attackSpeed = (stats.attackSpeed ?? 0) + value / 100;
    } else if (name === "life steal") {
      if (isPercent) stats.lifeSteal = (stats.lifeSteal ?? 0) + value / 100;
      // flat life steal is an artifact — skip
    } else if (name === "omnivamp") {
      stats.omnivamp = (stats.omnivamp ?? 0) + value / 100;
    } else if (name === "ability haste") {
      stats.abilityHaste = (stats.abilityHaste ?? 0) + value;
    } else if (name === "movement speed" || name === "move speed") {
      if (isPercent) stats.moveSpeedPct = (stats.moveSpeedPct ?? 0) + value / 100;
      else stats.moveSpeedFlat = (stats.moveSpeedFlat ?? 0) + value;
    } else if (name === "tenacity") {
      if (isPercent) stats.tenacity = (stats.tenacity ?? 0) + value / 100;
    } else if (name === "health") {
      stats.health = (stats.health ?? 0) + value;
    } else if (name === "armor") {
      if (!isPercent) stats.armor = (stats.armor ?? 0) + value;
    } else if (name === "magic resistance" || name === "magic resist") {
      if (!isPercent) stats.magicResist = (stats.magicResist ?? 0) + value;
    } else if (name === "mana") {
      stats.mana = (stats.mana ?? 0) + value;
    } else if (
      name === "health regeneration" ||
      name === "base health regen" ||
      name === "health regen"
    ) {
      stats.healthRegen = (stats.healthRegen ?? 0) + value;
    } else if (
      name === "mana regeneration" ||
      name === "base mana regen" ||
      name === "mana regen"
    ) {
      stats.manaRegen = (stats.manaRegen ?? 0) + value;
    }
  }

  return stats;
}

/**
 * Compute a physical damage profile for attack-damage items.
 *
 * Uses the standard League armor-mitigation formula:
 *   damage multiplier = 100 / (100 + effectiveArmor)
 *
 * Armor pen order (wiki-verified):
 *   1. Flat armor REDUCTION (abilities — not modelled here, assumed 0)
 *   2. % armor REDUCTION (e.g. Black Cleaver stacks — not modelled, assumed 0)
 *   3. % armor PENETRATION (armorPenPct — multiplicative, e.g. Lord Dominik's)
 *   4. Flat armor PENETRATION = lethality (1:1 since v14.1, applied LAST, min 0)
 *
 * Crit total multiplier: 2.0 base (v26.01+) + critDamage bonus addend (additive between items)
 *
 * @param stats     Parsed ItemStats for the item(s)
 * @param targetArmor  Armor of the target (default 100 — mid-game champion baseline)
 */
export function computeDamageProfile(
  stats: ItemStats,
  targetArmor = 100
): DamageProfile {
  const ad = stats.attackDamage ?? 0;
  const safeTargetArmor = Math.max(0, targetArmor);
  const armorPenPct = Math.min(1, Math.max(0, stats.armorPenPct ?? 0));
  const critChance = Math.min(1, Math.max(0, stats.critChance ?? 0));

  // Armor pen applied in wiki-correct order:
  //   Step 3: % armor penetration (multiplicative)
  //   Step 4: lethality = flat armor penetration (applied last, floor at 0)
  const armorAfterPctPen = safeTargetArmor * (1 - armorPenPct);
  const effectiveArmor = Math.max(0, armorAfterPctPen - (stats.lethality ?? 0));

  const armorMultiplier = 100 / (100 + effectiveArmor);
  const effectiveAD = ad * armorMultiplier;

  // League base crit multiplier is 2.0 (200% AD total on crit) since v26.01.
  // critDamage is the bonus addend from items like IE (e.g. +0.40 → 2.40 total).
  const critTotalMultiplier = 2.0 + (stats.critDamage ?? 0);

  const critAutoHit = effectiveAD * critTotalMultiplier;
  // Expected damage multiplier per auto-attack (probability-weighted)
  const critExpectedMultiplier = 1 + critChance * (critTotalMultiplier - 1);

  return {
    effectiveAD,
    critAutoHit,
    critExpectedMultiplier,
    targetArmor: safeTargetArmor,
  };
}

/**
 * Compute a magic damage profile for ability-power items.
 *
 * Magic pen order (wiki-verified, mirrors armor pen):
 *   1. Flat MR REDUCTION (abilities — not modelled here, assumed 0)
 *   2. % MR REDUCTION (not modelled, assumed 0)
 *   3. % magic PENETRATION (magicPenPct — multiplicative)
 *   4. Flat magic PENETRATION (magicPenFlat — applied LAST, min 0)
 *
 * @param stats    Parsed ItemStats
 * @param targetMR Magic resistance of the target (default 50 — mid-game baseline)
 */
export function computeMagicDamageProfile(
  stats: ItemStats,
  targetMR = 50
): MagicDamageProfile {
  const ap = stats.abilityPower ?? 0;
  const safeTargetMR = Math.max(0, targetMR);
  const magicPenPct = Math.min(1, Math.max(0, stats.magicPenPct ?? 0));
  const mrAfterPctPen = safeTargetMR * (1 - magicPenPct);
  const effectiveMR = Math.max(0, mrAfterPctPen - (stats.magicPenFlat ?? 0));
  const magicMultiplier = 100 / (100 + effectiveMR);
  return { ap, magicMultiplier, effectiveMR, targetMR: safeTargetMR };
}
