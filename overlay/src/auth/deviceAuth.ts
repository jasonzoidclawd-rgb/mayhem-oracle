import { invoke } from "@tauri-apps/api/core";

/**
 * Desktop device-authorization lifecycle. Rust owns the raw device bearer
 * token end-to-end (request, poll, secure storage, attaching it to member
 * requests) — this module only ever sees a short-lived pairing code (safe to
 * display; the user types it into their browser at wasfun.lol/account) and
 * small status/lifecycle enums. The token value itself never reaches the
 * webview.
 */

export interface DeviceAuthStatus {
  linked: boolean;
}

export interface DeviceCodeStarted {
  code: string;
  expiresInSeconds: number;
  /** Identifies this linking attempt; a superseded poll is discarded. */
  attempt: number;
}

export type DevicePollOutcome =
  | { status: "pending" }
  | { status: "approved" }
  | { status: "expired" }
  | { status: "superseded" };

export function getDeviceAuthStatus(): Promise<DeviceAuthStatus> {
  return invoke<DeviceAuthStatus>("device_auth_status");
}

export function requestDeviceCode(): Promise<DeviceCodeStarted> {
  return invoke<DeviceCodeStarted>("device_request_code");
}

export function pollDeviceLink(attempt: number): Promise<DevicePollOutcome> {
  return invoke<DevicePollOutcome>("device_poll", { attempt });
}

export function resetDeviceAuth(): Promise<void> {
  return invoke("device_reset");
}

// ─── Lifecycle state machine ────────────────────────────────────────────────
// UNAUTHENTICATED -> REQUESTING_CODE -> PENDING_APPROVAL -> LINKED, mirroring
// member.ts's MemberVerificationState pattern: pure state + injected effects,
// so the polling logic is fully unit-testable without React or Tauri.

export type DeviceLinkState =
  | { stage: "unauthenticated" }
  | { stage: "requesting-code" }
  | { stage: "pending-approval"; code: string; attempt: number; expiresAtMs: number }
  | { stage: "linked" }
  | { stage: "error"; message: string };

export const UNAUTHENTICATED_DEVICE_LINK_STATE: DeviceLinkState = { stage: "unauthenticated" };

const DEVICE_POLL_INTERVAL_MS = 2000;

export interface DeviceLinkEffects {
  requestCode: () => Promise<DeviceCodeStarted>;
  poll: (attempt: number) => Promise<DevicePollOutcome>;
  setState: (state: DeviceLinkState) => void;
  now: () => number;
  wait: (ms: number) => Promise<void>;
}

/**
 * Drives one linking attempt end to end: request a code, publish it for
 * display, then poll until approved, expired, or superseded by a newer
 * attempt. A transient network/backend failure while polling is swallowed
 * and retried on the next tick — it must never be mistaken for expiry or
 * denial, and must never authenticate anything on its own.
 */
export async function startDeviceLink(effects: DeviceLinkEffects): Promise<void> {
  effects.setState({ stage: "requesting-code" });
  let started: DeviceCodeStarted;
  try {
    started = await effects.requestCode();
  } catch (error) {
    effects.setState({
      stage: "error",
      message: error instanceof Error ? error.message : "device-code-request-failed",
    });
    return;
  }

  const expiresAtMs = effects.now() + started.expiresInSeconds * 1000;
  effects.setState({
    stage: "pending-approval",
    code: started.code,
    attempt: started.attempt,
    expiresAtMs,
  });

  await pollUntilSettled(started.attempt, expiresAtMs, effects);
}

export interface DeviceLinkCancelEffects {
  /** Invalidates the native in-flight attempt (device_reset). */
  reset: () => Promise<void>;
  setState: (state: DeviceLinkState) => void;
}

/**
 * Cancelling a pending link must supersede the native attempt before
 * publishing the unauthenticated state back to the UI. Without this, a poll
 * already in flight on the Rust side keeps running after the user backs out
 * and can still install a credential moments later.
 */
export async function cancelDeviceLink(effects: DeviceLinkCancelEffects): Promise<void> {
  await effects.reset();
  effects.setState(UNAUTHENTICATED_DEVICE_LINK_STATE);
}

async function pollUntilSettled(
  attempt: number,
  expiresAtMs: number,
  effects: DeviceLinkEffects,
): Promise<void> {
  for (;;) {
    if (effects.now() >= expiresAtMs) {
      effects.setState(UNAUTHENTICATED_DEVICE_LINK_STATE);
      return;
    }
    await effects.wait(DEVICE_POLL_INTERVAL_MS);

    let outcome: DevicePollOutcome;
    try {
      outcome = await effects.poll(attempt);
    } catch {
      // Transient network/backend failure — keep polling on the same
      // attempt rather than treating this tick as expiry or denial.
      continue;
    }

    if (outcome.status === "pending") continue;
    if (outcome.status === "superseded") return; // a newer attempt owns state now
    if (outcome.status === "expired") {
      effects.setState(UNAUTHENTICATED_DEVICE_LINK_STATE);
      return;
    }
    effects.setState({ stage: "linked" });
    return;
  }
}
