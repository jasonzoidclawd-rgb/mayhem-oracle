import type { ItemStats } from "../types";
import type { CombinedStats, ChampionStatsAtLevel } from "./championStats";

const BASE_CRIT_MULT = 2.0;

export interface DamageCalculationResult {
  targetArmor: number;
  targetMR: number;
  effectiveArmor: number;
  armorMult: number;
  autoPhys: number;
  critMult: number;
  critAutoPhys: number;
  avgAutoPhys: number;
  dps: number;
  effectiveMR: number;
  mrMult: number;
}

export function computeDamageCalculation(
  combined: CombinedStats,
  targetBaseStats: ChampionStatsAtLevel,
  targetBonusStats: Pick<ItemStats, "armor" | "magicResist"> = {},
): DamageCalculationResult {
  const targetArmor = targetBaseStats.armor + (targetBonusStats.armor ?? 0);
  const targetMR = targetBaseStats.mr + (targetBonusStats.magicResist ?? 0);

  const armorAfterPctPen = targetArmor * (1 - combined.armorPenPct);
  const effectiveArmor = Math.max(0, armorAfterPctPen - combined.lethality);
  const armorMult = 100 / (100 + effectiveArmor);

  const autoPhys = combined.totalAD * armorMult;
  const critMult = BASE_CRIT_MULT + combined.critDamage;
  const critAutoPhys = autoPhys * critMult;
  const avgAutoPhys = autoPhys * (1 + combined.critChance * (critMult - 1));
  const dps = avgAutoPhys * combined.attackSpeed;

  const mrAfterPctPen = targetMR * (1 - combined.magicPenPct);
  const effectiveMR = Math.max(0, mrAfterPctPen - combined.magicPenFlat);
  const mrMult = 100 / (100 + effectiveMR);

  return {
    targetArmor,
    targetMR,
    effectiveArmor,
    armorMult,
    autoPhys,
    critMult,
    critAutoPhys,
    avgAutoPhys,
    dps,
    effectiveMR,
    mrMult,
  };
}
