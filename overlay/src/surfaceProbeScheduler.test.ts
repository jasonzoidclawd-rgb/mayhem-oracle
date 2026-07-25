import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROBE_CONFIG,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  MAX_OUTSTANDING_NATIVE_PROBES,
  nextProbeAction,
  type ProbeSchedulerState,
} from "./surfaceProbeScheduler";
import { GEOMETRY_INTERVAL_MS } from "./surfaceGeometry";

const base: ProbeSchedulerState = {
  foreground: true,
  activeGame: true,
  inFlight: false,
  inFlightSince: null,
  lastProbeStartedAt: null,
  nativeOutstanding: 0,
};

describe("nextProbeAction — self-healing, telemetry-independent", () => {
  it("starts immediately when foreground + active game and never probed", () => {
    expect(nextProbeAction(base, DEFAULT_PROBE_CONFIG, 1000)).toEqual({ kind: "start" });
  });

  it("respects the ~250ms cadence between starts", () => {
    const state = { ...base, lastProbeStartedAt: 1000 };
    expect(nextProbeAction(state, DEFAULT_PROBE_CONFIG, 1000 + 100)).toEqual({
      kind: "skip",
      reason: "not-due",
    });
    expect(nextProbeAction(state, DEFAULT_PROBE_CONFIG, 1000 + PROBE_INTERVAL_MS)).toEqual({
      kind: "start",
    });
  });

  it("never runs two probes at once (one in flight => skip)", () => {
    const state = { ...base, inFlight: true, inFlightSince: 1000, lastProbeStartedAt: 1000 };
    expect(nextProbeAction(state, DEFAULT_PROBE_CONFIG, 1000 + PROBE_INTERVAL_MS)).toEqual({
      kind: "skip",
      reason: "in-flight",
    });
  });

  it("watchdog restarts a probe stuck in flight past the bounded timeout", () => {
    const state = { ...base, inFlight: true, inFlightSince: 1000, lastProbeStartedAt: 1000 };
    expect(nextProbeAction(state, DEFAULT_PROBE_CONFIG, 1000 + PROBE_TIMEOUT_MS)).toEqual({
      kind: "restart",
      reason: "in-flight-timeout",
    });
  });

  it("recovers a wedged scheduler: timeout → restart → next tick starts fresh", () => {
    // A probe wedged in flight past the timeout: the reducer asks for a restart.
    const wedged = { ...base, inFlight: true, inFlightSince: 1000, lastProbeStartedAt: 1000 };
    expect(nextProbeAction(wedged, DEFAULT_PROBE_CONFIG, 1000 + PROBE_TIMEOUT_MS)).toEqual({
      kind: "restart",
      reason: "in-flight-timeout",
    });
    // Once the restart tick resets the guard (inFlight=false), the very next
    // tick starts a fresh probe — recovery needs no remount or focus toggle.
    const recovered = { ...base, inFlight: false, inFlightSince: null, lastProbeStartedAt: 1000 };
    expect(nextProbeAction(recovered, DEFAULT_PROBE_CONFIG, 1000 + PROBE_TIMEOUT_MS)).toEqual({
      kind: "start",
    });
  });

  it("has no 'asleep' state: any foreground in-game tick starts, however old the last probe", () => {
    // Defect B (level-15 offer that never scanned): the scheduler is a pure
    // reducer with no internal memory, so a probe that last ran 60 s ago — under
    // any telemetry — still starts on the next foreground in-game tick.
    const longIdle = { ...base, lastProbeStartedAt: 1000 };
    expect(nextProbeAction(longIdle, DEFAULT_PROBE_CONFIG, 1000 + 60_000)).toEqual({ kind: "start" });
  });

  it("skips while the game is not foreground or no active game", () => {
    expect(nextProbeAction({ ...base, foreground: false }, DEFAULT_PROBE_CONFIG, 5000)).toEqual({
      kind: "skip",
      reason: "not-foreground",
    });
    expect(nextProbeAction({ ...base, activeGame: false }, DEFAULT_PROBE_CONFIG, 5000)).toEqual({
      kind: "skip",
      reason: "not-active-game",
    });
  });

  it("keeps probing across a long-running game (many ticks, still due later)", () => {
    // Simulate a long game: last probe ages out repeatedly and always re-arms.
    let lastStart = 0;
    for (let tick = 1; tick <= 2000; tick += 1) {
      const now = tick * PROBE_INTERVAL_MS;
      const action = nextProbeAction(
        { ...base, lastProbeStartedAt: lastStart },
        DEFAULT_PROBE_CONFIG,
        now,
      );
      expect(action.kind).toBe("start");
      lastStart = now;
    }
  });

  it("keeps the 150 ms geometry track alive through 2000 completed negative probes", () => {
    const geometryConfig = {
      intervalMs: GEOMETRY_INTERVAL_MS,
      timeoutMs: PROBE_TIMEOUT_MS,
    };
    let lastStart: number | null = null;
    for (let tick = 0; tick < 2000; tick += 1) {
      const now = tick * GEOMETRY_INTERVAL_MS;
      expect(
        nextProbeAction({ ...base, lastProbeStartedAt: lastStart }, geometryConfig, now),
      ).toEqual({ kind: "start" });
      lastStart = now;
    }
    expect(
      nextProbeAction(
        { ...base, lastProbeStartedAt: lastStart },
        geometryConfig,
        2000 * GEOMETRY_INTERVAL_MS,
      ),
    ).toEqual({ kind: "start" });
  });
});

/**
 * Backlog coalescing. A watchdog restart abandons LOGICAL ownership but cannot
 * cancel the native invoke, so the old call stays outstanding. The live trace
 * (mayhem-four-phase-postfix-20260726-014355.log) showed the consequence: native
 * work stayed healthy (nativeElapsedMs ~610 ms) while roundTripMs reached
 * 47–63 s and ~70 invokes were outstanding — every 2.1 s watchdog restart added
 * one more. Geometry must therefore keep at most one active logical request plus
 * one latest pending replacement.
 */
describe("native-outstanding coalescing", () => {
  const cfg = DEFAULT_PROBE_CONFIG;

  it("abandons ownership WITHOUT issuing another native call at the cap", () => {
    const action = nextProbeAction(
      {
        ...base,
        inFlight: true,
        inFlightSince: 0,
        nativeOutstanding: MAX_OUTSTANDING_NATIVE_PROBES,
      },
      cfg,
      PROBE_TIMEOUT_MS,
    );
    expect(action).toEqual({ kind: "abandon", reason: "native-backlog" });
  });

  it("still restarts normally while beneath the cap", () => {
    const action = nextProbeAction(
      { ...base, inFlight: true, inFlightSince: 0, nativeOutstanding: 1 },
      cfg,
      PROBE_TIMEOUT_MS,
    );
    expect(action).toEqual({ kind: "restart", reason: "in-flight-timeout" });
  });

  it("does not start a fresh probe while the native backlog is at the cap", () => {
    const action = nextProbeAction(
      {
        ...base,
        inFlight: false,
        lastProbeStartedAt: null,
        nativeOutstanding: MAX_OUTSTANDING_NATIVE_PROBES,
      },
      cfg,
      10_000,
    );
    expect(action).toEqual({ kind: "skip", reason: "native-backlog" });
  });

  it("resumes starting once outstanding native calls drain", () => {
    expect(
      nextProbeAction(
        { ...base, inFlight: false, lastProbeStartedAt: null, nativeOutstanding: 0 },
        cfg,
        10_000,
      ),
    ).toEqual({ kind: "start" });
  });

  it("bounds outstanding calls across a sustained 60 s IPC backlog", () => {
    // Replays the observed failure: the native side never resolves, so every
    // tick for 60 s sees inFlight with an expired deadline. Outstanding native
    // calls must never exceed the cap (the trace reached ~70).
    let outstanding = 0;
    let inFlight = false;
    let inFlightSince: number | null = null;
    let peak = 0;
    for (let now = 0; now <= 60_000; now += GEOMETRY_INTERVAL_MS) {
      const action = nextProbeAction(
        { ...base, inFlight, inFlightSince, lastProbeStartedAt: null, nativeOutstanding: outstanding },
        { intervalMs: GEOMETRY_INTERVAL_MS, timeoutMs: PROBE_TIMEOUT_MS },
        now,
      );
      if (action.kind === "start" || action.kind === "restart") {
        outstanding += 1; // native call issued; never resolves in this scenario
        inFlight = true;
        inFlightSince = now;
      } else if (action.kind === "abandon") {
        inFlight = false;
        inFlightSince = null;
      }
      peak = Math.max(peak, outstanding);
    }
    expect(peak).toBeLessThanOrEqual(MAX_OUTSTANDING_NATIVE_PROBES);
  });
});
