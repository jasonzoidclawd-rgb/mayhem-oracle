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
import {
  buildPatchDetailJsonLd,
  buildPatchDetailMetadataText,
} from "@/lib/patch-notes/seo";
import { languageAlternates, localizedUrl } from "@/lib/site";
import type { PatchNotesData } from "@/lib/types";

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
  const { title, description } = buildPatchDetailMetadataText(note, {
    pageTitle: t("title"),
    subtitle: t("subtitle"),
    patchLabel: (patchVersion) => t("patchLabel", { patch: patchVersion }),
  });
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
  const { title, description } = buildPatchDetailMetadataText(note, {
    pageTitle: t("title"),
    subtitle: t("subtitle"),
    patchLabel: (patchVersion) => t("patchLabel", { patch: patchVersion }),
  });
  const jsonLd = buildPatchDetailJsonLd(note, locale as Locale, {
    url,
    title,
    description,
    patchNotesUrl: localizedUrl("/patch-notes", locale as Locale),
    patchNotesLabel: t("title"),
    patchLabel: (patchVersion) => t("patchLabel", { patch: patchVersion }),
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
        linkTitle={false}
      />
    </div>
  );
}
