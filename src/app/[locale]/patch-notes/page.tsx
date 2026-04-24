import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function PatchNotesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tNav = await getTranslations("nav");
  const t = await getTranslations("patchNotes");

  return (
    <div className="py-8">
      <h1 className="text-3xl font-bold mb-2">{tNav("patchNotes")}</h1>
      <p className="text-[var(--color-text-secondary)]">{t("comingSoon")}</p>
      <div className="glass-card p-8 mt-6 text-center text-[var(--color-text-muted)]">
        📋 {t("placeholder")}
      </div>
    </div>
  );
}
