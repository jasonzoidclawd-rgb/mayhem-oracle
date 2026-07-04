import { SITE_URL } from "@/lib/site";

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
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
