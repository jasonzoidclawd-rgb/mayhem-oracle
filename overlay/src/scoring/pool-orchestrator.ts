/**
 * pool-orchestrator.ts — Champion-specific augment pool construction
 *
 * Mirrors src/lib/scoring/pool-orchestrator.ts. Keep the two in sync —
 * if you change one side, change the other.
 *
 * Composition order:
 *   1. Drop disabled and lifecycle.removed augments
 *   2. Hard-exclusion gate via isInAugmentPool (attack type, mana, CC, dash, etc.)
 *   3. Tag intersection: keep augments whose kit_tags overlap champion's kit_tags
 *      (augments with no tags are universal — shown to everyone)
 *   4. Item exclusions: drop augments blocked by currently-owned items
 */

import { buildPoolProfile, isInAugmentPool } from "./augment-tailoring";
import type { AbilityProfile, ChampionBaseStats, ChampionTag, PoolRules } from "./types";

export interface PoolAugmentInput {
  slug: string;
  rarity: "silver" | "gold" | "prismatic";
  wikiDescription?: string;
  kit_tags?: ChampionTag[];
}

export interface PoolOutput<T extends PoolAugmentInput = PoolAugmentInput> {
  silver: T[];
  gold: T[];
  prismatic: T[];
  total: number;
  excluded: { slug: string; reason: string }[];
}

export function getChampionAugmentPool<T extends PoolAugmentInput>(args: {
  championSlug: string;
  augments: T[];
  abilityProfile?: AbilityProfile;
  baseStats?: ChampionBaseStats;
  championKitTags: ChampionTag[];
  poolRules: PoolRules;
  ownedItems?: string[];
}): PoolOutput<T> {
  const {
    championSlug,
    augments,
    abilityProfile,
    baseStats,
    championKitTags,
    poolRules,
    ownedItems = [],
  } = args;

  const profile = buildPoolProfile(championSlug, abilityProfile, baseStats);

  const disabledSet = new Set(poolRules.disabled);
  const removedSet  = new Set(Object.keys(poolRules.lifecycle.removed));
  const blockedByItem = new Set(
    poolRules.item_exclusions
      .filter((r) => ownedItems.includes(r.blocked_by_item))
      .map((r) => r.augment),
  );

  const silver:    T[] = [];
  const gold:      T[] = [];
  const prismatic: T[] = [];
  const excluded: { slug: string; reason: string }[] = [];

  for (const aug of augments) {
    const slug = aug.slug;

    if (disabledSet.has(slug)) {
      excluded.push({ slug, reason: "disabled" });
      continue;
    }
    if (removedSet.has(slug)) {
      excluded.push({ slug, reason: "removed" });
      continue;
    }

    if (!isInAugmentPool({ slug, description: aug.wikiDescription ?? "" }, profile)) {
      excluded.push({ slug, reason: "hard-exclusion" });
      continue;
    }

    const augTags = aug.kit_tags ?? [];
    if (augTags.length > 0) {
      const hasOverlap = augTags.some((t) => championKitTags.includes(t));
      if (!hasOverlap) {
        excluded.push({ slug, reason: "tag-mismatch" });
        continue;
      }
    }

    if (blockedByItem.has(slug)) {
      excluded.push({ slug, reason: "item-exclusion" });
      continue;
    }

    if (aug.rarity === "prismatic") prismatic.push(aug);
    else if (aug.rarity === "gold")  gold.push(aug);
    else                             silver.push(aug);
  }

  return {
    silver,
    gold,
    prismatic,
    total: silver.length + gold.length + prismatic.length,
    excluded,
  };
}
