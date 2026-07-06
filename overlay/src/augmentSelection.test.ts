import { describe, expect, it } from "vitest";
import {
  advanceOcrSelection,
  isCompleteThreeCardOffer,
  matchAugmentFrame,
  shouldClearOcrStateForGameflow,
  shouldEndAugmentSelectionForLevel,
  shouldRunOcrForGameflow,
  type DetectedAugmentText,
} from "./augmentSelection";
import type { PoolAugment } from "./scoring";

function augment(slug: string): PoolAugment {
  return {
    slug,
    name: slug,
    win_rate: 50,
    score: 0,
    tier: "B",
    rarity: "silver",
    probability: 0,
    probabilityWithReroll: 0,
  };
}

describe("gameflow OCR gate", () => {
  it("allows OCR only when the LCU reports live capture allowed", () => {
    expect(shouldRunOcrForGameflow({ liveCaptureAllowed: true })).toBe(true);
    expect(shouldRunOcrForGameflow({ liveCaptureAllowed: false })).toBe(false);
  });

  it("denies OCR when the LCU is unreachable or the read failed", () => {
    expect(shouldRunOcrForGameflow(null)).toBe(false);
    expect(shouldRunOcrForGameflow(undefined)).toBe(false);
  });

  it("clears game-only state exactly when live capture is not allowed", () => {
    expect(shouldClearOcrStateForGameflow({ liveCaptureAllowed: true })).toBe(false);
    expect(shouldClearOcrStateForGameflow({ liveCaptureAllowed: false })).toBe(true);
    expect(shouldClearOcrStateForGameflow(null)).toBe(true);
    expect(shouldClearOcrStateForGameflow(undefined)).toBe(true);
  });
});

describe("augment selection lifecycle", () => {
  it("does not stop before any cards were ever seen", () => {
    const next = advanceOcrSelection({ hasSeenCards: false, emptyPasses: 0 }, 0);
    expect(next.shouldStop).toBe(false);
    expect(next.hasSeenCards).toBe(false);
  });

  it("stops only after two consecutive empty passes once cards were seen", () => {
    const seen = advanceOcrSelection({ hasSeenCards: false, emptyPasses: 0 }, 3);
    expect(seen).toEqual({ hasSeenCards: true, emptyPasses: 0, shouldStop: false });

    const firstGap = advanceOcrSelection(seen, 0);
    expect(firstGap.shouldStop).toBe(false);

    const secondGap = advanceOcrSelection(firstGap, 0);
    expect(secondGap.shouldStop).toBe(true);
  });

  it("treats a reroll gap as transient: reappearing cards reset the empty counter", () => {
    const seen = advanceOcrSelection({ hasSeenCards: false, emptyPasses: 0 }, 3);
    const gap = advanceOcrSelection(seen, 0);
    const rerolled = advanceOcrSelection(gap, 3);

    expect(rerolled).toEqual({ hasSeenCards: true, emptyPasses: 0, shouldStop: false });
  });

  it("ends selection when the player levels past the augment threshold", () => {
    expect(
      shouldEndAugmentSelectionForLevel({ playerLevel: 4, lastAugmentLevel: 3 }),
    ).toBe(true);
    expect(
      shouldEndAugmentSelectionForLevel({ playerLevel: 3, lastAugmentLevel: 3 }),
    ).toBe(false);
    expect(
      shouldEndAugmentSelectionForLevel({ playerLevel: 2, lastAugmentLevel: 0 }),
    ).toBe(false);
  });
});

describe("matched offer integrity", () => {
  it("accepts only three distinct augments across the three card regions", () => {
    const complete = [0, 1, 2].map((region) => ({
      augment: augment(`augment-${region}`),
      regionIndex: region,
    }));
    expect(isCompleteThreeCardOffer(complete)).toBe(true);
  });

  it("rejects partial, duplicated, or misaligned offers", () => {
    const cards = [0, 1, 2].map((region) => ({
      augment: augment(`augment-${region}`),
      regionIndex: region,
    }));

    expect(isCompleteThreeCardOffer(cards.slice(0, 2))).toBe(false);
    expect(
      isCompleteThreeCardOffer([
        cards[0],
        { ...cards[1], augment: augment("augment-0") },
        cards[2],
      ]),
    ).toBe(false);
    expect(
      isCompleteThreeCardOffer([cards[0], cards[1], { ...cards[2], regionIndex: 1 }]),
    ).toBe(false);
  });

  it("drops unmatched OCR text and orders matches by card region", () => {
    const lookup = new Map<string, PoolAugment>([
      ["known-a", augment("known-a")],
      ["known-b", augment("known-b")],
    ]);
    const detected: DetectedAugmentText[] = [
      { text: "known-b", region_index: 2 },
      { text: "garbage", region_index: 1 },
      { text: "known-a", region_index: 0 },
    ];

    const matched = matchAugmentFrame(
      detected,
      lookup,
      (text, table) => table.get(text) ?? null,
    );

    expect(matched.map((card) => card.augment.slug)).toEqual(["known-a", "known-b"]);
    expect(matched.map((card) => card.regionIndex)).toEqual([0, 2]);
  });
});
