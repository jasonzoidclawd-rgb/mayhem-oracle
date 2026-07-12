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
import { readEntityPresentationFile } from "@/lib/data/read-public-file";
import { resolveEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData, EntityRef } from "@/lib/entities/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "augments" });
  const route = "/augments";
  const title = t("metaTitle");
  const description = t("metaDescription");
  const url = localizedUrl(route, locale as Locale);

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates(route),
    },
    openGraph: { title, description, url, locale },
    twitter: { card: "summary_large_image", title, description },
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
  const [augRaw, entityPresentation] = await Promise.all([
    readFile(path.join(dataDir, "augments.json"), "utf-8"),
    readEntityPresentationFile<EntityPresentationData>(),
  ]);

  const { augments, patch } = JSON.parse(augRaw);
  const normalizedAugments = (augments as Array<ScoredAugment & { wikiSet?: string | null }>).map((augment) => ({
    ...augment,
    win_rate: augment.win_rate ?? null,
    set: normalizeAugmentSet(augment.set, augment.wikiSet),
  }));
  const currentCount = normalizedAugments.filter((augment) => augment.flags?.lifecycle !== "removed").length;
  const entityRefs: Record<string, EntityRef> = Object.fromEntries(
    normalizedAugments.flatMap((augment) => {
      const ref = resolveEntityRef(entityPresentation, "augment", {
        canonicalId: (augment as ScoredAugment & { augmentId?: string }).augmentId,
        slug: augment.slug,
      }, locale);
      return ref ? [[augment.slug, ref]] : [];
    }),
  );

  return (
    <div className="py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-1">{t("title")}</h1>
        <p className="text-[var(--color-text-secondary)]">
          {t("subtitle", { count: currentCount, patch })}
        </p>
        <DataProvenance locale={locale} />
      </header>
      <AugmentsClient augments={normalizedAugments} locale={locale} entityRefs={entityRefs} />
    </div>
  );
}
