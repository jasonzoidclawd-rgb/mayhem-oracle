import { describe, expect, test } from "vitest";
import augmentsData from "../../../public/data/augments.json";
import abilitiesData from "../../../public/data/abilities.json";
import championsData from "../../../public/data/champions.json";
import combosData from "../../../public/data/combos.json";
import { buildOverlayAugmentLookup, matchAugmentName } from "../../../overlay/src/scoring/offer-lookup";
import { buildChampionPool, parseSets } from "../../../overlay/src/scoring/probability";
import type { ComboTier, ScoredAugment } from "../../../overlay/src/scoring/oracle-score";
import type { AbilityProfile } from "../../../overlay/src/scoring/types";

const drmundoAbilityProfile = abilitiesData.profiles.drmundo as AbilityProfile;

function comboMapForChampion(championSlug: string) {
  return new Map<string, ComboTier>(
    combosData.combos
      .filter((combo) => combo.champion === championSlug)
      .map((combo) => [
        combo.augmentSlug ?? combo.augment.replace(/ /g, "-"),
        combo.tier as ComboTier,
      ]),
  );
}

describe("overlay augment lookup", () => {
  test("matches real OCR offers even when the predicted champion pool excludes them", () => {
    const champion = championsData.champions.find((candidate) => candidate.slug === "drmundo");
    expect(champion).toBeTruthy();

    const comboTiers = comboMapForChampion("drmundo");
    const pool = buildChampionPool(
      "drmundo",
      augmentsData.augments as ScoredAugment[],
      {
        win_rate: champion!.win_rate,
        tags: champion!.tags,
        kit_tags: champion!.kit_tags,
        baseStats: champion!.baseStats,
      },
      drmundoAbilityProfile,
      comboTiers,
      { disabled: [], lifecycle: { removed: {} }, item_exclusions: [], ally_exclusions: [] },
    );

    expect(pool.prismatic.augments.some((augment) => augment.slug === "ultimate-revolution"))
      .toBe(false);

    const lookup = buildOverlayAugmentLookup({
      allAugments: augmentsData.augments as ScoredAugment[],
      championWinRate: champion!.win_rate,
      comboTiers,
      poolData: pool,
      abilityProfile: drmundoAbilityProfile,
    });

    expect(matchAugmentName("終極革新", lookup)?.slug).toBe("ultimate-revolution");
    expect(matchAugmentName("任務:鋼鐵雄心", lookup)?.slug).toBe("quest-steel-your-heart");
  });

  test("matches every active generated augment name across locales", () => {
    const lookup = buildOverlayAugmentLookup({
      allAugments: augmentsData.augments as ScoredAugment[],
      poolData: null,
    });

    const localizedNameFields = ["name", "name_zh_TW", "name_zh_CN", "name_ja", "name_ko"] as const;

    for (const augment of augmentsData.augments) {
      if (augment.flags?.lifecycle === "removed") continue;

      for (const field of localizedNameFields) {
        const name = augment[field];
        expect(
          matchAugmentName(name, lookup)?.slug,
          `${augment.slug} should match ${field} (${name})`,
        ).toBe(augment.slug);
      }
    }
  });

  test("parses generated set ids used by current augment data", () => {
    expect(parseSets("stackosaurus_rex")).toEqual(["Stackosaurus Rex"]);
    expect(parseSets("dive_bomb")).toEqual(["Dive Bomb"]);
    expect(parseSets("Stackosaurus Rex")).toEqual(["Stackosaurus Rex"]);
  });
});
