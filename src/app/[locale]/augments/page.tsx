import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AugmentsClient } from "@/components/augments/AugmentsClient";
import { DataProvenance } from "@/components/ui/DataProvenance";
import { normalizeAugmentSet } from "@/lib/data/augment-set";
import { readFile } from "fs/promises";
import path from "path";
import type { ScoredAugment } from "@/lib/scoring/oracle-score";
import type { Locale } from "@/i18n/routing";
import { languageAlternates, localizedUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "augments" });
  const route = "/augments";

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: localizedUrl(route, locale as Locale),
      languages: languageAlternates(route),
    },
  };
}

export default async function AugmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("augments");

  const dataDir = path.join(process.cwd(), "public", "data");
  const augRaw = await readFile(path.join(dataDir, "augments.json"), "utf-8");

  const { augments, patch } = JSON.parse(augRaw);
  const normalizedAugments = (augments as Array<ScoredAugment & { wikiSet?: string | null }>).map((augment) => ({
    ...augment,
    win_rate: augment.win_rate ?? null,
    set: normalizeAugmentSet(augment.set, augment.wikiSet),
  }));
  const currentCount = normalizedAugments.filter((augment) => augment.flags?.lifecycle !== "removed").length;

  return (
    <div className="py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-1">{t("title")}</h1>
        <p className="text-[var(--color-text-secondary)]">
          {t("subtitle", { count: currentCount, patch })}
        </p>
        <DataProvenance locale={locale} />
      </header>
      <AugmentsClient augments={normalizedAugments} locale={locale} />
    </div>
  );
}
