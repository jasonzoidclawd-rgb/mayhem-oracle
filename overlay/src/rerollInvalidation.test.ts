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
const FP_D = "1".repeat(48) + "0".repeat(48) + "1".repeat(48); // distinct new card
const FP_E = "0".repeat(48) + "1".repeat(48) + "0".repeat(48); // distinct new card
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

// Failure C — a single-slot reroll must never mutate neighbour state, whatever
// state those neighbours are in. A left reroll while middle is OCR ERROR and
// right is resolved leaves middle and right byte-for-byte untouched.
describe("applyRerollInvalidation — mixed per-slot states survive a single reroll", () => {
  it("left reroll preserves a middle OCR ERROR and a resolved right", () => {
    const middleError: IdentityRecord<string> = {
      fingerprint: FP_B,
      resolution: null,
      resolvedAt: 100,
      championGeneration: 1,
      augmentId: "",
      unresolvedState: "ocr-error",
      failureCount: 3,
    };
    const store = [resolved(FP_A, "1006"), middleError, resolved(FP_C, "1008")];
    const r = applyRerollInvalidation({
      store,
      acceptedFingerprints: [FP_A, FP_B, FP_C],
      slotGenerations: [3, 3, 3],
      observation: observation([FP_C, FP_B, FP_C]), // ONLY left changed (A → C)
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(r.invalidated).toEqual([0]);
    expect(r.store[0]).toBeNull(); // left → SCANNING
    expect(r.slotGenerations).toEqual([4, 3, 3]);
    // middle stays OCR ERROR, right stays resolved — same object references.
    expect(r.store[1]).toBe(middleError);
    expect(r.store[1]?.unresolvedState).toBe("ocr-error");
    expect(r.store[2]).toBe(store[2]);
    expect(r.store[2]?.resolution).toBe("id:1008");
  });
});

// FIX 3 — when an accepted frame changes MULTIPLE slots, EVERY changed slot is
// invalidated atomically from the immutable previous snapshot; only truly
// unchanged neighbours are retained. The live 00:14:55 frame (left unchanged,
// middle+right changed) must never keep an old statistic over a new card.
describe("applyRerollInvalidation — every changed slot invalidates atomically", () => {
  const base = () => [resolved(FP_A, "1006"), resolved(FP_B, "1007"), resolved(FP_C, "1008")];
  const run = (next: [string, string, string]) =>
    applyRerollInvalidation({
      store: base(),
      acceptedFingerprints: [FP_A, FP_B, FP_C],
      slotGenerations: [5, 5, 5],
      observation: observation(next),
      championGeneration: CHAMP_GEN,
      now: 500,
    });

  it("00:14:55 repro — left unchanged, middle+right changed → both new slots SCANNING", () => {
    const r = run([FP_A, FP_D, FP_E]);
    expect(r.invalidated).toEqual([1, 2]);
    expect(r.store[0]?.resolution).toBe("id:1006"); // left retains A
    expect(r.store[1]).toBeNull(); // middle → SCANNING, no old B stat over D
    expect(r.store[2]).toBeNull(); // right → SCANNING, no old C stat over E
    expect(r.slotGenerations).toEqual([5, 6, 6]);
    expect(r.acceptedFingerprints).toEqual([FP_A, FP_D, FP_E]);
  });

  it("all three changed simultaneously → all three SCANNING", () => {
    const r = run([FP_D, FP_E, FP_A]); // each differs from prev A/B/C by >8 bits
    expect(r.invalidated).toEqual([0, 1, 2]);
    expect(r.store).toEqual([null, null, null]);
    expect(r.slotGenerations).toEqual([6, 6, 6]);
  });

  it("left+middle changed → right retained", () => {
    const r = run([FP_D, FP_E, FP_C]);
    expect(r.invalidated).toEqual([0, 1]);
    expect(r.store[2]?.resolution).toBe("id:1008");
    expect(r.slotGenerations).toEqual([6, 6, 5]);
  });

  it("middle+right changed → left retained", () => {
    const r = run([FP_A, FP_D, FP_E]);
    expect(r.invalidated).toEqual([1, 2]);
    expect(r.store[0]?.resolution).toBe("id:1006");
  });

  it("left+right changed → middle retained", () => {
    const r = run([FP_D, FP_B, FP_E]);
    expect(r.invalidated).toEqual([0, 2]);
    expect(r.store[1]?.resolution).toBe("id:1007");
    expect(r.slotGenerations).toEqual([6, 5, 6]);
  });

  it("one slot changes while another is OCR ERROR → error neighbour untouched", () => {
    const middleError: IdentityRecord<string> = {
      fingerprint: FP_B, resolution: null, resolvedAt: 100, championGeneration: 1,
      augmentId: "", unresolvedState: "ocr-error", failureCount: 3,
    };
    const r = applyRerollInvalidation({
      store: [resolved(FP_A, "1006"), middleError, resolved(FP_C, "1008")],
      acceptedFingerprints: [FP_A, FP_B, FP_C],
      slotGenerations: [5, 5, 5],
      observation: observation([FP_A, FP_B, FP_E]), // only right changed
      championGeneration: CHAMP_GEN,
      now: 500,
    });
    expect(r.invalidated).toEqual([2]);
    expect(r.store[1]).toBe(middleError); // OCR ERROR preserved
    expect(r.store[1]?.unresolvedState).toBe("ocr-error");
    expect(r.store[0]?.resolution).toBe("id:1006");
  });

  it("stale OCR from every replaced slot is rejected by its bumped generation", () => {
    const r = run([FP_D, FP_E, FP_C]); // left+middle replaced, slotGen 5→6
    // An OCR run stamped with the pre-reroll generation (5) for a replaced slot
    // must be discarded; the unchanged right (still gen 5) is still accepted.
    expect(ocrRunSuperseded(5, r.slotGenerations[0])).toBe(true);
    expect(ocrRunSuperseded(5, r.slotGenerations[1])).toBe(true);
    expect(ocrRunSuperseded(5, r.slotGenerations[2])).toBe(false);
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
