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
  "/tier-list",
  "/champions",
  "/augments",
  "/items",
  "/patch-notes",
  "/advisor",
  "/damage-sim",
  "/privacy",
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const slugs = await championSlugs();

  const paths: string[] = [
    ...STATIC_PATHS,
    ...slugs.map((slug) => `/champions/${slug}`),
  ];

  return paths.flatMap((p) =>
    routing.locales.map((locale) => ({
      url: localizedUrl(p, locale),
      lastModified,
      alternates: { languages: languageAlternates(p) },
    })),
  );
}
