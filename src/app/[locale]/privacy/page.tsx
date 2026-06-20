import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalArticle, LegalSection } from "@/components/legal/LegalArticle";
import {
  CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  languageAlternates,
  localizedUrl,
} from "@/lib/site";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });
  return {
    title: t("title"),
    alternates: {
      canonical: localizedUrl("/privacy", locale as Locale),
      languages: languageAlternates("/privacy"),
    },
  };
}

const SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
    new Date(LEGAL_LAST_UPDATED),
  );

  return (
    <LegalArticle
      title={t("title")}
      subtitle={t("lastUpdated", { date })}
      intro={t("intro")}
    >
      {SECTIONS.map((n) => (
        <LegalSection key={n} heading={t(`s${n}Title`)}>
          {t(`s${n}Body`, { email: CONTACT_EMAIL })}
        </LegalSection>
      ))}
    </LegalArticle>
  );
}
