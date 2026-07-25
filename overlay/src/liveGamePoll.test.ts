import { describe, expect, it } from "vitest";
import {
  LIVE_DATA_FAILURE_GRACE_MS,
  resolveLiveDataPoll,
} from "./liveGamePoll";

describe("live game poll continuity", () => {
  it("preserves an active game across the first transient Live Client miss", () => {
    expect(resolveLiveDataPoll({
      now: 10_000,
      captureAllowed: true,
      liveDataAvailable: false,
      failureStartedAt: null,
    })).toEqual({
      action: "preserve",
      failureStartedAt: 10_000,
      failureAgeMs: 0,
    });
  });

  it("preserves repeated misses only inside the bounded grace window", () => {
    const startedAt = 10_000;
    expect(resolveLiveDataPoll({
      now: startedAt + LIVE_DATA_FAILURE_GRACE_MS,
      captureAllowed: true,
      liveDataAvailable: false,
      failureStartedAt: startedAt,
    }).action).toBe("preserve");

    expect(resolveLiveDataPoll({
      now: startedAt + LIVE_DATA_FAILURE_GRACE_MS + 1,
      captureAllowed: true,
      liveDataAvailable: false,
      failureStartedAt: startedAt,
    }).action).toBe("clear");
  });

  it("clears immediately when gameflow no longer permits live capture", () => {
    expect(resolveLiveDataPoll({
      now: 20_000,
      captureAllowed: false,
      liveDataAvailable: false,
      failureStartedAt: 10_000,
    })).toEqual({
      action: "clear",
      failureStartedAt: null,
      failureAgeMs: 0,
    });
    expect(resolveLiveDataPoll({
      now: 20_000,
      captureAllowed: false,
      liveDataAvailable: true,
      failureStartedAt: 10_000,
    }).action).toBe("clear");
  });

  it("accepts a recovery and resets the failure window", () => {
    expect(resolveLiveDataPoll({
      now: 20_000,
      captureAllowed: true,
      liveDataAvailable: true,
      failureStartedAt: 10_000,
    })).toEqual({
      action: "accept",
      failureStartedAt: null,
      failureAgeMs: 0,
    });
  });

  // A death/respawn can drop port 2999 for 30-60 s — longer than the grace —
  // while the LCU still reports the match InProgress. A FRESH LCU confirmation
  // of a live game is authoritative: a Live Client Data outage, however long, is
  // never proof the match ended (the LCU's own non-live transition is the game
  // boundary, handled separately). Tearing the game down mid-outage sets
  // activeGame=false, which suspends the geometry probe ("not-active-game") so
  // phase never returns to augment_selection and the death-triggered augment
  // badges never render. Preserve indefinitely and reset the failure window.
  it("preserves indefinitely past the grace window while the LCU confirms a live game", () => {
    const startedAt = 10_000;
    expect(resolveLiveDataPoll({
      now: startedAt + LIVE_DATA_FAILURE_GRACE_MS * 10,
      captureAllowed: true,
      liveDataAvailable: false,
      failureStartedAt: startedAt,
      gameflowConfirmedLive: true,
    })).toEqual({
      action: "preserve",
      failureStartedAt: null,
      failureAgeMs: 0,
    });
  });

  // The bounded fail-closed only applies when liveness is UNCONFIRMED — the LCU
  // read itself failed (gameflow == null) and captureAllowed was carried forward.
  // There, retaining game state forever would be unsafe, so grace still expires.
  it("still fails closed past the grace window when the LCU itself is unavailable", () => {
    const startedAt = 10_000;
    expect(resolveLiveDataPoll({
      now: startedAt + LIVE_DATA_FAILURE_GRACE_MS + 1,
      captureAllowed: true,
      liveDataAvailable: false,
      failureStartedAt: startedAt,
      gameflowConfirmedLive: false,
    }).action).toBe("clear");
  });

  // Within grace, an unconfirmed miss still preserves (unchanged) — the new
  // signal only widens preservation, never narrows it.
  it("preserves an unconfirmed miss inside the grace window", () => {
    const startedAt = 10_000;
    expect(resolveLiveDataPoll({
      now: startedAt + LIVE_DATA_FAILURE_GRACE_MS,
      captureAllowed: true,
      liveDataAvailable: false,
      failureStartedAt: startedAt,
      gameflowConfirmedLive: false,
    }).action).toBe("preserve");
  });
});
