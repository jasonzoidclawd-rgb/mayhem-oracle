import type { ChampionDetailChampion } from "@/lib/champions/detail-data";

type ChampionDetailJsonLdOptions = {
  url: string;
  homeUrl: string;
  championsUrl: string;
  championsLabel: string;
  name: string;
  description?: string;
  patch?: string;
  tierLabel?: string;
  tagLabels?: string[];
  classLabels?: string[];
  kitTagLabels?: string[];
};

function propertyValue(name: string, value: string) {
  return {
    "@type": "PropertyValue",
    name,
    value,
  };
}

function formatRate(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : undefined;
}

export function buildChampionDetailJsonLd(
  champion: ChampionDetailChampion,
  locale: string,
  options: ChampionDetailJsonLdOptions,
): Record<string, unknown> {
  const description =
    options.description?.trim() ||
    `${options.name} champion details for League of Legends Arena Mayhem.`;
  const championId = `${options.url}#champion`;
  const winRate = formatRate(champion.win_rate);
  const pickRate = formatRate(champion.pick_rate);
  const properties = [
    options.patch ? propertyValue("Patch", options.patch) : null,
    options.tierLabel ? propertyValue("Public tier", options.tierLabel) : null,
    champion.rank != null ? propertyValue("Public rank", String(champion.rank)) : null,
    winRate ? propertyValue("Public win rate", winRate) : null,
    pickRate ? propertyValue("Public pick rate", pickRate) : null,
    options.tagLabels?.length
      ? propertyValue("Public tags", options.tagLabels.join(", "))
      : null,
    options.classLabels?.length
      ? propertyValue("Public classes", options.classLabels.join(", "))
      : null,
    options.kitTagLabels?.length
      ? propertyValue("Public kit tags", options.kitTagLabels.join(", "))
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
        about: { "@id": championId },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${options.url}#breadcrumbs`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Mayhem Oracle",
            item: options.homeUrl,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: options.championsLabel,
            item: options.championsUrl,
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
        "@type": "Person",
        "@id": championId,
        name: options.name,
        identifier: champion.slug,
        description,
        inLanguage: locale,
        ...(champion.title ? { additionalName: champion.title } : {}),
        ...(champion.icon ? { image: champion.icon } : {}),
        ...(properties.length ? { additionalProperty: properties } : {}),
      },
    ],
  };
}
