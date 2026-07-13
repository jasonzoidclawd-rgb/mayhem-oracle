import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { readFile } from "fs/promises";
import path from "path";
import { ItemsClient } from "@/components/items/ItemsClient";
import type { Item } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { languageAlternates, localizedUrl } from "@/lib/site";
import { readEntityPresentationFile } from "@/lib/data/read-public-file";
import { resolveEntityRef } from "@/lib/entities/catalog";
import type { EntityPresentationData, EntityRef } from "@/lib/entities/types";
import { projectVisibleItemCatalog } from "@/lib/items/catalog";

interface ItemsData {
  scraped_at: string;
  mayhemExclusive: Item[];
  items: Item[];
}

async function loadItemsData(): Promise<ItemsData | null> {
  try {
    const filePath = path.join(process.cwd(), "public", "data", "items.json");
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as ItemsData;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "items" });
  const route = "/items";
  const title = t("title");
  const description = t("subtitle");
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

export default async function ItemsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("items");

  const [data, entityPresentation] = await Promise.all([
    loadItemsData(),
    readEntityPresentationFile<EntityPresentationData>(),
  ]);

  const visibleCatalog = data
    ? projectVisibleItemCatalog({ mayhemExclusive: data.mayhemExclusive, items: data.items })
    : { mayhemExclusive: [], items: [] };
  const processedItems = visibleCatalog.items;
  const entityRefs: Record<string, EntityRef> = Object.fromEntries(
    (data ? [...visibleCatalog.mayhemExclusive, ...processedItems] : []).flatMap((item) => {
      const ref = resolveEntityRef(entityPresentation, "item", {
        canonicalId: item.id != null ? String(item.id) : undefined,
        slug: item.slug,
      }, locale);
      const key = item.id != null ? String(item.id) : item.slug;
      return ref && key ? [[key, ref]] : [];
    }),
  );

  return (
    <div className="py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
        <p className="text-[var(--color-text-secondary)] text-sm">{t("subtitle")}</p>
      </div>

      {data ? (
        <ItemsClient
          mayhemExclusive={visibleCatalog.mayhemExclusive}
          items={processedItems}
          entityRefs={entityRefs}
        />
      ) : (
        <div className="text-center py-20 text-[var(--color-text-muted)]">
          <p className="text-lg mb-2">Items data not yet generated.</p>
          <p className="text-sm">Run <code className="px-1.5 py-0.5 rounded bg-[var(--color-bg-card)] text-xs">python scripts/scrape_community_dragon.py</code> to generate it.</p>
        </div>
      )}
    </div>
  );
}
