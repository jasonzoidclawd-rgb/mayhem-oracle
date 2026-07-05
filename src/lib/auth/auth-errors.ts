const KNOWN_AUTH_ERRORS = ["google_identity_required", "auth_callback"] as const;

export type KnownAuthError = (typeof KNOWN_AUTH_ERRORS)[number];

/**
 * Map an ?error= query value to a translatable key. Anything unknown maps to
 * null so arbitrary query text can never reach the UI.
 */
export function resolveAuthErrorKey(
  value: string | string[] | null | undefined,
): KnownAuthError | null {
  const single = Array.isArray(value) ? value[0] : value;
  if (!single) return null;
  return (KNOWN_AUTH_ERRORS as readonly string[]).includes(single)
    ? (single as KnownAuthError)
    : null;
}
