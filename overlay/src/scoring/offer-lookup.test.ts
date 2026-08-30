import { describe, expect, it } from "vitest";
import {
  buildOverlayAugmentLookup,
  diagnoseAugmentMatch,
  normalizeAugmentNameForLookup,
  type OverlayAugmentLookup,
} from "./offer-lookup";
import type { ScoredAugment } from "./oracle-score";
import { compactWinRateFromPercent } from "../winRateFormat";
import type { PoolAugment } from "./probability";

function augment(overrides: Partial<PoolAugment> = {}): PoolAugment {
  return {
    slug: "arcane-comet",
    name: "Arcane Comet",
    win_rate: 55,
    score: 60,
    tier: "B",
    rarity: "gold",
    probability: 0.2,
    probabilityWithReroll: 0.4,
    ...overrides,
  };
}

describe("OCR match diagnostics", () => {
  it("reports an exact accepted match", () => {
    const candidate = augment();
    const lookup: OverlayAugmentLookup = new Map([[
      "arcanecomet",
      candidate,
    ]]);

    expect(diagnoseAugmentMatch("Arcane Comet", lookup)).toEqual({
      augment: candidate,
      normalizedText: "arcanecomet",
      bestCandidate: "arcane-comet",
      confidence: 1,
      rejectionReason: null,
    });
  });

  it("reports normalization and the rejection reason for empty OCR", () => {
    const result = diagnoseAugmentMatch(" : ! ", new Map());

    expect(result.normalizedText).toBe("");
    expect(result.bestCandidate).toBeNull();
    expect(result.rejectionReason).toBe("empty-after-normalization");
  });

  it("reports the nearest candidate when OCR text is rejected", () => {
    const lookup: OverlayAugmentLookup = new Map([[
      "arcanecomet",
      augment(),
    ]]);

    const result = diagnoseAugmentMatch("zz", lookup);

    expect(result.augment).toBeNull();
    expect(result.bestCandidate).toBe("arcane-comet");
    expect(result.confidence).toBeCloseTo(1 / 12);
    expect(result.rejectionReason).toMatch(/^distance-11-exceeds-threshold-1$/);
  });
});

// ─── Win-rate provenance: missing must stay missing ───
//
// The catalog carries `win_rate: null` for every augment with no observed
// sample (148 of 268 rows in data/internal/augments.json). A null coerced to
// the NUMBER 50 is indistinguishable downstream from a genuine observed 50.0 —
// `en-passant` really does sit at 50.0 — so the coercion destroys the only
// signal that separates "no data" from "measured dead even". These cases pin
// the seam at `buildOverlayAugmentLookup` (where the PoolAugment is built) AND
// at the display boundary that formats it.

function scored(overrides: Partial<ScoredAugment> = {}): ScoredAugment {
  return {
    slug: "test-augment",
    name: "Test Augment",
    rarity: "gold",
    win_rate: null,
    icon: "",
    ...overrides,
  };
}

function poolAugmentFor(augment: ScoredAugment): PoolAugment {
  const lookup = buildOverlayAugmentLookup({
    allAugments: [augment],
    poolData: null,
  });
  const entry = lookup.get(normalizeAugmentNameForLookup(augment.name));
  if (!entry) throw new Error(`no lookup entry for ${augment.name}`);
  return entry;
}

describe("win-rate provenance through buildOverlayAugmentLookup", () => {
  it("keeps a missing win rate missing and never formats it as 50.0%", () => {
    const entry = poolAugmentFor(scored({ win_rate: null }));

    expect(entry.win_rate).toBeNull();
    expect(compactWinRateFromPercent(entry.win_rate)).toBeNull();
    expect(compactWinRateFromPercent(entry.win_rate)).not.toBe("50.0%");
  });

  it("preserves a genuine observed 50 as 50.0%", () => {
    const entry = poolAugmentFor(scored({ win_rate: 50 }));

    expect(entry.win_rate).toBe(50);
    expect(compactWinRateFromPercent(entry.win_rate)).toBe("50.0%");
  });

  it("distinguishes a missing win rate from a genuine 50", () => {
    const missing = poolAugmentFor(scored({ slug: "a", name: "Missing", win_rate: null }));
    const observed = poolAugmentFor(scored({ slug: "b", name: "Observed", win_rate: 50 }));

    expect(missing.win_rate).not.toBe(observed.win_rate);
    expect(compactWinRateFromPercent(missing.win_rate)).toBeNull();
    expect(compactWinRateFromPercent(observed.win_rate)).toBe("50.0%");
  });

  it.each([
    [49.59, "49.6%"],
    [51.7, "51.7%"],
    [54.02, "54.0%"],
  ])("carries observed %s through to %s unchanged", (winRate, expected) => {
    const entry = poolAugmentFor(scored({ win_rate: winRate }));

    expect(entry.win_rate).toBe(winRate);
    expect(compactWinRateFromPercent(entry.win_rate)).toBe(expected);
  });
});
