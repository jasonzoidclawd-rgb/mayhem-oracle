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
  /**
   * The LCU gameflow FRESHLY confirmed a live match this poll (a non-null
   * sample reporting an in-progress game), as opposed to `captureAllowed` being
   * carried forward across a missing LCU read. When the LCU independently
   * confirms the match is live, a Live Client Data (port 2999) outage — even one
   * far longer than the grace window, as a death/respawn can cause — is never
   * proof the match ended, so the game is preserved indefinitely. The bounded
   * fail-closed below applies only when liveness is UNCONFIRMED (LCU also
   * unavailable), where retaining state forever would be unsafe.
   */
  gameflowConfirmedLive?: boolean;
  graceMs?: number;
}): LiveDataPollDecision {
  if (!input.captureAllowed) {
    return { action: "clear", failureStartedAt: null, failureAgeMs: 0 };
  }

  if (input.liveDataAvailable) {
    return { action: "accept", failureStartedAt: null, failureAgeMs: 0 };
  }

  if (input.gameflowConfirmedLive) {
    return { action: "preserve", failureStartedAt: null, failureAgeMs: 0 };
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
