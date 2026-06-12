import { describe, expect, test } from "vitest";
import { rankOfferedAugments } from "../scoring/offered-ranking";

type TestAugment = {
  slug: string;
  name: string;
  rarity: "silver" | "gold" | "prismatic";
  win_rate: number | null;
  icon: string;
  set?: string;
  wikiDescription?: string;
  kit_tags?: string[];
  flags?: {
    system_breaker?: boolean;
    lifecycle?: string;
  };
};

type TestChampion = {
  slug: string;
  name: string;
  win_rate: number;
  abilityProfile: {
    damageType: "physical" | "magic" | "mixed";
    attackType: "melee" | "ranged" | "mixed";
    playstyle: {
      damage: number;
      durability: number;
      crowdControl: number;
      mobility: number;
      utility: number;
    };
    abilities: unknown[];
  };
  modeMetadata: {
    aramMayhem: {
      preferredTags: string[];
      trapTags: string[];
    };
  };
};

const makeAugment = (overrides: Partial<TestAugment> & Pick<TestAugment, "slug">): TestAugment => ({
  name: overrides.slug,
  rarity: "gold",
  win_rate: 50,
  icon: `${overrides.slug}.png`,
  ...overrides,
});

const champion = {
  slug: "lux",
  name: "Lux",
  win_rate: 51.5,
  abilityProfile: {
    damageType: "magic",
    attackType: "ranged",
    playstyle: {
      damage: 4,
      durability: 1,
      crowdControl: 4,
      mobility: 1,
      utility: 3,
    },
    abilities: [],
  },
  modeMetadata: {
    aramMayhem: {
      preferredTags: ["skillshot", "crowd-control", "ap"],
      trapTags: ["melee-only"],
    },
  },
} satisfies TestChampion;

const interactionChampion = {
  ...champion,
  baseStats: {
    baseHP: 600,
    hpGrowth: 100,
    baseArmor: 30,
    armorGrowth: 4,
    baseMR: 30,
    mrGrowth: 1.3,
    baseAD: 60,
    adGrowth: 3,
    baseAS: 0.65,
    asGrowth: 3,
    attackRange: 550,
    moveSpeed: 335,
    baseMP: 0,
    mpGrowth: 0,
    baseHPRegen: 6,
    hpRegenGrowth: 0.6,
  },
  abilityProfile: {
    ...champion.abilityProfile,
    abilities: [
      {
        key: "Q" as const,
        name: "Spark",
        icon: "q.png",
        description: "Fires a spell.",
        stats: { apRatio: 0.8, cooldown: [4], damageType: "magic" as const },
      },
      {
        key: "W" as const,
        name: "Field",
        icon: "w.png",
        description: "Burns enemies over time.",
        stats: { apRatio: 0.7, cooldown: [8], damageType: "magic" as const, isDot: true, isAoe: true },
      },
      {
        key: "E" as const,
        name: "Root",
        icon: "e.png",
        description: "Roots an enemy.",
        stats: { apRatio: 0.5, cooldown: [10], damageType: "magic" as const, ccType: "root" },
      },
      {
        key: "R" as const,
        name: "Nova",
        icon: "r.png",
        description: "Large explosion.",
        stats: { apRatio: 1, cooldown: [80], damageType: "magic" as const, baseDamage: [150, 250, 350] },
      },
    ],
  },
};

const reasonCodes = (ranking: { reasons: Array<{ code: string }> }) =>
  ranking.reasons.map((reason) => reason.code);

const reasonByCode = (ranking: { reasons: Array<{ code: string }> }, code: string) =>
  ranking.reasons.find((reason) => reason.code === code);

describe("rankOfferedAugments", () => {
  test("ranks exactly three offered augments for a champion", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "arcane-sniper", win_rate: 56, wikiDescription: "Ability power and magic damage for ranged champions." }),
        makeAugment({ slug: "generic-power", win_rate: 52 }),
        makeAugment({ slug: "bad-melee-hook", win_rate: 48, wikiDescription: "Melee champions gain attack damage." }),
      ],
      ownedAugments: [],
    });

    expect(result.status).toBe("ranked");
    expect(result.rankings).toHaveLength(3);
    expect(result.rankings.map((ranking) => ranking.rank)).toEqual([1, 2, 3]);
    expect(result.rankings.map((ranking) => ranking.augment.slug)).toEqual([
      "arcane-sniper",
      "generic-power",
      "bad-melee-hook",
    ]);
    expect(result.rankings[0].score).toBeDefined();
    expect(result.rankings[0].scoreBand).toBeDefined();
  });

  test("returns incomplete-offers with no rankings when fewer than three offers are provided", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "one" }),
        makeAugment({ slug: "two" }),
      ],
      ownedAugments: [],
    });

    expect(result.status).toBe("incomplete-offers");
    expect(result.rankings).toEqual([]);
  });

  test("handles duplicate offered augments deterministically", () => {
    const duplicate = makeAugment({ slug: "duplicate-offer", win_rate: 54, wikiDescription: "Ability power." });

    const first = rankOfferedAugments({
      champion,
      offeredAugments: [
        duplicate,
        makeAugment({ slug: "baseline-offer", win_rate: 50 }),
        duplicate,
      ],
      ownedAugments: [],
    });
    const second = rankOfferedAugments({
      champion,
      offeredAugments: [
        duplicate,
        makeAugment({ slug: "baseline-offer", win_rate: 50 }),
        duplicate,
      ],
      ownedAugments: [],
    });

    expect(first.status).toBe("ranked");
    expect(second.status).toBe("ranked");
    expect(first.rankings.map((ranking) => ranking.augment.slug)).toEqual(
      second.rankings.map((ranking) => ranking.augment.slug),
    );
    expect(first.rankings.filter((ranking) => ranking.augment.slug === "duplicate-offer")).toHaveLength(2);
    expect(first.rankings.filter((ranking) => ranking.augment.slug === "duplicate-offer").map((ranking) => ranking.rank)).toEqual([1, 2]);
    expect(first.rankings.filter((ranking) => ranking.augment.slug === "duplicate-offer").every((ranking) =>
      ranking.flags?.includes("duplicate-offer"),
    )).toBe(true);
  });

  test("breaks exact score ties deterministically by slug ascending", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "zeta", win_rate: 50 }),
        makeAugment({ slug: "alpha", win_rate: 50 }),
        makeAugment({ slug: "middle", win_rate: 50 }),
      ],
      ownedAugments: [],
    });

    expect(result.status).toBe("ranked");
    expect(result.rankings.map((ranking) => ranking.augment.slug)).toEqual(["alpha", "middle", "zeta"]);
  });

  test("historical set metadata contributes no reason and no score effect (26.12: sets removed)", () => {
    const withSet = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "archmage-finisher", win_rate: 53, set: "archmage" }),
        makeAugment({ slug: "solo-power", win_rate: 52 }),
        makeAugment({ slug: "off-set", win_rate: 51, set: "Snowday" }),
      ],
      ownedAugments: [makeAugment({ slug: "archmage-owned", set: "Archmage" })],
    });

    expect(withSet.status).toBe("ranked");
    const archmage = withSet.rankings.find((ranking) => ranking.augment.slug === "archmage-finisher");
    expect(archmage).toBeDefined();
    expect(reasonByCode(archmage!, "same-set-2-piece-progress")).toBeUndefined();
    expect(archmage!.reasons.every((r) => r.source !== "augment-set-metadata")).toBe(true);
  });

  test("qualitative reroll EV distinguishes same-tier normal reroll from Golden Reroll upgrade opportunity", () => {
    const normal = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "normal-a", rarity: "gold", win_rate: 51 }),
        makeAugment({ slug: "normal-b", rarity: "gold", win_rate: 50 }),
        makeAugment({ slug: "normal-c", rarity: "gold", win_rate: 49 }),
      ],
      ownedAugments: [],
      rerollContext: { screenTier: "gold", rerollType: "normal", poolDataComplete: true },
    });
    const golden = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "golden-a", rarity: "gold", win_rate: 51 }),
        makeAugment({ slug: "golden-b", rarity: "gold", win_rate: 50 }),
        makeAugment({ slug: "golden-c", rarity: "gold", win_rate: 49 }),
      ],
      ownedAugments: [],
      rerollContext: { screenTier: "gold", rerollType: "golden", poolDataComplete: true },
    });

    expect(normal.status).toBe("ranked");
    expect(golden.status).toBe("ranked");
    expect(normal.rankings[0].rerollEv).toMatchObject({
      stance: "same-tier-search",
      confidence: "medium",
    });
    expect(normal.rankings[0].rerollEv?.factors).not.toContain("golden-reroll-upgrade-opportunity");
    expect(golden.rankings[0].rerollEv).toMatchObject({
      stance: "upgrade-opportunity",
      confidence: "medium",
    });
    expect(golden.rankings[0].rerollEv?.factors).toContain("golden-reroll-upgrade-opportunity");
  });

  test("Golden Reroll is not labeled as an upgrade opportunity on Prismatic screens", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "pris-a", rarity: "prismatic", win_rate: 51 }),
        makeAugment({ slug: "pris-b", rarity: "prismatic", win_rate: 50 }),
        makeAugment({ slug: "pris-c", rarity: "prismatic", win_rate: 49 }),
      ],
      ownedAugments: [],
      rerollContext: { screenTier: "prismatic", rerollType: "golden", poolDataComplete: true },
    });

    expect(result.status).toBe("ranked");
    expect(result.rankings[0].rerollEv?.stance).not.toBe("upgrade-opportunity");
    expect(result.rankings[0].rerollEv?.factors).not.toContain("golden-reroll-upgrade-opportunity");
  });

  test("reroll EV can be low confidence with incomplete pool data while citing concrete factors", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "pool-a", rarity: "silver", win_rate: 51 }),
        makeAugment({ slug: "pool-b", rarity: "silver", win_rate: 50 }),
        makeAugment({ slug: "pool-c", rarity: "silver", win_rate: 49 }),
      ],
      ownedAugments: [],
      rerollContext: { screenTier: "silver", rerollType: "normal", poolDataComplete: false },
    });

    expect(result.status).toBe("ranked");
    expect(result.rankings[0].rerollEv).toMatchObject({ confidence: "low" });
    expect(result.rankings[0].rerollEv?.factors).toEqual(
      expect.arrayContaining(["same-tier-reroll", "incomplete-pool-data"]),
    );
  });

  test("shop availability status appears in output and changes manual timing copy without client automation", () => {
    const unavailable = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "shop-a" }),
        makeAugment({ slug: "shop-b" }),
        makeAugment({ slug: "shop-c" }),
      ],
      ownedAugments: [],
      shopAvailability: { status: "closed" },
    });
    const available = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "shop-a" }),
        makeAugment({ slug: "shop-b" }),
        makeAugment({ slug: "shop-c" }),
      ],
      ownedAugments: [],
      shopAvailability: { status: "open" },
    });

    expect(unavailable.status).toBe("ranked");
    expect(available.status).toBe("ranked");
    expect(unavailable.rankings[0].shopTiming?.status).toBe("closed");
    expect(available.rankings[0].shopTiming?.status).toBe("open");
    expect(unavailable.rankings[0].shopTiming?.message).not.toBe(available.rankings[0].shopTiming?.message);
    expect(available.rankings[0].shopTiming?.message).not.toMatch(/client|automation|ocr|memory/i);
  });

  test("system breaker flags flow into offered ranking score", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "breaker", win_rate: 45, flags: { system_breaker: true } }),
        makeAugment({ slug: "normal-high", win_rate: 55 }),
        makeAugment({ slug: "normal-mid", win_rate: 50 }),
      ],
      ownedAugments: [],
    });

    expect(result.status).toBe("ranked");
    expect(result.rankings[0].augment.slug).toBe("breaker");
  });

  test("champion-specific mode overrides can affect score and reasons when concrete metadata supports them", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "lux-root-reset", win_rate: 50, kit_tags: ["crowd-control"], wikiDescription: "Root and slow enemies." }),
        makeAugment({ slug: "plain-damage", win_rate: 50 }),
        makeAugment({ slug: "melee-bait", win_rate: 50, kit_tags: ["melee-only"], wikiDescription: "Melee champions gain attack damage." }),
      ],
      ownedAugments: [],
      modeRules: {
        championOverrides: {
          lux: {
            preferredAugments: { "lux-root-reset": { scoreDelta: 8, source: "curated-mode-rule" } },
            trapAugments: { "melee-bait": { scoreDelta: -8, source: "curated-mode-rule" } },
          },
        },
      },
    });

    expect(result.status).toBe("ranked");
    const best = result.rankings[0];
    const trap = result.rankings.find((ranking) => ranking.augment.slug === "melee-bait");
    expect(best.augment.slug).toBe("lux-root-reset");
    expect(reasonByCode(best, "champion-mode-override")).toMatchObject({
      source: "curated-mode-rule",
      confidence: "high",
    });
    expect(reasonByCode(trap!, "champion-mode-trap")).toMatchObject({
      source: "curated-mode-rule",
      confidence: "high",
    });
  });

  test("curated mode-rule signals and inferred text-derived signals are both supported with lower confidence for inference", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "curated-ap", win_rate: 50, wikiDescription: "Ability power." }),
        makeAugment({ slug: "inferred-root", win_rate: 50, wikiDescription: "Your roots and slows deal bonus magic damage." }),
        makeAugment({ slug: "neutral", win_rate: 50 }),
      ],
      ownedAugments: [],
      modeRules: {
        curatedSignals: {
          "curated-ap": [{ code: "mode-preferred-ap", source: "curated-mode-rule", confidence: "high" }],
        },
        inferFromText: true,
      },
    });

    expect(result.status).toBe("ranked");
    const curated = result.rankings.find((ranking) => ranking.augment.slug === "curated-ap");
    const inferred = result.rankings.find((ranking) => ranking.augment.slug === "inferred-root");
    expect(reasonByCode(curated!, "mode-preferred-ap")).toMatchObject({
      source: "curated-mode-rule",
      confidence: "high",
    });
    expect(reasonByCode(inferred!, "text-inferred-crowd-control-synergy")).toMatchObject({
      source: "augment-description-inference",
      confidence: "low",
    });
  });

  test("combo provenance is preserved in data-backed reasons", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "combo-hit", win_rate: 50 }),
        makeAugment({ slug: "combo-miss", win_rate: 50 }),
        makeAugment({ slug: "combo-neutral", win_rate: 50 }),
      ],
      ownedAugments: [],
      comboMetadata: {
        "combo-hit": { tier: "S", ref: "combos:lux:combo-hit", source: "combo-table" },
        "combo-miss": { tier: "C", ref: "combos:lux:combo-miss", source: "combo-table" },
      },
    });

    expect(result.status).toBe("ranked");
    expect(reasonByCode(result.rankings.find((ranking) => ranking.augment.slug === "combo-hit")!, "strong-combo")).toMatchObject({
      source: "combo-table",
      confidence: "high",
      ref: "combos:lux:combo-hit",
    });
    expect(reasonByCode(result.rankings.find((ranking) => ranking.augment.slug === "combo-miss")!, "trap-combo")).toMatchObject({
      source: "combo-table",
      confidence: "high",
      ref: "combos:lux:combo-miss",
    });
  });

  test("trap and synergy metadata produces explanations only when score breakdown or concrete metadata supports it", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "supported-trap", win_rate: 50 }),
        makeAugment({ slug: "supported-synergy", win_rate: 50 }),
        makeAugment({ slug: "unsupported-story", win_rate: 50 }),
      ],
      ownedAugments: [],
      scoreBreakdowns: {
        "supported-trap": { trapPenalty: -15 },
        "supported-synergy": { abilityTypeSynergy: 6 },
      },
    });

    expect(result.status).toBe("ranked");
    expect(reasonCodes(result.rankings.find((ranking) => ranking.augment.slug === "supported-trap")!)).toContain("trap-penalty");
    expect(reasonCodes(result.rankings.find((ranking) => ranking.augment.slug === "supported-synergy")!)).toContain("ability-type-synergy");
    expect(reasonCodes(result.rankings.find((ranking) => ranking.augment.slug === "unsupported-story")!)).toEqual([
      "oracle-score-band",
      "augment-win-rate-available",
    ]);
  });

  test("reasons are data-backed with stable code/source/confidence and no generic invented explanation text", () => {
    const result = rankOfferedAugments({
      champion,
      offeredAugments: [
        makeAugment({ slug: "documented", win_rate: 50, set: "Archmage" }),
        makeAugment({ slug: "empty-metadata", win_rate: null }),
        makeAugment({ slug: "also-empty", win_rate: null }),
      ],
      ownedAugments: [makeAugment({ slug: "owned-archmage", set: "Archmage" })],
    });

    expect(result.status).toBe("ranked");
    expect(result.rankings.every((ranking) => ranking.reasons.length >= 2)).toBe(true);

    for (const ranking of result.rankings) {
      for (const reason of ranking.reasons) {
        expect(reason.code).toMatch(/^[a-z0-9-]+$/);
        expect(reason.source).toBeDefined();
        expect(reason.confidence).toMatch(/^(high|medium|low)$/);
        expect(reason.message ?? "").not.toMatch(/generally good|works well|strong choice|recommended pick/i);
      }
    }

    expect(reasonCodes(result.rankings.find((ranking) => ranking.augment.slug === "empty-metadata")!)).toEqual([
      "oracle-score-band",
      "augment-win-rate-missing",
    ]);
    expect(reasonCodes(result.rankings.find((ranking) => ranking.augment.slug === "also-empty")!)).toEqual([
      "oracle-score-band",
      "augment-win-rate-missing",
    ]);
  });

  test("structured mechanical interactions affect both ranking score and explanation provenance", () => {
    const result = rankOfferedAugments({
      champion: interactionChampion,
      offeredAugments: [
        makeAugment({
          slug: "ability-crit",
          win_rate: 50,
          wikiDescription: "Your abilities can critically strike.",
        }),
        makeAugment({ slug: "neutral", win_rate: 50 }),
        makeAugment({
          slug: "mana-scaling-trap",
          win_rate: 50,
          wikiDescription: "Gain power based on your maximum mana.",
        }),
      ],
      ownedAugments: [],
    });

    expect(result.status).toBe("ranked");
    expect(result.rankings.map((ranking) => ranking.augment.slug)).toEqual([
      "ability-crit",
      "neutral",
      "mana-scaling-trap",
    ]);

    const synergy = result.rankings[0];
    const trap = result.rankings[2];
    expect(reasonByCode(synergy, "mechanical-synergy")).toMatchObject({
      source: "mechanical-interaction-analysis",
      confidence: "medium",
      ref: "ABILITY_CRIT",
    });
    expect(reasonByCode(trap, "mechanical-trap")).toMatchObject({
      source: "mechanical-interaction-analysis",
      confidence: "medium",
      ref: "MANA_SCALING",
    });
    expect(synergy.score).toBeGreaterThan(result.rankings[1].score);
    expect(trap.score).toBeLessThan(result.rankings[1].score);
  });

  test("does not double-count mechanical signals already represented by Oracle profile scoring", () => {
    const result = rankOfferedAugments({
      champion: interactionChampion,
      offeredAugments: [
        makeAugment({ slug: "attack-speed", win_rate: 50, wikiDescription: "Gain 60% attack speed." }),
        makeAugment({ slug: "neutral-a", win_rate: 50 }),
        makeAugment({ slug: "neutral-b", win_rate: 50 }),
      ],
      ownedAugments: [],
    });

    const attackSpeed = result.rankings.find((ranking) => ranking.augment.slug === "attack-speed");
    expect(reasonCodes(attackSpeed!)).toContain("tag-mismatch");
    expect(reasonCodes(attackSpeed!)).not.toContain("mechanical-trap");
  });
});
