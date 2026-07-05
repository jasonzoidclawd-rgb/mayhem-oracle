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
    }) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
};

export function getGoogleClientId(env: GoogleClientIdEnv = process.env): string {
  return env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
}

export function isGoogleIdentityAvailable(env: GoogleClientIdEnv = process.env): boolean {
  return getGoogleClientId(env).length > 0;
}

export function normalizeGoogleSignInNextPath(nextPath: string): string {
  const trimmed = nextPath.trim();
  const safePath = trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/\\")
    ? trimmed
    : "/";
  return safePath.replace(/^\/(?:en|zh-TW|zh-CN|ja|ko)(?=\/|$)/, "") || "/";
}

export async function signInWithGoogleCredential(
  supabase: SupabaseGoogleTokenClient,
  response: GoogleCredentialResponse,
): Promise<unknown> {
  const token = response.credential?.trim();
  if (!token) {
    throw new Error("Missing Google credential");
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token,
  });

  if (error) {
    throw new Error(error.message || "Google sign-in failed");
  }

  return data;
}
