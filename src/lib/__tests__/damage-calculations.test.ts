import { describe, expect, test } from "vitest";
import { computeDamageCalculation } from "../data/damage-calculations";
import type { CombinedStats, ChampionStatsAtLevel } from "../data/championStats";

const attackerStats: CombinedStats = {
  totalAD: 200,
  totalAP: 0,
  attackSpeed: 1.5,
  critChance: 0.25,
  critDamage: 0.5,
  lethality: 18,
  armorPenPct: 0.2,
  magicPenFlat: 12,
  magicPenPct: 0.1,
  lifeSteal: 0,
  omnivamp: 0,
};

const targetStats: ChampionStatsAtLevel = {
  hp: 2000,
  ad: 100,
  armor: 80,
  mr: 50,
  attackSpeed: 1,
  attackRange: 550,
  moveSpeed: 325,
  mp: 1000,
};

describe("computeDamageCalculation", () => {
  test("does not apply attacker defensive items to the target by default", () => {
    const result = computeDamageCalculation(attackerStats, targetStats);

    expect(result.targetArmor).toBe(80);
    expect(result.targetMR).toBe(50);
  });

  test("only applies explicit target defensive bonuses", () => {
    const result = computeDamageCalculation(attackerStats, targetStats, {
      armor: 40,
      magicResist: 25,
    });

    expect(result.targetArmor).toBe(120);
    expect(result.targetMR).toBe(75);
  });
});
