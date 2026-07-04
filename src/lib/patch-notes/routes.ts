import type { Locale } from "@/i18n/routing";
import type { PatchNote, PatchNotesData } from "@/lib/types";

export function patchDetailRoute(version: string): string {
  return `/patch-notes/${encodeURIComponent(version)}`;
}

export function findPatchByVersion(
  data: PatchNotesData | null | undefined,
  version: string,
): PatchNote | null {
  return data?.patches.find((patch) => patch.version === version) ?? null;
}

export function buildPatchDetailStaticParams(
  data: PatchNotesData | null | undefined,
  locales: readonly Locale[],
): { locale: Locale; patch: string }[] {
  if (!data?.patches?.length) return [];
  return locales.flatMap((locale) =>
    data.patches.map((patch) => ({ locale, patch: patch.version })),
  );
}
