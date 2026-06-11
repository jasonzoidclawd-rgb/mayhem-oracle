import { describe, expect, test } from "vitest";
import { abilityAugmentFit } from "../scoring/ability-augment-fit";
import { computeOracleScore } from "../scoring/oracle-score";
import { SCORE_WEIGHTS, type AbilityProfile } from "../types";

function profileWith(
  abilities: Array<{
    key: "Q" | "W" | "E" | "R" | "passive";
    stats?: Record<string, unknown>;
  }>,
): AbilityProfile {
  return {
    damageType: "physical",
    attackType: "melee",
    playstyle: { damage: 3, durability: 3, crowdControl: 3, mobility: 2, utility: 2 },
    abilities: abilities.map((a) => ({
      key: a.key,
      name: a.key,
      icon: "",
      description: "",
      stats: a.stats as never,
    })),
  };
}

const alistarProfile = profileWith([
  { key: "Q", stats: { knockup: true, baseDamage: [60] } },
  { key: "W", stats: { knockback: true, knockup: true, baseDamage: [55] } },
  { key: "E", stats: { heal: true } },
  { key: "R", stats: {} },
]);

const garenProfile = profileWith([
  { key: "Q", stats: { baseDamage: [30] } },
  { key: "W", stats: { shield: true } },
  { key: "E", stats: { baseDamage: [4] } },
  { key: "R", stats: { baseDamage: [150] } },
]);

const chainReaction = {
  slug: "chain-reaction",
  type: "ability",
  wikiDescription:
    "If a target Knocked Back by your chosen ability hits another champion, they are Knocked Up and dealt damage.",
};
const spellSplit = {
  slug: "spell-split",
  type: "ability",
  wikiDescription:
    "Your chosen ability missile splits into two on hit, at max Range, or when Recast.",
};
const goliath = {
  slug: "goliath",
  type: "standalone",
  wikiDescription: "Grants 35% bonus health, 15% adaptive force, and 50% increased size.",
};

describe("abilityAugmentFit", () => {
  test("Chain Reaction scores high fit for a knockup kit", () => {
    expect(abilityAugmentFit(chainReaction, alistarProfile)?.strength).toBeGreaterThanOrEqual(2);
  });

  test("Spell Split is a trap-fit for a projectile-less melee kit", () => {
    const fit = abilityAugmentFit(spellSplit, garenProfile);
    expect(fit).toBeDefined();
    expect(fit!.strength).toBeLessThan(0);
  });

  test("standalone augments produce no ability fit signal", () => {
    expect(abilityAugmentFit(goliath, garenProfile)).toBeUndefined();
  });

  test("missing profile produces no signal", () => {
    expect(abilityAugmentFit(chainReaction, undefined)).toBeUndefined();
  });

  test("quest feasibility: Support Main needs heal or shield in kit", () => {
    expect(
      abilityAugmentFit({ slug: "support-main", type: "quest" }, alistarProfile)?.strength,
    ).toBeGreaterThanOrEqual(2);
    const noSustain = profileWith([{ key: "Q", stats: { baseDamage: [50] } }]);
    expect(
      abilityAugmentFit({ slug: "support-main", type: "quest" }, noSustain)?.strength,
    ).toBeLessThan(0);
  });

  test("quest feasibility: From Downtown needs a long-range projectile", () => {
    const longRangePoker = profileWith([
      { key: "W", stats: { projectile: true, longRange: true } },
    ]);
    expect(
      abilityAugmentFit({ slug: "from-downtown", type: "quest" }, longRangePoker)?.strength,
    ).toBeGreaterThanOrEqual(2);
    expect(
      abilityAugmentFit({ slug: "from-downtown", type: "quest" }, garenProfile)?.strength,
    ).toBeLessThan(0);
  });

  test("uncurated quest augments emit no signal", () => {
    expect(
      abilityAugmentFit({ slug: "tooth-fairy", type: "quest" }, alistarProfile),
    ).toBeUndefined();
  });
});

describe("computeOracleScore abilityAugmentFit wiring", () => {
  const augment = {
    slug: "chain-reaction",
    name: "Chain Reaction",
    rarity: "prismatic" as const,
    win_rate: null,
    icon: "icon.png",
  };

  test("positive fit adds strength × weight to the breakdown", () => {
    const result = computeOracleScore({
      augment,
      abilityAugmentFit: { strength: 3 },
    });
    expect(result.breakdown.abilityAugmentFit).toBe(
      3 * SCORE_WEIGHTS.ABILITY_AUGMENT_FIT_PER_STRENGTH,
    );
  });

  test("negative fit subtracts and is clamped to -3..3", () => {
    const result = computeOracleScore({
      augment,
      abilityAugmentFit: { strength: -2 },
    });
    expect(result.breakdown.abilityAugmentFit).toBe(
      -2 * SCORE_WEIGHTS.ABILITY_AUGMENT_FIT_PER_STRENGTH,
    );

    const clamped = computeOracleScore({
      augment,
      abilityAugmentFit: { strength: 99 },
    });
    expect(clamped.breakdown.abilityAugmentFit).toBe(
      3 * SCORE_WEIGHTS.ABILITY_AUGMENT_FIT_PER_STRENGTH,
    );
  });

  test("no signal leaves the dimension at zero", () => {
    const result = computeOracleScore({ augment });
    expect(result.breakdown.abilityAugmentFit).toBe(0);
  });
});
