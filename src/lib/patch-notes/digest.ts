import type { PatchNote } from "@/lib/types";

export interface PatchDigest {
  added: number;
  removed: number;
  hotfixes: number;
}

export function buildPatchDigest(
  patch: PatchNote,
  removedAugmentsCount: number,
  hotfixEventCount: number,
): PatchDigest {
  return {
    added: patch.summary?.byKind.added ?? 0,
    removed: patch.summary?.byKind.removed ?? removedAugmentsCount,
    hotfixes: hotfixEventCount,
  };
}
