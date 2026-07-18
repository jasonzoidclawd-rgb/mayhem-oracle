/**
 * The self-healing surface-probe scheduler decision function.
 *
 * A SINGLE probe runs on a fixed cadence while the GameClient is foreground and
 * an active game is running — and NOTHING else gates it. Round bookkeeping,
 * scanMode, champion level/death, phase, and prior cancellations may change the
 * round LABEL but can never stop the probe (that was the permanent-sleep bug:
 * scanning lived inside the 1.5 s poll's conditional branches and a stuck flag
 * or stale phase left it asleep indefinitely).
 *
 * `nextProbeAction` is a pure reducer so the liveness rules are unit-testable
 * without timers. The React effect owns a fixed interval and calls it each tick:
 *   - start   → acquire the in-flight guard and run one probe;
 *   - skip    → do nothing this tick (reason is diagnostic only);
 *   - restart → the in-flight guard has been held past the bounded timeout, so
 *               the previous run is stuck: the watchdog invalidates it, releases
 *               the guard, and starts fresh — recovery needs no foreground
 *               toggle or component remount.
 */

/** Target cadence: 4 probes/second — sub-second detection without 20 ms OCR. */
export const PROBE_INTERVAL_MS = 250;
/** A probe held longer than this is considered stuck; the watchdog restarts it. */
export const PROBE_TIMEOUT_MS = 2000;
/** A rendered frame older than this hides — a dead scheduler fails closed. */
export const FRAME_FRESHNESS_TTL_MS = 500;

export interface ProbeSchedulerState {
  /** Actual GameClient foreground (fresh this tick). */
  foreground: boolean;
  /** Live Client reports an active game / capture allowed (fresh this tick). */
  activeGame: boolean;
  /** A probe is currently in flight. */
  inFlight: boolean;
  /** Monotonic clock when the in-flight probe started, or null. */
  inFlightSince: number | null;
  /** Monotonic clock when the last probe STARTED, or null (never). */
  lastProbeStartedAt: number | null;
}

export interface ProbeSchedulerConfig {
  intervalMs: number;
  timeoutMs: number;
}

export type ProbeAction =
  | { kind: "start" }
  | { kind: "skip"; reason: string }
  | { kind: "restart"; reason: string };

export const DEFAULT_PROBE_CONFIG: ProbeSchedulerConfig = {
  intervalMs: PROBE_INTERVAL_MS,
  timeoutMs: PROBE_TIMEOUT_MS,
};

export function nextProbeAction(
  state: ProbeSchedulerState,
  config: ProbeSchedulerConfig,
  now: number,
): ProbeAction {
  if (!state.foreground) return { kind: "skip", reason: "not-foreground" };
  if (!state.activeGame) return { kind: "skip", reason: "not-active-game" };
  if (state.inFlight) {
    if (state.inFlightSince != null && now - state.inFlightSince >= config.timeoutMs) {
      // Watchdog: a probe that never completed within the bounded timeout is
      // stuck (hung IPC, lost promise). Invalidate it and re-arm.
      return { kind: "restart", reason: "in-flight-timeout" };
    }
    return { kind: "skip", reason: "in-flight" };
  }
  if (
    state.lastProbeStartedAt == null ||
    now - state.lastProbeStartedAt >= config.intervalMs
  ) {
    return { kind: "start" };
  }
  return { kind: "skip", reason: "not-due" };
}

/** True while a positive frame is still within its freshness TTL. */
export function frameWithinTtl(
  capturedAt: number | null,
  now: number,
  ttlMs: number = FRAME_FRESHNESS_TTL_MS,
): boolean {
  return capturedAt != null && now - capturedAt <= ttlMs;
}
