import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGeometryVisibleFrame,
  advanceGeometrySurface,
  classifyGeometryObservation,
  createGeometrySurfaceState,
  emptyGeometryObservation,
  fingerprintChanged,
  geometrySchedulerHealthy,
  GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS,
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
    preCaptureMs: 5,
    captureMs: 30,
    analysisMs: 1,
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
  it.each([150, 300, 500, 750, 1000])(
    "keeps a valid frame visible during a legitimate %d ms geometry probe",
    (durationMs) => {
      const frame = buildGeometryVisibleFrame({
        revision: 1,
        captureSeq: 1,
        observation: obs({ capturedAt: 900 }),
        generation: 1,
        resolveIdentity: (regionIndex) => `resolved-${regionIndex}`,
      });
      const healthy = geometrySchedulerHealthy({
        now: 1000 + durationMs,
        foreground: true,
        activeGame: true,
        inFlightSince: 1000,
        lastProbeStartedAt: 1000,
        lastProbeCompletedAt: 900,
      });
      expect(visibleFrameRenderable(frame, true) && healthy).toBe(true);
      expect(frame.slots.map((slot) => slot.resolution)).toEqual([
        "resolved-0",
        "resolved-1",
        "resolved-2",
      ]);
    },
  );

  it("reproduces the old 500 ms whole-frame blink and keeps the fixed gate healthy", () => {
    // HEAD f9aa669 aged capturedAt while a newer probe was legitimately in
    // flight. At 501 ms the old TTL hid all three chips simultaneously.
    const now = 1501;
    expect(now - 1000).toBeGreaterThan(500);
    expect(geometrySchedulerHealthy({
      now,
      foreground: true,
      activeGame: true,
      inFlightSince: 1150,
      lastProbeStartedAt: 1150,
      lastProbeCompletedAt: 1000,
    })).toBe(true);
  });

  it("fails closed after the scheduler health deadline and immediately on foreground loss", () => {
    const baseHealth = {
      foreground: true,
      activeGame: true,
      inFlightSince: null,
      lastProbeStartedAt: 1000,
      lastProbeCompletedAt: 1000,
    };
    expect(geometrySchedulerHealthy({
      ...baseHealth,
      now: 1000 + GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS,
    })).toBe(true);
    expect(geometrySchedulerHealthy({
      ...baseHealth,
      now: 1001 + GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS,
    })).toBe(false);
    expect(geometrySchedulerHealthy({ ...baseHealth, now: 1050, foreground: false })).toBe(false);
    expect(geometrySchedulerHealthy({ ...baseHealth, now: 1050, activeGame: false })).toBe(false);
    expect(geometrySchedulerHealthy({
      ...baseHealth,
      now: 1001 + GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS,
      inFlightSince: 1000,
    })).toBe(false);
  });
});

describe("geometry confidence hysteresis", () => {
  const oneStrong = (overrides: Partial<GeometryObservation> = {}) => obs({
    present: false,
    confidence: 0.9,
    cards: [card(0, true, FP_A), card(1, false, FP_B), card(2, false, FP_A_NUDGE)],
    rejectionReasons: ["insufficient-cards-1/3"],
    ...overrides,
  });
  const zeroStrong = () => obs({
    present: false,
    confidence: 0,
    cards: [card(0, false, FP_A), card(1, false, FP_B), card(2, false, FP_A_NUDGE)],
    rejectionReasons: ["insufficient-cards-0/3"],
  });

  it("preserves resolved chips through one weak/uncertain observation", () => {
    const entered = advanceGeometrySurface(createGeometrySurfaceState(), obs());
    const uncertain = advanceGeometrySurface(entered.state, oneStrong());
    expect(uncertain.classification).toBe("uncertain");
    expect(uncertain.action).toBe("preserve");
    expect(uncertain.state.visualObservation).toBe(entered.state.visualObservation);
  });

  it("retains a single weak slot when the other two cards remain strong", () => {
    const entered = advanceGeometrySurface(createGeometrySurfaceState(), obs());
    const oneWeakCard = obs({
      cards: [card(0, true, FP_A), card(1, false, FP_B), card(2, true, FP_A_NUDGE)],
      rejectionReasons: ["card1-frame-contrast-low"],
    });
    const next = advanceGeometrySurface(entered.state, oneWeakCard);
    expect(next.classification).toBe("present");
    expect(next.action).toBe("publish");
    expect(next.state.visualObservation?.cards.every((entry) => entry.present)).toBe(true);
  });

  it("clears after two consecutive weak negatives", () => {
    const entered = advanceGeometrySurface(
      createGeometrySurfaceState(),
      obs({ capturedAt: 1000 }),
    );
    const first = advanceGeometrySurface(
      entered.state,
      oneStrong({ probeSeq: 2, capturedAt: 1150 }),
    );
    const secondObservation = oneStrong({ probeSeq: 3, capturedAt: 1300 });
    const second = advanceGeometrySurface(first.state, secondObservation);
    expect(first.action).toBe("preserve");
    expect(second.action).toBe("clear");
    expect(second.hideReason).toBe("confirmed-weak-negative");
    expect(secondObservation.capturedAt - 1000).toBe(300);
  });

  // FIX 1 — a single 0/3 probe (a transient detector false-negative) after a
  // stable 3/3 must NOT clear instantly; it enters bounded negative continuity
  // and preserves the prior visible state. Only a REPEATED 0/3 (past the bound)
  // is confirmed absence. Explicit occlusion still clears immediately.
  it("preserves one zero-structure probe, then clears on the second (bounded absence)", () => {
    const entered = advanceGeometrySurface(createGeometrySurfaceState(), obs());
    const firstAbsent = advanceGeometrySurface(entered.state, zeroStrong());
    expect(firstAbsent.classification).toBe("absent");
    expect(firstAbsent.action).toBe("preserve");
    expect(firstAbsent.state.visualObservation).toBe(entered.state.visualObservation);

    const secondAbsent = advanceGeometrySurface(firstAbsent.state, zeroStrong());
    expect(secondAbsent.action).toBe("clear");
    expect(secondAbsent.hideReason).toBe("confirmed-absent");
    expect(secondAbsent.state.visualObservation).toBeNull();
  });

  it("clears immediately on explicit occlusion regardless of continuity", () => {
    const entered = advanceGeometrySurface(createGeometrySurfaceState(), obs());
    const occluded = advanceGeometrySurface(entered.state, obs({ occluded: true }));
    expect(occluded.action).toBe("clear");
    expect(occluded.hideReason).toBe("occluded");
  });

  it("does not let delayed OCR restore a frame after confirmed geometry absence", () => {
    const entered = advanceGeometrySurface(createGeometrySurfaceState(), obs());
    // Two consecutive zero-structure probes are required for confirmed absence.
    const preserved = advanceGeometrySurface(entered.state, zeroStrong());
    const cleared = advanceGeometrySurface(preserved.state, zeroStrong());
    expect(cleared.state.visualObservation).toBeNull();
    const lateIdentity = identityForSlot(
      { fingerprint: FP_A, resolution: "late", resolvedAt: 2000 },
      FP_A,
    );
    expect(lateIdentity).toBe("late");
    expect(cleared.state.visualObservation).toBeNull();
  });

  it("a first-observation 0/3 with no prior positive clears immediately (gameplay, no offer)", () => {
    const transition = advanceGeometrySurface(createGeometrySurfaceState(), zeroStrong());
    expect(transition.action).toBe("clear");
    expect(transition.hideReason).toBe("confirmed-absent");
    expect(transition.state.visualObservation).toBeNull();
  });

  it("does not enter present from an uncertain first observation", () => {
    const transition = advanceGeometrySurface(createGeometrySurfaceState(), oneStrong());
    expect(transition.action).toBe("clear");
    expect(transition.state.visualObservation).toBeNull();
  });

  it("treats a capture/IPC failure as uncertain, not confirmed combat absence", () => {
    const failure = emptyGeometryObservation(2, 1150, "capture-failed: transient");
    expect(classifyGeometryObservation(failure)).toBe("uncertain");

    const entered = advanceGeometrySurface(createGeometrySurfaceState(), obs());
    const transition = advanceGeometrySurface(entered.state, failure);
    expect(transition.action).toBe("preserve");
    expect(transition.state.visualObservation).toBe(entered.state.visualObservation);
  });
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
      expect(frame.capturedAt).toBe(seq * 150);
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
    expect(source).toContain("advanceGeometrySurface(previousSurface, observation)");
    expect(source).toContain("geometrySchedulerHealthy({");
    expect(source).not.toContain("geometryFrameFresh(");
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
