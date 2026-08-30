import { describe, expect, it } from "vitest";

import { deriveSlotStatPresentation } from "./slotStatPresentation";
import type { PoolAugment } from "./scoring/probability";
import type { AramggStat, RiotTitleResolution } from "./dev/aramggSource";

/**
 * ONE authority for what a badge chip shows.
 *
 * The live acceptance run (2026-08-30) logged 38 `displayedStatText`
 * percentages that were never on screen: the diagnostic recomputed them from
 * `pool.win_rate` while every one of those slots was in `champion-loading`
 * and the renderer was painting LOADING DATA with no percentage at all. The
 * trace must be derived from the same decision the renderer makes, never from
 * a second, independent computation.
 */

const riot = { augmentId: "1133" } as unknown as RiotTitleResolution;

function pool(overrides: Partial<PoolAugment> = {}): PoolAugment {
  return {
    slug: "tank-engine",
    name: "Tank Engine",
    win_rate: 58.36,
    score: 1,
    tier: "A",
    rarity: "gold",
    probability: 0,
    probabilityWithReroll: 0,
    ...overrides,
  } as PoolAugment;
}

function championStat(overrides: Partial<AramggStat> = {}): AramggStat {
  return {
    augmentId: "1133",
    rawWinRate: "0.591500",
    winRatePercent: "59.1500",
    numGames: "1200",
    pickRate: "0.1",
    tier: 1,
    tierLetter: "S",
    grade: "S",
    provenance: "champion",
    championId: "126",
    championRank: "3",
    topChampionsById: new Map(),
    ...overrides,
  } as AramggStat;
}

describe("deriveSlotStatPresentation", () => {
  it("shows no percentage while the champion dataset is loading", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: { pool: pool(), aramgg: { kind: "loading", riot, localSlug: "tank-engine" } },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.state).toBe("loading-data");
    expect(presentation.winRateText).toBeNull();
    expect(presentation.statKind).toBe("missing");
    expect(presentation.provenance).toBeNull();
  });

  it("shows no percentage on a champion dataset fetch error", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: { pool: pool(), aramgg: { kind: "error", riot, localSlug: "tank-engine" } },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.state).toBe("data-error");
    expect(presentation.winRateText).toBeNull();
    expect(presentation.statKind).toBe("missing");
  });

  it("shows no percentage when the complete champion dataset has no row", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: { pool: pool(), aramgg: { kind: "no-data", riot, localSlug: "tank-engine" } },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.state).toBe("no-data");
    expect(presentation.winRateText).toBeNull();
    expect(presentation.noDataVerified).toBe(true);
    expect(presentation.statKind).toBe("missing");
  });

  it("renders the matched ARAMGG row from its raw fraction", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: {
        pool: pool(),
        aramgg: { kind: "matched", riot, stat: championStat(), localSlug: "tank-engine" },
      },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.state).toBe("tier");
    expect(presentation.tier).toBe("S");
    // "0.591500" → 59.15 → half-up one decimal. NOT the pool's 58.36.
    expect(presentation.winRateText).toBe("59.2%");
    expect(presentation.statKind).toBe("observed");
    expect(presentation.provenance).toBe("champion");
    expect(presentation.statScope).toBe("champion");
  });

  it("shows no percentage when a matched ARAMGG row carries an unusable win rate", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: {
        pool: pool(),
        aramgg: {
          kind: "matched",
          riot,
          stat: championStat({ rawWinRate: "" }),
          localSlug: "tank-engine",
        },
      },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.winRateText).toBeNull();
    expect(presentation.statKind).toBe("missing");
  });

  it("never lets a global-provenance stat reach the chip as champion scope", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: {
        pool: pool(),
        aramgg: {
          kind: "matched",
          riot,
          stat: championStat({ provenance: "global", championId: null }),
          localSlug: "tank-engine",
        },
      },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.statScope).toBeNull();
    expect(presentation.provenance).toBeNull();
  });

  it("shows no percentage for an unresolved Riot identity", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: {
        pool: pool(),
        aramgg: { kind: "unmatched", rejection: { stage: "riot", reason: "no-match" } as never },
      },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.state).toBe("unmatched");
    expect(presentation.winRateText).toBeNull();
    expect(presentation.failureCategory).toBe("FAIL_IDENTITY");
  });

  it("shows no percentage while a slot is still scanning", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: null,
      unresolvedState: "scanning",
      candidate: null,
    });

    expect(presentation.state).toBe("scanning");
    expect(presentation.winRateText).toBeNull();
    expect(presentation.statKind).toBe("missing");
  });

  it("carries the engine path's catalog percentage when no ARAMGG stage exists", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: { pool: pool(), aramgg: null },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.state).toBe("tier");
    expect(presentation.winRateText).toBe("58.4%");
    expect(presentation.statKind).toBe("observed");
    // The engine path is catalog-global: it is NEVER champion-scoped.
    expect(presentation.statScope).toBeNull();
    expect(presentation.provenance).toBeNull();
  });

  it("shows no percentage on the engine path when the catalog win rate is null", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: { pool: pool({ win_rate: null }), aramgg: null },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.winRateText).toBeNull();
    expect(presentation.statKind).toBe("missing");
  });

  it("shows no percentage when neither a pool match nor an ARAMGG stage exists", () => {
    const presentation = deriveSlotStatPresentation({
      resolution: { pool: null, aramgg: null },
      unresolvedState: undefined,
      candidate: null,
    });

    expect(presentation.state).toBe("unmatched");
    expect(presentation.winRateText).toBeNull();
    expect(presentation.statKind).toBe("missing");
  });
});
