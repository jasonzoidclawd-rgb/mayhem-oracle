export type EntityType = "champion" | "augment" | "item";

export type EntityLifecycleState =
  | "active"
  | "added"
  | "removed"
  | "disabled"
  | "unknown";

export type StatUnit = "flat" | "percent" | "multiplier" | "per5" | "gold" | "seconds" | "units" | "label";
export type StatDirection = "buff" | "nerf" | "changed";
export type StatLifecycle = "live" | "hotfix" | "preview" | "landed";

export interface EntityStat {
  key: string;
  label_key: string;
  value: number | string | unknown[] | Record<string, unknown>;
  context?: string;
  unit: StatUnit;
  source_path: string;
  source_version: string;
  patch: string;
  lane: "live" | "preview";
}

export interface EntityStatChange {
  key: string;
  label_key: string;
  before: number | string | unknown[] | Record<string, unknown>;
  after: number | string | unknown[] | Record<string, unknown>;
  unit: StatUnit;
  source_path: string;
  source_version: string;
  patch: string;
  lane: "live" | "preview";
  lifecycle: StatLifecycle;
  is_hotfix: boolean;
  direction: StatDirection;
  context?: string;
}

export interface EntityPresentationRecord {
  type: EntityType;
  canonical_id: string;
  slug: string;
  names: Record<string, string>;
  icon: string;
  description: string;
  lifecycle: {
    state: EntityLifecycleState;
    patch: string;
  };
  stats: EntityStat[];
  patch_changes: EntityStatChange[];
}

export interface EntityPresentationData {
  schema_version: number;
  source: string;
  status: "fresh" | "stale" | "unavailable" | "not_yet_confirmed";
  patch: string;
  pbe_patch: string;
  observed_at: string;
  entities: EntityPresentationRecord[];
}

export interface EntityRef {
  type: EntityType;
  canonicalId: string;
  slug: string;
  name: string;
  href: string;
  icon?: string;
  lifecycle: EntityLifecycleState;
  availability?: string;
}
