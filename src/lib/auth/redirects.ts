import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site";

const blockedNextPathPrefixes = ["/api", "/auth", "/_next", "/_vercel"];
const MAX_POLICY_DECODE_ITERATIONS = 6;

function repeatedlyDecodePath(pathname: string): string | null {
  let decoded = pathname;
  for (let index = 0; index < MAX_POLICY_DECODE_ITERATIONS; index += 1) {
    let nextDecoded: string;
    try {
      nextDecoded = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (nextDecoded === decoded) return decoded;
    decoded = nextDecoded;
  }
  return null;
}

function normalizePolicyPath(pathname: string): string | null {
  if (pathname.includes("\\")) return null;
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;

  try {
    const normalizedUrl = new URL(pathname, "https://local.invalid");
    if (normalizedUrl.origin !== "https://local.invalid") return null;
    return normalizedUrl.pathname;
  } catch {
    return null;
  }
}

function stripLocalePrefix(pathname: string): string {
  const lowerPathname = pathname.toLowerCase();

  for (const locale of routing.locales) {
    const lowerPrefix = `/${locale.toLowerCase()}`;
    if (lowerPathname === lowerPrefix) return "/";
    if (lowerPathname.startsWith(`${lowerPrefix}/`)) {
      return pathname.slice(lowerPrefix.length) || "/";
    }
  }

  return pathname;
}

function hasBlockedNextPathPrefix(pathname: string): boolean {
  const lowerPathname = pathname.toLowerCase();
  return blockedNextPathPrefixes.some(
    (prefix) => lowerPathname === prefix || lowerPathname.startsWith(`${prefix}/`),
  );
}

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
  const decodedPolicyPath = repeatedlyDecodePath(pathname);
  if (!decodedPolicyPath) return "/";

  const normalizedPolicyPath = normalizePolicyPath(decodedPolicyPath);
  if (!normalizedPolicyPath) return "/";

  const unlocalizedPolicyPath = stripLocalePrefix(normalizedPolicyPath);
  if (hasBlockedNextPathPrefix(unlocalizedPolicyPath)) {
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
