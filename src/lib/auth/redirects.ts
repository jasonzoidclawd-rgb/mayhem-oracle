import { SITE_URL } from "@/lib/site";

const blockedNextPathPrefixes = ["/api", "/auth", "/_next", "/_vercel"];

export function safeNextPath(value: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return "/";
  }
  let nextUrl: URL;
  try {
    nextUrl = new URL(trimmed, "https://local.invalid");
  } catch {
    return "/";
  }
  if (nextUrl.origin !== "https://local.invalid") return "/";

  const pathname = nextUrl.pathname;
  if (
    blockedNextPathPrefixes.some((prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return "/";
  }

  return `${pathname}${nextUrl.search}${nextUrl.hash}`;
}

export function authCallbackUrl(): string {
  return new URL("/auth/callback", `${SITE_URL}/`).toString();
}

export function canonicalRedirect(next: string): string {
  return new URL(next, `${SITE_URL}/`).toString();
}

export function canonicalRedirectWithError(next: string, error: string): string {
  const url = new URL(next, `${SITE_URL}/`);
  url.searchParams.set("error", error);
  return url.toString();
}
