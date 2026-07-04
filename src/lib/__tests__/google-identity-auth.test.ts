import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, test, vi } from "vitest";
import {
  GOOGLE_IDENTITY_SCRIPT_SRC,
  getGoogleClientId,
  isGoogleIdentityAvailable,
  signInWithGoogleCredential,
} from "@/lib/auth/google-identity";

describe("Google Identity Services auth", () => {
  test("reads NEXT_PUBLIC_GOOGLE_CLIENT_ID for GIS initialization", () => {
    const previous = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "  google-web-client-id.apps.googleusercontent.com  ";

    expect(getGoogleClientId()).toBe("google-web-client-id.apps.googleusercontent.com");
    expect(isGoogleIdentityAvailable()).toBe(true);

    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    } else {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = previous;
    }
  });

  test("missing Google client ID prevents GIS initialization", () => {
    const previous = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

    expect(getGoogleClientId()).toBe("");
    expect(isGoogleIdentityAvailable()).toBe(false);

    if (previous !== undefined) {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = previous;
    }
  });

  test("credential callback signs in with Supabase Google ID token", async () => {
    const signInWithIdToken = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
    const supabase = { auth: { signInWithIdToken } };

    await expect(
      signInWithGoogleCredential(supabase, { credential: "google-id-token" }),
    ).resolves.toEqual({ user: { id: "user-1" } });

    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "google-id-token",
    });
  });

  test("missing credential reports an error before calling Supabase", async () => {
    const signInWithIdToken = vi.fn();
    const supabase = { auth: { signInWithIdToken } };

    await expect(signInWithGoogleCredential(supabase, {})).rejects.toThrow(
      "Missing Google credential",
    );
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  test("Google auth button uses GIS and the public client ID", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/components/auth/GoogleSignInButton.tsx"),
      "utf-8",
    );

    expect(GOOGLE_IDENTITY_SCRIPT_SRC).toBe("https://accounts.google.com/gsi/client");
    expect(source).toContain("GOOGLE_IDENTITY_SCRIPT_SRC");
    expect(source).toContain("NEXT_PUBLIC_GOOGLE_CLIENT_ID");
    expect(source).toContain("accounts.id.initialize");
    expect(source).toContain("accounts.id.renderButton");
  });

  test("user-facing Google login path no longer starts Supabase OAuth", async () => {
    const files = [
      "src/app/api/auth/signin/route.ts",
      "src/app/[locale]/account/page.tsx",
      "src/app/[locale]/advisor/page.tsx",
      "src/app/[locale]/membership/page.tsx",
      "src/app/[locale]/champions/[slug]/page.tsx",
      "src/components/champions/PoolConstructionSection.tsx",
      "src/components/companion/CompanionClient.tsx",
    ];

    const sources = await Promise.all(
      files.map((file) => readFile(path.join(process.cwd(), file), "utf-8")),
    );
    const combined = sources.join("\n");

    const oauthRedirectMethod = ["signIn", "With", "OAuth"].join("");
    expect(combined).not.toContain(oauthRedirectMethod);
    expect(combined).not.toContain("/api/auth/signin?next=");
    expect(combined).toContain("GoogleSignInButton");
  });
});
