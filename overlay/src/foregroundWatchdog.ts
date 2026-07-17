/**
 * Foreground truth must never freeze. Two live-retest failure modes drive
 * this module:
 *
 *  - a native foreground poll that never settles left the LAST state latched
 *    forever (an in-flight guard with no deadline): development panels stayed
 *    painted over Terminal, and the game never re-gained foreground;
 *  - a poll that cannot produce fresh truth must degrade to "unknown"
 *    (everything hidden) — hiding is always the safe direction.
 */

export const FOREGROUND_POLL_TIMEOUT_MS = 1500;
export const FOREGROUND_POLL_STUCK_MS = 3000;

/**
 * A new poll may start when none is in flight, or when the in-flight one has
 * been stuck past the deadline — a hung native call must never block
 * foreground truth indefinitely.
 */
export function foregroundPollMayStart(
  nowMs: number,
  inFlightSinceMs: number | null,
): boolean {
  return inFlightSinceMs === null || nowMs - inFlightSinceMs >= FOREGROUND_POLL_STUCK_MS;
}

/** Resolve with `fallback` when `promise` does not settle within `timeoutMs`. */
export async function resolveWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
