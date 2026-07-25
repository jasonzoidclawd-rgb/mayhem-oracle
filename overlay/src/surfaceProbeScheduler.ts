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
/**
 * Max native calls issued but not yet settled. A watchdog restart abandons
 * LOGICAL ownership but cannot cancel the native invoke, so the old call stays
 * outstanding. Without this cap each restart added another invoke: the live
 * trace showed healthy native work (nativeElapsedMs ~610 ms) behind a 47–63 s
 * roundTripMs and ~70 outstanding calls, so no result ever arrived fresh and
 * level 15 rendered nothing. Two = one active logical request plus one latest
 * pending replacement.
 */
export const MAX_OUTSTANDING_NATIVE_PROBES = 2;

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
  /**
   * Native calls issued but not yet settled, INCLUDING ones whose logical
   * ownership the watchdog already abandoned. Abandoning is not cancelling.
   */
  nativeOutstanding: number;
}

export interface ProbeSchedulerConfig {
  intervalMs: number;
  timeoutMs: number;
}

export type ProbeAction =
  | { kind: "start" }
  | { kind: "skip"; reason: string }
  | { kind: "restart"; reason: string }
  /**
   * Release logical ownership so a late result can never publish, but do NOT
   * issue another native call — the backlog is already at the cap.
   */
  | { kind: "abandon"; reason: string };

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
  const backlogged = state.nativeOutstanding >= MAX_OUTSTANDING_NATIVE_PROBES;
  if (state.inFlight) {
    if (state.inFlightSince != null && now - state.inFlightSince >= config.timeoutMs) {
      // Watchdog: a probe that never completed within the bounded timeout is
      // stuck (hung IPC, lost promise). Invalidate it and re-arm — but only
      // issue a replacement while the native backlog is beneath the cap.
      // Otherwise release ownership alone, or restarts compound the very IPC
      // backlog that is delaying the results.
      return backlogged
        ? { kind: "abandon", reason: "native-backlog" }
        : { kind: "restart", reason: "in-flight-timeout" };
    }
    return { kind: "skip", reason: "in-flight" };
  }
  if (backlogged) return { kind: "skip", reason: "native-backlog" };
  if (
    state.lastProbeStartedAt == null ||
    now - state.lastProbeStartedAt >= config.intervalMs
  ) {
    return { kind: "start" };
  }
  return { kind: "skip", reason: "not-due" };
}
