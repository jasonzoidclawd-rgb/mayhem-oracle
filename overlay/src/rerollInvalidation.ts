/**
 * PHASE B — atomic per-slot reroll invalidation.
 *
 * When a single slot is rerolled, only that card's fingerprint changes. The
 * geometry probe that first observes the change must, in one step:
 *   - increment ONLY that slot's generation;
 *   - invalidate ONLY its identity + statistic (store entry → null → SCANNING);
 *   - retain the unchanged neighbours (by reference);
 *   - guarantee any in-flight OCR run stamped with the old slot generation is
 *     rejected on completion.
 *
 * This closes the window that produced the stale 牙仙 chip over the new 不可通行
 * card: previously the identity store was only *masked* by the live fingerprint,
 * so an OCR run triggered by the reroll but reading stale pixels (or resolving
 * during the card-flip's transitional hash) could re-publish the old augment on
 * the new card. Clearing the store atomically the instant a changed fingerprint
 * is observed leaves no old identity to resolve, and the slot-generation stamp
 * rejects any OCR whose slot rerolled again mid-read.
 *
 * Pure — no timers, IPC or React — so left/middle/right reroll ordering is
 * unit-tested deterministically. Fingerprint comparison reuses the geometry
 * average-hash Hamming band, so sub-threshold sparkle drift is the same card.
 */
import { fingerprintChanged, type GeometryObservation, type IdentityRecord } from "./surfaceGeometry";

export interface RerollInvalidationResult<R> {
  /** New identity store; changed slots set to null, neighbours retained by ref. */
  store: Array<IdentityRecord<R> | null>;
  /** New per-slot generations; only invalidated slots incremented. */
  slotGenerations: number[];
  /** Region indices whose fingerprint changed this observation. */
  invalidated: number[];
}

/**
 * Given the current identity store, per-slot generations and a completed
 * geometry observation, invalidate exactly the slots whose present card's
 * fingerprint moved past the Hamming band. An absent card is not a reroll
 * (absence is handled by the geometry presence hysteresis), and a record that
 * is already empty has no identity to invalidate.
 */
export function applyRerollInvalidation<R>(params: {
  store: Array<IdentityRecord<R> | null>;
  slotGenerations: number[];
  observation: GeometryObservation;
  championGeneration: number;
  now: number;
}): RerollInvalidationResult<R> {
  const { store, slotGenerations, observation } = params;
  const nextStore = store.slice();
  const nextGenerations = slotGenerations.slice();
  const invalidated: number[] = [];

  for (const card of observation.cards) {
    const i = card.regionIndex;
    if (!card.present) continue;
    const record = store[i];
    if (record == null) continue;
    if (fingerprintChanged(record.fingerprint, card.fingerprint)) {
      nextStore[i] = null;
      nextGenerations[i] = slotGenerations[i] + 1;
      invalidated.push(i);
    }
  }

  return { store: nextStore, slotGenerations: nextGenerations, invalidated };
}

/**
 * True when an OCR run stamped with `triggerSlotGeneration` must be discarded
 * because its slot was rerolled again (advancing the current generation) before
 * the run completed.
 */
export function ocrRunSuperseded(triggerSlotGeneration: number, currentSlotGeneration: number): boolean {
  return triggerSlotGeneration !== currentSlotGeneration;
}
