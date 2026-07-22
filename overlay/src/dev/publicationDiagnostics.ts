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
  | "[game-poll]";

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

/** Development-only structured logging. Production folding removes the call. */
export function logOverlayDiagnostic(
  marker: DiagnosticMarker,
  payload: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  console.info(marker, JSON.stringify(payload));
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
  void invoke("emit_overlay_diagnostic", { marker, payload: serialized }).catch(() => {
    // The native sink is best-effort; the WebView console line above always runs.
  });
}
