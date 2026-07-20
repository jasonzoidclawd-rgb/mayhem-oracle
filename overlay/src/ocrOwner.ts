import { fingerprintChanged } from "./surfaceGeometry";

/**
 * Phase C policy, measured against the existing 2 s native watchdog and 150 ms
 * geometry cadence. Two visible retries fit inside the old 1.5 s retry window;
 * later attempts continue in the background with a 6 s cap without leaving the
 * UI indefinitely in SCANNING.
 */
export const NATIVE_OCR_TIMEOUT_MS = 2_000;
export const INITIAL_OCR_RETRY_MS = 750;
export const MAX_OCR_RETRY_MS = 6_000;
export const VISIBLE_SCANNING_FAILURES = 2;
export const OCR_WATCHDOG_CADENCE_MS = 150;

export type OcrUnresolvedState = "scanning" | "unmatched" | "ocr-error";

export interface OcrOwnerContext {
  foregroundEpoch: number;
  gameEpoch: number;
  championGeneration: number;
  championId: string | null;
  offerGeneration: number;
  requestedSlots: number[];
  slotGenerations: number[];
  fingerprints: string[];
}

export interface OcrOwnerToken extends OcrOwnerContext {
  runId: number;
  startedAt: number;
  timeoutDeadline: number;
}

export function ownerCurrent(
  result: OcrOwnerToken,
  currentOwner: OcrOwnerToken | null,
  current: OcrOwnerContext,
): boolean {
  if (currentOwner?.runId !== result.runId) return false;
  if (
    result.foregroundEpoch !== current.foregroundEpoch ||
    result.gameEpoch !== current.gameEpoch ||
    result.championGeneration !== current.championGeneration ||
    result.championId !== current.championId ||
    result.offerGeneration !== current.offerGeneration
  ) return false;
  return result.requestedSlots.every((slot) =>
    result.slotGenerations[slot] === current.slotGenerations[slot] &&
    !fingerprintChanged(result.fingerprints[slot] ?? "", current.fingerprints[slot] ?? "")
  );
}

export class OcrOwnerRegistry {
  private nextRunId = 0;
  current: OcrOwnerToken | null = null;

  start(context: OcrOwnerContext, startedAt: number): OcrOwnerToken {
    const owner: OcrOwnerToken = {
      ...context,
      requestedSlots: [...context.requestedSlots],
      slotGenerations: [...context.slotGenerations],
      fingerprints: [...context.fingerprints],
      runId: (this.nextRunId += 1),
      startedAt,
      timeoutDeadline: startedAt + NATIVE_OCR_TIMEOUT_MS,
    };
    this.current = owner;
    return owner;
  }

  release(runId: number): boolean {
    if (this.current?.runId !== runId) return false;
    this.current = null;
    return true;
  }

  expire(runId: number, now: number): boolean {
    if (this.current?.runId !== runId || now < this.current.timeoutDeadline) return false;
    this.current = null;
    return true;
  }

  invalidate(): OcrOwnerToken | null {
    const previous = this.current;
    this.current = null;
    return previous;
  }
}

export function nextRetryDelay(failureCount: number): number {
  const exponent = Math.max(0, failureCount - 1);
  return Math.min(MAX_OCR_RETRY_MS, INITIAL_OCR_RETRY_MS * (2 ** exponent));
}

export interface OcrFailurePublication {
  state: OcrUnresolvedState;
  failureCount: number;
  retryAt: number;
}

export function failurePublication(failureCount: number, failedAt: number): OcrFailurePublication {
  return {
    state: failureCount <= VISIBLE_SCANNING_FAILURES ? "scanning" : "ocr-error",
    failureCount,
    retryAt: failedAt + nextRetryDelay(failureCount),
  };
}

export function requestedPendingStates(
  requestedSlots: number[],
): Array<"scanning" | "unchanged"> {
  const requested = new Set(requestedSlots);
  return [0, 1, 2].map((slot) => requested.has(slot) ? "scanning" : "unchanged");
}

export type OcrExecutionResult<T> =
  | { kind: "success"; value: T }
  | { kind: "failure"; reason: string };

export async function executeOcrRun<Native, Matched>(
  invokeNative: () => Promise<Native> | Native,
  match: (native: Native) => Matched,
  timeoutMs = NATIVE_OCR_TIMEOUT_MS,
): Promise<OcrExecutionResult<Matched>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const nativePromise = Promise.resolve().then(invokeNative);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
    const native = await Promise.race([nativePromise, timeout]);
    return { kind: "success", value: match(native) };
  } catch (error) {
    return {
      kind: "failure",
      reason: error instanceof Error ? error.message : "ocr-run-failed",
    };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
