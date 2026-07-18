/**
 * Geometry-provider presence: the Round-6 replacement for OCR-title presence.
 *
 * A cheap Rust pixel probe (`probe_augment_surface`) is the AUTHORITY for three
 * things OCR must never decide:
 *   - present: is a three-card augment surface on screen right now;
 *   - occluded: is a dialog/scoreboard covering the offer (cards behind a panel);
 *   - freshness: the geometry capture clock the render gate ages against.
 *
 * OCR is a separate, TRIGGERED track that only supplies per-slot identity. This
 * split fixes the live failures: a static offer no longer blinks (fast geometry
 * refreshes freshness every ~150 ms instead of waiting on a slow OCR pass), OCR
 * false-negatives on unchanged pixels no longer drop presence, and the AFK modal
 * (readable card text behind it) is classified occluded → zero chips.
 *
 * Every value here is pure so the presence/occlusion/freshness/reroll rules are
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
 * A positive geometry frame older than this hides (fails closed). Tied to the
 * GEOMETRY cadence, NOT OCR duration: max(3× interval, measured p99 + margin).
 * At 150 ms cadence, 3× = 450 ms tolerates two missed geometry probes before a
 * static offer's chips drop — while a healthy scheduler refreshes it every tick.
 */
export const GEOMETRY_FRESHNESS_TTL_MS = 500;
/**
 * Two fingerprints (144-bit average-hash bitstrings) are "the same card" within
 * this Hamming tolerance. Identical pixels hash to distance 0; different augments
 * measured ≥12 on the fixtures — 8 sits clear of both with margin.
 */
export const FINGERPRINT_CHANGED_HAMMING = 8;
/** An unresolved slot re-triggers OCR after this long (retry deadline). */
export const IDENTITY_RETRY_MS = 1500;

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

/** One geometry probe result — presence/occlusion/freshness authority. */
export interface GeometryObservation {
  probeSeq: number;
  capturedAt: number;
  captureWidth: number;
  captureHeight: number;
  present: boolean;
  occluded: boolean;
  confidence: number;
  cards: GeometryCard[];
  rejectionReasons: string[];
  elapsedMs: number;
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
 * The offer is a NEW offer relative to the previous observation when it went
 * absent→present, or when ≥2 slots changed fingerprint while staying present
 * (a queued round replaced the completed one). A single-slot change is a reroll.
 */
export function newOfferDetected(
  previous: GeometryObservation | null,
  current: GeometryObservation,
): boolean {
  if (!current.present || current.occluded) return false;
  if (previous == null || !previous.present) return true;
  let changed = 0;
  for (let i = 0; i < current.cards.length; i += 1) {
    const prev = previous.cards[i]?.fingerprint ?? "";
    const curr = current.cards[i]?.fingerprint ?? "";
    if (current.cards[i]?.present && fingerprintChanged(prev, curr)) changed += 1;
  }
  return changed >= 2;
}

/**
 * Geometry freshness gate. A positive frame renders only while its GEOMETRY
 * capture is within the TTL. A stalled geometry scheduler stops refreshing
 * `capturedAt`, so the UI fails closed instead of freezing the last surface.
 * This replaces the invalid OCR-completion TTL that caused the blinking.
 */
export function geometryFrameFresh(
  capturedAt: number | null,
  now: number,
  ttlMs: number = GEOMETRY_FRESHNESS_TTL_MS,
): boolean {
  return capturedAt != null && now - capturedAt <= ttlMs;
}

/** A per-slot identity resolved by the OCR track, keyed to a geometry fingerprint. */
export interface IdentityRecord<R> {
  /** Geometry fingerprint this identity was resolved against. */
  fingerprint: string;
  /** Resolved identity, or null while OCR is still pending/unmatched. */
  resolution: R | null;
  /** Monotonic clock when this record was written (retry deadline base). */
  resolvedAt: number;
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
