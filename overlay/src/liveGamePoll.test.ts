import { describe, expect, it } from "vitest";
import {
  LIVE_DATA_FAILURE_GRACE_MS,
  resolveLiveDataPoll,
} from "./liveGamePoll";

describe("live game poll continuity", () => {
  it("preserves an active game across the first transient Live Client miss", () => {
    expect(resolveLiveDataPoll({
      now: 10_000,
      captureAllowed: true,
      liveDataAvailable: false,
      failureStartedAt: null,
    })).toEqual({
      action: "preserve",
      failureStartedAt: 10_000,
      failureAgeMs: 0,
    });
  });

  it("preserves repeated misses only inside the bounded grace window", () => {
    const startedAt = 10_000;
    expect(resolveLiveDataPoll({
      now: startedAt + LIVE_DATA_FAILURE_GRACE_MS,
      captureAllowed: true,
      liveDataAvailable: false,
      failureStartedAt: startedAt,
    }).action).toBe("preserve");

    expect(resolveLiveDataPoll({
      now: startedAt + LIVE_DATA_FAILURE_GRACE_MS + 1,
      captureAllowed: true,
      liveDataAvailable: false,
      failureStartedAt: startedAt,
    }).action).toBe("clear");
  });

  it("clears immediately when gameflow no longer permits live capture", () => {
    expect(resolveLiveDataPoll({
      now: 20_000,
      captureAllowed: false,
      liveDataAvailable: false,
      failureStartedAt: 10_000,
    })).toEqual({
      action: "clear",
      failureStartedAt: null,
      failureAgeMs: 0,
    });
    expect(resolveLiveDataPoll({
      now: 20_000,
      captureAllowed: false,
      liveDataAvailable: true,
      failureStartedAt: 10_000,
    }).action).toBe("clear");
  });

  it("accepts a recovery and resets the failure window", () => {
    expect(resolveLiveDataPoll({
      now: 20_000,
      captureAllowed: true,
      liveDataAvailable: true,
      failureStartedAt: 10_000,
    })).toEqual({
      action: "accept",
      failureStartedAt: null,
      failureAgeMs: 0,
    });
  });
});
