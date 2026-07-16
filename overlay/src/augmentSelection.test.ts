import { describe, expect, it } from "vitest";
import {
  advanceOcrSelection,
  isCompleteThreeCardOffer,
  ocrRunIsCurrent,
} from "./augmentSelection";

describe("augment OCR lifecycle", () => {
  it("keeps a fresh run eligible after an older run is cancelled", () => {
    expect(ocrRunIsCurrent({ active: false, currentRunId: 8, runId: 7 })).toBe(false);
    expect(ocrRunIsCurrent({ active: true, currentRunId: 8, runId: 7 })).toBe(false);
    expect(ocrRunIsCurrent({ active: true, currentRunId: 8, runId: 8 })).toBe(true);
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
});
