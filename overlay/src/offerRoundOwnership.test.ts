import { describe, expect, it } from "vitest";

import {
  createOfferRoundOwnership,
  presentationClearedGeneration,
  reduceOfferRoundOwnership,
  type OfferRoundOwnership,
} from "./offerRoundOwnership";
import {
  advanceOfferSurface,
  createOfferSurfaceState,
  type OfferSurfaceEvidence,
  type OfferSurfaceKind,
} from "./offerSurfaceState";

function surfaceEvidence(
  overrides: Partial<OfferSurfaceEvidence> = {},
): OfferSurfaceEvidence {
  return {
    now: 100,
    captureValid: true,
    blueControlPresent: true,
    blueControlConfidence: 1,
    validCardCount: 3,
    occlusionReason: null,
    hiddenEvidence: false,
    newOfferEvidence: false,
    ...overrides,
  };
}

function accept(state: OfferRoundOwnership, offerGeneration: number) {
  return reduceOfferRoundOwnership(state, {
    type: "accepted-offer",
    offerGeneration,
  });
}

function close(state: OfferRoundOwnership, offerGeneration: number) {
  return reduceOfferRoundOwnership(state, {
    type: "offer-closed",
    offerGeneration,
  });
}

function clearPresentation(state: OfferRoundOwnership, offerGeneration: number) {
  return reduceOfferRoundOwnership(state, {
    type: "presentation-cleared",
    offerGeneration,
  });
}

function pick(state: OfferRoundOwnership, offerGeneration: number) {
  return reduceOfferRoundOwnership(state, {
    type: "pick-confirmed",
    offerGeneration,
  });
}

describe("accepted offer round ownership", () => {
  it("owns four sequential accepted offers independently across close-then-next transitions", () => {
    let state = createOfferRoundOwnership();

    for (const [index, generation] of [11, 18, 27, 42].entries()) {
      state = accept(state, generation);
      expect(state.activeOwner).toEqual({
        offerGeneration: generation,
        round: index + 1,
      });

      if (index < 3) {
        state = close(state, generation);
        expect(state.activeOwner).toBeNull();
      }
    }

    expect(state.completedOwners).toEqual([
      { offerGeneration: 11, round: 1 },
      { offerGeneration: 18, round: 2 },
      { offerGeneration: 27, round: 3 },
    ]);
  });

  it("completes an in-place owner when a distinct accepted successor owns the next round", () => {
    let state = accept(createOfferRoundOwnership(), 3);
    state = accept(state, 4);

    expect(state.completedOwners).toEqual([{ offerGeneration: 3, round: 1 }]);
    expect(state.activeOwner).toEqual({ offerGeneration: 4, round: 2 });
  });

  it("closes the prior visible generation before the next visible generation owns round 2 once", () => {
    let surface = advanceOfferSurface(
      createOfferSurfaceState(),
      surfaceEvidence(),
    );
    let ownership = accept(createOfferRoundOwnership(), surface.offerGeneration);
    const priorVisibleGeneration = surface.offerGeneration;

    expect(ownership.activeOwner).toEqual({
      offerGeneration: priorVisibleGeneration,
      round: 1,
    });

    surface = advanceOfferSurface(surface, surfaceEvidence({
      now: 200,
      blueControlPresent: false,
      blueControlConfidence: 0,
      validCardCount: 0,
    }));
    expect(surface.offerGeneration).toBe(priorVisibleGeneration + 1);

    ownership = close(ownership, priorVisibleGeneration);
    expect(ownership.activeOwner).toBeNull();
    expect(ownership.pendingClosedOwner).toEqual({
      offerGeneration: priorVisibleGeneration,
      round: 1,
    });

    surface = advanceOfferSurface(surface, surfaceEvidence({ now: 300 }));
    ownership = accept(ownership, surface.offerGeneration);
    ownership = accept(ownership, surface.offerGeneration);

    expect(ownership.completedOwners).toEqual([{
      offerGeneration: priorVisibleGeneration,
      round: 1,
    }]);
    expect(ownership.activeOwner).toEqual({
      offerGeneration: surface.offerGeneration,
      round: 2,
    });
  });

  it("never advances when the same accepted generation is observed again, including a one-slot reroll", () => {
    let state = accept(createOfferRoundOwnership(), 9);

    // A one-slot reroll remains part of the already accepted offer generation.
    state = accept(state, 9);
    state = accept(state, 9);

    expect(state.activeOwner).toEqual({ offerGeneration: 9, round: 1 });
    expect(state.completedOwners).toEqual([]);
  });

  it("rebinds an operationally cleared still-open offer to the same round until a genuine close", () => {
    let state = accept(createOfferRoundOwnership(), 50);

    state = clearPresentation(state, 50);
    expect(state.activeOwner).toBeNull();
    expect(state.completedOwners).toEqual([]);

    state = accept(state, 51);
    expect(state.activeOwner).toEqual({ offerGeneration: 51, round: 1 });
    expect(state.completedOwners).toEqual([]);

    state = clearPresentation(state, 51);
    state = accept(state, 52);
    expect(state.activeOwner).toEqual({ offerGeneration: 52, round: 1 });
    expect(state.completedOwners).toEqual([]);

    state = close(state, 52);
    state = accept(state, 53);
    expect(state.completedOwners).toEqual([{
      offerGeneration: 52,
      round: 1,
    }]);
    expect(state.activeOwner).toEqual({ offerGeneration: 53, round: 2 });
  });

  it("a confirmed pick completes and clears the prior owner, so the next accepted generation owns the next round", () => {
    let state = accept(createOfferRoundOwnership(), 20);
    state = pick(state, 20);

    expect(state.activeOwner).toBeNull();
    expect(state.completedOwners).toEqual([{ offerGeneration: 20, round: 1 }]);

    state = accept(state, 21);
    expect(state.activeOwner).toEqual({ offerGeneration: 21, round: 2 });
    expect(state.activeOwner?.offerGeneration).not.toBe(20);
  });

  it("ignores stale close and pick events for an older generation", () => {
    let state = accept(createOfferRoundOwnership(), 31);
    state = accept(state, 32);

    state = close(state, 31);
    state = pick(state, 31);

    expect(state.activeOwner).toEqual({ offerGeneration: 32, round: 2 });
    expect(state.completedOwners).toEqual([{ offerGeneration: 31, round: 1 }]);
  });

  it("caps ownership at four product rounds and never invents a fifth", () => {
    let state = createOfferRoundOwnership();
    for (const generation of [1, 2, 3, 4, 5]) {
      state = accept(state, generation);
    }

    expect(state.completedOwners).toEqual([
      { offerGeneration: 1, round: 1 },
      { offerGeneration: 2, round: 2 },
      { offerGeneration: 3, round: 3 },
      { offerGeneration: 4, round: 4 },
    ]);
    expect(state.activeOwner).toBeNull();
    expect(state.completedOwners.some((owner) => owner.round === 5)).toBe(false);
  });
});

/**
 * Offer-surface flicker suite (live defect, 2026-08-30 acceptance run).
 *
 * A single physical Mayhem round re-acquires its surface many times: the live
 * trace shows OFFER_VISIBLE → UNCERTAIN → OFFER_VISIBLE at a BUMPED generation
 * 13 times, and OFFER_VISIBLE → OCCLUDED → OFFER_VISIBLE at a bumped generation
 * 7 more. Every one of those used to mint a new round, so rounds 2, 3 and 4
 * were consumed within 7.6 s of each other and 92 of 105 slot publications in
 * the real game carried no round owner at all.
 *
 * `applySurfaceTransition` mirrors the App.tsx wiring exactly, so these tests
 * exercise the same dispatch rules the overlay runs.
 */
function applySurfaceTransition(
  ownership: OfferRoundOwnership,
  prior: { state: OfferSurfaceKind; offerGeneration: number },
  next: { state: OfferSurfaceKind; offerGeneration: number },
): OfferRoundOwnership {
  let state = ownership;
  if (next.state === "OFFER_VISIBLE") {
    state = accept(state, next.offerGeneration);
  }
  const clearedGeneration = presentationClearedGeneration(prior, next);
  if (clearedGeneration !== null) {
    state = clearPresentation(state, clearedGeneration);
  }
  if (next.state === "NO_OFFER" && prior.state !== "NO_OFFER") {
    state = close(state, prior.offerGeneration);
  }
  return state;
}

/** Leave OFFER_VISIBLE for a continuity-retaining state, then come back at a
 *  bumped generation — the exact live flicker. */
function flicker(
  ownership: OfferRoundOwnership,
  generation: number,
  through: "UNCERTAIN" | "OCCLUDED",
): { state: OfferRoundOwnership; generation: number } {
  let state = applySurfaceTransition(
    ownership,
    { state: "OFFER_VISIBLE", offerGeneration: generation },
    { state: through, offerGeneration: generation },
  );
  const reacquired = generation + 1;
  state = applySurfaceTransition(
    state,
    { state: through, offerGeneration: generation },
    { state: "OFFER_VISIBLE", offerGeneration: reacquired },
  );
  return { state, generation: reacquired };
}

/** Drive a round to its genuine end: visible → OCCLUDED → NO_OFFER. */
function closeRound(
  ownership: OfferRoundOwnership,
  generation: number,
): OfferRoundOwnership {
  let state = applySurfaceTransition(
    ownership,
    { state: "OFFER_VISIBLE", offerGeneration: generation },
    { state: "OCCLUDED", offerGeneration: generation },
  );
  return applySurfaceTransition(
    state,
    { state: "OCCLUDED", offerGeneration: generation },
    { state: "NO_OFFER", offerGeneration: generation + 1 },
  );
}

describe("offer-surface flicker never advances round ownership", () => {
  it("rebinds round 2 when OFFER_VISIBLE → UNCERTAIN → OFFER_VISIBLE bumps the generation", () => {
    let state = accept(createOfferRoundOwnership(), 8);
    state = closeRound(state, 8);
    state = accept(state, 44);
    expect(state.activeOwner).toEqual({ offerGeneration: 44, round: 2 });

    const flickered = flicker(state, 44, "UNCERTAIN");

    expect(flickered.state.activeOwner).toEqual({
      offerGeneration: 45,
      round: 2,
    });
    expect(flickered.state.completedOwners).toEqual([
      { offerGeneration: 8, round: 1 },
    ]);
  });

  it("never advances the round across repeated UNCERTAIN flickers", () => {
    let state = accept(createOfferRoundOwnership(), 8);
    state = closeRound(state, 8);
    state = accept(state, 44);

    let generation = 44;
    for (let i = 0; i < 6; i += 1) {
      const flickered = flicker(state, generation, "UNCERTAIN");
      state = flickered.state;
      generation = flickered.generation;
      expect(state.activeOwner?.round).toBe(2);
    }

    expect(state.activeOwner).toEqual({ offerGeneration: 50, round: 2 });
    expect(state.completedOwners).toEqual([{ offerGeneration: 8, round: 1 }]);
  });

  it("treats OCCLUDED the same as UNCERTAIN — both retain presentation continuity", () => {
    let state = accept(createOfferRoundOwnership(), 8);
    state = closeRound(state, 8);
    state = accept(state, 44);

    const flickered = flicker(state, 44, "OCCLUDED");

    expect(flickered.state.activeOwner).toEqual({
      offerGeneration: 45,
      round: 2,
    });
    expect(flickered.state.completedOwners).toEqual([
      { offerGeneration: 8, round: 1 },
    ]);
  });

  it("still completes exactly one round on a genuine close taken after a clear", () => {
    let state = accept(createOfferRoundOwnership(), 8);
    state = closeRound(state, 8);
    state = accept(state, 44);
    const flickered = flicker(state, 44, "UNCERTAIN");
    state = closeRound(flickered.state, flickered.generation);

    // The close arrives while the presentation is already cleared — the round
    // must still complete, or ownership stalls on round 2 forever.
    state = accept(state, 87);

    expect(state.activeOwner).toEqual({ offerGeneration: 87, round: 3 });
    expect(state.completedOwners).toEqual([
      { offerGeneration: 8, round: 1 },
      { offerGeneration: 45, round: 2 },
    ]);
  });

  it("yields exactly four owners across R1→R4 even with flickers in every round", () => {
    let state = createOfferRoundOwnership();
    let generation = 10;
    const rounds: number[] = [];

    for (let round = 1; round <= 4; round += 1) {
      state = accept(state, generation);
      rounds.push(state.activeOwner?.round ?? -1);
      const first = flicker(state, generation, "UNCERTAIN");
      const second = flicker(first.state, first.generation, "OCCLUDED");
      state = second.state;
      expect(state.activeOwner?.round).toBe(round);
      state = closeRound(state, second.generation);
      generation = second.generation + 10;
    }

    // The fourth close leaves its owner pending until the next accepted offer
    // retires it — that is the existing close contract, unchanged here.
    const owners = [...state.completedOwners, state.pendingClosedOwner]
      .filter((owner): owner is NonNullable<typeof owner> => owner != null);

    expect(rounds).toEqual([1, 2, 3, 4]);
    expect(owners.map((owner) => owner.round)).toEqual([1, 2, 3, 4]);
    expect(state.activeOwner).toBeNull();
  });

  it("never creates a fifth round when the fourth round flickers", () => {
    let state = createOfferRoundOwnership();
    let generation = 10;
    for (let round = 1; round <= 4; round += 1) {
      state = accept(state, generation);
      state = closeRound(state, generation);
      generation += 10;
    }
    state = accept(state, generation);
    expect(state.activeOwner).toBeNull();

    const flickered = flicker(state, generation, "UNCERTAIN");

    expect(flickered.state.activeOwner).toBeNull();
    expect(flickered.state.completedOwners.map((owner) => owner.round))
      .toEqual([1, 2, 3, 4]);
    expect(flickered.state.completedOwners.some((owner) => owner.round === 5))
      .toBe(false);
  });

  it("leaves reroll semantics unchanged — the same generation re-observed never advances", () => {
    let state = accept(createOfferRoundOwnership(), 8);
    state = closeRound(state, 8);
    state = accept(state, 44);

    // A one-slot reroll re-accepts the SAME generation repeatedly.
    state = accept(state, 44);
    state = accept(state, 44);

    expect(state.activeOwner).toEqual({ offerGeneration: 44, round: 2 });
    expect(state.completedOwners).toEqual([{ offerGeneration: 8, round: 1 }]);
  });

  it("clears nothing when the surface never left OFFER_VISIBLE", () => {
    expect(presentationClearedGeneration(
      { state: "OFFER_VISIBLE", offerGeneration: 44 },
      { state: "OFFER_VISIBLE", offerGeneration: 44 },
    )).toBeNull();
    expect(presentationClearedGeneration(
      { state: "UNCERTAIN", offerGeneration: 44 },
      { state: "OCCLUDED", offerGeneration: 44 },
    )).toBeNull();
    // NO_OFFER is a genuine close, not a retained presentation.
    expect(presentationClearedGeneration(
      { state: "OFFER_VISIBLE", offerGeneration: 44 },
      { state: "NO_OFFER", offerGeneration: 45 },
    )).toBeNull();
  });
});
