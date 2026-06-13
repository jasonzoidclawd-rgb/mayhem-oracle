import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("membership");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">{t("privacyTitle")}</h1>
      <ul className="mt-6 flex flex-col gap-4 text-sm text-white/70">
        <li>{t("privacyAds")}</li>
        <li>{t("privacyCollector")}</li>
        <li>{t("privacyRetention")}</li>
      </ul>
    </main>
  );
}
