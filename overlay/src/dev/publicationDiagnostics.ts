import { invoke } from "@tauri-apps/api/core";

export type DiagnosticMarker =
  | "[slot-publication]"
  | "[slot-publication-violation]"
  | "[identity-trigger]"
  | "[identity-start]"
  | "[identity-native-finish]"
  | "[identity-publish]"
  | "[identity-stale-reject]"
  | "[identity-timeout]"
  | "[identity-watchdog-restart]"
  | "[identity-retry]"
  | "[offer-state]"
  | "[offer-session]"
  | "[game-poll]"
  | "[geometry-watchdog]"
  | "[identity-native-return]"
  | "[geometry-timing]"
  | "[geometry-stale-hide]"
  | "[geometry-recovery]";

/** Bounded, irreversible FNV-1a hash; complete OCR text is never logged. */
export function boundedDiagnosticHash(value: string | null | undefined): string | null {
  if (!value) return null;
  let hash = 0x811c9dc5;
  for (const char of value.normalize("NFKC").slice(0, 64)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Pure enable predicate for terminal trace forwarding — split from `import.meta`
 * so it is unit-testable (mirrors `tierFixtureEnabledFrom`). Only a dev build
 * with `MAYHEM_OVERLAY_TRACE=1` forwards the console-only diagnostic stream to
 * the terminal stderr sink.
 */
export function traceForwardingEnabledFrom(input: {
  dev: boolean;
  flag: string | undefined;
}): boolean {
  return input.dev === true && input.flag === "1";
}

function isTraceForwardingEnabled(): boolean {
  const env = (import.meta as unknown as {
    env: { DEV: boolean; MAYHEM_OVERLAY_TRACE?: string };
  }).env;
  return traceForwardingEnabledFrom({ dev: env.DEV, flag: env.MAYHEM_OVERLAY_TRACE });
}

/** Bridge a pre-serialized bounded payload to the terminal stderr sink (best-effort). */
function forwardToNativeSink(marker: DiagnosticMarker, serialized: string): void {
  void invoke("emit_overlay_diagnostic", { marker, payload: serialized }).catch(() => {
    // Best-effort; the WebView console line always runs regardless.
  });
}

/**
 * Development-only structured logging. Production folding removes the call.
 * Console-only by default; with `MAYHEM_OVERLAY_TRACE=1` the same bounded line
 * ALSO reaches terminal stderr, so a tee'd live-game log captures the identity/
 * publication lifecycle (which the coarse `emitNativeDiagnostic` markers omit).
 */
export function logOverlayDiagnostic(
  marker: DiagnosticMarker,
  payload: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  const serialized = JSON.stringify(payload);
  console.info(marker, serialized);
  if (isTraceForwardingEnabled()) forwardToNativeSink(marker, serialized);
}

/**
 * Development-only diagnostic that ALSO reaches TERMINAL stderr via the Rust
 * bridge (not just the WebView console), for controlled retests where the
 * terminal is the only visible sink. Payload must be bounded counts/booleans/
 * enums — never OCR text, names, or account identifiers. Fire-and-forget.
 */
export function emitNativeDiagnostic(
  marker: DiagnosticMarker,
  payload: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  const serialized = JSON.stringify(payload);
  console.info(marker, serialized);
  forwardToNativeSink(marker, serialized);
}
