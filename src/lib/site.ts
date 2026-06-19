/**
 * Canonical site origin, single source of truth for metadata, sitemap, robots,
 * and JSON-LD. Set NEXT_PUBLIC_SITE_URL in the environment (e.g. the production
 * Vercel domain). The fallback is a placeholder — replace via env in prod.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://mayhemoracle.com"
).replace(/\/$/, "");

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
