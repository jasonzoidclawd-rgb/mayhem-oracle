import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "zh-TW", "zh-CN", "ja", "ko"],
  defaultLocale: "en",
  localePrefix: "as-needed", // no /en/ prefix for default locale
});

export type Locale = (typeof routing.locales)[number];
