import { describe, expect, it } from "vitest";
import {
  augmentRoundForLevel,
  isCompleteThreeCardOffer,
  ocrRunIsCurrent,
  shouldClearOcrStateForGameflow,
} from "./augmentSelection";
import { resolveRoundDelivery } from "./roundDelivery";

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
    // every badge. Level only feeds ELIGIBILITY — a level gained mid-offer
    // keeps the latched offer scanning at full speed and never signals
    // completion (there is no level-derived completion input at all).
    for (const playerLevel of [4, 5, 6, 7, 11, 15]) {
      const decision = resolveRoundDelivery({
        playerLevel,
        isDead: false,
        completedRounds: 0,
        offerLatched: true,
      });
      expect(decision.scanMode).toBe("fast");
    }
  });

  it("reaching a threshold while alive only updates eligibility, never delivery", () => {
    // Levels 7/11/15 crossed alive: rounds become pending but no fast scan
    // window opens and nothing is consumed — delivery happens on death
    // (roundDelivery.test.ts covers the full matrix).
    const decision = resolveRoundDelivery({
      playerLevel: 11,
      isDead: false,
      completedRounds: 1,
      offerLatched: false,
    });
    expect(decision.eligibleRounds).toBe(3);
    expect(decision.pendingRounds).toBe(2);
    expect(decision.scanMode).toBe("ambient");
  });

  it("maps levels onto augment rounds", () => {
    expect(augmentRoundForLevel(2)).toBeNull();
    expect(augmentRoundForLevel(6)).toEqual({ round: 1, level: 3 });
    expect(augmentRoundForLevel(12)).toEqual({ round: 3, level: 11 });
    expect(augmentRoundForLevel(18)).toEqual({ round: 4, level: 15 });
  });
});
