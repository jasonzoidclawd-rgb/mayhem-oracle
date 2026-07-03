import type { Locale } from "@/i18n/routing";
import type { PatchNote, PatchNotesData } from "@/lib/types";

export interface PatchNotesJsonLdOptions {
  url: string;
  title: string;
  description: string;
  breadcrumbLabel: string;
  patchLabel: (patch: string) => string;
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(value: string | null | undefined): string | undefined {
  return validDate(value)?.toISOString();
}

function currentPatch(data: PatchNotesData): PatchNote | null {
  return (
    data.patches.find((patch) => patch.version === data.patch) ??
    data.patches[0] ??
    null
  );
}

function slugSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function patchNoteAnchor(patch: string): string {
  return `patch-${slugSegment(patch)}`;
}

export function patchNoteSectionAnchor(patch: string, sectionId: string): string {
  return `${patchNoteAnchor(patch)}-${slugSegment(sectionId) || "section"}`;
}

export function patchNoteSectionHref(patch: string, sectionId: string): string {
  return `/patch-notes#${patchNoteSectionAnchor(patch, sectionId)}`;
}

export function resolvePatchNotesLastModified(
  data: PatchNotesData | null | undefined,
): Date | null {
  if (!data) return null;
  return (
    validDate(data.scraped_at) ??
    validDate(currentPatch(data)?.publishedAt) ??
    validDate(currentPatch(data)?.released)
  );
}

export function buildPatchNotesJsonLd(
  data: PatchNotesData,
  locale: Locale,
  options: PatchNotesJsonLdOptions,
): Record<string, unknown> {
  const current = currentPatch(data);
  const dateModified = resolvePatchNotesLastModified(data)?.toISOString();
  const collectionId = `${options.url}#collection`;
  const articleId = `${options.url}#current-patch`;
  const itemListElements = data.patches.map((patch, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: `${options.url}#${patchNoteAnchor(patch.version)}`,
    name: options.patchLabel(patch.version),
  }));

  const graph: Record<string, unknown>[] = [
    {
      "@type": "CollectionPage",
      "@id": collectionId,
      url: options.url,
      name: options.title,
      description: options.description,
      inLanguage: locale,
      dateModified,
      isPartOf: {
        "@type": "WebSite",
        name: "Mayhem Oracle",
      },
      about: [
        "League of Legends",
        "ARAM Mayhem",
        `Patch ${data.patch}`,
      ],
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Mayhem Oracle",
          item: options.url.replace(/\/patch-notes$/, ""),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: options.breadcrumbLabel,
          item: options.url,
        },
      ],
    },
    {
      "@type": "ItemList",
      name: options.title,
      numberOfItems: data.patches.length,
      itemListElement: itemListElements,
    },
  ];

  if (current) {
    graph.push({
      "@type": "Article",
      "@id": articleId,
      headline: current.title || options.patchLabel(current.version),
      description: current.intro || options.description,
      url: options.url,
      mainEntityOfPage: options.url,
      isPartOf: { "@id": collectionId },
      inLanguage: locale,
      datePublished: isoDate(current.publishedAt || current.released),
      dateModified,
      author: (current.authors ?? []).map((name) => ({
        "@type": "Person",
        name,
      })),
      keywords: Object.keys(current.summary?.byKind ?? {}).join(", "),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
