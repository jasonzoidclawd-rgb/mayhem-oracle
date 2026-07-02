import type { Metadata } from "next";
import { AdSlot } from "@/components/ads/AdSlot";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  PatchNotesView,
  type RemovedPatchAugment,
} from "@/components/patch-notes/PatchNotesView";
import { HotfixNotes } from "@/components/patch-notes/HotfixNotes";
import type { PatchNotesData } from "@/lib/types";
import {
  readAugmentsFile,
  readPatchNotesFile,
} from "@/lib/data/read-public-file";
import type { Locale } from "@/i18n/routing";
import { languageAlternates, localizedUrl } from "@/lib/site";

async function loadPatchNotes(): Promise<PatchNotesData | null> {
  try {
    return await readPatchNotesFile<PatchNotesData>();
  } catch {
    return null;
  }
}

async function loadRemovedAugments(): Promise<RemovedPatchAugment[]> {
  try {
    const data = await readAugmentsFile<{ augments: RemovedPatchAugment[] }>();
    return data.augments
      .filter((augment) => augment.flags?.lifecycle === "removed")
      .sort((a, b) => {
        const patchCompare = (b.flags?.lifecycle_patch ?? "").localeCompare(
          a.flags?.lifecycle_patch ?? "",
          undefined,
          { numeric: true },
        );
        return patchCompare || a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "patchNotes" });
  const route = "/patch-notes";

  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: {
      canonical: localizedUrl(route, locale as Locale),
      languages: languageAlternates(route),
    },
  };
}

export default async function PatchNotesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("patchNotes");
  const [data, removedAugments] = await Promise.all([
    loadPatchNotes(),
    loadRemovedAugments(),
  ]);

  return (
    <div className="py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-[var(--color-text-secondary)]">
          {t("subtitle")}
          {data?.patch ? ` · ${t("patchLabel", { patch: data.patch })}` : ""}
        </p>
      </header>
      <AdSlot slot="public-patch-notes" />
      <HotfixNotes locale={locale} />
      {data ? (
        <PatchNotesView
          data={data}
          locale={locale}
          removedAugments={removedAugments}
        />
      ) : (
        <div className="glass-card p-8 text-center text-[var(--color-text-muted)]">
          {t("noData")}
        </div>
      )}
    </div>
  );
}
