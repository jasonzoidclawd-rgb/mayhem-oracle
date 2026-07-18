import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGeometryVisibleFrame,
  emptyGeometryObservation,
  fingerprintChanged,
  geometryFrameFresh,
  GEOMETRY_FRESHNESS_TTL_MS,
  hammingDistance,
  identityForSlot,
  newOfferDetected,
  type GeometryCard,
  type GeometryObservation,
  type IdentityRecord,
} from "./surfaceGeometry";
import { visibleFrameRenderable } from "./visibleOfferFrame";

const FP_A = "1".repeat(72) + "0".repeat(72);
const FP_B = "0".repeat(72) + "1".repeat(72); // hamming 144 from FP_A
const FP_A_NUDGE = "0" + "1".repeat(71) + "0".repeat(72); // hamming 2 from FP_A

function card(i: number, present: boolean, fingerprint: string): GeometryCard {
  return {
    regionIndex: i,
    present,
    cardRect: present ? { x: 100 + i * 200, y: 250, width: 180, height: 60 } : null,
    interiorLuma: present ? 13 : 60,
    interiorStd: present ? 1 : 20,
    frameContrast: present ? 109 : 5,
    edgeEnergy: present ? 13 : 4,
    structuralScore: present ? 0.9 : 0,
    fingerprint,
  };
}

function obs(overrides: Partial<GeometryObservation> = {}): GeometryObservation {
  return {
    probeSeq: 1,
    capturedAt: 1000,
    captureWidth: 1280,
    captureHeight: 720,
    present: true,
    occluded: false,
    confidence: 0.9,
    cards: [card(0, true, FP_A), card(1, true, FP_B), card(2, true, FP_A_NUDGE)],
    rejectionReasons: [],
    elapsedMs: 40,
    ...overrides,
  };
}

describe("fingerprint comparison", () => {
  it("identical pixels hash to distance 0 and are unchanged", () => {
    expect(hammingDistance(FP_A, FP_A)).toBe(0);
    expect(fingerprintChanged(FP_A, FP_A)).toBe(false);
  });
  it("small nudges within tolerance are the same card", () => {
    expect(hammingDistance(FP_A, FP_A_NUDGE)).toBe(1);
    expect(fingerprintChanged(FP_A, FP_A_NUDGE)).toBe(false);
  });
  it("a real reroll (large hamming) is a change", () => {
    expect(fingerprintChanged(FP_A, FP_B)).toBe(true);
  });
  it("an empty fingerprint never matches a real one", () => {
    expect(fingerprintChanged("", FP_A)).toBe(true);
    expect(fingerprintChanged(FP_A, "")).toBe(true);
  });
});

describe("geometry freshness — decoupled from OCR duration", () => {
  it("a positive frame stays fresh within the geometry TTL", () => {
    expect(geometryFrameFresh(1000, 1000 + GEOMETRY_FRESHNESS_TTL_MS - 1)).toBe(true);
  });
  it("fails closed once the geometry capture ages past the TTL", () => {
    expect(geometryFrameFresh(1000, 1000 + GEOMETRY_FRESHNESS_TTL_MS + 1)).toBe(false);
    expect(geometryFrameFresh(null, 1000)).toBe(false);
  });
  it("stays renderable even when OCR has run far longer than 500 ms", () => {
    // OCR started at t=1000 and is STILL running at t=3000 (2 s). The geometry
    // probe refreshed capturedAt=2950 on its own cadence, so the frame is fresh
    // regardless of OCR — the exact fix for the blinking.
    const geoCapturedAt = 2950;
    expect(geometryFrameFresh(geoCapturedAt, 3000)).toBe(true);
  });

  it.each([250, 500, 1000, 2000])(
    "keeps a static offer renderable while OCR takes %d ms",
    (ocrDurationMs) => {
      for (let elapsed = 0; elapsed <= ocrDurationMs; elapsed += 150) {
        const observation = obs({ probeSeq: elapsed / 150 + 1, capturedAt: 1000 + elapsed });
        const frame = buildGeometryVisibleFrame({
          revision: elapsed / 150 + 1,
          captureSeq: observation.probeSeq,
          observation,
          generation: 1,
          resolveIdentity: () => null,
        });
        expect(visibleFrameRenderable(frame, true)).toBe(true);
        expect(geometryFrameFresh(frame.capturedAt, 1000 + elapsed + 149)).toBe(true);
        expect(frame.slots.every((slot) => slot.resolution === null)).toBe(true);
      }
    },
  );
});

describe("buildGeometryVisibleFrame — presence, occlusion, SCANNING", () => {
  const resolveAll = (i: number) => `id:${i}`;

  it("renders three slots for a present, unoccluded offer", () => {
    const frame = buildGeometryVisibleFrame({
      revision: 1,
      captureSeq: 1,
      observation: obs(),
      generation: 1,
      resolveIdentity: resolveAll,
    });
    expect(frame.surfaceValidated).toBe(true);
    expect(frame.slots).toHaveLength(3);
    expect(frame.slots.map((s) => s.resolution)).toEqual(["id:0", "id:1", "id:2"]);
    expect(visibleFrameRenderable(frame, true)).toBe(true);
  });

  it("renders SCANNING slots (rects, no identity) when 0/3 resolve — never hides", () => {
    // Geometry present + OCR pending/none: chips still exist (SCANNING), the
    // offer is NOT hidden merely because identities are unknown.
    const frame = buildGeometryVisibleFrame({
      revision: 1,
      captureSeq: 1,
      observation: obs(),
      generation: 1,
      resolveIdentity: () => null,
    });
    expect(frame.surfaceValidated).toBe(true);
    expect(frame.slots).toHaveLength(3);
    expect(frame.slots.every((s) => s.resolution === null)).toBe(true);
    expect(frame.slots.every((s) => s.cardRect !== null)).toBe(true);
  });

  it("keeps 100 identical geometry publications stable regardless of OCR outcome", () => {
    const expectedFingerprints = obs().cards.map((entry) => entry.fingerprint);
    for (let seq = 1; seq <= 100; seq += 1) {
      const observation = obs({ probeSeq: seq, capturedAt: seq * 150 });
      const frame = buildGeometryVisibleFrame({
        revision: seq,
        captureSeq: seq,
        observation,
        generation: 1,
        resolveIdentity: (regionIndex) =>
          seq < 34 ? null : seq < 67 ? `resolved-${regionIndex}` : null,
      });
      expect(observation.present).toBe(true);
      expect(observation.occluded).toBe(false);
      expect(observation.cards.map((entry) => entry.fingerprint)).toEqual(expectedFingerprints);
      expect(visibleFrameRenderable(frame, true)).toBe(true);
      expect(geometryFrameFresh(frame.capturedAt, frame.capturedAt + 149)).toBe(true);
    }
  });

  it("AFK modal → occluded → empty frame (zero chips)", () => {
    const frame = buildGeometryVisibleFrame({
      revision: 1,
      captureSeq: 1,
      observation: obs({ occluded: true, rejectionReasons: ["occluded-modal-panel"] }),
      generation: 1,
      resolveIdentity: resolveAll,
    });
    expect(frame.surfaceValidated).toBe(false);
    expect(frame.slots).toEqual([]);
    expect(visibleFrameRenderable(frame, true)).toBe(false);
  });

  it("a delayed successful OCR result cannot paint over an AFK modal", () => {
    const lateIdentities = ["late-left", "late-middle", "late-right"];
    const frame = buildGeometryVisibleFrame({
      revision: 2,
      captureSeq: 2,
      observation: obs({ occluded: true, rejectionReasons: ["occluded-modal-panel"] }),
      generation: 1,
      resolveIdentity: (regionIndex) => lateIdentities[regionIndex],
    });
    expect(frame.surfaceValidated).toBe(false);
    expect(frame.slots).toEqual([]);
    expect(visibleFrameRenderable(frame, true)).toBe(false);
  });

  it("absent surface (combat/scoreboard) → empty frame", () => {
    const frame = buildGeometryVisibleFrame({
      revision: 1,
      captureSeq: 1,
      observation: obs({
        present: false,
        cards: [card(0, false, ""), card(1, false, ""), card(2, false, "")],
      }),
      generation: 1,
      resolveIdentity: resolveAll,
    });
    expect(frame.surfaceValidated).toBe(false);
    expect(frame.slots).toEqual([]);
  });

  it("clears the offer on the next 150 ms negative probe and ignores stale identities", () => {
    const present = buildGeometryVisibleFrame({
      revision: 1,
      captureSeq: 1,
      observation: obs({ capturedAt: 1000 }),
      generation: 1,
      resolveIdentity: resolveAll,
    });
    expect(visibleFrameRenderable(present, true)).toBe(true);

    const closed = buildGeometryVisibleFrame({
      revision: 2,
      captureSeq: 2,
      observation: obs({
        probeSeq: 2,
        capturedAt: 1150,
        present: false,
        cards: [card(0, false, ""), card(1, false, ""), card(2, false, "")],
      }),
      generation: 1,
      resolveIdentity: resolveAll,
    });
    expect(closed.capturedAt - present.capturedAt).toBe(150);
    expect(closed.capturedAt - present.capturedAt).toBeLessThanOrEqual(250);
    expect(closed.slots).toEqual([]);
    expect(visibleFrameRenderable(closed, true)).toBe(false);
  });
});

describe("geometry/OCR capability separation", () => {
  it("does not gate the geometry scheduler on OCR availability", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source.indexOf("const geometryProbeTick")).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("const identityProbeTick")).toBeGreaterThan(
      source.indexOf("const geometryProbeTick"),
    );
    const geometryTick = source.slice(
      source.indexOf("const geometryProbeTick"),
      source.indexOf("const identityProbeTick"),
    );
    expect(geometryTick).not.toContain("canRunOcr");
  });
});

describe("identityForSlot — stale-result guard for identity", () => {
  const rec = (fingerprint: string, resolution: string | null, resolvedAt = 0): IdentityRecord<string> => ({
    fingerprint,
    resolution,
    resolvedAt,
  });

  it("returns the identity while the fingerprint still matches (identical pixels)", () => {
    expect(identityForSlot(rec(FP_A, "abc"), FP_A)).toBe("abc");
    expect(identityForSlot(rec(FP_A, "abc"), FP_A_NUDGE)).toBe("abc"); // within tolerance
  });

  it("drops to SCANNING when the slot was rerolled (fingerprint changed)", () => {
    expect(identityForSlot(rec(FP_A, "abc"), FP_B)).toBeNull();
  });

  it("a late OCR result keyed to an old fingerprint cannot paint the new card", () => {
    // Card rerolled A→B; the still-in-flight OCR from generation A resolves and
    // writes a record keyed to FP_A. The live card is FP_B, so identityForSlot
    // returns null — the stale identity never shows.
    const staleRecord = rec(FP_A, "old-augment");
    expect(identityForSlot(staleRecord, FP_B)).toBeNull();
  });

  it.each([0, 1, 2])(
    "invalidates only rerolled slot %d and rejects its late old result",
    (changedSlot) => {
      const liveFingerprints = [FP_A, FP_B, FP_A_NUDGE];
      const records = liveFingerprints.map((fingerprint, slot) =>
        rec(fingerprint, `identity-${slot}`),
      );
      const changedFingerprint = changedSlot === 1 ? FP_A : FP_B;
      liveFingerprints[changedSlot] = changedFingerprint;

      expect(
        records.map((record, slot) => identityForSlot(record, liveFingerprints[slot])),
      ).toEqual(
        [0, 1, 2].map((slot) => slot === changedSlot ? null : `identity-${slot}`),
      );
      expect(identityForSlot(records[changedSlot], changedFingerprint)).toBeNull();
    },
  );

  it("returns null for a never-resolved slot", () => {
    expect(identityForSlot(null, FP_A)).toBeNull();
    expect(identityForSlot(rec(FP_A, null), FP_A)).toBeNull();
  });
});

describe("newOfferDetected — round completion trigger", () => {
  it("absent → present is a new offer", () => {
    expect(newOfferDetected(emptyGeometryObservation(0, 0), obs())).toBe(true);
    expect(newOfferDetected(null, obs())).toBe(true);
  });
  it("an unchanged present offer is NOT a new offer (no re-count, no re-OCR churn)", () => {
    expect(newOfferDetected(obs(), obs())).toBe(false);
  });
  it("a single-slot reroll is NOT a new offer", () => {
    const rerolled = obs({
      cards: [card(0, true, FP_B), card(1, true, FP_B), card(2, true, FP_A_NUDGE)],
    });
    expect(newOfferDetected(obs(), rerolled)).toBe(false);
  });
  it("≥2 slots swapping (queued round) IS a new offer", () => {
    const replaced = obs({
      cards: [card(0, true, FP_B), card(1, true, FP_A), card(2, true, FP_B)],
    });
    expect(newOfferDetected(obs(), replaced)).toBe(true);
  });
  it("an occluded observation is never a new offer", () => {
    expect(newOfferDetected(emptyGeometryObservation(0, 0), obs({ occluded: true }))).toBe(false);
  });
});
