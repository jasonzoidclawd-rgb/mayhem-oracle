import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LegalArticle, LegalSection } from "@/components/legal/LegalArticle";
import { languageAlternates, localizedUrl } from "@/lib/site";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: {
      canonical: localizedUrl("/about", locale as Locale),
      languages: languageAlternates("/about"),
    },
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");
  const tf = await getTranslations("footer");

  return (
    <LegalArticle title={t("title")} intro={t("intro")}>
      <LegalSection heading={t("whatTitle")}>{t("whatBody")}</LegalSection>
      <LegalSection heading={t("dataTitle")}>{t("dataBody")}</LegalSection>
      <LegalSection heading={t("disclaimerTitle")}>
        <p>{tf("riotDisclaimer")}</p>
      </LegalSection>
      <LegalSection heading={t("contactTitle")}>
        <p>{t("contactBody")}</p>
        <p className="mt-3">
          <Link
            href="/contact"
            className="font-medium text-[var(--color-neon-primary)] hover:underline"
          >
            {t("contactLink")}
          </Link>
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
