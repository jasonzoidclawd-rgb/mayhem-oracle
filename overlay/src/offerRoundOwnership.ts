import type { OfferSurfaceKind } from "./offerSurfaceState";

export interface OfferRoundOwner {
  offerGeneration: number;
  round: number;
}

export interface OfferRoundOwnership {
  activeOwner: OfferRoundOwner | null;
  pendingClosedOwner: OfferRoundOwner | null;
  /**
   * The offer whose PRESENTATION vanished without a close — the surface left
   * OFFER_VISIBLE for a continuity-retaining state (UNCERTAIN / OCCLUDED).
   * The round is still in flight: the next visible generation rebinds to it,
   * and a genuine close still completes it. Distinct from
   * `pendingClosedOwner`, which means the offer genuinely ended.
   */
  clearedOwner: OfferRoundOwner | null;
  completedOwners: OfferRoundOwner[];
}

type OfferRoundOwnershipEvent = {
  type: "accepted-offer" | "offer-closed" | "pick-confirmed" | "presentation-cleared";
  offerGeneration: number;
};

const TOTAL_ROUNDS = 4;

export function createOfferRoundOwnership(): OfferRoundOwnership {
  return {
    activeOwner: null,
    pendingClosedOwner: null,
    clearedOwner: null,
    completedOwners: [],
  };
}

/**
 * States that RETAIN presentation continuity: the offer is still the same
 * round, the overlay merely lost sight of or confidence in it. Leaving
 * OFFER_VISIBLE for one of these clears the PRESENTATION, never the round.
 * NO_OFFER is excluded — that is a genuine close.
 */
const CONTINUITY_RETAINING_STATES = ["UNCERTAIN", "OCCLUDED"] as const;

/**
 * The generation whose presentation this surface transition cleared, or null
 * when the transition is not a presentation loss. A live Mayhem round
 * re-acquires its surface repeatedly (occlusion, hover glow, card animation,
 * a capture that fails validation), each time at a BUMPED offer generation;
 * without this event the reducer sees an unrelated successor and mints a new
 * round, which is how one round consumed R2, R3 and R4 in 7.6 s.
 */
export function presentationClearedGeneration(
  prior: { state: OfferSurfaceKind; offerGeneration: number },
  next: { state: OfferSurfaceKind; offerGeneration?: number },
): number | null {
  if (prior.state !== "OFFER_VISIBLE") return null;
  return CONTINUITY_RETAINING_STATES.some((state) => state === next.state)
    ? prior.offerGeneration
    : null;
}

export function reduceOfferRoundOwnership(
  state: OfferRoundOwnership,
  event: OfferRoundOwnershipEvent,
): OfferRoundOwnership {
  if (event.type === "accepted-offer") {
    if (state.activeOwner?.offerGeneration === event.offerGeneration) return state;
    if (state.pendingClosedOwner?.offerGeneration === event.offerGeneration) {
      return {
        ...state,
        activeOwner: state.pendingClosedOwner,
        pendingClosedOwner: null,
      };
    }
    // A round whose presentation was cleared without a close is still in
    // flight: the offer came back. Rebind that SAME round to whichever
    // generation re-acquired it — never advance.
    if (state.clearedOwner !== null) {
      return {
        ...state,
        activeOwner: {
          offerGeneration: event.offerGeneration,
          round: state.clearedOwner.round,
        },
        clearedOwner: null,
      };
    }

    const priorOwner = state.activeOwner ?? state.pendingClosedOwner;
    const completedOwners = priorOwner == null
      ? state.completedOwners
      : [...state.completedOwners, priorOwner];
    const nextRound = completedOwners.length + 1;
    return {
      activeOwner: nextRound <= TOTAL_ROUNDS
        ? { offerGeneration: event.offerGeneration, round: nextRound }
        : null,
      pendingClosedOwner: null,
      clearedOwner: null,
      completedOwners,
    };
  }

  // A close or a pick may arrive while the presentation is already cleared
  // (the live close path is OFFER_VISIBLE → OCCLUDED → NO_OFFER), so both
  // terminal events accept the cleared owner too. Without this the round
  // never completes and ownership stalls forever.
  const terminatingOwner =
    state.activeOwner?.offerGeneration === event.offerGeneration
      ? state.activeOwner
      : state.clearedOwner?.offerGeneration === event.offerGeneration
        ? state.clearedOwner
        : null;

  if (event.type === "offer-closed") {
    if (terminatingOwner === null) return state;
    return {
      ...state,
      activeOwner: null,
      clearedOwner: null,
      pendingClosedOwner: terminatingOwner,
    };
  }

  if (event.type === "presentation-cleared") {
    if (state.activeOwner?.offerGeneration !== event.offerGeneration) return state;
    return {
      ...state,
      activeOwner: null,
      pendingClosedOwner: null,
      clearedOwner: state.activeOwner,
    };
  }

  if (terminatingOwner === null) return state;
  return {
    activeOwner: null,
    pendingClosedOwner: null,
    clearedOwner: null,
    completedOwners: [...state.completedOwners, terminatingOwner],
  };
}
