import { describe, expect, it } from "vitest";
import {
  advanceOcrSelection,
  augmentRoundForLevel,
  isCompleteThreeCardOffer,
  ocrRunIsCurrent,
  shouldClearOcrStateForGameflow,
  transitionAugmentRound,
} from "./augmentSelection";

describe("augment OCR lifecycle", () => {
  it("keeps a fresh run eligible after an older run is cancelled", () => {
    expect(ocrRunIsCurrent({ active: false, currentRunId: 8, runId: 7 })).toBe(false);
    expect(ocrRunIsCurrent({ active: true, currentRunId: 8, runId: 7 })).toBe(false);
    expect(ocrRunIsCurrent({ active: true, currentRunId: 8, runId: 8 })).toBe(true);
  });

  it("does not erase a round on a transient missing gameflow response", () => {
    expect(shouldClearOcrStateForGameflow(null)).toBe(false);
    expect(shouldClearOcrStateForGameflow({ liveCaptureAllowed: false })).toBe(true);
  });

  it("does not stop after an initial empty capture and stops only after a seen offer disappears", () => {
    const initial = advanceOcrSelection(
      { hasSeenCards: false, emptyPasses: 0 },
      0,
    );
    expect(initial.shouldStop).toBe(false);

    const seen = advanceOcrSelection(
      { hasSeenCards: initial.hasSeenCards, emptyPasses: initial.emptyPasses },
      3,
    );
    expect(seen.hasSeenCards).toBe(true);
    expect(seen.shouldStop).toBe(false);

    const stale = advanceOcrSelection(
      { hasSeenCards: seen.hasSeenCards, emptyPasses: seen.emptyPasses },
      0,
    );
    expect(stale.shouldStop).toBe(false);
  });

  it("requires one fresh atomic offer across all three regions", () => {
    expect(
      isCompleteThreeCardOffer([
        { regionIndex: 0, augment: { slug: "a" } },
        { regionIndex: 1, augment: { slug: "b" } },
        { regionIndex: 2, augment: { slug: "c" } },
      ]),
    ).toBe(true);
    expect(
      isCompleteThreeCardOffer([
        { regionIndex: 0, augment: { slug: "a" } },
        { regionIndex: 1, augment: { slug: "b" } },
      ]),
    ).toBe(false);
    expect(
      isCompleteThreeCardOffer([
        { regionIndex: 0, augment: { slug: "a" } },
        { regionIndex: 1, augment: { slug: "a" } },
        { regionIndex: 2, augment: { slug: "c" } },
      ]),
    ).toBe(false);
  });

  it("restarts OCR for R2 after R1 selection completes", () => {
    const r1 = transitionAugmentRound({
      playerLevel: 3,
      lastAugmentLevel: 0,
      phase: "in_game",
    });
    expect(r1).toMatchObject({
      round: { round: 1, level: 3 },
      isNewRound: true,
      nextPhase: "augment_selection",
    });

    const afterSelection = transitionAugmentRound({
      playerLevel: 4,
      lastAugmentLevel: r1.round!.level,
      phase: "augment_selection",
    });
    expect(afterSelection).toMatchObject({
      selectionComplete: true,
      nextPhase: "in_game",
    });

    const r2 = transitionAugmentRound({
      playerLevel: 7,
      lastAugmentLevel: r1.round!.level,
      phase: "in_game",
    });
    expect(r2).toMatchObject({
      round: { round: 2, level: 7 },
      isNewRound: true,
      selectionComplete: false,
      nextPhase: "augment_selection",
    });
  });

  it("restarts OCR for R3 after R2 selection completes", () => {
    expect(augmentRoundForLevel(6)).toEqual({ round: 1, level: 3 });
    expect(augmentRoundForLevel(12)).toEqual({ round: 3, level: 11 });

    const afterR2 = transitionAugmentRound({
      playerLevel: 8,
      lastAugmentLevel: 7,
      phase: "augment_selection",
    });
    expect(afterR2.nextPhase).toBe("in_game");

    const r3 = transitionAugmentRound({
      playerLevel: 11,
      lastAugmentLevel: 7,
      phase: afterR2.nextPhase,
    });
    expect(r3).toMatchObject({
      round: { round: 3, level: 11 },
      isNewRound: true,
      nextPhase: "augment_selection",
    });
  });
});
