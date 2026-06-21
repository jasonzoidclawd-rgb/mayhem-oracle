import type { ComboTier } from "../scoring/oracle-score";

export interface ComboLookupEntry {
  champion: string;
  augment: string;
  augmentSlug?: string;
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
    .replace(/&amp;|&#38;|&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

const VALID_COMBO_TIERS = new Set<string>(["S", "A", "B", "C"]);

function buildAugmentSlugIndex(augments: AugmentLookupEntry[]): Map<string, string> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const augment of augments) {
    for (const key of [normalizeLookupKey(augment.slug), normalizeLookupKey(augment.name)]) {
      if (ambiguous.has(key)) continue;
      if (index.has(key) && index.get(key) !== augment.slug) {
        ambiguous.add(key);
        index.delete(key);
      } else {
        index.set(key, augment.slug);
      }
    }
  }
  return index;
}

export function buildComboTierLookup(
  championSlug: string,
  combos: ComboLookupEntry[],
  augments: AugmentLookupEntry[],
): Map<string, ComboTier> {
  const championKey = normalizeLookupKey(championSlug);
  const augmentSlugByKey = buildAugmentSlugIndex(augments);

  const comboBySlug = new Map<string, ComboTier>();

  for (const combo of combos) {
    if (normalizeLookupKey(combo.champion) !== championKey) continue;
    if (!VALID_COMBO_TIERS.has(combo.tier)) continue;

    const augmentSlug = combo.augmentSlug ?? augmentSlugByKey.get(normalizeLookupKey(combo.augment));
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
  const augmentSlugByKey = buildAugmentSlugIndex(augments);

  const resolved: ResolvedComboLookupEntry[] = [];

  for (const combo of combos) {
    if (normalizeLookupKey(combo.champion) !== championKey) continue;

    const augmentSlug = combo.augmentSlug ?? augmentSlugByKey.get(normalizeLookupKey(combo.augment));
    if (!augmentSlug) continue;

    resolved.push({ ...combo, augmentSlug });
  }

  return resolved;
}
