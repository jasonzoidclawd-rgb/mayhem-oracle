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
  test("applies combo, tier, system-breaker, and profile bonuses (no set dimension)", () => {
    const result = computeOracleScore({
      augment: baseAugment,
      championWinRate: 56,
      comboTier: "S",
      isSystemBreaker: true,
      abilityProfile: rangedPhysicalProfile,
    });

    expect(result.breakdown.comboBonus).toBe(SCORE_WEIGHTS.STRONG_COMBO_BONUS);
    // 26.12: "set tier" meant selection-screen tier — renamed to tierBonus.
    expect(result.breakdown.tierBonus).toBe(10);
    expect(result.breakdown).not.toHaveProperty("setTierBonus");
    // 26.12 removed augment sets — the dimension is deleted, not zeroed.
    expect(result.breakdown).not.toHaveProperty("sameSetSynergy");
    expect(result.breakdown.systemBreakerBonus).toBe(SCORE_WEIGHTS.SYSTEM_BREAKER_BONUS);
    expect(result.breakdown.abilityTypeSynergy).toBe(SCORE_WEIGHTS.ABILITY_TYPE_SYNERGY);
    expect(result.breakdown.attackTypeSynergy).toBe(SCORE_WEIGHTS.ATTACK_TYPE_SYNERGY);
    expect(result.breakdown.ccSynergy).toBe(SCORE_WEIGHTS.CC_SYNERGY);
    expect(result.breakdown.tagMismatch).toBe(0);
    // 54.2 base + 0.6 champion adj + 10 tier + 1 rarity + 12 combo + 20 breaker + 6 + 4 + 4
    expect(result.total).toBeCloseTo(111.8, 5);
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

  test("applies one bounded structured mechanical interaction signal", () => {
    const synergy = computeOracleScore({
      augment: baseAugment,
      mechanicalInteraction: { type: "synergy", strength: 3 },
    });
    const trap = computeOracleScore({
      augment: baseAugment,
      mechanicalInteraction: { type: "trap", strength: 2 },
    });

    expect(synergy.breakdown.mechanicalInteraction).toBe(
      SCORE_WEIGHTS.MECHANICAL_INTERACTION_PER_STRENGTH * 3,
    );
    expect(trap.breakdown.mechanicalInteraction).toBe(
      -SCORE_WEIGHTS.MECHANICAL_INTERACTION_PER_STRENGTH * 2,
    );
  });
});

describe("26.12 preview win-rate neutrality", () => {
  test("added augment with no telemetry scores from a neutral 50 base", () => {
    const added = computeOracleScore({
      augment: { ...baseAugment, win_rate: 0, flags: { system_breaker: false, lifecycle: "added" } },
    });
    expect(added.breakdown.championWr).toBe(50);

    const addedNull = computeOracleScore({
      augment: { ...baseAugment, win_rate: null, flags: { system_breaker: false, lifecycle: "added" } },
    });
    expect(addedNull.breakdown.championWr).toBe(50);
  });

  test("an active augment with a real 0.0 win rate is unchanged", () => {
    const activeZero = computeOracleScore({
      augment: { ...baseAugment, win_rate: 0, flags: { system_breaker: false, lifecycle: "active" } },
    });
    expect(activeZero.breakdown.championWr).toBe(0);
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
