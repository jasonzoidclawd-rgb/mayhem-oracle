import type {
  EntityPresentationData,
  EntityPresentationRecord,
  EntityRef,
  EntityType,
} from "./types";

const ENTITY_ROUTES: Record<EntityType, string> = {
  champion: "champions",
  augment: "augments",
  item: "items",
};

function localeKeys(locale: string): string[] {
  const normalized = locale.replace("_", "-");
  return [
    normalized,
    normalized.toLowerCase(),
    normalized.replace("-", "_"),
    normalized.split("-")[0],
    "en",
  ];
}

function localizedEntityName(record: EntityPresentationRecord, locale: string): string {
  for (const key of localeKeys(locale)) {
    const value = record.names[key];
    if (value) return value;
  }
  return record.names.en || record.slug;
}

export function buildEntityIndex(data: EntityPresentationData): Map<string, EntityPresentationRecord> {
  const index = new Map<string, EntityPresentationRecord>();
  for (const record of data.entities) {
    if (!record.canonical_id || !record.slug || !record.type) continue;
    const key = `${record.type}:${record.canonical_id}`;
    if (index.has(key)) {
      throw new Error(`duplicate entity canonical ID: ${key}`);
    }
    index.set(key, record);
  }
  return index;
}

function resolveRecord(
  data: EntityPresentationData,
  type: EntityType,
  query: { canonicalId?: string; slug?: string },
): EntityPresentationRecord | null {
  const records = data.entities.filter((record) => record.type === type);
  if (query.canonicalId) {
    const matches = records.filter((record) => record.canonical_id === query.canonicalId);
    return matches.length === 1 ? matches[0] : null;
  }
  if (!query.slug) return null;
  const matches = records.filter((record) => record.slug === query.slug);
  return matches.length === 1 ? matches[0] : null;
}

export function entityHref(type: EntityType, record: Pick<EntityPresentationRecord, "slug" | "canonical_id">): string {
  const identifier = record.slug || record.canonical_id;
  return `/${ENTITY_ROUTES[type]}/${identifier}`;
}

export function resolveEntityRef(
  data: EntityPresentationData,
  type: EntityType,
  query: { canonicalId?: string; slug?: string },
  locale: string,
): EntityRef | null {
  const record = resolveRecord(data, type, query);
  if (!record) return null;
  return {
    type,
    canonicalId: record.canonical_id,
    slug: record.slug,
    name: localizedEntityName(record, locale),
    href: entityHref(type, record),
    icon: record.icon || undefined,
    lifecycle: record.lifecycle.state,
  };
}

export function resolveEntityRefs(
  data: EntityPresentationData,
  refs: Array<{ type: EntityType; canonicalId?: string; slug?: string }>,
  locale: string,
): EntityRef[] {
  return refs.flatMap((ref) => {
    const resolved = resolveEntityRef(data, ref.type, ref, locale);
    return resolved ? [resolved] : [];
  });
}

export function entityName(record: EntityPresentationRecord, locale: string): string {
  return localizedEntityName(record, locale);
}
