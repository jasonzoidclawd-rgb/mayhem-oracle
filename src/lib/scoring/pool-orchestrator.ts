/**
 * pool-orchestrator.ts — Champion-specific augment pool construction
 *
 * Combines all filtering layers to produce the set of augments a champion
 * can actually see in Smart Tailoring, grouped by rarity tier.
 *
 * Composition order:
 *   1. Drop disabled and lifecycle.removed augments
 *   2. Hard-exclusion gate via isInAugmentPool (attack type, mana, CC, dash, etc.)
 *   3. Tag intersection: keep augments whose kit_tags overlap champion's kit_tags
 *      (augments with no tags are universal — shown to everyone)
 *   4. Item exclusions: drop augments blocked by currently-owned items
 */

import { abilityAugmentFit } from "./ability-augment-fit";
import { buildPoolProfile, isInAugmentPool } from "./augment-tailoring";

function normalizeItemKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeAugmentKey(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]/g, "");
}
import type { AbilityProfile, ChampionBaseStats, ChampionTag, PoolRules } from "../types";

// Resource-eligibility tags (mana / manaless) are handled exclusively by
// Layer 2 (`isInAugmentPool` → MANA_REQUIRED + heuristic regex). They must
// NOT participate in Layer 3 tag intersection: `classify_augments.py` emits
// `mana` / `manaless` on augments, but `classify_champions.py` intentionally
// does not emit them on champions, so leaving them in here would silently
// drop every `["mana"]`-only augment from every champion.
const RESOURCE_TAGS: ReadonlySet<ChampionTag> = new Set(["mana", "manaless"]);

export interface PoolAugmentInput {
  slug: string;
  rarity: "silver" | "gold" | "prismatic";
  type?: "ability" | "quest" | "standalone";
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
  ownedAugments?: string[];
  seenOffers?: string[];
}): PoolOutput<T> {
  const {
    championSlug,
    augments,
    abilityProfile,
    baseStats,
    championKitTags,
    poolRules,
    ownedItems = [],
    ownedAugments = [],
    seenOffers = [],
  } = args;

  const profile = buildPoolProfile(championSlug, abilityProfile, baseStats);

  const disabledSet = new Set(poolRules.disabled.map(normalizeAugmentKey));
  const removedSet  = new Set(Object.keys(poolRules.lifecycle.removed).map(normalizeAugmentKey));
  const observedLiveSet = new Set(
    Object.keys(poolRules.availability_overrides?.observed_live ?? {}).map(normalizeAugmentKey),
  );
  const normalizedOwnedItems = new Set(ownedItems.map(normalizeItemKey));
  const normalizedOwnedAugments = new Set(ownedAugments.map(normalizeAugmentKey));
  const normalizedSeenOffers = new Set(seenOffers.map(normalizeAugmentKey));
  const blockedByItem = new Set(
    poolRules.item_exclusions
      .filter((r) => normalizedOwnedItems.has(normalizeItemKey(r.blocked_by_item)))
      .map((r) => normalizeAugmentKey(r.augment)),
  );
  const blockedByOwnedAugment = new Set(
    poolRules.mutually_exclusive.flatMap(([left, right]) => {
      const normalizedLeft = normalizeAugmentKey(left);
      const normalizedRight = normalizeAugmentKey(right);
      if (normalizedOwnedAugments.has(normalizedLeft)) return [normalizedRight];
      if (normalizedOwnedAugments.has(normalizedRight)) return [normalizedLeft];
      return [];
    }),
  );

  const silver:    T[] = [];
  const gold:      T[] = [];
  const prismatic: T[] = [];
  const excluded: { slug: string; reason: string }[] = [];

  for (const aug of augments) {
    const slug = aug.slug;
    const normalizedSlug = normalizeAugmentKey(slug);

    // Layer 1 — lifecycle / disabled
    if (disabledSet.has(normalizedSlug)) {
      excluded.push({ slug, reason: "disabled" });
      continue;
    }
    if (removedSet.has(normalizedSlug) && !observedLiveSet.has(normalizedSlug)) {
      excluded.push({ slug, reason: "removed" });
      continue;
    }
    if (normalizedOwnedAugments.has(normalizedSlug)) {
      excluded.push({ slug, reason: "owned" });
      continue;
    }
    if (blockedByOwnedAugment.has(normalizedSlug)) {
      excluded.push({ slug, reason: "mutually-exclusive" });
      continue;
    }
    if (normalizedSeenOffers.has(normalizedSlug)) {
      excluded.push({ slug, reason: "seen-offer" });
      continue;
    }

    // Layer 2 — hard-exclusion gate (existing logic, now with real wikiDescription)
    if (!isInAugmentPool({ slug, description: aug.wikiDescription ?? "" }, profile)) {
      excluded.push({ slug, reason: "hard-exclusion" });
      continue;
    }

    // Layer 2.6 — 26.12 ability-augment usability gate (mirrors Riot's
    // "usable for your champion" pool rule).
    if (aug.type === "ability") {
      const fit = abilityAugmentFit(
        { slug, type: aug.type, wikiDescription: aug.wikiDescription },
        abilityProfile,
      );
      if (fit && fit.strength < 0) {
        excluded.push({ slug, reason: "ability-ineligible" });
        continue;
      }
    }

    // Layer 2.5 — resource-tag gate.
    // kit_tags "manaless" means the augment targets resourceless (no-mana, no-energy) champions.
    // kit_tags "mana" means the augment targets mana champions.
    // These must be evaluated BEFORE RESOURCE_TAGS strips them in Layer 3, otherwise a
    // manaless-tagged augment with no other tags would become universal (empty → pass-all).
    const rawKitTags = aug.kit_tags ?? [];
    if (rawKitTags.includes("manaless") && profile.resource !== "none") {
      excluded.push({ slug, reason: "resource-mismatch" });
      continue;
    }
    if (rawKitTags.includes("mana") && profile.resource !== "mana") {
      excluded.push({ slug, reason: "resource-mismatch" });
      continue;
    }

    // Layer 3 — tag intersection (Smart Tailoring active matching).
    // Resource tags are stripped first; see RESOURCE_TAGS comment above.
    const augTags = (aug.kit_tags ?? []).filter((t) => !RESOURCE_TAGS.has(t));
    if (augTags.length > 0) {
      const hasOverlap = augTags.some((t) => championKitTags.includes(t));
      if (!hasOverlap) {
        excluded.push({ slug, reason: "tag-mismatch" });
        continue;
      }
    }
    // augTags.length === 0 (post-filter) → universal augment, always passes

    // Layer 4 — item exclusions
    if (blockedByItem.has(normalizedSlug)) {
      excluded.push({ slug, reason: "item-exclusion" });
      continue;
    }

    // Passed all layers
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
