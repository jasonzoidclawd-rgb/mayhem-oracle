import { describe, expect, test } from "vitest";
import {
  addAugmentAliases,
  matchAugment,
} from "../../../overlay/src/augmentSelection";
import type { PoolAugment } from "../../../overlay/src/scoring";

function augment(slug: string, name: string, name_zh_TW: string): PoolAugment {
  return {
    slug,
    name,
    name_zh_TW,
    sets: [],
    win_rate: 50,
    score: 50,
    tier: "B",
    rarity: "gold",
    probability: 0,
    probabilityWithReroll: 0,
  };
}

describe("overlay augment selection matching", () => {
  test("matches Steel Your Heart OCR aliases", () => {
    const steelHeart = augment(
      "quest-steel-your-heart",
      "Quest: Steel Your Heart",
      "任務：心鋼起來",
    );
    const lookup = new Map<string, PoolAugment>([
      [steelHeart.name, steelHeart],
      [steelHeart.name_zh_TW!, steelHeart],
    ]);

    addAugmentAliases(lookup, steelHeart);

    expect(matchAugment("任務:鋼鐵雄心", lookup)?.slug).toBe("quest-steel-your-heart");
    expect(matchAugment("任務：鋼鐵雄心", lookup)?.slug).toBe("quest-steel-your-heart");
  });

  test("matches one-character Traditional Chinese OCR drift", () => {
    const poroBlaster = augment("poro-blaster", "Poro Blaster", "普羅能量炮");
    const lookup = new Map<string, PoolAugment>([
      [poroBlaster.name, poroBlaster],
      [poroBlaster.name_zh_TW!, poroBlaster],
    ]);

    expect(matchAugment("普纖能量炮", lookup)?.slug).toBe("poro-blaster");
  });
});
