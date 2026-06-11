/**
 * ability-augment-fit.ts — champion fit for 26.12 ability/quest augments.
 *
 * Riot gates Ability Augments by usability ("You'll only ever receive Ability
 * Augments that are usable for your champion") and the player chooses which
 * ability the augment enhances. No public data exposes augment→ability
 * bindings, so fit is modeled as eligibility + best-slot strength from the
 * structured per-ability flags scraped in Phase 0.
 *
 * Mirrors src/lib/scoring/ability-augment-fit.ts — keep both in sync.
 */

import type { AbilityEntry, AbilityProfile } from "./types";

export interface AbilityAugmentFitSignal {
  /** -3..3, scaled by SCORE_WEIGHTS.ABILITY_AUGMENT_FIT_PER_STRENGTH. */
  strength: -3 | -2 | -1 | 1 | 2 | 3;
  /** Castable abilities (Q/W/E/R) satisfying the augment's requirement. */
  eligibleKeys: string[];
}

export interface FitAugmentInput {
  slug: string;
  type?: string;
  wikiDescription?: string;
}

type FlagKey =
  | "projectile"
  | "knockback"
  | "knockup"
  | "recast"
  | "heal"
  | "shield"
  | "dash"
  | "longRange";

interface FitRule {
  /** Ability qualifies if it has ANY of these flags… */
  needsAny?: FlagKey[];
  /** …or ALL of these. */
  needsAll?: FlagKey[];
  /** Ability must deal damage (base damage or a scaling ratio). */
  wantsDamage?: boolean;
  /** Recast-natured abilities do not qualify (e.g. Echo Cast double-casts). */
  excludeRecast?: boolean;
}

// Curated rules for the class-page ability augments (live 26.12 tooltips).
const ABILITY_FIT_RULES: Record<string, FitRule> = {
  "chain-reaction": { needsAny: ["knockback", "knockup"] },
  multishot: { needsAny: ["projectile"] },
  tripleshot: { needsAny: ["projectile"] },
  "spell-split": { needsAny: ["projectile"] },
  "echo-cast": { wantsDamage: true, excludeRecast: true },
  siphon: { wantsDamage: true },
};

// Quest feasibility — only quests whose objective demonstrably needs a kit
// property get a rule; objective-based quests are champion-agnostic.
const QUEST_FIT_RULES: Record<string, FitRule> = {
  "support-main": { needsAny: ["heal", "shield"] },
  "from-downtown": { needsAll: ["longRange", "projectile"] },
};

/** Tooltip fallback for ability augments without a curated rule. */
function inferRule(description: string): FitRule {
  const d = description.toLowerCase();
  if (/knock(?:ed|s)?[- ]?(?:back|up)|airborne/.test(d)) {
    return { needsAny: ["knockback", "knockup"] };
  }
  if (/missile|projectile/.test(d)) {
    return { needsAny: ["projectile"] };
  }
  if (/heal|shield/.test(d)) {
    return { needsAny: ["heal", "shield"] };
  }
  return { wantsDamage: true };
}

function dealsDamage(ability: AbilityEntry): boolean {
  const s = ability.stats;
  if (!s) return false;
  return Boolean(
    (s.baseDamage && s.baseDamage.some((v) => v > 0)) ||
      (s.apRatio ?? 0) > 0 ||
      (s.adRatio ?? 0) > 0 ||
      (s.totalAdRatio ?? 0) > 0,
  );
}

function qualifies(ability: AbilityEntry, rule: FitRule): boolean {
  const s = ability.stats ?? {};
  if (rule.excludeRecast && s.recast) return false;
  if (rule.needsAll) return rule.needsAll.every((flag) => Boolean(s[flag]));
  if (rule.needsAny) return rule.needsAny.some((flag) => Boolean(s[flag]));
  if (rule.wantsDamage) return dealsDamage(ability);
  return false;
}

export function abilityAugmentFit(
  augment: FitAugmentInput,
  profile: AbilityProfile | undefined,
): AbilityAugmentFitSignal | undefined {
  if (augment.type !== "ability" && augment.type !== "quest") return undefined;
  if (!profile) return undefined;

  const castable = profile.abilities.filter((a) => a.key !== "passive");
  if (castable.length === 0) return undefined;

  const rule =
    augment.type === "ability"
      ? (ABILITY_FIT_RULES[augment.slug] ?? inferRule(augment.wikiDescription ?? ""))
      : QUEST_FIT_RULES[augment.slug];
  if (!rule) return undefined;

  const eligible = castable.filter((a) => qualifies(a, rule));
  if (eligible.length === 0) {
    return { strength: -2, eligibleKeys: [] };
  }

  // Generic damage-ability rules are weak signals — every kit has damage spells.
  const generic = !rule.needsAny && !rule.needsAll;
  const strength = generic ? 1 : eligible.length >= 2 ? 3 : 2;
  return { strength, eligibleKeys: eligible.map((a) => a.key) };
}
