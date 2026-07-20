export type DiagnosticMarker =
  | "[slot-publication]"
  | "[identity-trigger]"
  | "[identity-start]"
  | "[identity-native-finish]"
  | "[identity-publish]"
  | "[identity-stale-reject]"
  | "[identity-timeout]"
  | "[identity-watchdog-restart]"
  | "[identity-retry]"
  | "[offer-state]";

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
