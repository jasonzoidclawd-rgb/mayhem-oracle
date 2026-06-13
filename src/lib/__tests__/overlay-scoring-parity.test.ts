import { describe, expect, test } from "vitest";
import { computeOracleScore as computeWebScore, type OracleScoreInput as WebScoreInput, type ScoredAugment as WebScoredAugment } from "../scoring/oracle-score";
import { computeOracleScore as computeOverlayScore } from "../../../overlay/src/scoring/oracle-score";
import { evaluateDecision as evaluateWebDecision, type DecisionEngineData } from "../decision/evaluate";
import { DEFAULT_MODEL_CONFIG as WEB_MODEL_CONFIG } from "../decision/model-config";
import { evaluateDecision as evaluateOverlayDecision } from "../../../overlay/src/decision/evaluate";
import { DEFAULT_MODEL_CONFIG as OVERLAY_MODEL_CONFIG } from "../../../overlay/src/decision/model-config";
import type { DecisionContext } from "../contracts/decision";
import type { AbilityProfile, PoolRules } from "../types";

const physicalProfile: AbilityProfile = {
  damageType: "physical",
  attackType: "ranged",
  playstyle: { damage: 4, durability: 2, crowdControl: 4, mobility: 2, utility: 1 },
  abilities: [],
};

const magicProfile: AbilityProfile = {
  damageType: "magic",
  attackType: "melee",
  playstyle: { damage: 4, durability: 3, crowdControl: 2, mobility: 2, utility: 2 },
  abilities: [],
};

function expectOverlayToMatchWeb(input: WebScoreInput) {
  const web = computeWebScore(input);
  const overlay = computeOverlayScore(input as Parameters<typeof computeOverlayScore>[0]);

  expect(overlay.breakdown).toEqual(web.breakdown);
  expect(overlay.total).toBe(web.total);
}

describe("overlay oracle scoring parity", () => {
  test("matches web scoring for description-only profile text", () => {
    expectOverlayToMatchWeb({
      augment: {
        slug: "description-only",
        name: "Description Only",
        rarity: "gold",
        win_rate: 54,
        icon: "icon.png",
        description: "Gain attack damage. Ranged champions apply crowd control effects more often.",
      },
      championWinRate: 56,
      abilityProfile: physicalProfile,
      mechanicalInteraction: { type: "synergy", strength: 3 },
    });
  });

  test("matches web scoring for malformed generated-data values", () => {
    expectOverlayToMatchWeb({
      augment: {
        slug: "bad-data",
        name: "Bad Data",
        rarity: "diamond",
        win_rate: Number.NaN,
        icon: "icon.png",
        wikiDescription: "Gain attack damage.",
      } as unknown as WebScoredAugment,
      championWinRate: Number.POSITIVE_INFINITY,
      comboTier: "SS" as WebScoreInput["comboTier"],
      abilityProfile: magicProfile,
    });
  });
});

const EMPTY_POOL_RULES: PoolRules = {
  patch: "26.12",
  scraped_at: "test",
  disabled: [],
  mutually_exclusive: [["owned", "blocked-by-owned"]],
  item_exclusions: [],
  ally_exclusions: [],
  lifecycle: { added: {}, removed: {} },
};

const decisionData: DecisionEngineData = {
  champion: {
    slug: "garen",
    winRate: 50,
    kitTags: ["ability", "tank"],
    abilityProfile: magicProfile,
  },
  augments: [
    {
      slug: "reliable",
      name: "Reliable",
      rarity: "gold",
      win_rate: 62,
      icon: "reliable.png",
      kit_tags: [],
      flags: { lifecycle: "active", system_breaker: false },
    },
    {
      slug: "high-ceiling",
      name: "High Ceiling",
      rarity: "gold",
      win_rate: 50,
      icon: "high-ceiling.png",
      kit_tags: [],
      flags: { lifecycle: "active", system_breaker: true },
    },
    {
      slug: "owned",
      name: "Owned",
      rarity: "gold",
      win_rate: 55,
      icon: "owned.png",
      kit_tags: [],
      flags: { lifecycle: "active", system_breaker: false },
    },
    {
      slug: "blocked-by-owned",
      name: "Blocked by Owned",
      rarity: "gold",
      win_rate: 60,
      icon: "blocked.png",
      kit_tags: [],
      flags: { lifecycle: "active", system_breaker: false },
    },
    {
      slug: "overflow",
      name: "Overflow",
      rarity: "gold",
      win_rate: 70,
      icon: "overflow.png",
      wikiDescription: "Double mana costs for bonus damage.",
      kit_tags: ["mana"],
      flags: { lifecycle: "active", system_breaker: false },
    },
  ],
  poolRules: EMPTY_POOL_RULES,
  mechanicalInteractions: {
    "high-ceiling": { type: "synergy", strength: 3 },
  },
};

function expectOverlayDecisionToMatchWeb(context: DecisionContext) {
  const web = evaluateWebDecision(context, decisionData, WEB_MODEL_CONFIG);
  const overlay = evaluateOverlayDecision(
    context,
    decisionData as Parameters<typeof evaluateOverlayDecision>[1],
    OVERLAY_MODEL_CONFIG,
  );

  expect(overlay).toEqual(web);
}

describe("overlay unified decision parity", () => {
  const baseContext: DecisionContext = {
    championSlug: "garen",
    round: 2,
    screenRarity: "gold",
    mode: "competitive",
    ownedAugmentSlugs: [],
    currentItemIds: [],
    plannedItemIds: [],
    rerollsRemaining: 1,
    goldenRerollAvailable: false,
  };

  test("matches eligible pool, scores, grades, probabilities, warnings, and reasons", () => {
    expectOverlayDecisionToMatchWeb(baseContext);
    expectOverlayDecisionToMatchWeb({ ...baseContext, mode: "exploration" });
  });

  test("matches residual exclusions and hard-incompatible offered warnings", () => {
    expectOverlayDecisionToMatchWeb({
      ...baseContext,
      ownedAugmentSlugs: ["owned"],
      seenOfferSlugs: ["reliable"],
      offeredAugmentSlugs: ["blocked-by-owned", "overflow", "high-ceiling"],
    });
  });

  test("matches Golden Reroll stance without adding normal draws", () => {
    expectOverlayDecisionToMatchWeb({
      ...baseContext,
      goldenRerollAvailable: true,
      rerollsRemaining: 0,
      offeredAugmentSlugs: ["overflow", "reliable", "high-ceiling"],
    });
  });
});
