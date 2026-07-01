import { describe, expect, test } from "vitest";
import {
  advanceOcrSelection,
  addAugmentAliases,
  isCompleteThreeCardOffer,
  matchAugment,
  matchAugmentFrame,
  shouldClearOcrStateForGameflow,
  shouldEndAugmentSelectionForLevel,
  shouldRunOcrForGameflow,
  shouldStartAugmentSelection,
} from "../../../overlay/src/augmentSelection";
import type { PoolAugment } from "../../../overlay/src/scoring";

function augment(slug: string, name: string, name_zh_TW: string): PoolAugment {
  return {
    slug,
    name,
    name_zh_TW,
    win_rate: 50,
    score: 50,
    tier: "B",
    rarity: "gold",
    probability: 0,
    probabilityWithReroll: 0,
  };
}

describe("overlay augment selection matching", () => {
  test("starts any newly reached augment threshold without requiring death state", () => {
    expect(shouldStartAugmentSelection({ augmentLevel: 3 })).toBe(true);
    expect(shouldStartAugmentSelection({ augmentLevel: 7 })).toBe(true);
    expect(shouldStartAugmentSelection({ augmentLevel: 11 })).toBe(true);
    expect(shouldStartAugmentSelection({ augmentLevel: 15 })).toBe(true);
  });

  test("does not start when no new augment threshold was reached", () => {
    expect(shouldStartAugmentSelection({ augmentLevel: undefined })).toBe(false);
  });

  test("keeps level 7 selection active until the player advances past level 7", () => {
    expect(shouldEndAugmentSelectionForLevel({
      playerLevel: 7,
      lastAugmentLevel: 7,
    })).toBe(false);
    expect(shouldEndAugmentSelectionForLevel({
      playerLevel: 8,
      lastAugmentLevel: 7,
    })).toBe(true);
  });

  test("ends selection only after raw card text disappears for two consecutive OCR passes", () => {
    const seen = advanceOcrSelection(
      { hasSeenCards: false, emptyPasses: 0 },
      3,
    );
    const rerollGap = advanceOcrSelection(seen, 0);
    const newCards = advanceOcrSelection(rerollGap, 3);
    const firstEmpty = advanceOcrSelection(newCards, 0);
    const secondEmpty = advanceOcrSelection(firstEmpty, 0);

    expect(rerollGap.shouldStop).toBe(false);
    expect(newCards.emptyPasses).toBe(0);
    expect(firstEmpty.shouldStop).toBe(false);
    expect(secondEmpty.shouldStop).toBe(true);
  });

  test("preserves three-card slot order from OCR fixture frames", () => {
    const left = augment("left-card", "Left Card", "左卡");
    const middle = augment("middle-card", "Middle Card", "中卡");
    const right = augment("right-card", "Right Card", "右卡");
    const lookup = new Map<string, PoolAugment>([
      [left.name, left],
      [middle.name, middle],
      [right.name, right],
    ]);

    const matched = matchAugmentFrame(
      [
        { text: "Right Card", region_index: 2 },
        { text: "Left Card", region_index: 0 },
        { text: "Middle Card", region_index: 1 },
      ],
      lookup,
    );

    expect(matched.map((card) => card.augment.slug)).toEqual([
      "left-card",
      "middle-card",
      "right-card",
    ]);
    expect(isCompleteThreeCardOffer(matched)).toBe(true);
  });

  test("keeps partial reads incomplete while preserving recognized slots", () => {
    const left = augment("left-card", "Left Card", "左卡");
    const right = augment("right-card", "Right Card", "右卡");
    const lookup = new Map<string, PoolAugment>([
      [left.name, left],
      [right.name, right],
    ]);

    const matched = matchAugmentFrame(
      [
        { text: "Left Card", region_index: 0 },
        { text: "unreadable", region_index: 1 },
        { text: "Right Card", region_index: 2 },
      ],
      lookup,
    );

    expect(matched.map((card) => card.regionIndex)).toEqual([0, 2]);
    expect(isCompleteThreeCardOffer(matched)).toBe(false);
  });

  test("treats reroll refresh frames as transient gaps, not selection exit", () => {
    const firstCards = advanceOcrSelection({ hasSeenCards: false, emptyPasses: 0 }, 3);
    const refreshGap = advanceOcrSelection(firstCards, 0);
    const refreshedCards = advanceOcrSelection(refreshGap, 2);

    expect(refreshGap.shouldStop).toBe(false);
    expect(refreshGap.emptyPasses).toBe(1);
    expect(refreshedCards.shouldStop).toBe(false);
    expect(refreshedCards.emptyPasses).toBe(0);
  });

  test("clears stale OCR state when normalized gameflow leaves live capture", () => {
    expect(shouldRunOcrForGameflow({ liveCaptureAllowed: true })).toBe(true);
    expect(shouldClearOcrStateForGameflow({ liveCaptureAllowed: true })).toBe(false);

    expect(shouldRunOcrForGameflow({ liveCaptureAllowed: false })).toBe(false);
    expect(shouldClearOcrStateForGameflow({ liveCaptureAllowed: false })).toBe(true);
  });

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
