import type { Locale } from "@/i18n/routing";
import type { PatchNote, PatchNotesData } from "@/lib/types";

export function patchDetailRoute(version: string): string {
  return `/patch-notes/${encodeURIComponent(version)}`;
}

export function findPatchByVersion(
  data: PatchNotesData | null | undefined,
  version: string,
): PatchNote | null {
  const normalizedVersion = /^\d{2}-\d{1,2}$/.test(version) ? version.replace("-", ".") : version;
  return data?.patches.find((patch) => patch.version === normalizedVersion) ?? null;
}

export function buildPatchDetailStaticParams(
  data: PatchNotesData | null | undefined,
  locales: readonly Locale[],
): { locale: Locale; patch: string }[] {
  if (!data?.patches?.length) return [];
  return locales.flatMap((locale) =>
    data.patches.flatMap((patch) => [
      { locale, patch: patch.version },
      { locale, patch: patch.version.replace(".", "-") },
    ]),
  );
}
