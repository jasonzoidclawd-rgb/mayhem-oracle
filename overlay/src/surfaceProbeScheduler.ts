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
 *   - abandon → the in-flight guard has been held past the bounded timeout, so
 *               the logical request is released. NO replacement is issued: a JS
 *               deadline cannot cancel a native capture, so the only thing a
 *               second invoke can do is deepen the queue that is making the
 *               first one slow. Recovery is the settle, and it needs no
 *               foreground toggle or component remount.
 */

/** Target cadence: 4 probes/second — sub-second detection without 20 ms OCR. */
export const PROBE_INTERVAL_MS = 250;
/**
 * A probe held longer than this releases its LOGICAL guard.
 *
 * Deliberately unchanged. The 2026-07-27 trace showed this deadline sitting
 * below the end-to-end round trip it actually times (roundTripMs > 2000 in 20 of
 * 22 samples in the R4 window, median 4001, max 9575), which turns a watchdog
 * into a load generator of fixed period: offered rate 1/D instead of 1/S, so
 * utilization S/D ≈ 1.9 > 1 and the queue never drains. Raising D would hide
 * that; making the timeout stop issuing work removes it. The deadline now only
 * releases ownership, so a slow-but-healthy probe costs nothing.
 */
export const PROBE_TIMEOUT_MS = 2000;
/**
 * Max native calls issued but not yet settled — ONE.
 *
 * A JS-side deadline cannot cancel an OS capture (`lib.rs:745-750` says so
 * outright: the permit lives in the blocking worker and is released only when
 * that worker truly returns). So an abandoned probe still runs to completion,
 * still holds one of the four Rust capture permits, and still ships its result.
 * Every "replacement" issued against it was pure added load on the exact
 * resource that was scarce.
 *
 * The previous value of 2 was not the cause of the collapse but it was the only
 * thing bounding it — it converted an unbounded blowup into a bounded permanent
 * stall (2 outstanding, 4 s round trips) instead of the ~70 outstanding and
 * 47–63 s round trips an uncapped run produced. One removes the pathology
 * rather than bounding it: at most one native geometry capture can be in flight,
 * so the queue depth this scheduler contributes is provably zero.
 */
export const MAX_OUTSTANDING_NATIVE_PROBES = 1;

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
  /**
   * Release logical ownership without issuing another native call. The caller
   * must NOT advance the capture sequence here: with no replacement in flight
   * the outstanding probe's own result is still the newest evidence, and
   * invalidating it is what drove goodput to zero while the machine ran at 100%
   * utilization.
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
      // Watchdog: the logical request has waited past the bounded timeout.
      // Release ownership ONLY. There is no "stuck" state a second invoke can
      // repair — abandoning is not cancelling, so the native call is still
      // running and still holding its capture permit, and a replacement merely
      // queues behind it. The settle is the recovery event.
      return { kind: "abandon", reason: "in-flight-timeout" };
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
