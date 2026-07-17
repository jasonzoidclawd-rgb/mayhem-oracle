import { describe, expect, it } from "vitest";
import {
  foregroundPollMayStart,
  resolveWithTimeout,
  FOREGROUND_POLL_STUCK_MS,
  FOREGROUND_POLL_TIMEOUT_MS,
} from "./foregroundWatchdog";

describe("foreground watchdog", () => {
  it("allows a poll when none is in flight", () => {
    expect(foregroundPollMayStart(10_000, null)).toBe(true);
  });

  it("blocks overlapping polls while one is fresh in flight", () => {
    expect(foregroundPollMayStart(10_000, 9_800)).toBe(false);
  });

  it("never lets a hung poll block foreground truth forever", () => {
    // The 18:53 retest failure mode: an in-flight guard with no deadline froze
    // the last classification indefinitely. Once the stuck deadline passes,
    // polling resumes no matter what happened to the old call.
    expect(
      foregroundPollMayStart(10_000 + FOREGROUND_POLL_STUCK_MS, 10_000),
    ).toBe(true);
    expect(
      foregroundPollMayStart(10_000 + FOREGROUND_POLL_STUCK_MS * 100, 10_000),
    ).toBe(true);
  });

  it("degrades a non-settling native call to the fallback state", async () => {
    const never = new Promise<string>(() => {});
    const result = await resolveWithTimeout(never, 5, "unknown");
    expect(result).toBe("unknown");
  });

  it("returns the real value when the call settles in time", async () => {
    const result = await resolveWithTimeout(Promise.resolve("fresh"), 1_000, "unknown");
    expect(result).toBe("fresh");
  });

  it("keeps the stuck deadline no tighter than the poll timeout", () => {
    // A timed-out poll clears its slot in `finally`; the stuck deadline only
    // covers a poll that never reaches `finally`. It must not fire while a
    // healthy timeout race is still pending.
    expect(FOREGROUND_POLL_STUCK_MS).toBeGreaterThan(FOREGROUND_POLL_TIMEOUT_MS);
  });
});
