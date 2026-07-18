import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROBE_CONFIG,
  FRAME_FRESHNESS_TTL_MS,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  frameWithinTtl,
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

describe("frameWithinTtl — fail closed when the scheduler stalls", () => {
  it("keeps a fresh frame and expires a stale one", () => {
    expect(frameWithinTtl(1000, 1000 + 200, FRAME_FRESHNESS_TTL_MS)).toBe(true);
    expect(frameWithinTtl(1000, 1000 + FRAME_FRESHNESS_TTL_MS, FRAME_FRESHNESS_TTL_MS)).toBe(true);
    expect(frameWithinTtl(1000, 1000 + FRAME_FRESHNESS_TTL_MS + 1, FRAME_FRESHNESS_TTL_MS)).toBe(
      false,
    );
    expect(frameWithinTtl(null, 5000, FRAME_FRESHNESS_TTL_MS)).toBe(false);
  });
});
