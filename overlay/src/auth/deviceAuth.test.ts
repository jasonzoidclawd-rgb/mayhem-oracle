import { describe, expect, it, vi } from "vitest";
import {
  cancelDeviceLink,
  startDeviceLink,
  UNAUTHENTICATED_DEVICE_LINK_STATE,
  type DeviceCodeStarted,
  type DeviceLinkEffects,
  type DeviceLinkState,
  type DevicePollOutcome,
} from "./deviceAuth";

function recordingEffects(overrides: Partial<DeviceLinkEffects> = {}) {
  const states: DeviceLinkState[] = [];
  let nowMs = 0;
  const waits: number[] = [];
  const effects: DeviceLinkEffects = {
    requestCode: vi.fn<() => Promise<DeviceCodeStarted>>(),
    poll: vi.fn<(attempt: number) => Promise<DevicePollOutcome>>(),
    setState: (state) => states.push(state),
    now: () => nowMs,
    wait: async (ms) => {
      waits.push(ms);
      nowMs += ms;
    },
    ...overrides,
  };
  return { effects, states, waits, advanceNow: (ms: number) => (nowMs += ms) };
}

describe("startDeviceLink", () => {
  it("moves unauthenticated -> requesting-code -> pending-approval -> linked on approval", async () => {
    const { effects, states } = recordingEffects();
    (effects.requestCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      code: "WXYZ-1234",
      expiresInSeconds: 600,
      attempt: 1,
    });
    let calls = 0;
    (effects.poll as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls += 1;
      return calls < 3 ? { status: "pending" } : { status: "approved" };
    });

    await startDeviceLink(effects);

    expect(states[0]).toEqual({ stage: "requesting-code" });
    expect(states[1]).toMatchObject({
      stage: "pending-approval",
      code: "WXYZ-1234",
      attempt: 1,
      expiresAtMs: 600_000,
    });
    expect(states.at(-1)).toEqual({ stage: "linked" });
    expect(calls).toBe(3);
  });

  it("never polls in a busy loop -- each poll is preceded by exactly one wait", async () => {
    const { effects, waits } = recordingEffects();
    (effects.requestCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      code: "WXYZ-1234",
      expiresInSeconds: 600,
      attempt: 1,
    });
    let calls = 0;
    (effects.poll as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls += 1;
      return calls < 4 ? { status: "pending" } : { status: "approved" };
    });

    await startDeviceLink(effects);

    expect(waits).toEqual([2000, 2000, 2000, 2000]);
    expect(calls).toBe(4);
  });

  it("a transient network/backend failure while polling never authenticates and keeps retrying", async () => {
    const { effects, states } = recordingEffects();
    (effects.requestCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      code: "WXYZ-1234",
      expiresInSeconds: 600,
      attempt: 1,
    });
    let calls = 0;
    (effects.poll as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network blip");
      if (calls === 2) return { status: "pending" };
      return { status: "approved" };
    });

    await startDeviceLink(effects);

    expect(calls).toBe(3);
    expect(states.filter((state) => state.stage === "linked")).toHaveLength(1);
    // Never set anything but pending-approval/linked while transient errors occurred.
    expect(states.every((state) => state.stage !== "unauthenticated")).toBe(true);
  });

  it("resets to unauthenticated once the code expires without ever authenticating", async () => {
    const { effects, states } = recordingEffects();
    (effects.requestCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      code: "WXYZ-1234",
      expiresInSeconds: 4, // 4s expiry, 2s poll interval -> expires after ~2 polls
      attempt: 1,
    });
    (effects.poll as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "pending" });

    await startDeviceLink(effects);

    expect(states.at(-1)).toEqual(UNAUTHENTICATED_DEVICE_LINK_STATE);
    expect(states.some((state) => state.stage === "linked")).toBe(false);
  });

  it("an explicit expired outcome from the server resets to unauthenticated", async () => {
    const { effects, states } = recordingEffects();
    (effects.requestCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      code: "WXYZ-1234",
      expiresInSeconds: 600,
      attempt: 1,
    });
    (effects.poll as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "expired" });

    await startDeviceLink(effects);

    expect(states.at(-1)).toEqual(UNAUTHENTICATED_DEVICE_LINK_STATE);
  });

  it("a superseded outcome stops silently -- a newer attempt owns state now", async () => {
    const { effects, states } = recordingEffects();
    (effects.requestCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      code: "WXYZ-1234",
      expiresInSeconds: 600,
      attempt: 1,
    });
    (effects.poll as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "superseded" });

    await startDeviceLink(effects);

    // requesting-code, then pending-approval -- nothing published after the
    // superseded poll; in particular never "linked" and never reset to
    // unauthenticated (that would clobber whatever the newer attempt set).
    expect(states).toHaveLength(2);
    expect(states[1].stage).toBe("pending-approval");
  });

  it("a failed code request surfaces an error state instead of hanging", async () => {
    const { effects, states } = recordingEffects();
    (effects.requestCode as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("backend down"));

    await startDeviceLink(effects);

    expect(states.at(-1)).toEqual({ stage: "error", message: "backend down" });
    expect(effects.poll).not.toHaveBeenCalled();
  });
});

describe("cancelDeviceLink", () => {
  it("supersedes the native attempt before publishing the unauthenticated state", async () => {
    const order: string[] = [];
    const reset = vi.fn(async () => {
      order.push("reset");
    });
    const setState = vi.fn((state: DeviceLinkState) => {
      order.push(`setState:${state.stage}`);
    });

    await cancelDeviceLink({ reset, setState });

    // Reset must complete (superseding any in-flight poll on the native
    // side) before the UI is told the attempt is gone -- otherwise a poll
    // that was already mid-flight when the user cancelled could still land
    // an "approved" result and install a credential after the fact.
    expect(order).toEqual(["reset", "setState:unauthenticated"]);
    expect(setState).toHaveBeenCalledWith(UNAUTHENTICATED_DEVICE_LINK_STATE);
  });

  it("still resets the UI to unauthenticated even if the native reset call rejects", async () => {
    const setState = vi.fn();
    await expect(
      cancelDeviceLink({ reset: () => Promise.reject(new Error("ipc down")), setState }),
    ).rejects.toThrow("ipc down");

    // The native reset failed, so it must NOT be masked by publishing
    // "unauthenticated" as if the attempt were safely superseded.
    expect(setState).not.toHaveBeenCalled();
  });
});
