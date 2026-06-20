/**
 * Canonical site origin, single source of truth for metadata, sitemap, robots,
 * and JSON-LD. Set NEXT_PUBLIC_SITE_URL in the environment (e.g. the production
 * Vercel domain). The fallback is a placeholder — replace via env in prod.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://mayhemoracle.com"
).replace(/\/$/, "");

/**
 * Operator contact address, surfaced on the Contact page and in legal copy.
 * Placeholder — set NEXT_PUBLIC_CONTACT_EMAIL in prod to a monitored inbox.
 */
export const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@mayhemoracle.com";

/**
 * "Last updated" stamp shown on Terms and Privacy. Bump when the operator
 * reviews and revises the legal copy. ISO date, rendered per-locale.
 */
export const LEGAL_LAST_UPDATED = "2026-06-20";

import { routing, type Locale } from "@/i18n/routing";

/**
 * Builds an absolute URL for a path under a given locale, honoring next-intl's
 * `as-needed` prefix policy (default locale has no prefix).
 */
export function localizedUrl(path: string, locale: Locale = routing.defaultLocale): string {
  const clean = path === "/" ? "" : path.replace(/^(?!\/)/, "/");
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${SITE_URL}${prefix}${clean}`;
}

/**
 * hreflang alternates map for a path across every supported locale, for use in
 * Next.js `alternates.languages` and sitemap entries.
 */
export function languageAlternates(path: string): Record<string, string> {
  return Object.fromEntries(
    routing.locales.map((locale) => [locale, localizedUrl(path, locale)]),
  );
}
