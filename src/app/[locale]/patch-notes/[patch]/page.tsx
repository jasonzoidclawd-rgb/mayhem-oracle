import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { JsonLd } from "@/components/seo/JsonLd";
import { PatchCard } from "@/components/patch-notes/PatchCard";
import { readPatchNotesFile } from "@/lib/data/read-public-file";
import {
  buildPatchDetailStaticParams,
  findPatchByVersion,
  patchDetailRoute,
} from "@/lib/patch-notes/routes";
import { resolvePatchNotesLastModified } from "@/lib/patch-notes/seo";
import { languageAlternates, localizedUrl } from "@/lib/site";
import type { PatchNote, PatchNotesData } from "@/lib/types";

export const dynamicParams = false;

async function loadPatchNotes(): Promise<PatchNotesData> {
  return readPatchNotesFile<PatchNotesData>();
}

export async function generateStaticParams() {
  try {
    const data = await loadPatchNotes();
    return buildPatchDetailStaticParams(data, routing.locales);
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; patch: string }>;
}): Promise<Metadata> {
  const { locale, patch } = await params;
  const [t, data] = await Promise.all([
    getTranslations({ locale, namespace: "patchNotes" }),
    loadPatchNotes(),
  ]);
  const note = findPatchByVersion(data, decodeURIComponent(patch));
  if (!note) notFound();

  const route = patchDetailRoute(note.version);
  const title = `${t("patchLabel", { patch: note.version })} · ${t("title")}`;
  const description = `${t("subtitle")} · ${
    note.title || t("patchLabel", { patch: note.version })
  }`;
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

export default async function PatchDetailPage({
  params,
}: {
  params: Promise<{ locale: string; patch: string }>;
}) {
  const { locale, patch } = await params;
  setRequestLocale(locale);
  const [t, data] = await Promise.all([
    getTranslations("patchNotes"),
    loadPatchNotes(),
  ]);
  const note = findPatchByVersion(data, decodeURIComponent(patch));
  if (!note) notFound();

  const route = patchDetailRoute(note.version);
  const url = localizedUrl(route, locale as Locale);
  const title = `${t("patchLabel", { patch: note.version })} · ${t("title")}`;
  const description = `${t("subtitle")} · ${note.title || title}`;
  const jsonLd = buildPatchDetailJsonLd({
    note,
    data,
    locale: locale as Locale,
    url,
    title,
    description,
  });

  return (
    <div className="py-8">
      <JsonLd data={jsonLd} />
      <div className="mb-5">
        <Link
          href="/patch-notes"
          className="text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
        >
          {"<- "}
          {t("title")}
        </Link>
      </div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold">
          {t("patchLabel", { patch: note.version })}
        </h1>
        <p className="mt-1 text-[var(--color-text-secondary)]">
          {note.title || t("subtitle")}
        </p>
      </header>
      <PatchCard
        patch={note}
        locale={locale}
        isCurrent={note.version === data.patch}
      />
    </div>
  );
}

function buildPatchDetailJsonLd({
  note,
  data,
  locale,
  url,
  title,
  description,
}: {
  note: PatchNote;
  data: PatchNotesData;
  locale: Locale;
  url: string;
  title: string;
  description: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: note.title || title,
    description,
    url,
    mainEntityOfPage: url,
    inLanguage: locale,
    datePublished: isoDate(note.publishedAt || note.released),
    dateModified: resolvePatchNotesLastModified(data)?.toISOString(),
    author: (note.authors ?? []).map((name) => ({
      "@type": "Person",
      name,
    })),
    isPartOf: {
      "@type": "CollectionPage",
      url: localizedUrl("/patch-notes", locale),
    },
  };
}

function isoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
