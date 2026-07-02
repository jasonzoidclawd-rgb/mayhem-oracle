import type { MetadataRoute } from "next";
import { readFile } from "fs/promises";
import path from "path";
import { localizedUrl, languageAlternates } from "@/lib/site";
import { routing } from "@/i18n/routing";

/**
 * Public, indexable routes (account/admin are excluded — see robots.ts).
 * Each emits one entry per locale with hreflang alternates so Google and AI
 * crawlers discover every localized version.
 */
const STATIC_PATHS = [
  "/",
  "/champions",
  "/tier-list",
  "/augments",
  "/items",
  "/patch-notes",
  "/advisor",
  "/companion",
  "/damage-sim",
  "/membership",
  "/privacy",
  "/terms",
  "/contact",
] as const;

async function championSlugs(): Promise<string[]> {
  try {
    const file = path.join(process.cwd(), "public", "data", "champions.json");
    const data = JSON.parse(await readFile(file, "utf-8")) as {
      champions?: { slug: string }[];
    };
    return (data.champions ?? []).map((c) => c.slug);
  } catch {
    return [];
  }
}

async function augmentSlugs(): Promise<string[]> {
  try {
    const file = path.join(process.cwd(), "public", "data", "augments.json");
    const data = JSON.parse(await readFile(file, "utf-8")) as {
      augments?: { slug: string }[];
    };
    return (data.augments ?? []).map((augment) => augment.slug);
  } catch {
    return [];
  }
}

async function itemIdentifiers(): Promise<string[]> {
  try {
    const file = path.join(process.cwd(), "public", "data", "items.json");
    const data = JSON.parse(await readFile(file, "utf-8")) as {
      mayhemExclusive?: { slug: string }[];
      items?: { id?: number | null }[];
    };
    return [
      ...(data.mayhemExclusive ?? []).map((item) => item.slug),
      ...(data.items ?? [])
        .filter((item) => item.id != null)
        .map((item) => String(item.id)),
    ];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const [slugs, augmentIds, itemIds] = await Promise.all([
    championSlugs(),
    augmentSlugs(),
    itemIdentifiers(),
  ]);

  const paths: string[] = [
    ...STATIC_PATHS,
    ...slugs.map((slug) => `/champions/${slug}`),
    ...augmentIds.map((slug) => `/augments/${slug}`),
    ...itemIds.map((identifier) => `/items/${identifier}`),
  ];

  return paths.flatMap((p) =>
    routing.locales.map((locale) => ({
      url: localizedUrl(p, locale),
      lastModified,
      alternates: { languages: languageAlternates(p) },
    })),
  );
}
