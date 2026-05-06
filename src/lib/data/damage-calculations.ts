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
  const targetArmor = Math.max(0, targetBaseStats.armor + (targetBonusStats.armor ?? 0));
  const targetMR = Math.max(0, targetBaseStats.mr + (targetBonusStats.magicResist ?? 0));

  const armorPenPct = Math.min(1, Math.max(0, combined.armorPenPct));
  const lethality = Math.max(0, combined.lethality);
  const totalAD = Math.max(0, Number.isFinite(combined.totalAD) ? combined.totalAD : 0);
  const attackSpeed = Math.max(0, Number.isFinite(combined.attackSpeed) ? combined.attackSpeed : 0);
  const critChance = Math.min(1, Math.max(0, combined.critChance));
  const critDamage = Math.max(0, combined.critDamage);
  const magicPenPct = Math.min(1, Math.max(0, combined.magicPenPct));
  const magicPenFlat = Math.max(0, combined.magicPenFlat);

  const armorAfterPctPen = targetArmor * (1 - armorPenPct);
  const effectiveArmor = Math.max(0, armorAfterPctPen - lethality);
  const armorMult = 100 / (100 + effectiveArmor);

  const autoPhys = totalAD * armorMult;
  const critMult = BASE_CRIT_MULT + critDamage;
  const critAutoPhys = autoPhys * critMult;
  const avgAutoPhys = autoPhys * (1 + critChance * (critMult - 1));
  const dps = avgAutoPhys * attackSpeed;

  const mrAfterPctPen = targetMR * (1 - magicPenPct);
  const effectiveMR = Math.max(0, mrAfterPctPen - magicPenFlat);
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
