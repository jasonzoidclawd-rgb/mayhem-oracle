import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { languageAlternates, localizedUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tierList" });
  const route = "/tier-list";

  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: {
      canonical: localizedUrl(route, locale as Locale),
      languages: languageAlternates(route),
    },
  };
}

// The tier list is now a view inside the unified /champions dashboard.
// Preserve the old URL for SEO/bookmarks by redirecting to /champions.
export default async function TierListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect({ href: "/champions", locale });
}
