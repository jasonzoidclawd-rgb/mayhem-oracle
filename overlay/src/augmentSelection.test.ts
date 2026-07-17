import { describe, expect, it } from "vitest";
import {
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

  it("never ends an open selection because the champion leveled up", () => {
    // Reported defect: level 3 → 4 while the R1 offer was still open cleared
    // every badge. Level is a round-boundary trigger ONLY — a level gained
    // mid-offer must keep phase and never signal completion.
    const midOffer = transitionAugmentRound({
      playerLevel: 4,
      lastAugmentLevel: 3,
      phase: "augment_selection",
    });
    expect(midOffer.isNewRound).toBe(false);
    expect(midOffer.nextPhase).toBe("augment_selection");
    expect("selectionComplete" in midOffer).toBe(false);

    // Several levels gained during one open offer (4, 5, 6) — same result.
    for (const playerLevel of [4, 5, 6]) {
      const transition = transitionAugmentRound({
        playerLevel,
        lastAugmentLevel: 3,
        phase: "augment_selection",
      });
      expect(transition.isNewRound).toBe(false);
      expect(transition.nextPhase).toBe("augment_selection");
    }
  });

  it("starts R1 at level 3 and R2 at level 7 as new-round boundaries", () => {
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

    const r2 = transitionAugmentRound({
      playerLevel: 7,
      lastAugmentLevel: r1.round!.level,
      phase: "in_game",
    });
    expect(r2).toMatchObject({
      round: { round: 2, level: 7 },
      isNewRound: true,
      nextPhase: "augment_selection",
    });
  });

  it("crosses a round boundary even while the previous offer is still open", () => {
    // If the player somehow levels straight across the next threshold while an
    // offer is displayed, the boundary still wins: a NEW round begins and the
    // stale offer is replaced by the new-round reset.
    const r3 = transitionAugmentRound({
      playerLevel: 11,
      lastAugmentLevel: 7,
      phase: "augment_selection",
    });
    expect(r3).toMatchObject({
      round: { round: 3, level: 11 },
      isNewRound: true,
      nextPhase: "augment_selection",
    });
  });

  it("maps levels onto augment rounds", () => {
    expect(augmentRoundForLevel(2)).toBeNull();
    expect(augmentRoundForLevel(6)).toEqual({ round: 1, level: 3 });
    expect(augmentRoundForLevel(12)).toEqual({ round: 3, level: 11 });
    expect(augmentRoundForLevel(18)).toEqual({ round: 4, level: 15 });
  });
});
