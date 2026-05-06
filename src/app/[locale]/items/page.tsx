import { getTranslations, setRequestLocale } from "next-intl/server";
import { readFile } from "fs/promises";
import path from "path";
import { ItemsClient } from "@/components/items/ItemsClient";
import type { Item } from "@/lib/types";

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

export default async function ItemsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("items");

  const data = await loadItemsData();

  // ── Dedup + auto-tag ──────────────────────────────────────────────────────
  //
  // The scraped items[] pool contains several classes of entries that need
  // to be cleaned up before display:
  //
  //  A) Base items (id < 200 000) whose Mayhem-modified counterpart exists at
  //     id + 220 000.  Hide the base; show the +220 000 version tagged "modified".
  //
  //  B) Items whose name (case-insensitive) already appears in mayhemExclusive[].
  //     Hide them — they are already displayed in the Mayhem tab.
  //
  //  C) When multiple entries survive A+B with the same name, keep only the one
  //     with the highest id (most specific / most recent scrape wins).
  //     This fixes cases like The Collector appearing as both 226 676 (2 500g)
  //     and 667 666 (3 000g): the higher-id entry is the correct Mayhem version.
  //
  const processedItems = data
    ? (() => {
        const allIds = new Set(data.items.map((i) => i.id));

        // Names of items already shown in the Mayhem-exclusive tab (case-insensitive)
        const exclNames = new Set(
          data.mayhemExclusive.map((i) => i.name.toLowerCase()),
        );

        // Base IDs hidden because a Mayhem-modified counterpart (id + 220 000) exists
        const hiddenBaseIds = new Set(
          data.items
            .filter((i) => i.id != null && i.id >= 200_000 && allIds.has(i.id - 220_000))
            .map((i) => i.id! - 220_000),
        );

        // Pass 1: remove duplicates-of-exclusive and hidden-base items; auto-tag
        const candidates: Item[] = data.items
          .filter((i) => {
            if (exclNames.has(i.name.toLowerCase())) return false;           // rule B
            if (i.id != null && i.id < 200_000 && hiddenBaseIds.has(i.id))  // rule A
              return false;
            return true;
          })
          .map((i): Item => {
            if (i.id == null || i.id < 200_000) return i;
            const tag = allIds.has(i.id - 220_000) ? "modified" : "exclusive";
            return i.mayhemTag ? i : { ...i, mayhemTag: tag };
          });

        // Pass 2: name-level dedup — keep the entry with the highest id (rule C)
        const best = new Map<string, Item>();
        for (const item of candidates) {
          const key = item.name.toLowerCase();
          const prev = best.get(key);
          if (!prev || (item.id ?? 0) > (prev.id ?? 0)) best.set(key, item);
        }

        return [...best.values()];
      })()
    : [];

  return (
    <div className="py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
        <p className="text-[var(--color-text-secondary)] text-sm">{t("subtitle")}</p>
      </div>

      {data ? (
        <ItemsClient
          mayhemExclusive={data.mayhemExclusive}
          items={processedItems}
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
