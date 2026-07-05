import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "zh-TW", "zh-CN", "ja", "ko"],
  defaultLocale: "en",
  localePrefix: "as-needed", // no /en/ prefix for default locale
});

export type Locale = (typeof routing.locales)[number];

export function isSupportedLocale(locale: string): locale is Locale {
  return routing.locales.includes(locale as Locale);
}

const PREFIXED_LOCALES = routing.locales.filter(
  (locale) => locale !== routing.defaultLocale,
);

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
