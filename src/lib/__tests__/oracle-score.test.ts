import { describe, expect, test } from "vitest";
import { baselineOracleScore, computeOracleScore, type ScoredAugment } from "../scoring/oracle-score";
import { SCORE_WEIGHTS, type AbilityProfile } from "../types";

const baseAugment: ScoredAugment = {
  slug: "test-augment",
  name: "Test Augment",
  rarity: "gold",
  win_rate: 54.2,
  icon: "test.png",
  wikiDescription: "Gain attack damage. Ranged champions apply crowd control effects more often.",
};

const rangedPhysicalProfile: AbilityProfile = {
  damageType: "physical",
  attackType: "ranged",
  playstyle: {
    damage: 4,
    durability: 2,
    crowdControl: 4,
    mobility: 2,
    utility: 2,
  },
  abilities: [],
};

const meleeMagicProfile: AbilityProfile = {
  damageType: "magic",
  attackType: "melee",
  playstyle: {
    damage: 4,
    durability: 3,
    crowdControl: 2,
    mobility: 2,
    utility: 2,
  },
  abilities: [],
};

describe("computeOracleScore", () => {
  test("applies combo, set, system-breaker, and profile bonuses", () => {
    const result = computeOracleScore({
      augment: baseAugment,
      championWinRate: 56,
      comboTier: "S",
      pickedSetIds: ["alpha"],
      augmentSetId: "alpha",
      isSystemBreaker: true,
      abilityProfile: rangedPhysicalProfile,
    });

    expect(result.breakdown.comboBonus).toBe(SCORE_WEIGHTS.STRONG_COMBO_BONUS);
    expect(result.breakdown.sameSetSynergy).toBe(SCORE_WEIGHTS.SAME_SET_SYNERGY);
    expect(result.breakdown.systemBreakerBonus).toBe(SCORE_WEIGHTS.SYSTEM_BREAKER_BONUS);
    expect(result.breakdown.abilityTypeSynergy).toBe(SCORE_WEIGHTS.ABILITY_TYPE_SYNERGY);
    expect(result.breakdown.attackTypeSynergy).toBe(SCORE_WEIGHTS.ATTACK_TYPE_SYNERGY);
    expect(result.breakdown.ccSynergy).toBe(SCORE_WEIGHTS.CC_SYNERGY);
    expect(result.breakdown.tagMismatch).toBe(0);
  });

  test("applies trap and mismatch penalties for a bad champion fit", () => {
    const result = computeOracleScore({
      augment: {
        ...baseAugment,
        wikiDescription: "Ranged champions gain attack damage and attack speed.",
      },
      comboTier: "C",
      abilityProfile: meleeMagicProfile,
    });

    expect(result.breakdown.trapPenalty).toBe(SCORE_WEIGHTS.TRAP_PENALTY);
    expect(result.breakdown.tagMismatch).toBe(SCORE_WEIGHTS.TAG_MISMATCH_PENALTY);
    expect(result.breakdown.abilityTypeSynergy).toBe(0);
    expect(result.breakdown.attackTypeSynergy).toBe(0);
  });
});

describe("baselineOracleScore", () => {
  test("rounds to one decimal place", () => {
    const score = baselineOracleScore({
      ...baseAugment,
      rarity: "silver",
      win_rate: 53.27,
    });

    expect(score).toBeCloseTo(59.6, 5);
  });
});
