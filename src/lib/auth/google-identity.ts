import { routing } from "@/i18n/routing";

export const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

export type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleClientIdEnv = {
  [key: string]: string | undefined;
  NEXT_PUBLIC_GOOGLE_CLIENT_ID?: string;
};

type SupabaseGoogleTokenClient = {
  auth: {
    signInWithIdToken: (args: {
      provider: "google";
      token: string;
      nonce?: string;
    }) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
};

export type GoogleNoncePair = {
  /** Raw nonce, handed to Supabase for hash verification. */
  nonce: string;
  /** SHA-256 hex of the raw nonce, handed to GIS so Google embeds it in the ID token. */
  hashedNonce: string;
};

export function getGoogleClientId(env: GoogleClientIdEnv = process.env): string {
  return env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
}

export function isGoogleIdentityAvailable(env: GoogleClientIdEnv = process.env): boolean {
  return getGoogleClientId(env).length > 0;
}

// Derived from routing.locales so new locales can never break sign-in
// redirects (docs/plans/2026-07-02-full-riot-locale-coverage.md rule 1).
const LOCALE_PREFIX_PATTERN = new RegExp(
  `^/(?:${routing.locales.join("|")})(?=/|$)`,
);

export function normalizeGoogleSignInNextPath(nextPath: string): string {
  const trimmed = nextPath.trim();
  const safePath = trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/\\")
    ? trimmed
    : "/";
  return safePath.replace(LOCALE_PREFIX_PATTERN, "") || "/";
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Replay protection for the GIS → signInWithIdToken flow. Returns null when
 * the Web Crypto API is unavailable (e.g. insecure context) so callers can
 * fall back to the nonce-less flow instead of breaking sign-in entirely.
 */
export async function generateGoogleNonce(): Promise<GoogleNoncePair | null> {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return { nonce, hashedNonce: await sha256Hex(nonce) };
  } catch {
    return null;
  }
}

export async function signInWithGoogleCredential(
  supabase: SupabaseGoogleTokenClient,
  response: GoogleCredentialResponse,
  options: { nonce?: string } = {},
): Promise<unknown> {
  const token = response.credential?.trim();
  if (!token) {
    throw new Error("Missing Google credential");
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token,
    ...(options.nonce ? { nonce: options.nonce } : {}),
  });

  if (error) {
    throw new Error(error.message || "Google sign-in failed");
  }

  return data;
}
