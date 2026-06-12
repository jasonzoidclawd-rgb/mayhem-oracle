import { describe, expect, test } from "vitest";
import { evaluateDecision, type DecisionEngineData } from "../decision/evaluate";
import { GRADE_BANDS, gradeForPercentile } from "../decision/grade";
import { DEFAULT_MODEL_CONFIG } from "../decision/model-config";
import type { DecisionContext } from "../contracts/decision";
import type { AbilityProfile, ChampionTag, PoolRules } from "../types";

const EMPTY_POOL_RULES: PoolRules = {
  patch: "26.12",
  scraped_at: "test",
  disabled: [],
  mutually_exclusive: [],
  item_exclusions: [],
  ally_exclusions: [],
  lifecycle: { added: {}, removed: {} },
};

const PROFILE: AbilityProfile = {
  damageType: "magic",
  attackType: "ranged",
  playstyle: {
    damage: 4,
    durability: 2,
    crowdControl: 3,
    mobility: 2,
    utility: 2,
  },
  abilities: [],
};

const BASE_CONTEXT: DecisionContext = {
  championSlug: "test-champion",
  round: 2,
  screenRarity: "gold",
  mode: "competitive",
  ownedAugmentSlugs: [],
  currentItemIds: [],
  plannedItemIds: [],
  rerollsRemaining: 1,
  goldenRerollAvailable: false,
};

function augment(
  slug: string,
  winRate: number,
  options: {
    rarity?: "silver" | "gold" | "prismatic";
    kitTags?: ChampionTag[];
    systemBreaker?: boolean;
    wikiDescription?: string;
    set?: string;
    wikiSet?: string;
  } = {},
) {
  return {
    slug,
    name: slug,
    rarity: options.rarity ?? "gold",
    win_rate: winRate,
    icon: `${slug}.png`,
    wikiDescription: options.wikiDescription ?? "Gain a useful combat bonus.",
    kit_tags: options.kitTags ?? [],
    set: options.set,
    wikiSet: options.wikiSet,
    flags: {
      lifecycle: "active",
      system_breaker: options.systemBreaker ?? false,
    },
  };
}

function data(
  augments: ReturnType<typeof augment>[],
  overrides: Partial<DecisionEngineData> = {},
): DecisionEngineData {
  return {
    champion: {
      slug: BASE_CONTEXT.championSlug,
      winRate: 50,
      kitTags: ["ability", "cc"],
      abilityProfile: PROFILE,
    },
    augments,
    poolRules: EMPTY_POOL_RULES,
    ...overrides,
  };
}

describe("decision grade contract", () => {
  test("uses the frozen descending same-pool percentile bands", () => {
    expect(GRADE_BANDS).toEqual({
      hot: [0, 0.1],
      strong: [0.1, 0.3],
      steady: [0.3, 0.6],
      average: [0.6, 0.85],
      weak: [0.85, 1],
    });
    expect([0, 0.1, 0.3, 0.6, 0.85, 1].map(gradeForPercentile)).toEqual([
      "hot",
      "strong",
      "steady",
      "average",
      "weak",
      "weak",
    ]);
  });
});

describe("evaluateDecision contract", () => {
  test("only same-rarity eligible augments form the comparison pool", () => {
    const result = evaluateDecision(
      BASE_CONTEXT,
      data([
        augment("gold-best", 60),
        augment("gold-middle", 52),
        augment("gold-worst", 44),
        augment("silver-higher", 99, { rarity: "silver" }),
        augment("gold-ineligible", 99, { kitTags: ["attack"] }),
      ]),
      DEFAULT_MODEL_CONFIG,
    );

    expect(result.poolSize).toBe(3);
    expect(result.candidates.map((candidate) => candidate.augmentSlug)).toEqual([
      "gold-best",
      "gold-middle",
      "gold-worst",
    ]);
    expect(result.candidates.map((candidate) => candidate.percentile)).toEqual([
      0,
      0.5,
      1,
    ]);
  });

  test("three visible offers can all be average or weak", () => {
    const augments = Array.from({ length: 10 }, (_, index) =>
      augment(`gold-${index + 1}`, 60 - index),
    );
    const result = evaluateDecision(
      {
        ...BASE_CONTEXT,
        offeredAugmentSlugs: ["gold-8", "gold-9", "gold-10"],
      },
      data(augments),
      DEFAULT_MODEL_CONFIG,
    );

    expect(result.candidates.map((candidate) => candidate.grade)).toEqual([
      "average",
      "weak",
      "weak",
    ]);
  });

  test("hard-incompatible offered augments are always weak and carry warnings", () => {
    const result = evaluateDecision(
      {
        ...BASE_CONTEXT,
        championSlug: "garen",
        offeredAugmentSlugs: ["overflow", "universal"],
      },
      data(
        [
          augment("overflow", 62, {
            kitTags: ["mana"],
            wikiDescription: "Double mana costs for bonus damage.",
          }),
          augment("universal", 50),
        ],
        {
          champion: {
            slug: "garen",
            winRate: 50,
            kitTags: ["ability"],
            abilityProfile: PROFILE,
          },
        },
      ),
      DEFAULT_MODEL_CONFIG,
    );

    const incompatible = result.candidates.find(
      (candidate) => candidate.augmentSlug === "overflow",
    );
    expect(incompatible?.grade).toBe("weak");
    expect(incompatible?.warnings).toContain("hard-incompatible");
  });

  test("competitive and exploration modes can rank the same eligible augments differently", () => {
    const engineData = data(
      [
        augment("reliable", 62),
        augment("high-ceiling", 50, { systemBreaker: true }),
        augment("baseline", 52),
      ],
      {
        mechanicalInteractions: {
          "high-ceiling": { type: "synergy", strength: 3 },
        },
      },
    );

    const competitive = evaluateDecision(
      BASE_CONTEXT,
      engineData,
      DEFAULT_MODEL_CONFIG,
    );
    const exploration = evaluateDecision(
      { ...BASE_CONTEXT, mode: "exploration" },
      engineData,
      DEFAULT_MODEL_CONFIG,
    );

    expect(competitive.candidates[0].augmentSlug).toBe("reliable");
    expect(exploration.candidates[0].augmentSlug).toBe("high-ceiling");
  });

  test("Patch 26.12 decisions contain no Trait or Set bonus", () => {
    const result = evaluateDecision(
      BASE_CONTEXT,
      data([
        augment("legacy-labeled", 55, {
          set: "Legacy Set",
          wikiSet: "Legacy Wiki Set",
        }),
        augment("plain", 54),
      ]),
      DEFAULT_MODEL_CONFIG,
    );

    for (const candidate of result.candidates) {
      expect(Object.keys(candidate.breakdown).join(" ").toLowerCase()).not.toMatch(
        /trait|set/,
      );
      expect([...candidate.reasons, ...candidate.warnings].join(" ").toLowerCase()).not.toMatch(
        /trait|set/,
      );
    }
  });
});
