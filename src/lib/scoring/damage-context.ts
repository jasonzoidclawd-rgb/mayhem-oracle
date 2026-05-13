import type { AbilityProfile, ChampionBaseStats, ItemStats } from "../types";
import { combineStats, statsAtLevel } from "../data/championStats";
import { computeDamageCalculation } from "../data/damage-calculations";

const TARGET_ARMOR = 100;
const TARGET_MR = 50;
const DEFAULT_LEVEL = 11;

// Minimal ChampionStatsAtLevel used only as a target (only armor/mr are read by computeDamageCalculation)
const DUMMY_TARGET = { hp: 2000, ad: 0, armor: TARGET_ARMOR, mr: TARGET_MR, attackSpeed: 0.625, attackRange: 175, moveSpeed: 340, mp: 0 };

export interface ChampionDamageBaseline {
  dps: number;
  avgAutoPhys: number;
  attackSpeed: number;
  totalAD: number;
  damageType: "magic" | "physical" | "mixed";
}

export interface AugmentDamageContext {
  baselineDps: number;
  augmentedDps: number;
  dpsDeltaPct: number;
  parsedStats: Partial<ItemStats>;
  hasParsableStats: boolean;
  damageType: "magic" | "physical" | "mixed";
}

// Returns true if a matched stat is preceded by loss/reduction wording within 50 chars,
// indicating the stat is being taken away rather than granted.
function hasNegativeContext(description: string, matchIndex: number): boolean {
  const prefix = description.slice(Math.max(0, matchIndex - 50), matchIndex).toLowerCase();
  return /\b(?:reduc|los[st]|decreas|remov|drain)\b/.test(prefix);
}

// Returns true when the number at matchIndex is a spaced-out decimal fragment like "4. 5 %"
// (the wiki sometimes renders "4.5" as "4. 5" with a sentence-break space).
function isDecimalFragment(description: string, matchIndex: number): boolean {
  return matchIndex >= 2 && description[matchIndex - 1] === " " && description[matchIndex - 2] === ".";
}

// Returns true when the stat appears inside a champion-specific exception clause like
// "On Kalista, this augment instead grants her 125% bonus attack speed".
function isChampionSpecificClause(description: string, matchIndex: number): boolean {
  const prefix = description.slice(Math.max(0, matchIndex - 120), matchIndex);
  return /\bOn [A-Z][a-z]+[, ]/.test(prefix);
}

export function parseAugmentStatDelta(description: string): Partial<ItemStats> {
  const result: Partial<ItemStats> = {};

  const asMatch = description.match(/(\d+(?:\.\d+)?)\s*%[^.]*?attack\s*speed/i);
  if (asMatch && asMatch.index !== undefined
      && !hasNegativeContext(description, asMatch.index)
      && !isChampionSpecificClause(description, asMatch.index)) {
    result.attackSpeed = Number(asMatch[1]) / 100;
  }

  const critChanceMatch = description.match(/(\d+(?:\.\d+)?)\s*%[^.]*?crit(?:ical)?\s*(?:strike\s*)?chance/i);
  if (critChanceMatch && critChanceMatch.index !== undefined
      && !hasNegativeContext(description, critChanceMatch.index)
      && !isDecimalFragment(description, critChanceMatch.index)) {
    result.critChance = Math.min(1, Number(critChanceMatch[1]) / 100);
  }

  const critDmgMatch = description.match(/(\d+(?:\.\d+)?)\s*%[^.]*?crit(?:ical)?\s*(?:strike\s*)?damage/i);
  if (critDmgMatch && critDmgMatch.index !== undefined
      && !hasNegativeContext(description, critDmgMatch.index)
      && !/bonus\s+crit(?:ical)?(?:\s+strike)?\s+damage/i.test(critDmgMatch[0])) {
    result.critDamage = Number(critDmgMatch[1]) / 100;
  }

  // Match "+20 AD" or "20 Attack Damage" but not "AD scaling" patterns
  const adMatch = description.match(/\+?(\d+)\s*(?:bonus\s*)?(?:attack\s+damage\b|(?:^|(?<=\s|[+]))AD(?=\s|$|[.,)]|\b))/i);
  if (adMatch && adMatch.index !== undefined && !hasNegativeContext(description, adMatch.index)) {
    result.attackDamage = Number(adMatch[1]);
  }

  // AP is intentionally excluded: computeDamageCalculation models physical DPS only and
  // does not consume totalAP. Parsing AP would mark AP-only augments as hasParsableStats=true
  // while producing zero dpsDeltaPct — misleading callers about DPS impact.

  const lethMatch = description.match(/(\d+(?:\.\d+)?)\s*lethality/i);
  if (lethMatch && lethMatch.index !== undefined && !hasNegativeContext(description, lethMatch.index)) {
    result.lethality = Number(lethMatch[1]);
  }

  const armorPenMatch = description.match(/(\d+(?:\.\d+)?)\s*%[^.]*?armor\s*penetration/i);
  if (armorPenMatch && armorPenMatch.index !== undefined && !hasNegativeContext(description, armorPenMatch.index)) {
    result.armorPenPct = Math.min(1, Number(armorPenMatch[1]) / 100);
  }

  return result;
}

export function computeChampionBaseline(
  baseStats: ChampionBaseStats,
  abilityProfile: AbilityProfile,
  targetArmor = TARGET_ARMOR,
  targetMR = TARGET_MR,
  level = DEFAULT_LEVEL,
): ChampionDamageBaseline {
  const champAtLevel = statsAtLevel(baseStats, level);
  const combined = combineStats(champAtLevel, {});
  const target = targetArmor === TARGET_ARMOR && targetMR === TARGET_MR
    ? DUMMY_TARGET
    : { ...DUMMY_TARGET, armor: targetArmor, mr: targetMR };
  const result = computeDamageCalculation(combined, target);
  return {
    dps: result.dps,
    avgAutoPhys: result.avgAutoPhys,
    attackSpeed: combined.attackSpeed,
    totalAD: combined.totalAD,
    damageType: abilityProfile.damageType,
  };
}

export function computeAugmentDamageContext(
  augmentDescription: string,
  baseStats: ChampionBaseStats,
  abilityProfile: AbilityProfile,
): AugmentDamageContext {
  const baseline = computeChampionBaseline(baseStats, abilityProfile);
  const parsedStats = parseAugmentStatDelta(augmentDescription);
  const hasParsableStats = Object.keys(parsedStats).length > 0;

  if (!hasParsableStats) {
    return {
      baselineDps: baseline.dps,
      augmentedDps: baseline.dps,
      dpsDeltaPct: 0,
      parsedStats,
      hasParsableStats: false,
      damageType: abilityProfile.damageType,
    };
  }

  const champAtLevel = statsAtLevel(baseStats, DEFAULT_LEVEL);
  const augItemStats: ItemStats = {
    attackDamage: parsedStats.attackDamage ?? 0,
    attackSpeed: parsedStats.attackSpeed ?? 0,
    critChance: parsedStats.critChance ?? 0,
    critDamage: parsedStats.critDamage ?? 0,
    lethality: parsedStats.lethality ?? 0,
    armorPenPct: parsedStats.armorPenPct ?? 0,
  };
  const combined = combineStats(champAtLevel, augItemStats);
  const result = computeDamageCalculation(combined, DUMMY_TARGET);

  const dpsDeltaPct = baseline.dps > 0
    ? (result.dps - baseline.dps) / baseline.dps * 100
    : 0;

  return {
    baselineDps: baseline.dps,
    augmentedDps: result.dps,
    dpsDeltaPct,
    parsedStats,
    hasParsableStats: true,
    damageType: abilityProfile.damageType,
  };
}
