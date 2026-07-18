import { describe, expect, it } from "vitest";
import { resolveRoundDelivery, TOTAL_AUGMENT_ROUNDS } from "./roundDelivery";
import { resolveScanActivation } from "./scanActivation";
import {
  applyScanToOffer,
  emptyOfferState,
  offerActive,
  type OfferState,
} from "./offerLifecycle";
import { buildVisibleFrame, validateOfferSurface, visibleFrameRenderable } from "./visibleOfferFrame";
import type { PhysicalRect } from "./calibration";

// The real death-triggered R2 offer from the 01:52:34 retest, described
// verbatim (no pixel capture was supplied for this state, so this is a
// state-machine replay; the R1 pixel replay covers the OCR-from-image path).
const DEATH_OFFER = ["旋風鉤", "不祥契約", "靈光一閃"] as const;

// Only real augment names resolve — garbage OCR over combat does not, exactly
// as the live catalog lookup behaves.
const KNOWN = new Set<string>(DEATH_OFFER);
const normalize = (title: string) => title.trim();
const validate = (resolution: string) => resolution.startsWith("resolved:");
const resolve = (title: string) => (KNOWN.has(title) ? `resolved:${title}` : `unmatched:${title}`);

function freshRects(): Array<PhysicalRect | null> {
  return [0, 1, 2].map((i) => ({ x: 100 + i * 200, y: 250, width: 180, height: 60 }));
}

// Mirror App.tsx exactly: fresh validated count is gated on surfaceVisible, so
// a grace-retained latch never validates a hidden surface.
function freshValidatedSlots(state: OfferState<string>): number {
  return state.surfaceVisible
    ? state.slots.filter((slot) => slot.fingerprint !== null && slot.validated).length
    : 0;
}

/** Simulate one scan of the death offer and return the visible frame it would
 *  publish, exactly as App.tsx does: apply → validate surface → build frame. */
function scanDeathOffer(prev: OfferState<string>) {
  const applied = applyScanToOffer(prev, [...DEATH_OFFER], normalize, resolve, validate);
  const surface = validateOfferSurface({
    cropsCaptured: 3,
    validatedSlots: freshValidatedSlots(applied.state),
    latched: prev.latched,
  });
  const frame = buildVisibleFrame({
    revision: prev.generation + 1,
    captureSeq: prev.generation + 1,
    offerState: applied.state,
    freshRects: freshRects(),
    surfaceValidated: surface.validated,
  });
  return { applied, surface, frame };
}

describe("post-death R2 activation — visual surface overrides telemetry", () => {
  it("scans and renders the death-triggered offer on the canonical sequence", () => {
    // R1 completed → ordinary gameplay → level 11 alive (no offer) → dies at 12.
    const aliveAt11 = resolveScanActivation({
      gameWindowForeground: true,
      phase: "in_game",
      scanMode: resolveRoundDelivery({
        playerLevel: 11,
        isDead: false,
        completedRounds: 1,
        offerLatched: false,
      }).scanMode,
      selectionCompleted: false,
    });
    // Alive at a crossed threshold: a probe runs, but no surface is present so
    // nothing renders (validated=false below is what matters).
    expect(aliveAt11).not.toBe("none");

    const deadAt12 = resolveRoundDelivery({
      playerLevel: 12,
      isDead: true,
      completedRounds: 1,
      offerLatched: false,
    });
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "in_game",
        scanMode: deadAt12.scanMode,
        selectionCompleted: false,
      }),
    ).not.toBe("none");

    // The three-card surface appears → currentOfferSurfaceValidated=true →
    // crops → OCR → slot resolution → chips renderable.
    const { applied, surface, frame } = scanDeathOffer(emptyOfferState<string>());
    expect(surface.validated).toBe(true);
    expect(offerActive(applied.state)).toBe(true);
    expect(frame.surfaceValidated).toBe(true);
    expect(frame.slots.filter((slot) => slot.cardRect !== null)).toHaveLength(3);
    expect(visibleFrameRenderable(frame, true)).toBe(true);
    expect(applied.state.slots.map((slot) => slot.resolution)).toEqual(
      DEATH_OFFER.map((title) => `resolved:${title}`),
    );
  });

  it("still scans and renders under every stale-bookkeeping injection", () => {
    // Telemetry may estimate the wrong round, but must NEVER veto scanning a
    // visible surface. Each injection deliberately breaks the round count.
    const injections = [
      { label: "activeOfferRound too high", completedRounds: 0, extra: {} },
      { label: "completedRoundCount undercounted", completedRounds: 0, extra: {} },
      { label: "completedRoundCount overcounted by one", completedRounds: 2, extra: {} },
      { label: "pendingRoundCount zero (overcounted to eligible)", completedRounds: TOTAL_AUGMENT_ROUNDS, extra: {} },
    ];

    for (const injection of injections) {
      const decision = resolveRoundDelivery({
        playerLevel: 12,
        isDead: true,
        completedRounds: injection.completedRounds,
        offerLatched: false,
      });
      const activation = resolveScanActivation({
        gameWindowForeground: true,
        phase: "in_game", // stale phase still in_game
        scanMode: decision.scanMode,
        selectionCompleted: false,
      });
      expect(activation, injection.label).not.toBe("none");

      const { surface, frame } = scanDeathOffer(emptyOfferState<string>());
      expect(surface.validated, injection.label).toBe(true);
      expect(visibleFrameRenderable(frame, true), injection.label).toBe(true);
    }
  });

  it("overcounted rounds drive scanMode 'off' — the exact veto that suppressed 01:52", () => {
    const decision = resolveRoundDelivery({
      playerLevel: 12,
      isDead: true,
      completedRounds: TOTAL_AUGMENT_ROUNDS, // pending 0 → scanMode off
      offerLatched: false,
    });
    expect(decision.scanMode).toBe("off");
    // Before the fix this returned "none" and the visible offer was never
    // scanned. Now it probes.
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "in_game",
        scanMode: "off",
        selectionCompleted: false,
      }),
    ).toBe("ambient-probe");
  });
});

describe("normal gameplay renders zero slots", () => {
  it("does not validate a surface from combat noise or a single stray match", () => {
    // No readable card titles (combat): nothing latches, nothing renders.
    const combat = scanCombat([null, null, null], false);
    expect(combat.surface.validated).toBe(false);
    expect(combat.frame.slots).toEqual([]);
    expect(visibleFrameRenderable(combat.frame, true)).toBe(false);

    // One stray region matches a name over gameplay: still not an offer.
    const stray = scanCombat(["旋風鉤", "噪音亂碼", "隨機文字"], false);
    expect(stray.surface.validated).toBe(false);
    expect(stray.frame.slots).toEqual([]);
  });

  it("clears a completed offer to an empty frame once the surface is gone", () => {
    // A validated offer, then the cards close (combat): the very next scan
    // publishes an empty frame — no chip lingers over combat/respawn.
    const offer = applyScanToOffer(
      emptyOfferState<string>(),
      [...DEATH_OFFER],
      normalize,
      resolve,
      validate,
    ).state;
    expect(offer.latched).toBe(true);

    const afterClose = scanCombat([null, null, null], offer.latched, offer);
    expect(afterClose.surface.validated).toBe(false);
    expect(afterClose.frame.slots).toEqual([]);
    expect(visibleFrameRenderable(afterClose.frame, true)).toBe(false);
  });
});

function scanCombat(
  titles: Array<string | null>,
  latched: boolean,
  prev: OfferState<string> = emptyOfferState<string>(),
) {
  const applied = applyScanToOffer(prev, titles, normalize, resolve, validate);
  const surface = validateOfferSurface({
    cropsCaptured: 3,
    validatedSlots: freshValidatedSlots(applied.state),
    latched,
  });
  const frame = buildVisibleFrame({
    revision: 1,
    captureSeq: 1,
    offerState: applied.state,
    freshRects: freshRects(),
    surfaceValidated: surface.validated,
  });
  return { applied, surface, frame };
}
