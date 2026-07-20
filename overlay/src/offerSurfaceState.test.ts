import { describe, expect, it } from "vitest";
import {
  advanceOfferSurface,
  createOfferSurfaceState,
  renderPublicationAllowed,
  type OfferSurfaceEvidence,
} from "./offerSurfaceState";

const visible = (overrides: Partial<OfferSurfaceEvidence> = {}): OfferSurfaceEvidence => ({
  now: 100,
  captureValid: true,
  blueControlPresent: true,
  blueControlConfidence: 0.9,
  validCardCount: 3,
  occlusionReason: null,
  hiddenEvidence: false,
  newOfferEvidence: false,
  ...overrides,
});

describe("offer surface state machine", () => {
  it("blue control plus valid cards is OFFER_VISIBLE", () => {
    const next = advanceOfferSurface(createOfferSurfaceState(), visible());
    expect(next.state).toBe("OFFER_VISIBLE");
    expect(next.render).toBe(true);
  });

  it("cards and control absent is NO_OFFER and renders nothing", () => {
    const prior = advanceOfferSurface(createOfferSurfaceState(), visible());
    const next = advanceOfferSurface(prior, visible({ now: 200, validCardCount: 0, blueControlPresent: false }));
    expect(next.state).toBe("NO_OFFER");
    expect(next.render).toBe(false);
    expect(next.offerGeneration).toBeGreaterThan(prior.offerGeneration);
  });

  it.each(["shop", "afk-modal", "scoreboard", "settings"])(
    "%s is OCCLUDED and immediately renders zero",
    (reason) => {
      const prior = advanceOfferSurface(createOfferSurfaceState(), visible());
      const next = advanceOfferSurface(prior, visible({ now: 200, occlusionReason: reason }));
      expect(next.state).toBe("OCCLUDED");
      expect(next.render).toBe(false);
    },
  );

  it("valid combat evidence is NO_OFFER", () => {
    const next = advanceOfferSurface(createOfferSurfaceState(), visible({
      validCardCount: 0,
      blueControlPresent: false,
    }));
    expect(next.state).toBe("NO_OFFER");
  });

  it("capture failure is UNCERTAIN and continuity expires at the health bound", () => {
    const prior = advanceOfferSurface(createOfferSurfaceState(), visible({ now: 100 }));
    const within = advanceOfferSurface(prior, visible({ now: 1_000, captureValid: false }));
    const expired = advanceOfferSurface(within, visible({ now: 1_500, captureValid: false }));
    expect(within.state).toBe("UNCERTAIN");
    expect(within.render).toBe(true);
    expect(expired.state).toBe("UNCERTAIN");
    expect(expired.render).toBe(false);
  });

  it("late publication after NO_OFFER or OCCLUDED cannot restore output", () => {
    const visibleState = advanceOfferSurface(createOfferSurfaceState(), visible());
    const noOffer = advanceOfferSurface(visibleState, visible({ validCardCount: 0, blueControlPresent: false }));
    const occluded = advanceOfferSurface(visibleState, visible({ occlusionReason: "shop" }));
    expect(renderPublicationAllowed(visibleState.offerGeneration, noOffer)).toBe(false);
    expect(renderPublicationAllowed(visibleState.offerGeneration, occluded)).toBe(false);
  });

  it("does not classify OFFER_HIDDEN without genuine hidden evidence", () => {
    const uncertain = advanceOfferSurface(createOfferSurfaceState(), visible({ validCardCount: 0 }));
    expect(uncertain.state).toBe("UNCERTAIN");
    const hidden = advanceOfferSurface(createOfferSurfaceState(), visible({
      validCardCount: 0,
      hiddenEvidence: true,
    }));
    expect(hidden.state).toBe("OFFER_HIDDEN");
    expect(hidden.render).toBe(false);
  });

  it("explicit negative evidence overrides uncertainty continuity", () => {
    const prior = advanceOfferSurface(createOfferSurfaceState(), visible());
    const noOffer = advanceOfferSurface(prior, visible({
      now: 101,
      validCardCount: 0,
      blueControlPresent: false,
    }));
    expect(noOffer.state).toBe("NO_OFFER");
    expect(noOffer.render).toBe(false);
  });
});
