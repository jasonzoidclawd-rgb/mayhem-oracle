import { describe, expect, it } from "vitest";
import {
  applyScanToOffer,
  emptyOfferState,
  offerActive,
  type OfferState,
} from "./offerLifecycle";
import { resolveScanActivation } from "./scanActivation";
import { resolveRoundDelivery } from "./roundDelivery";

// The exact R1 offer from the 18:53:40 failed retest (champion level 3):
// three validated cards visible while the overlay showed nothing.
const R1_TITLES = ["魔法導彈", "天界之身", "頂尖發明家"] as const;

const normalize = (title: string) => title.trim();
const validate = (resolution: string) => resolution.startsWith("resolved:");

function makeResolver() {
  const calls: Array<{ title: string; regionIndex: number }> = [];
  const resolve = (title: string, regionIndex: number) => {
    calls.push({ title, regionIndex });
    return `resolved:${title}`;
  };
  return { calls, resolve };
}

describe("R1 replay — real three-card screen activates scanning", () => {
  it("attempts a per-card resolution for every one of the three R1 slots", () => {
    const { calls, resolve } = makeResolver();
    const scan = applyScanToOffer(
      emptyOfferState<string>(),
      [...R1_TITLES],
      normalize,
      resolve,
      validate,
    );

    expect(calls).toEqual([
      { title: "魔法導彈", regionIndex: 0 },
      { title: "天界之身", regionIndex: 1 },
      { title: "頂尖發明家", regionIndex: 2 },
    ]);
    expect(scan.state.latched).toBe(true);
    expect(scan.state.surfaceVisible).toBe(true);
    expect(offerActive(scan.state)).toBe(true);
    expect(scan.state.slots.map((slot) => slot.resolution)).toEqual(
      R1_TITLES.map((title) => `resolved:${title}`),
    );
  });

  it("escalates to the fast loop once the R1 offer latches", () => {
    const { resolve } = makeResolver();
    const scan = applyScanToOffer(
      emptyOfferState<string>(),
      [...R1_TITLES],
      normalize,
      resolve,
      validate,
    );
    const decision = resolveRoundDelivery({
      playerLevel: 3,
      isDead: false,
      completedRounds: 0,
      offerLatched: offerActive(scan.state),
    });
    expect(decision.scanMode).toBe("fast");
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "augment_selection",
        scanMode: decision.scanMode,
        selectionCompleted: false,
      }),
    ).toBe("fast-loop");
  });

  it("cannot be suppressed by stale foreground state from an earlier tick", () => {
    // Tick 1: Terminal foreground — no scan runs, and crucially nothing about
    // that tick is stored anywhere the next decision reads from.
    const terminalTick = resolveScanActivation({
      gameWindowForeground: false,
      phase: "in_game",
      scanMode: "ambient",
      selectionCompleted: false,
    });
    expect(terminalTick).toBe("none");

    // Tick 2: GameClient foreground with the R1 screen up. Activation is a
    // pure function of THIS tick's inputs, so the earlier "none" cannot leak
    // forward — the probe runs and the scan latches all three cards.
    const gameTick = resolveScanActivation({
      gameWindowForeground: true,
      phase: "in_game",
      scanMode: "ambient",
      selectionCompleted: false,
    });
    expect(gameTick).toBe("ambient-probe");

    const { calls, resolve } = makeResolver();
    let state: OfferState<string> = emptyOfferState<string>();
    const scan = applyScanToOffer(state, [...R1_TITLES], normalize, resolve, validate);
    state = scan.state;
    expect(calls).toHaveLength(3);
    expect(offerActive(state)).toBe(true);
  });

  it("restores scanning after game → Terminal → game without clearing the latch prematurely", () => {
    const { resolve } = makeResolver();
    let state: OfferState<string> = emptyOfferState<string>();
    state = applyScanToOffer(state, [...R1_TITLES], normalize, resolve, validate).state;
    expect(offerActive(state)).toBe(true);

    // Focus flips to Terminal: activation stops, the offer state is preserved
    // as background state only (no scans applied, no pixels rendered).
    expect(
      resolveScanActivation({
        gameWindowForeground: false,
        phase: "augment_selection",
        scanMode: "fast",
        selectionCompleted: false,
      }),
    ).toBe("none");
    expect(offerActive(state)).toBe(true);

    // Focus returns: the fast loop re-activates and the SAME offer is still
    // latched — the next scan re-confirms it without re-resolving anything.
    expect(
      resolveScanActivation({
        gameWindowForeground: true,
        phase: "augment_selection",
        scanMode: "fast",
        selectionCompleted: false,
      }),
    ).toBe("fast-loop");
    const { calls: rescanCalls, resolve: rescanResolve } = makeResolver();
    const rescan = applyScanToOffer(state, [...R1_TITLES], normalize, rescanResolve, validate);
    expect(rescanCalls).toHaveLength(0);
    expect(offerActive(rescan.state)).toBe(true);
    expect(rescan.state.generation).toBe(state.generation);
  });
});
