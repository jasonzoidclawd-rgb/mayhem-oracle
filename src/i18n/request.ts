import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, isSupportedLocale } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  // Resolve the incoming locale from the URL segment
  const locale = await requestLocale;

  // Validate it against our supported locales
  if (!locale) {
    return {
      locale: routing.defaultLocale,
      messages: (await import(`../../messages/${routing.defaultLocale}.json`)).default,
    };
  }

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
