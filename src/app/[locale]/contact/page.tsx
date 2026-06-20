import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalArticle, LegalSection } from "@/components/legal/LegalArticle";
import { CONTACT_EMAIL, languageAlternates, localizedUrl } from "@/lib/site";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  return {
    title: t("title"),
    alternates: {
      canonical: localizedUrl("/contact", locale as Locale),
      languages: languageAlternates("/contact"),
    },
  };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");

  return (
    <LegalArticle title={t("title")} intro={t("aboutBody")}>
      <LegalSection heading={t("contactTitle")}>
        <p>{t("contactBody")}</p>
        <p className="mt-3">
          <span className="text-[var(--color-text-muted)]">{t("emailLabel")}: </span>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-[var(--color-neon-primary)] hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t("responseNote")}</p>
      </LegalSection>

      <LegalSection heading={t("dataTitle")}>{t("dataBody")}</LegalSection>
    </LegalArticle>
  );
}
