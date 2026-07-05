import { describe, expect, test, vi } from "vitest";
import {
  generateGoogleNonce,
  sha256Hex,
  signInWithGoogleCredential,
} from "@/lib/auth/google-identity";

describe("Google sign-in nonce hardening", () => {
  test("sha256Hex matches a known vector", async () => {
    await expect(sha256Hex("test")).resolves.toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
  });

  test("generateGoogleNonce yields a base64url nonce and its SHA-256 pair", async () => {
    const pair = await generateGoogleNonce();

    expect(pair).not.toBeNull();
    expect(pair!.nonce).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    await expect(sha256Hex(pair!.nonce)).resolves.toBe(pair!.hashedNonce);
  });

  test("consecutive nonces are unique", async () => {
    const [a, b] = await Promise.all([generateGoogleNonce(), generateGoogleNonce()]);
    expect(a!.nonce).not.toBe(b!.nonce);
  });

  test("signInWithIdToken receives the raw nonce when provided", async () => {
    const signInWithIdToken = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const supabase = { auth: { signInWithIdToken } };

    await signInWithGoogleCredential(
      supabase,
      { credential: "google-id-token" },
      { nonce: "raw-nonce-value" },
    );

    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "google-id-token",
      nonce: "raw-nonce-value",
    });
  });

  test("signInWithIdToken stays nonce-less when no nonce is supplied", async () => {
    const signInWithIdToken = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const supabase = { auth: { signInWithIdToken } };

    await signInWithGoogleCredential(supabase, { credential: "google-id-token" }, {});

    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "google-id-token",
    });
  });
});
