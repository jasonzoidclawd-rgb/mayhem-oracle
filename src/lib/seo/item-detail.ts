import type { Item } from "@/lib/types";

type ItemDetailJsonLdOptions = {
  url: string;
  homeUrl?: string;
  itemsUrl: string;
  itemsLabel: string;
  name: string;
  description?: string;
  identifier: string;
  tierLabel?: string;
  tagLabel?: string;
  categoryLabels?: string[];
};

function propertyValue(name: string, value: string) {
  return {
    "@type": "PropertyValue",
    name,
    value,
  };
}

export function buildItemDetailJsonLd(
  item: Item,
  locale: string,
  options: ItemDetailJsonLdOptions,
): Record<string, unknown> {
  const description =
    options.description?.trim() ||
    item.description?.trim() ||
    `${options.name} item details for League of Legends Arena Mayhem.`;
  const itemId = `${options.url}#item`;
  const properties = [
    item.cost > 0 ? propertyValue("Gold cost", String(item.cost)) : null,
    options.tierLabel ? propertyValue("Tier", options.tierLabel) : null,
    options.tagLabel ? propertyValue("Mayhem tag", options.tagLabel) : null,
    item.stats?.trim() ? propertyValue("Public stats", item.stats.trim()) : null,
    options.categoryLabels?.length
      ? propertyValue("Public categories", options.categoryLabels.join(", "))
      : null,
    item.wikiPassives?.length
      ? propertyValue("Public passive count", String(item.wikiPassives.length))
      : null,
    item.wikiNotes?.length
      ? propertyValue("Public note count", String(item.wikiNotes.length))
      : null,
  ].filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${options.url}#webpage`,
        url: options.url,
        name: options.name,
        description,
        inLanguage: locale,
        breadcrumb: { "@id": `${options.url}#breadcrumbs` },
        about: { "@id": itemId },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${options.url}#breadcrumbs`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Mayhem Oracle",
            item: options.homeUrl ?? new URL("/", options.url).toString().replace(/\/$/, ""),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: options.itemsLabel,
            item: options.itemsUrl,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: options.name,
            item: options.url,
          },
        ],
      },
      {
        "@type": "Thing",
        "@id": itemId,
        name: options.name,
        identifier: options.identifier,
        description,
        inLanguage: locale,
        ...(properties.length ? { additionalProperty: properties } : {}),
      },
    ],
  };
}
