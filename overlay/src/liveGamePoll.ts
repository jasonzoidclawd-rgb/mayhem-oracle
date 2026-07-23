/**
 * A short Live Client Data outage is not proof that the active match ended.
 * Death/respawn transitions can briefly make port 2999 unavailable even while
 * LCU still considers the game live. Preserve the last confirmed game state for
 * a bounded interval so geometry/OCR ownership survives that transient, then
 * fail closed if no usable player snapshot returns.
 */
// `get_live_player_data` performs three sequential requests with a 3 s native
// timeout each. Thirty seconds covers three worst-case poll attempts (27 s)
// without allowing an unavailable data source to retain game state indefinitely.
export const LIVE_DATA_FAILURE_GRACE_MS = 30_000;

// Measured core budget: foreground 1.5 s + gameflow 3 s + three sequential
// Live Client Data requests at 3 s each = 13.5 s.
export const LIVE_GAME_POLL_OWNER_DEADLINE_MS = 15_000;

// Optional member verification has its own 20 s native timeout.
export const LIVE_GAME_POLL_MEMBER_DEADLINE_MS = 25_000;

export interface LiveGamePollOwner {
  runId: number; startedAt: number; timeoutDeadline: number;
}

export type LiveGamePollClaim =
  | { kind: "start"; owner: LiveGamePollOwner }
  | { kind: "replace"; owner: LiveGamePollOwner; supersededRunId: number }
  | { kind: "queued"; owner: LiveGamePollOwner };

export type LiveGamePollRelease = "released" | "restart" | "stale";

/**
 * Renderer deadline covers Tauri dispatch/WebView hangs outside native request
 * timeouts. Continuations publish only while current; stale release is a no-op.
 */
export class LiveGamePollOwnerRegistry {
  private nextRunId = 0;
  current: LiveGamePollOwner | null = null;
  pending = false;

  claim(now: number): LiveGamePollClaim {
    if (this.current && now < this.current.timeoutDeadline) {
      this.pending = true;
      return { kind: "queued", owner: this.current };
    }

    const supersededRunId = this.current?.runId;
    const owner: LiveGamePollOwner = {
      runId: (this.nextRunId += 1),
      startedAt: now,
      timeoutDeadline: now + LIVE_GAME_POLL_OWNER_DEADLINE_MS,
    };
    this.current = owner;
    this.pending = false;
    return supersededRunId == null
      ? { kind: "start", owner }
      : { kind: "replace", owner, supersededRunId };
  }

  isCurrent(runId: number): boolean {
    return this.current?.runId === runId;
  }

  renew(runId: number, now: number, durationMs = LIVE_GAME_POLL_MEMBER_DEADLINE_MS): boolean {
    if (this.current?.runId !== runId) return false;
    this.current.timeoutDeadline = now + durationMs;
    return true;
  }

  release(runId: number): LiveGamePollRelease {
    if (this.current?.runId !== runId) return "stale";
    const restart = this.pending;
    this.current = null;
    this.pending = false;
    return restart ? "restart" : "released";
  }

  invalidate(): LiveGamePollOwner | null {
    const previous = this.current;
    this.current = null;
    this.pending = false;
    return previous;
  }
}

export type LiveDataPollAction = "accept" | "preserve" | "clear";

export interface LiveDataPollDecision {
  action: LiveDataPollAction;
  failureStartedAt: number | null;
  failureAgeMs: number;
}

export function resolveLiveDataPoll(input: {
  now: number;
  captureAllowed: boolean;
  liveDataAvailable: boolean;
  failureStartedAt: number | null;
  graceMs?: number;
}): LiveDataPollDecision {
  if (!input.captureAllowed) {
    return { action: "clear", failureStartedAt: null, failureAgeMs: 0 };
  }

  if (input.liveDataAvailable) {
    return { action: "accept", failureStartedAt: null, failureAgeMs: 0 };
  }

  const failureStartedAt = input.failureStartedAt ?? input.now;
  const failureAgeMs = Math.max(0, input.now - failureStartedAt);
  const graceMs = input.graceMs ?? LIVE_DATA_FAILURE_GRACE_MS;
  return {
    action: failureAgeMs <= graceMs ? "preserve" : "clear",
    failureStartedAt,
    failureAgeMs,
  };
}
