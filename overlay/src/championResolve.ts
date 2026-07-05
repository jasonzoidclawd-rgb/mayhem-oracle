export function normalizeChampionName(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Resolve a live-client champion name to a catalog slug, or null when the
 * name does not correspond to any known champion. Live data can carry
 * placeholder text (e.g. "Locked" during champ select); treating that text
 * as a slug produced 404 ability-profile fetches and a hard error banner.
 */
export function resolveKnownChampionSlug(
  name: string,
  slugByName: ReadonlyMap<string, string>,
  knownSlugs: ReadonlySet<string>,
): string | null {
  const raw = name.trim();
  if (!raw) return null;

  const exact = slugByName.get(raw) ?? slugByName.get(raw.toLowerCase());
  if (exact) return exact;

  const normalized = normalizeChampionName(raw);
  if (!normalized) return null;

  return slugByName.get(normalized) ?? (knownSlugs.has(normalized) ? normalized : null);
}
