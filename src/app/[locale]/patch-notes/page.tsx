import { AdSlot } from "@/components/ads/AdSlot";
import { readFile } from "fs/promises";
import path from "path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PatchNotesView } from "@/components/patch-notes/PatchNotesView";
import type { PatchNotesData } from "@/lib/types";

async function loadPatchNotes(): Promise<PatchNotesData | null> {
  try {
    const dataPath = path.join(
      process.cwd(),
      "public",
      "data",
      "patch-notes.json",
    );
    const raw = await readFile(dataPath, "utf-8");
    return JSON.parse(raw) as PatchNotesData;
  } catch {
    return null;
  }
}

export default async function PatchNotesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("patchNotes");
  const data = await loadPatchNotes();

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
      {data ? (
        <PatchNotesView data={data} locale={locale} />
      ) : (
        <div className="glass-card p-8 text-center text-[var(--color-text-muted)]">
          {t("noData")}
        </div>
      )}
    </div>
  );
}
