import type { ChampionBaseStats, ItemStats } from "../types";

/**
 * League of Legends stat-per-level growth formula (wiki-verified):
 *   stat(level) = base + growth × (level − 1) × (0.7025 + 0.0175 × (level − 1))
 *
 * This produces a non-linear curve where each level grants slightly more than the last.
 * At level 18 the multiplier is ~17 × growth (not 17 × growth as flat would give).
 */
function growthFactor(level: number): number {
  return (level - 1) * (0.7025 + 0.0175 * (level - 1));
}

export interface ChampionStatsAtLevel {
  hp: number;
  ad: number;
  armor: number;
  mr: number;
  /** Attacks per second */
  attackSpeed: number;
  attackRange: number;
  moveSpeed: number;
  mp: number;
}

/**
 * Compute a champion's stats at a given level (no items).
 *
 * Attack speed uses a different formula:
 *   AS(level) = baseAS × (1 + asGrowth% × growthFactor)
 */
export function statsAtLevel(
  base: ChampionBaseStats,
  level: number
): ChampionStatsAtLevel {
  const safeLevel = Number.isFinite(level) ? level : 1;
  const clampedLevel = Math.min(18, Math.max(1, Math.round(safeLevel)));
  const g = growthFactor(clampedLevel);
  return {
    hp: base.baseHP + base.hpGrowth * g,
    ad: base.baseAD + base.adGrowth * g,
    armor: base.baseArmor + base.armorGrowth * g,
    mr: base.baseMR + base.mrGrowth * g,
    attackSpeed: base.baseAS * (1 + (base.asGrowth / 100) * g),
    attackRange: base.attackRange,
    moveSpeed: base.moveSpeed,
    mp: base.baseMP + base.mpGrowth * g,
  };
}

/**
 * Merge champion base stats at level with item stats to get combined totals.
 * Returns the fields needed for damage calculations.
 */
export interface CombinedStats {
  totalAD: number;
  totalAP: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  lethality: number;
  armorPenPct: number;
  magicPenFlat: number;
  magicPenPct: number;
  lifeSteal: number;
  omnivamp: number;
}

export function combineStats(
  champStats: ChampionStatsAtLevel,
  itemStats: ItemStats
): CombinedStats {
  return {
    totalAD: champStats.ad + (itemStats.attackDamage ?? 0),
    totalAP: itemStats.abilityPower ?? 0,
    attackSpeed: champStats.attackSpeed * (1 + (itemStats.attackSpeed ?? 0)),
    critChance: Math.min(1, itemStats.critChance ?? 0),
    critDamage: itemStats.critDamage ?? 0,
    lethality: itemStats.lethality ?? 0,
    armorPenPct: itemStats.armorPenPct ?? 0,
    magicPenFlat: itemStats.magicPenFlat ?? 0,
    magicPenPct: itemStats.magicPenPct ?? 0,
    lifeSteal: itemStats.lifeSteal ?? 0,
    omnivamp: itemStats.omnivamp ?? 0,
  };
}

/**
 * Stack multiple items' stats together (additive for flat, multiplicative for % pen).
 */
export function stackItemStats(statsList: ItemStats[]): ItemStats {
  const combined: ItemStats = {};
  for (const s of statsList) {
    combined.attackDamage = (combined.attackDamage ?? 0) + (s.attackDamage ?? 0);
    combined.abilityPower = (combined.abilityPower ?? 0) + (s.abilityPower ?? 0);
    combined.lethality = (combined.lethality ?? 0) + (s.lethality ?? 0);
    combined.critChance = (combined.critChance ?? 0) + (s.critChance ?? 0);
    combined.critDamage = (combined.critDamage ?? 0) + (s.critDamage ?? 0);
    combined.attackSpeed = (combined.attackSpeed ?? 0) + (s.attackSpeed ?? 0);
    combined.lifeSteal = (combined.lifeSteal ?? 0) + (s.lifeSteal ?? 0);
    combined.omnivamp = (combined.omnivamp ?? 0) + (s.omnivamp ?? 0);
    combined.abilityHaste = (combined.abilityHaste ?? 0) + (s.abilityHaste ?? 0);
    combined.health = (combined.health ?? 0) + (s.health ?? 0);
    combined.armor = (combined.armor ?? 0) + (s.armor ?? 0);
    combined.magicResist = (combined.magicResist ?? 0) + (s.magicResist ?? 0);
    combined.mana = (combined.mana ?? 0) + (s.mana ?? 0);
    combined.magicPenFlat = (combined.magicPenFlat ?? 0) + (s.magicPenFlat ?? 0);
    // % pen stacks multiplicatively: 1 - (1-a)(1-b)
    combined.armorPenPct = 1 - (1 - (combined.armorPenPct ?? 0)) * (1 - (s.armorPenPct ?? 0));
    combined.magicPenPct = 1 - (1 - (combined.magicPenPct ?? 0)) * (1 - (s.magicPenPct ?? 0));
  }
  return combined;
}
