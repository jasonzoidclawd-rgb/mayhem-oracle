type PublicAugmentSeoRecord = {
  slug: string;
  rarity?: string;
  type?: string;
  wikiDescription?: string;
  kit_tags?: string[];
};

type AugmentDetailJsonLdOptions = {
  url: string;
  homeUrl?: string;
  name: string;
  description?: string;
  augmentsUrl: string;
  augmentsLabel: string;
  rarityLabel?: string;
};

function propertyValue(name: string, value: string) {
  return {
    "@type": "PropertyValue",
    name,
    value,
  };
}

export function buildAugmentDetailJsonLd(
  augment: PublicAugmentSeoRecord,
  locale: string,
  options: AugmentDetailJsonLdOptions,
): Record<string, unknown> {
  const description =
    options.description?.trim() ||
    augment.wikiDescription?.trim() ||
    `${options.name} augment details for League of Legends Arena Mayhem.`;
  const termId = `${options.url}#augment`;
  const properties = [
    options.rarityLabel ? propertyValue("Rarity", options.rarityLabel) : null,
    augment.type ? propertyValue("Type", augment.type) : null,
    augment.kit_tags?.length
      ? propertyValue("Public synergy tags", augment.kit_tags.join(", "))
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
        about: { "@id": termId },
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
            name: options.augmentsLabel,
            item: options.augmentsUrl,
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
        "@type": "DefinedTerm",
        "@id": termId,
        name: options.name,
        termCode: augment.slug,
        description,
        inLanguage: locale,
        inDefinedTermSet: {
          "@type": "DefinedTermSet",
          name: "League of Legends Arena Mayhem Augments",
        },
        ...(properties.length ? { additionalProperty: properties } : {}),
      },
    ],
  };
}
