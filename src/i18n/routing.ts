import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "zh-TW", "zh-CN", "ja", "ko"],
  defaultLocale: "en",
  // Always prefix the locale. With Next 16's production router, rewriting an
  // unprefixed default-locale URL to /en while also canonicalizing /en back to
  // the unprefixed URL creates a redirect loop. A single / -> /en redirect is
  // explicit, crawlable, and keeps every rendered route on one contract.
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

export function isSupportedLocale(locale: string): locale is Locale {
  return routing.locales.includes(locale as Locale);
}

const PREFIXED_LOCALES = routing.locales;

/**
 * Collapse accidentally doubled locale prefixes (/zh-TW/zh-TW/account →
 * /zh-TW/account), which past locale-aware redirects produced. Returns the
 * fixed pathname, or null when the pathname is already well-formed.
 */
export function collapseDuplicateLocalePrefix(pathname: string): string | null {
  for (const locale of PREFIXED_LOCALES) {
    const doubled = `/${locale}/${locale}`;
    if (pathname === doubled || pathname.startsWith(`${doubled}/`)) {
      const collapsed = pathname.slice(locale.length + 1);
      return collapseDuplicateLocalePrefix(collapsed) ?? collapsed;
    }
  }
  return null;
}
