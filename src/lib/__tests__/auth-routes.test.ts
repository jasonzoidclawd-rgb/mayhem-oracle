import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const exchangeCodeForSession = vi.fn();
const signOut = vi.fn();
const intlMiddleware = vi.hoisted(() => vi.fn(() => undefined));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession,
      signOut,
    },
  })),
}));

vi.mock("next-intl/middleware", () => ({
  default: () => intlMiddleware,
}));

describe("auth routes", () => {
  beforeEach(() => {
    vi.resetModules();
    exchangeCodeForSession.mockReset();
    signOut.mockReset();
    intlMiddleware.mockClear();
    process.env.NEXT_PUBLIC_SITE_URL = "https://wasfun.lol";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://krmyzbcoifdpgrszcfun.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  test("legacy sign-in route does not start a Supabase Google OAuth redirect", async () => {
    const { GET } = await import("@/app/api/auth/signin/route");
    const response = await GET(
      new Request("https://mayhem-oracle.vercel.app/api/auth/signin?next=%2Faccount"),
    );

    expect(response.headers.get("location")).toBe(
      "https://wasfun.lol/account?error=google_identity_required",
    );
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

  test("rejects auth, API, and framework next destinations", async () => {
    const { safeNextPath } = await import("@/lib/auth/redirects");

    const blockedPaths = [
      "/auth/callback",
      "/api/admin/entitlements",
      "/_next/static/chunk.js",
      "/_vercel/insights/view",
      "/API/admin/entitlements",
      "/Auth/callback",
      "/%61pi/admin/entitlements",
      "/%2561pi/admin/entitlements",
      "/%61uth/callback",
      "/zh-TW/auth/callback",
      "/en/api/x",
      "/zh-TW/%61pi/x",
      "/%7A%68-TW/%61uth/callback",
      "/%2fapi/x",
      "/%5capi/x",
      "/%2e%2e/api/x",
      "/zh-TW/account/../auth/callback",
      "/%c0%afapi",
      "/%252525252525252525252561pi/x",
    ];

    for (const blockedPath of blockedPaths) {
      expect(safeNextPath(blockedPath), blockedPath).toBe("/");
    }

    expect(safeNextPath("/zh-TW/account")).toBe("/zh-TW/account");
    expect(safeNextPath("/environment/account")).toBe("/environment/account");
    expect(safeNextPath("/authors")).toBe("/authors");
    expect(safeNextPath("/apiary")).toBe("/apiary");
    expect(safeNextPath("/account?tab=billing#top")).toBe("/account?tab=billing#top");
    expect(safeNextPath("/account")).toBe("/account");
  });

  test("callback preserves localized account destinations after successful exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const { GET } = await import("@/app/auth/callback/route");
    const response = await GET(
      new Request("https://wasfun.lol/auth/callback?code=abc&next=%2Fzh-TW%2Faccount"),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe("https://wasfun.lol/zh-TW/account");
  });

  test("signout clears the Supabase session and returns to a canonical public URL", async () => {
    signOut.mockResolvedValue({ error: null });

    const { POST } = await import("@/app/api/auth/signout/route");
    const response = await POST(
      new Request("https://wasfun.lol/api/auth/signout?next=%2Fauth%2Fcallback", {
        method: "POST",
      }),
    );

    expect(signOut).toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://wasfun.lol/");
  });

  test("account page gates private account data and renders the signout action", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/account/page.tsx"),
      "utf8",
    );

    expect(source.indexOf("if (!user)")).toBeGreaterThan(-1);
    expect(source.indexOf('supabase.from("entitlements")')).toBeGreaterThan(
      source.indexOf("if (!user)"),
    );
    expect(source.indexOf('from("decision_sessions")')).toBeGreaterThan(
      source.indexOf("if (!user)"),
    );
    expect(source).toContain(
      'const signoutNext = `/${locale}`;',
    );
    expect(source).toContain(
      "action={`/api/auth/signout?next=${encodeURIComponent(signoutNext)}`}",
    );
    expect(source).toContain('method="post"');
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
