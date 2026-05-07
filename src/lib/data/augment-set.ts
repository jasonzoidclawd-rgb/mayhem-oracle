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

const CANONICAL_SET_MAP: ReadonlyMap<string, string> = new Map(
  [...VALID_AUGMENT_SET_LABELS].map((label) => [label.toLowerCase().replace(/\s+/g, " "), label]),
);

export function normalizeAugmentSet(set: string | null | undefined, wikiSet?: string | null): string | undefined {
  const value = (set ?? wikiSet)?.trim().replace(/\s+/g, " ");
  if (!value) return undefined;
  return CANONICAL_SET_MAP.get(value.toLowerCase()) ?? undefined;
}
