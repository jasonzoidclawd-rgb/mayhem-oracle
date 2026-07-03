import type { ChangeKind, PatchEntityType } from "@/lib/types";

export const CHANGE_KIND_LABEL_KEYS = [
  "buffed",
  "nerfed",
  "changed",
  "mechanism",
  "added",
  "removed",
  "fixed",
  "hotfix",
] as const satisfies readonly ChangeKind[];

export const PATCH_OBJECT_TYPE_LABEL_KEYS = [
  "champion",
  "item",
  "augment",
  "ability",
  "system",
  "unknown",
] as const satisfies readonly PatchEntityType[];

const CHANGE_KIND_SET = new Set<string>(CHANGE_KIND_LABEL_KEYS);
const PATCH_OBJECT_TYPE_SET = new Set<string>(PATCH_OBJECT_TYPE_LABEL_KEYS);

export function normalizeChangeKind(kind: string | null | undefined): ChangeKind {
  return kind && CHANGE_KIND_SET.has(kind) ? (kind as ChangeKind) : "changed";
}

export function normalizePatchObjectType(
  type: string | null | undefined,
): PatchEntityType {
  return type && PATCH_OBJECT_TYPE_SET.has(type)
    ? (type as PatchEntityType)
    : "unknown";
}
