// Per-user fixed-window rate limiter. In-process only: on serverless this
// bounds each warm instance rather than the global rate, which is acceptable
// for a $0 v1 — the entitlement gate in front of it is the real barrier.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweepAt = 0;

// Evict expired buckets so keys that are never seen again don't accumulate for
// the life of a warm instance. Bounded: sweeps at most once per windowMs.
function sweepExpired(now: number, windowMs: number): void {
  if (now - lastSweepAt < windowMs) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  { limit, windowMs, now = Date.now() }: RateLimitOptions,
): RateLimitVerdict {
  sweepExpired(now, windowMs);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count < limit) {
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

export function resetRateLimits(): void {
  buckets.clear();
  lastSweepAt = 0;
}
