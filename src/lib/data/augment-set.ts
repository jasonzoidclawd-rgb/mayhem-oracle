export const VALID_AUGMENT_SET_LABELS = new Set([
  "Archmage",
  "Dive Bomb",
  "Dive Bomb Fully Automated",
  "Firecracker",
  "Fully Automated",
  "Fully Automated Wee Woo Wee Woo",
  "High Roller",
  "Make it Rain",
  "Snowday",
  "Stackosaurus Rex",
  "Wee Woo Wee Woo",
]);

export function normalizeAugmentSet(set: string | null | undefined, wikiSet?: string | null): string | undefined {
  const value = set ?? wikiSet;
  if (!value) return undefined;

  return VALID_AUGMENT_SET_LABELS.has(value) ? value : undefined;
}
