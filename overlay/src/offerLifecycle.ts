/**
 * Latched augment-offer lifecycle.
 *
 * Once an augment screen is visible its identity is LATCHED per slot by a
 * normalized OCR-title fingerprint. Champion level is never a continuing
 * validity gate: an already-visible offer stays latched across level changes.
 * The offer clears only on explicit evidence:
 *   - the selection surface disappears for SCREEN_ABSENCE_CLEAR_PASSES scans,
 *   - the caller confirms a pick / crosses a new augment-round boundary,
 *   - the caller resets on focus loss or a gameflow boundary.
 *
 * Reroll semantics: a slot whose title changes (or vanishes while the other
 * slots remain visible) is invalidated IMMEDIATELY and re-resolved — its old
 * identity is never retained; untouched slots keep their resolved state only
 * while their fingerprint still matches. Every transition returns a complete
 * next state, so a publish can never mix two offer generations.
 */

export interface OfferSlot<R> {
  regionIndex: number;
  /** Normalized OCR title; null while the slot has no readable card title. */
  fingerprint: string | null;
  /** Raw OCR title backing the fingerprint. */
  title: string | null;
  /** Caller-supplied identity/stat resolution; null while scanning. */
  resolution: R | null;
}

export interface OfferState<R> {
  /** Bumps whenever any slot's fingerprint changes — one generation per offer surface. */
  generation: number;
  /** True once any card title has been seen since the last reset. */
  latched: boolean;
  /** Consecutive scans in which NO slot had a readable title (latched only). */
  screenEmptyPasses: number;
  slots: OfferSlot<R>[];
}

/** Full-screen absence tolerated for one scan; the second clears the offer. */
export const SCREEN_ABSENCE_CLEAR_PASSES = 2;

export const OFFER_REGION_COUNT = 3;

export function emptyOfferState<R>(generation = 0): OfferState<R> {
  return {
    generation,
    latched: false,
    screenEmptyPasses: 0,
    slots: Array.from({ length: OFFER_REGION_COUNT }, (_, regionIndex) => ({
      regionIndex,
      fingerprint: null,
      title: null,
      resolution: null,
    })),
  };
}

export interface ScanApplication<R> {
  state: OfferState<R>;
  /** True when this scan closed the offer (surface absent long enough). */
  cleared: boolean;
  /** Regions whose identity changed in this scan (reroll / new offer). */
  changedRegions: number[];
}

/**
 * Apply one OCR scan to the offer. `titles[i]` is the raw OCR title for region
 * i, or null when that region had no readable text. `resolve` runs ONLY for a
 * region whose fingerprint changed — stable slots keep their prior resolution
 * without re-resolving.
 */
export function applyScanToOffer<R>(
  state: OfferState<R>,
  titles: Array<string | null>,
  normalize: (title: string) => string,
  resolve: (title: string, regionIndex: number) => R,
): ScanApplication<R> {
  const fingerprints = state.slots.map((slot, regionIndex) => {
    const title = titles[regionIndex] ?? null;
    const normalized = title ? normalize(title) : "";
    return { title, fingerprint: normalized.length > 0 ? normalized : null };
  });
  const anyPresent = fingerprints.some((entry) => entry.fingerprint !== null);

  if (!anyPresent) {
    if (!state.latched) {
      return { state, cleared: false, changedRegions: [] };
    }
    const screenEmptyPasses = state.screenEmptyPasses + 1;
    if (screenEmptyPasses >= SCREEN_ABSENCE_CLEAR_PASSES) {
      return {
        state: emptyOfferState(state.generation + 1),
        cleared: true,
        changedRegions: state.slots
          .filter((slot) => slot.fingerprint !== null)
          .map((slot) => slot.regionIndex),
      };
    }
    // One fully-empty scan is a transient capture gap (tooltip, animation
    // frame) — retain the latched identities and wait for the next scan.
    return {
      state: { ...state, screenEmptyPasses },
      cleared: false,
      changedRegions: [],
    };
  }

  const changedRegions: number[] = [];
  const slots = state.slots.map((slot, regionIndex) => {
    const { title, fingerprint } = fingerprints[regionIndex];
    if (fingerprint === slot.fingerprint) {
      return slot;
    }
    changedRegions.push(regionIndex);
    if (fingerprint === null) {
      // Some slots are visible but this one is not: a reroll is in flight.
      // Invalidate the slot's identity immediately — never keep stale data.
      return { regionIndex, fingerprint: null, title: null, resolution: null };
    }
    return {
      regionIndex,
      fingerprint,
      title,
      resolution: resolve(title as string, regionIndex),
    };
  });

  return {
    state: {
      generation: changedRegions.length > 0 ? state.generation + 1 : state.generation,
      latched: true,
      screenEmptyPasses: 0,
      slots,
    },
    cleared: false,
    changedRegions,
  };
}

/** True while a latched offer surface has at least one identified slot. */
export function offerActive<R>(state: OfferState<R>): boolean {
  return state.latched && state.slots.some((slot) => slot.fingerprint !== null);
}
