import type { Item } from "@/lib/types";

export interface PublicItemCatalog {
  mayhemExclusive: Item[];
  items: Item[];
}

function nameKey(item: Item): string {
  return item.name.trim().toLowerCase();
}

/**
 * Project the generated item catalog to one presentation row per display
 * entity. CDragon publishes base, Mayhem-modified, and other-mode variants
 * with different IDs but the same name; those IDs remain in the internal
 * source for structured comparisons, while public navigation/search use the
 * highest-ID representative exactly as the item index does.
 */
export function projectVisibleItemCatalog(data: PublicItemCatalog): PublicItemCatalog {
  const allIds = new Set(data.items.map((item) => item.id));
  const mayhemNames = new Set(data.mayhemExclusive.map(nameKey));
  const hiddenBaseIds = new Set(
    data.items
      .filter((item) => item.id != null && item.id >= 200_000 && allIds.has(item.id - 220_000))
      .map((item) => item.id! - 220_000),
  );

  const candidates = data.items
    .filter((item) => !mayhemNames.has(nameKey(item)) && !(item.id != null && item.id < 200_000 && hiddenBaseIds.has(item.id)))
    .map((item) => {
      if (item.id == null || item.id < 200_000 || item.mayhemTag) return item;
      const mayhemTag: Item["mayhemTag"] = allIds.has(item.id - 220_000) ? "modified" : "exclusive";
      return { ...item, mayhemTag };
    });

  const best = new Map<string, Item>();
  for (const item of candidates) {
    const key = nameKey(item);
    const previous = best.get(key);
    if (!previous || (item.id ?? 0) > (previous.id ?? 0)) best.set(key, item);
  }

  return {
    mayhemExclusive: [...data.mayhemExclusive],
    items: [...best.values()],
  };
}
