/**
 * Geometry-provider presence: the Round-6 replacement for OCR-title presence.
 *
 * A cheap Rust pixel probe (`probe_augment_surface`) is the AUTHORITY for three
 * things OCR must never decide:
 *   - present: is a three-card augment surface on screen right now;
 *   - occluded: is a dialog/scoreboard covering the offer (cards behind a panel);
 *   - visual freshness: the most recent accepted card rectangles/fingerprints.
 *
 * OCR is a separate, TRIGGERED track that only supplies per-slot identity. This
 * split fixes the live failures: confidence hysteresis preserves a positive
 * static offer through one uncertain observation, and scheduler health keeps
 * that frame renderable while a normal newer probe is in flight. OCR false-
 * negatives on unchanged pixels never drop presence, and the AFK modal
 * (readable card text behind it) is classified occluded → zero chips.
 *
 * Every value here is pure so presence/occlusion/health/reroll rules are
 * unit-tested without timers, IPC, or React. Mirrors the Rust SurfaceObservation
 * (serde camelCase).
 */
import type { PhysicalRect } from "./calibration";
import {
  emptyVisibleFrame,
  type VisibleOfferFrame,
  type VisibleSlot,
} from "./visibleOfferFrame";

/** Fast geometry cadence — sub-second detection, independent of slow OCR. */
export const GEOMETRY_INTERVAL_MS = 150;
/**
 * Longest full-probe duration treated as healthy by the deterministic latency
 * matrix. The live rolling diagnostics collect the actual capture+analysis+IPC+
 * publication distribution; this bound deliberately covers its 1 s test case.
 */
export const GEOMETRY_FULL_PROBE_P99_BUDGET_MS = 1000;
export const GEOMETRY_HEALTH_SAFETY_MARGIN_MS = 250;
/** Scheduler health, never frame age, owns fail-closed expiry. */
export const GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS = Math.max(
  3 * GEOMETRY_INTERVAL_MS,
  GEOMETRY_FULL_PROBE_P99_BUDGET_MS + GEOMETRY_HEALTH_SAFETY_MARGIN_MS,
);
/**
 * Two fingerprints (144-bit average-hash bitstrings) are "the same card" within
 * this Hamming tolerance. Identical pixels hash to distance 0; different augments
 * measured ≥12 on the fixtures — 8 sits clear of both with margin.
 */
export const FINGERPRINT_CHANGED_HAMMING = 8;
/** An unresolved slot re-triggers OCR after this long (retry deadline). */
export const IDENTITY_RETRY_MS = 1500;
/**
 * Bounded negative continuity (FIX 1). A NEGATIVE geometry observation (0 or 1
 * strong card) following a stable positive preserves the prior visible state for
 * up to this many consecutive frames before clearing, so a transient detector
 * false-negative never blanks resolved chips or converts them to OCR ERROR. A
 * value of 2 preserves one negative frame and clears on the second consecutive.
 */
export const GEOMETRY_NEGATIVE_CONTINUITY_FRAMES = 2;

/** Per-card structural observation from the Rust geometry probe. */
export interface GeometryCard {
  regionIndex: number;
  present: boolean;
  /** Name-band rect (calibrated logical space) for chip rendering; null absent. */
  cardRect: PhysicalRect | null;
  interiorLuma: number;
  interiorStd: number;
  frameContrast: number;
  edgeEnergy: number;
  structuralScore: number;
  /** 144-bit average-hash bitstring of the icon+name window. */
  fingerprint: string;
}

/** One geometry probe result — presence/occlusion/visual-freshness authority. */
export interface GeometryObservation {
  probeSeq: number;
  capturedAt: number;
  captureWidth: number;
  captureHeight: number;
  present: boolean;
  occluded: boolean;
  confidence: number;
  blueControl?: {
    present: boolean;
    confidence: number;
    normalizedRect: { x: number; y: number; width: number; height: number };
    features?: {
      aspectRatio: number;
      blueBodyCoverage: number;
      bodySaturation: number;
      borderContrast: number;
      centralIconCoverage: number;
    };
  };
  cards: GeometryCard[];
  rejectionReasons: string[];
  preCaptureMs: number;
  captureMs: number;
  analysisMs: number;
  elapsedMs: number;
}

export type GeometryClassification = "present" | "uncertain" | "absent";
export type GeometryHideReason =
  | "confirmed-absent"
  | "confirmed-weak-negative"
  | "occluded"
  | "uncertain-without-positive";

export interface GeometrySurfaceState {
  visualObservation: GeometryObservation | null;
  lastPositiveObservation: GeometryObservation | null;
  consecutiveWeakNegatives: number;
}

export interface GeometrySurfaceTransition {
  state: GeometrySurfaceState;
  classification: GeometryClassification;
  action: "publish" | "preserve" | "clear";
  hideReason: GeometryHideReason | null;
}

export function createGeometrySurfaceState(): GeometrySurfaceState {
  return {
    visualObservation: null,
    lastPositiveObservation: null,
    consecutiveWeakNegatives: 0,
  };
}

export function emptyGeometryObservation(
  probeSeq: number,
  capturedAt: number,
  reason = "no-observation",
): GeometryObservation {
  return {
    probeSeq,
    capturedAt,
    captureWidth: 0,
    captureHeight: 0,
    present: false,
    occluded: false,
    confidence: 0,
    blueControl: {
      present: false,
      confidence: 0,
      normalizedRect: { x: 0.435, y: 0.758, width: 0.13, height: 0.067 },
    },
    cards: [0, 1, 2].map((regionIndex) => ({
      regionIndex,
      present: false,
      cardRect: null,
      interiorLuma: 0,
      interiorStd: 0,
      frameContrast: 0,
      edgeEnergy: 0,
      structuralScore: 0,
      fingerprint: "",
    })),
    rejectionReasons: [reason],
    preCaptureMs: 0,
    captureMs: 0,
    analysisMs: 0,
    elapsedMs: 0,
  };
}

/** Hamming distance between two equal-length bitstrings (∞ if lengths differ). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
  return d;
}

/**
 * True when two fingerprints describe DIFFERENT cards (a reroll). An empty
 * fingerprint (no card) never "matches" a real one. Distances at or below the
 * tolerance are the same card surviving identical-pixel probes.
 */
export function fingerprintChanged(previous: string, current: string): boolean {
  if (previous.length === 0 || current.length === 0) return previous !== current;
  return hammingDistance(previous, current) > FINGERPRINT_CHANGED_HAMMING;
}

/**
 * Three-way raw classification. Zero structures are confirmed absent only when
 * native capture and analysis actually completed; a capture/IPC failure has no
 * pixels and is uncertain. Occlusion is an orthogonal immediate-clear.
 */
export function classifyGeometryObservation(
  observation: GeometryObservation,
): GeometryClassification {
  const strongCards = observation.cards.filter((card) => card.present).length;
  if (strongCards >= 2) return "present";
  if (
    strongCards === 0 &&
    observation.captureWidth > 0 &&
    observation.captureHeight > 0
  ) {
    return "absent";
  }
  return "uncertain";
}

function stabilizePresentObservation(
  previous: GeometryObservation | null,
  current: GeometryObservation,
): GeometryObservation {
  if (previous == null) return current;
  return {
    ...current,
    cards: current.cards.map((card, regionIndex) => {
      if (card.present) return card;
      const old = previous.cards[regionIndex];
      if (
        old?.present &&
        !fingerprintChanged(old.fingerprint, card.fingerprint)
      ) {
        return old;
      }
      return card;
    }),
  };
}

/**
 * Confidence hysteresis for the visual geometry surface.
 *
 * - ≥2 strong cards enters/remains present.
 * - 1 strong card is uncertain: preserve one completed cycle, clear on two.
 * - 0 strong cards is high-confidence absence and clears immediately.
 * - explicit occlusion always clears immediately.
 *
 * Preserving uses the last accepted geometry observation, so resolved chips do
 * not degrade to SCANNING merely because a borderline probe was uncertain.
 */
export function advanceGeometrySurface(
  previous: GeometrySurfaceState,
  observation: GeometryObservation,
): GeometrySurfaceTransition {
  const classification = classifyGeometryObservation(observation);
  if (observation.occluded) {
    return {
      classification,
      action: "clear",
      hideReason: "occluded",
      state: {
        visualObservation: null,
        lastPositiveObservation: previous.lastPositiveObservation,
        consecutiveWeakNegatives: 0,
      },
    };
  }
  if (classification === "present") {
    const stabilized = stabilizePresentObservation(
      previous.lastPositiveObservation,
      observation,
    );
    return {
      classification,
      action: "publish",
      hideReason: null,
      state: {
        visualObservation: stabilized,
        lastPositiveObservation: stabilized,
        consecutiveWeakNegatives: 0,
      },
    };
  }
  // FIX 1 — a NEGATIVE observation (0 cards = "absent", or 1 card = "uncertain")
  // that follows a stable positive is treated as bounded continuity, NOT an
  // instant clear: a single detector false-negative preserves the prior visible
  // state so resolved chips never flash empty (and are never converted to OCR
  // ERROR) on a transient 0/3. Only a REPEATED negative past the bound — or an
  // explicit occlusion (handled above) — clears. A negative with no prior
  // positive (gameplay with no offer) still clears immediately.
  const weakCount = previous.consecutiveWeakNegatives + 1;
  if (previous.visualObservation != null && weakCount < GEOMETRY_NEGATIVE_CONTINUITY_FRAMES) {
    return {
      classification,
      action: "preserve",
      hideReason: null,
      state: {
        visualObservation: previous.visualObservation,
        lastPositiveObservation: previous.lastPositiveObservation,
        consecutiveWeakNegatives: weakCount,
      },
    };
  }
  return {
    classification,
    action: "clear",
    hideReason: classification === "absent"
      ? "confirmed-absent"
      : previous.visualObservation == null
        ? "uncertain-without-positive"
        : "confirmed-weak-negative",
    state: {
      visualObservation: null,
      lastPositiveObservation: null,
      consecutiveWeakNegatives: weakCount,
    },
  };
}

/**
 * The offer is a NEW offer relative to the previous observation when it went
 * absent→present, or when ≥2 slots changed fingerprint while staying present
 * (a queued round replaced the completed one). A single-slot change is a reroll.
 *
 * `precededByNegative` is true when a negative (absent/uncertain) frame was just
 * masked by negative-continuity preservation since the last positive — i.e. the
 * surface briefly went away and came back. A reroll never has such a gap (the
 * card flips in place while the offer stays present), whereas a death-sequence
 * queued round closes the UI for a frame before the next offer opens. So when a
 * gap intervened, ANY single changed slot marks a fresh offer session — a
 * queued round that repeats ≥2 augments must not be mistaken for a reroll
 * (§4). Identical fingerprints after the gap are a genuine transient
 * false-negative on the SAME offer and stay preserved (no re-scan).
 */
export function newOfferDetected(
  previous: GeometryObservation | null,
  current: GeometryObservation,
  precededByNegative = false,
): boolean {
  if (!current.present || current.occluded) return false;
  if (previous == null || !previous.present) return true;
  let changed = 0;
  for (let i = 0; i < current.cards.length; i += 1) {
    const prev = previous.cards[i]?.fingerprint ?? "";
    const curr = current.cards[i]?.fingerprint ?? "";
    if (current.cards[i]?.present && fingerprintChanged(prev, curr)) changed += 1;
  }
  if (precededByNegative && changed >= 1) return true;
  return changed >= 2;
}

/**
 * Scheduler-health render gate. A valid frame remains visible while a newer
 * probe is legitimately in flight; its old capture timestamp cannot expire the
 * frame. Foreground/game loss is immediate, and a silent or over-budget
 * scheduler fails closed at the derived health deadline.
 */
export function geometrySchedulerHealthy(input: {
  now: number;
  foreground: boolean;
  activeGame: boolean;
  inFlightSince: number | null;
  lastProbeStartedAt: number | null;
  lastProbeCompletedAt: number | null;
  healthDeadlineMs?: number;
}): boolean {
  if (!input.foreground || !input.activeGame) return false;
  const deadline = input.healthDeadlineMs ?? GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS;
  if (input.inFlightSince != null) {
    return input.now - input.inFlightSince <= deadline;
  }
  const lastActivity = Math.max(
    input.lastProbeStartedAt ?? Number.NEGATIVE_INFINITY,
    input.lastProbeCompletedAt ?? Number.NEGATIVE_INFINITY,
  );
  return Number.isFinite(lastActivity) && input.now - lastActivity <= deadline;
}

/** A per-slot identity resolved by the OCR track, keyed to a geometry fingerprint. */
export interface IdentityRecord<R> {
  /** Geometry fingerprint this identity was resolved against. */
  fingerprint: string;
  /** Resolved identity, or null while OCR is still pending/unmatched. */
  resolution: R | null;
  /** Monotonic clock when this record was written (retry deadline base). */
  resolvedAt: number;
  /**
   * Champion generation the statistic was computed for. A champion change bumps
   * it so `reconcileSlotIdentity` recomputes rather than treating a stale
   * champion's value as immutable. Optional for backward compatibility.
   */
  championGeneration?: number;
  /**
   * Canonical numeric augment ID of the verified identity (empty while pending).
   * Lets the immutability guard detect a conflicting re-read for the same card.
   */
  augmentId?: string;
  /** Normalized/readable OCR title retained only to recompute derived stats. */
  ocrTitle?: string | null;
  foregroundEpoch?: number;
  gameEpoch?: number;
  offerGeneration?: number;
  slotGeneration?: number;
  ocrRunId?: number;
  championRequestId?: number;
  championPatch?: string | null;
  conflictCount?: number;
  unresolvedState?: "scanning" | "unmatched" | "ocr-error";
  failureCount?: number;
  retryAt?: number;
}

/**
 * Resolve a slot's current identity: the stored record ONLY when its fingerprint
 * still matches the live geometry fingerprint. A rerolled slot (fingerprint
 * changed) or an unwritten slot returns null → the chip shows SCANNING. This is
 * the stale-result guard for identity: a late OCR result keyed to an old
 * fingerprint can never paint over the new card.
 */
export function identityForSlot<R>(
  record: IdentityRecord<R> | null | undefined,
  currentFingerprint: string,
): R | null {
  if (record == null) return null;
  if (fingerprintChanged(record.fingerprint, currentFingerprint)) return null;
  return record.resolution;
}

/**
 * Build the visible frame from a geometry observation. Presence, occlusion, and
 * per-slot geometry (rect + fingerprint) come from the observation; chip CONTENT
 * (identity) is layered via `resolveIdentity`, which returns null for a slot
 * whose identity is pending or fingerprint-mismatched (SCANNING).
 *
 * surfaceValidated is present && !occluded — a modal-occluded offer publishes an
 * EMPTY frame (zero chips) even though its cards physically exist.
 */
export function buildGeometryVisibleFrame<R>(params: {
  revision: number;
  captureSeq: number;
  observation: GeometryObservation;
  generation: number;
  resolveIdentity: (regionIndex: number, fingerprint: string) => R | null;
  resolveUnresolvedState?: (
    regionIndex: number,
    fingerprint: string,
  ) => "scanning" | "unmatched" | "ocr-error";
}): VisibleOfferFrame<R> {
  const { revision, captureSeq, observation, generation, resolveIdentity } = params;
  const renderable = observation.present && !observation.occluded;
  if (!renderable) {
    return emptyVisibleFrame(revision, captureSeq, generation, observation.capturedAt);
  }
  const slots: VisibleSlot<R>[] = observation.cards
    .filter((card) => card.present)
    .map((card) => ({
      regionIndex: card.regionIndex,
      cardRect: card.cardRect,
      fingerprint: card.fingerprint,
      resolution: resolveIdentity(card.regionIndex, card.fingerprint),
      unresolvedState: params.resolveUnresolvedState?.(card.regionIndex, card.fingerprint) ?? "scanning",
    }));
  return {
    revision,
    captureSeq,
    capturedAt: observation.capturedAt,
    surfaceValidated: true,
    generation,
    slots,
  };
}
