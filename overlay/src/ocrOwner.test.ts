import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_OCR_RETRY_MS,
  MAX_OCR_RETRY_MS,
  NATIVE_OCR_TIMEOUT_MS,
  OCR_WATCHDOG_CADENCE_MS,
  VISIBLE_SCANNING_FAILURES,
  OcrOwnerRegistry,
  executeOcrRun,
  failurePublication,
  nextRetryDelay,
  ownerCurrent,
  requestedPendingStates,
  type OcrOwnerContext,
} from "./ocrOwner";

const FP = ["10".repeat(72), "1100".repeat(36), "1110".repeat(36)];

function context(overrides: Partial<OcrOwnerContext> = {}): OcrOwnerContext {
  return {
    foregroundEpoch: 1,
    gameEpoch: 2,
    championGeneration: 3,
    championId: "56",
    offerGeneration: 4,
    requestedSlots: [0, 2],
    slotGenerations: [5, 6, 7],
    fingerprints: FP,
    ...overrides,
  };
}

describe("explicit OCR owner", () => {
  it("documents the measured timeout, retry and watchdog policy", () => {
    expect(NATIVE_OCR_TIMEOUT_MS).toBe(2_000);
    expect(INITIAL_OCR_RETRY_MS).toBe(750);
    expect(MAX_OCR_RETRY_MS).toBe(6_000);
    expect(VISIBLE_SCANNING_FAILURES).toBe(2);
    expect(OCR_WATCHDOG_CADENCE_MS).toBe(150);
  });

  it("has at most one current owner and replacement invalidates the old run", () => {
    const owners = new OcrOwnerRegistry();
    const old = owners.start(context(), 100);
    const replacement = owners.start(context({ offerGeneration: 5 }), 200);
    expect(owners.current).toBe(replacement);
    expect(ownerCurrent(old, owners.current, context({ offerGeneration: 5 }))).toBe(false);
  });

  it.each([
    ["foreground loss", { foregroundEpoch: 2 }],
    ["active game ends", { gameEpoch: 3 }],
    ["champion changes", { championGeneration: 4, championId: "103" }],
    ["slot rerolls", { slotGenerations: [5, 6, 8] }],
    ["offer closes", { offerGeneration: 5 }],
    ["new chained offer", { offerGeneration: 6 }],
  ])("rejects publication when %s during OCR", (_label, overrides) => {
    const owners = new OcrOwnerRegistry();
    const owner = owners.start(context(), 100);
    expect(ownerCurrent(owner, owners.current, context(overrides))).toBe(false);
  });

  it("an old run cannot release a replacement owner", () => {
    const owners = new OcrOwnerRegistry();
    const old = owners.start(context(), 100);
    const replacement = owners.start(context(), 200);
    expect(owners.release(old.runId)).toBe(false);
    expect(owners.current).toBe(replacement);
    expect(owners.release(replacement.runId)).toBe(true);
    expect(owners.current).toBeNull();
  });

  it("timeout invalidates exactly that owner and late completion stays stale", () => {
    const owners = new OcrOwnerRegistry();
    const timedOut = owners.start(context(), 100);
    expect(owners.expire(timedOut.runId, timedOut.timeoutDeadline - 1)).toBe(false);
    expect(owners.expire(timedOut.runId, timedOut.timeoutDeadline)).toBe(true);
    const replacement = owners.start(context(), 3_000);
    expect(ownerCurrent(timedOut, owners.current, context())).toBe(false);
    expect(owners.current).toBe(replacement);
  });
});

describe("native timeout and failure recovery", () => {
  it("times out when the native OCR promise never resolves", async () => {
    vi.useFakeTimers();
    const result = executeOcrRun(
      () => new Promise<string>(() => {}),
      (value) => value,
      25,
    );
    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toEqual({ kind: "failure", reason: "timeout" });
    vi.useRealTimers();
  });

  it("ignores a native completion that arrives after timeout", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const native = new Promise<string>((resolve) => { finish = resolve; });
    const result = executeOcrRun(() => native, (value) => value, 25);
    await vi.advanceTimersByTimeAsync(25);
    finish("late");
    await expect(result).resolves.toEqual({ kind: "failure", reason: "timeout" });
    vi.useRealTimers();
  });

  it("a timed-out run completing after replacement cannot release that replacement", () => {
    const owners = new OcrOwnerRegistry();
    const timedOut = owners.start(context(), 0);
    expect(owners.expire(timedOut.runId, NATIVE_OCR_TIMEOUT_MS)).toBe(true);
    const replacement = owners.start(context(), NATIVE_OCR_TIMEOUT_MS + 1);
    expect(owners.release(timedOut.runId)).toBe(false);
    expect(owners.current).toBe(replacement);
  });

  it("contains a synchronous native throw", async () => {
    await expect(executeOcrRun(
      () => { throw new Error("sync"); },
      (value) => value,
      25,
    )).resolves.toEqual({ kind: "failure", reason: "sync" });
  });

  it("contains an asynchronous native rejection", async () => {
    await expect(executeOcrRun(
      async () => { throw new Error("async"); },
      (value) => value,
      25,
    )).resolves.toEqual({ kind: "failure", reason: "async" });
  });

  it("contains identity matching failures", async () => {
    await expect(executeOcrRun(
      async () => "title",
      () => { throw new Error("match"); },
      25,
    )).resolves.toEqual({ kind: "failure", reason: "match" });
  });

  it("uses bounded exponential retry for one, two and five failures", () => {
    expect(nextRetryDelay(1)).toBe(750);
    expect(nextRetryDelay(2)).toBe(1_500);
    expect(nextRetryDelay(5)).toBe(6_000);
  });

  it("moves SCANNING to OCR ERROR and allows a later success", async () => {
    expect(failurePublication(1, 100)).toMatchObject({ state: "scanning" });
    expect(failurePublication(2, 100)).toMatchObject({ state: "scanning" });
    expect(failurePublication(3, 100)).toMatchObject({ state: "ocr-error" });
    expect(failurePublication(5, 100)).toMatchObject({ state: "ocr-error", failureCount: 5 });
    await expect(executeOcrRun(async () => "valid", (value) => value, 25)).resolves.toEqual({
      kind: "success",
      value: "valid",
    });
  });

  it("only requested slots enter pending state", () => {
    expect(requestedPendingStates([0, 2])).toEqual(["scanning", "unchanged", "scanning"]);
  });

  it("a long-idle new offer can start after an earlier timeout", () => {
    const owners = new OcrOwnerRegistry();
    const first = owners.start(context(), 0);
    expect(owners.expire(first.runId, NATIVE_OCR_TIMEOUT_MS)).toBe(true);
    const later = owners.start(context({ offerGeneration: 9 }), 60_000);
    expect(later.runId).toBeGreaterThan(first.runId);
    expect(owners.current).toBe(later);
  });
});
