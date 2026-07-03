import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const signInWithOAuth = vi.fn();
const exchangeCodeForSession = vi.fn();
const intlMiddleware = vi.hoisted(() => vi.fn(() => undefined));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signInWithOAuth,
      exchangeCodeForSession,
    },
  })),
}));

vi.mock("next-intl/middleware", () => ({
  default: () => intlMiddleware,
}));

describe("auth routes", () => {
  beforeEach(() => {
    vi.resetModules();
    signInWithOAuth.mockReset();
    exchangeCodeForSession.mockReset();
    intlMiddleware.mockClear();
    process.env.NEXT_PUBLIC_SITE_URL = "https://wasfun.lol";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://krmyzbcoifdpgrszcfun.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  test("uses the canonical site URL for the Supabase OAuth callback and preserves safe next", async () => {
    signInWithOAuth.mockImplementation(async ({ options }) => ({
      data: {
        url: `https://krmyzbcoifdpgrszcfun.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(options.redirectTo)}`,
      },
      error: null,
    }));

    const { GET } = await import("@/app/api/auth/signin/route");
    const response = await GET(
      new Request("https://mayhem-oracle.vercel.app/api/auth/signin?next=%2Faccount"),
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://wasfun.lol/auth/callback?next=%2Faccount",
      },
    });

    const location = response.headers.get("location");
    expect(location).not.toBeNull();

    const redirectTo = new URL(location!).searchParams.get("redirect_to");
    expect(redirectTo).toBe("https://wasfun.lol/auth/callback?next=%2Faccount");
  });

  test("drops unsafe signin next values before building the OAuth callback", async () => {
    signInWithOAuth.mockImplementation(async ({ options }) => ({
      data: {
        url: `https://krmyzbcoifdpgrszcfun.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(options.redirectTo)}`,
      },
      error: null,
    }));

    const { GET } = await import("@/app/api/auth/signin/route");
    await GET(
      new Request("https://mayhem-oracle.vercel.app/api/auth/signin?next=https%3A%2F%2Fevil.example"),
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://wasfun.lol/auth/callback",
      },
    });
  });

  test("exchanges callback codes and returns to the canonical site URL", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const { GET } = await import("@/app/auth/callback/route");
    const response = await GET(
      new Request("https://mayhem-oracle.vercel.app/auth/callback?code=abc&next=%2Faccount"),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe("https://wasfun.lol/account");
  });

  test("sanitizes external callback next values before redirecting", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const { GET } = await import("@/app/auth/callback/route");
    const response = await GET(
      new Request("https://www.wasfun.lol/auth/callback?code=abc&next=%40evil.example"),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe("https://wasfun.lol/");
  });

  test("rescues root auth codes to the callback route", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const { default: proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest("https://wasfun.lol/?code=auth-code&state=provider-state"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://wasfun.lol/auth/callback?code=auth-code&state=provider-state",
    );
  });

  test("canonicalizes www auth code landings directly to the bare callback route", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const { default: proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest("https://www.wasfun.lol/?code=auth-code&state=provider-state"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://wasfun.lol/auth/callback?code=auth-code&state=provider-state",
    );
  });

  test("canonicalizes www requests to the bare production host", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const { default: proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest("https://www.wasfun.lol/champions/brand?tab=build"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://wasfun.lol/champions/brand?tab=build",
    );
  });

  test("lets the auth callback route handle Supabase code exchange", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const { default: proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest("https://wasfun.lol/auth/callback?code=auth-code&state=provider-state"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(intlMiddleware).not.toHaveBeenCalled();
  });
});
