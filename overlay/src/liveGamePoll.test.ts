import { describe, expect, it } from "vitest";
import {
  LIVE_GAME_POLL_MEMBER_DEADLINE_MS,
  LIVE_GAME_POLL_OWNER_DEADLINE_MS,
  LIVE_DATA_FAILURE_GRACE_MS,
  LiveGamePollOwnerRegistry,
  resolveLiveDataPoll,
} from "./liveGamePoll";

describe("live game poll owner", () => {
  it("documents a deadline just above the measured core native request budget", () => {
    expect(LIVE_GAME_POLL_OWNER_DEADLINE_MS).toBe(15_000);
    expect(LIVE_GAME_POLL_MEMBER_DEADLINE_MS).toBe(25_000);
  });

  it("single-flights a healthy owner and records one pending replacement", () => {
    const owners = new LiveGamePollOwnerRegistry();
    const first = owners.claim(1_000);
    expect(first.kind).toBe("start");
    const queued = owners.claim(2_000);
    expect([queued.kind, owners.pending]).toEqual(["queued", true]);
    expect(owners.release(first.owner.runId)).toBe("restart");
    expect([owners.current, owners.pending]).toEqual([null, false]);
  });

  it("replaces an overdue owner without waiting for its promise to settle", () => {
    const owners = new LiveGamePollOwnerRegistry();
    const first = owners.claim(1_000);
    const replacement = owners.claim(first.owner.timeoutDeadline);
    expect(replacement.kind).toBe("replace");
    expect(replacement.owner.runId).toBeGreaterThan(first.owner.runId);
    expect(owners.current).toBe(replacement.owner);
    expect([
      owners.isCurrent(first.owner.runId),
      owners.isCurrent(replacement.owner.runId),
    ]).toEqual([false, true]);
  });

  it("prevents a late owner from releasing its replacement", () => {
    const owners = new LiveGamePollOwnerRegistry();
    const first = owners.claim(1_000);
    const replacement = owners.claim(first.owner.timeoutDeadline);
    expect(owners.release(first.owner.runId)).toBe("stale");
    expect(owners.current).toBe(replacement.owner);
    expect(owners.release(replacement.owner.runId)).toBe("released");
    expect(owners.current).toBeNull();
  });

  it("renews only the current owner for the bounded member-verification tail", () => {
    const owners = new LiveGamePollOwnerRegistry();
    const first = owners.claim(1_000);
    expect(owners.renew(first.owner.runId, 5_000)).toBe(true);
    const deadline = 5_000 + LIVE_GAME_POLL_MEMBER_DEADLINE_MS;
    expect(owners.current?.timeoutDeadline).toBe(deadline);
    const replacement = owners.claim(deadline);
    expect(owners.renew(first.owner.runId, 40_000)).toBe(false);
    expect(owners.current).toBe(replacement.owner);
  });

});

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
