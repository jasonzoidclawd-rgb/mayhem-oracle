import type { ComboTier } from "../scoring/oracle-score";

export interface ComboLookupEntry {
  champion: string;
  augment: string;
  tier: string;
}

export interface AugmentLookupEntry {
  slug: string;
  name: string;
}

export interface ResolvedComboLookupEntry extends ComboLookupEntry {
  augmentSlug: string;
}

export function normalizeLookupKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&#38;|&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

export function buildComboTierLookup(
  championSlug: string,
  combos: ComboLookupEntry[],
  augments: AugmentLookupEntry[],
): Map<string, ComboTier> {
  const championKey = normalizeLookupKey(championSlug);
  const augmentSlugByKey = new Map<string, string>();

  for (const augment of augments) {
    augmentSlugByKey.set(normalizeLookupKey(augment.slug), augment.slug);
    augmentSlugByKey.set(normalizeLookupKey(augment.name), augment.slug);
  }

  const comboBySlug = new Map<string, ComboTier>();

  for (const combo of combos) {
    if (normalizeLookupKey(combo.champion) !== championKey) continue;

    const augmentSlug = augmentSlugByKey.get(normalizeLookupKey(combo.augment));
    if (!augmentSlug) continue;

    comboBySlug.set(augmentSlug, combo.tier as ComboTier);
  }

  return comboBySlug;
}

export function resolveChampionCombos(
  championSlug: string,
  combos: ComboLookupEntry[],
  augments: AugmentLookupEntry[],
): ResolvedComboLookupEntry[] {
  const championKey = normalizeLookupKey(championSlug);
  const augmentSlugByKey = new Map<string, string>();

  for (const augment of augments) {
    augmentSlugByKey.set(normalizeLookupKey(augment.slug), augment.slug);
    augmentSlugByKey.set(normalizeLookupKey(augment.name), augment.slug);
  }

  const resolved: ResolvedComboLookupEntry[] = [];

  for (const combo of combos) {
    if (normalizeLookupKey(combo.champion) !== championKey) continue;

    const augmentSlug = augmentSlugByKey.get(normalizeLookupKey(combo.augment));
    if (!augmentSlug) continue;

    resolved.push({ ...combo, augmentSlug });
  }

  return resolved;
}
