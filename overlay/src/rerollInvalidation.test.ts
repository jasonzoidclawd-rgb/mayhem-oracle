/**
 * PHASE B — atomic per-slot reroll invalidation.
 *
 * On the first completed geometry observation whose slot fingerprint changed,
 * ONLY that slot's generation increments, ONLY its identity is invalidated
 * (→ SCANNING), neighbours are retained, and any OCR run stamped with the old
 * slot generation is rejected. Fixes the stale 牙仙 chip lingering over the new
 * 不可通行 card.
 */
import { describe, expect, it } from "vitest";
import { applyRerollInvalidation, ocrRunSuperseded } from "./rerollInvalidation";
import type { GeometryObservation, IdentityRecord } from "./surfaceGeometry";

// 144-char average-hash bitstrings; ">8" bits apart = a different card (reroll).
const FP_A = "1".repeat(72) + "0".repeat(72);
const FP_B = "0".repeat(72) + "1".repeat(72); // 144 bits differ from A → reroll
const FP_C = "1".repeat(36) + "0".repeat(36) + "1".repeat(36) + "0".repeat(36);
const FP_A_DRIFT = "1".repeat(71) + "0" + "0".repeat(72); // 1 bit from A → same card
const drift = (bits: number) => "0".repeat(bits) + FP_A.slice(bits);

function card(regionIndex: number, fingerprint: string, present = true) {
  return {
    regionIndex,
    present,
    cardRect: present ? { x: regionIndex * 100, y: 0, width: 80, height: 30 } : null,
    interiorLuma: 0,
    interiorStd: 0,
    frameContrast: 0,
    edgeEnergy: 0,
    structuralScore: 0,
    fingerprint,
  };
}

function observation(fingerprints: [string, string, string]): GeometryObservation {
  return {
    probeSeq: 1,
    capturedAt: 0,
    captureWidth: 1920,
    captureHeight: 1080,
    present: true,
    occluded: false,
    confidence: 1,
    cards: [card(0, fingerprints[0]), card(1, fingerprints[1]), card(2, fingerprints[2])],
    rejectionReasons: [],
    preCaptureMs: 0,
    captureMs: 0,
    analysisMs: 0,
    elapsedMs: 0,
  };
}

function resolved(fingerprint: string, augmentId: string): IdentityRecord<string> {
  return { fingerprint, resolution: `id:${augmentId}`, resolvedAt: 100, championGeneration: 1, augmentId };
}

const CHAMP_GEN = 1;

describe("applyRerollInvalidation — only the changed slot is invalidated", () => {
  it("invalidates the LEFT slot only on a left reroll", () => {
    const store = [resolved(FP_A, "1006"), resolved(FP_B, "1007"), resolved(FP_C, "1008")];
    const r = applyRerollInvalidation({
      store,
      slotGenerations: [3, 3, 3],
      observation: observation([FP_A_DRIFT === FP_A ? FP_B : FP_C, FP_B, FP_C]), // left changed to FP_C
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(r.invalidated).toEqual([0]);
    expect(r.store[0]).toBeNull(); // old identity gone → SCANNING
    expect(r.slotGenerations).toEqual([4, 3, 3]); // only slot 0 bumped
    expect(r.store[1]).toBe(store[1]); // neighbours retained by reference
    expect(r.store[2]).toBe(store[2]);
  });

  it("invalidates the MIDDLE slot only on a middle reroll", () => {
    const store = [resolved(FP_A, "1006"), resolved(FP_B, "1007"), resolved(FP_C, "1008")];
    const r = applyRerollInvalidation({
      store,
      slotGenerations: [3, 3, 3],
      observation: observation([FP_A, FP_C, FP_C]), // middle FP_B → FP_C
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(r.invalidated).toEqual([1]);
    expect(r.store[1]).toBeNull();
    expect(r.slotGenerations).toEqual([3, 4, 3]);
    expect(r.store[0]).toBe(store[0]);
    expect(r.store[2]).toBe(store[2]);
  });

  it("invalidates the RIGHT slot only on a right reroll", () => {
    const store = [resolved(FP_A, "1006"), resolved(FP_B, "1007"), resolved(FP_C, "1008")];
    const r = applyRerollInvalidation({
      store,
      slotGenerations: [3, 3, 3],
      observation: observation([FP_A, FP_B, FP_A]), // right FP_C → FP_A
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(r.invalidated).toEqual([2]);
    expect(r.store[2]).toBeNull();
    expect(r.slotGenerations).toEqual([3, 3, 4]);
  });

  it("does not invalidate on sub-threshold sparkle drift", () => {
    const store = [resolved(FP_A, "1006"), resolved(FP_B, "1007"), resolved(FP_C, "1008")];
    const r = applyRerollInvalidation({
      store,
      slotGenerations: [3, 3, 3],
      observation: observation([FP_A_DRIFT, FP_B, FP_C]), // 1-bit drift on slot 0
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(r.invalidated).toEqual([]);
    expect(r.store[0]).toBe(store[0]); // same card, identity retained
    expect(r.slotGenerations).toEqual([3, 3, 3]);
  });

  it("leaves an absent slot untouched (absence is not a reroll)", () => {
    const store = [resolved(FP_A, "1006"), resolved(FP_B, "1007"), resolved(FP_C, "1008")];
    const obs = observation([FP_A, FP_B, FP_C]);
    obs.cards[1] = card(1, "", false); // middle momentarily not present
    const r = applyRerollInvalidation({
      store,
      slotGenerations: [3, 3, 3],
      observation: obs,
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(r.invalidated).toEqual([]);
    expect(r.store[1]).toBe(store[1]);
  });

  it("bumps an unresolved slot when its accepted fingerprint rerolls during OCR", () => {
    const r = applyRerollInvalidation({
      store: [null, resolved(FP_B, "1007"), resolved(FP_C, "1008")],
      acceptedFingerprints: [FP_A, FP_B, FP_C],
      slotGenerations: [3, 3, 3],
      observation: observation([FP_C, FP_B, FP_C]),
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(r.invalidated).toEqual([0]);
    expect(r.slotGenerations).toEqual([4, 3, 3]);
  });

  it("invalidates two changed slots atomically", () => {
    const store = [resolved(FP_A, "1006"), resolved(FP_B, "1007"), resolved(FP_C, "1008")];
    const r = applyRerollInvalidation({
      store,
      acceptedFingerprints: [FP_A, FP_B, FP_C],
      slotGenerations: [3, 3, 3],
      observation: observation([FP_C, FP_B, FP_A]),
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(r.invalidated).toEqual([0, 2]);
    expect(r.slotGenerations).toEqual([4, 3, 4]);
    expect(r.store).toEqual([null, store[1], null]);
  });

  it("a new chained offer invalidates all slots even when fingerprints look the same", () => {
    const store = [resolved(FP_A, "1006"), resolved(FP_B, "1007"), resolved(FP_C, "1008")];
    const r = applyRerollInvalidation({
      store,
      acceptedFingerprints: [FP_A, FP_B, FP_C],
      slotGenerations: [3, 3, 3],
      observation: observation([FP_A, FP_B, FP_C]),
      championGeneration: CHAMP_GEN,
      now: 500,
      newOffer: true,
    });
    expect(r.invalidated).toEqual([0, 1, 2]);
    expect(r.slotGenerations).toEqual([4, 4, 4]);
    expect(r.store).toEqual([null, null, null]);
  });

  it("locks the Hamming boundary: 8 bits is sparkle, 9 bits is a reroll", () => {
    const base = [resolved(FP_A, "1006"), resolved(FP_B, "1007"), resolved(FP_C, "1008")];
    const same = applyRerollInvalidation({
      store: base,
      acceptedFingerprints: [FP_A, FP_B, FP_C],
      slotGenerations: [3, 3, 3],
      observation: observation([drift(8), FP_B, FP_C]),
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    const changed = applyRerollInvalidation({
      store: base,
      acceptedFingerprints: [FP_A, FP_B, FP_C],
      slotGenerations: [3, 3, 3],
      observation: observation([drift(9), FP_B, FP_C]),
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(same.invalidated).toEqual([]);
    expect(changed.invalidated).toEqual([0]);
  });
});

describe("ocrRunSuperseded — a reroll during OCR rejects the stale run", () => {
  it("rejects an OCR result whose slot generation is behind current", () => {
    expect(ocrRunSuperseded(3, 4)).toBe(true);
  });
  it("accepts an OCR result whose slot generation still matches", () => {
    expect(ocrRunSuperseded(4, 4)).toBe(false);
  });
});
