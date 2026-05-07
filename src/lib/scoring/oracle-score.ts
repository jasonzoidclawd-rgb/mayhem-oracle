/**
 * Oracle Score algorithm — ported from oracle_ghost.py
 *
 * Computes a composite score for an augment in the context of a specific champion
 * and the augments already picked in earlier rounds.
 *
 * score = champion_wr + set_tier_bonus + combo_bonus + trap_penalty
 *       + same_set_synergy + rarity_bonus + system_breaker_bonus
 *       + ability_type_synergy + attack_type_synergy + cc_synergy
 */

import { SCORE_WEIGHTS, type AbilityProfile, type ChampionTag } from "../types";

export type AugmentRarity = "prismatic" | "gold" | "silver";
export type ComboTier = "S" | "A" | "B" | "C";

export interface ScoredAugment {
  slug: string;
  name: string;
  name_zh_CN?: string;
  name_zh_TW?: string;
  name_ja?: string;
  name_ko?: string;
  rarity: AugmentRarity;
  win_rate: number | null;
  icon: string;
  set?: string;
  wikiSet?: string;
  description?: string;
  wikiDescription?: string;
  notes?: string[];
  kit_tags?: ChampionTag[];
  flags?: {
    system_breaker?: boolean;
    lifecycle?: string;
  };
}

export interface OracleScoreInput {
  augment: ScoredAugment;
  /** Champion win rate (0–100), e.g. 56.29 */
  championWinRate?: number;
  /** Combo tier for this augment × champion pair, if known */
  comboTier?: ComboTier;
  /** Augment set IDs already picked (for same-set synergy bonus) */
  pickedSetIds?: string[];
  /** Set ID of this augment, if it belongs to one */
  augmentSetId?: string;
  /** Whether this augment is a system breaker (qualitative change / 質變增幅) */
  isSystemBreaker?: boolean;
  /** Champion ability profile from CommunityDragon */
  abilityProfile?: AbilityProfile;
}

export interface OracleScoreResult {
  total: number;
  breakdown: {
    championWr: number;
    setTierBonus: number;
    comboBonus: number;
    trapPenalty: number;
    sameSetSynergy: number;
    rarityBonus: number;
    systemBreakerBonus: number;
    abilityTypeSynergy: number;
    attackTypeSynergy: number;
    ccSynergy: number;
    tagMismatch: number;
  };
}

/** Detect what type of champion/playstyle an augment prefers from its description. */
function detectAugmentProfile(description: string): {
  prefersAP: boolean;
  prefersAD: boolean;
  prefersRanged: boolean;
  prefersMelee: boolean;
  enhancesCC: boolean;
  prefersTank: boolean;
} {
  const d = description.toLowerCase();
  // Conversion phrases flip the audience: "become ranged" targets melee, "become melee" targets ranged.
  const becomeMelee = /\bbecome melee\b/.test(d);
  const becomeRanged = /\bbecome ranged\b/.test(d);
  return {
    prefersAP:     /magic damage|ability power|\bap\b|spell damage/.test(d),
    prefersAD:     /attack damage|physical damage|\bad\b|attack speed|on-hit|auto-attack/.test(d),
    prefersRanged: (/\branged\b/.test(d) && !becomeRanged) || becomeMelee,
    prefersMelee:  (/\bmelee\b/.test(d) && !becomeMelee) || becomeRanged,
    enhancesCC:    /crowd control|immobiliz|stun|root|\bslow\b/.test(d),
    prefersTank:   /bonus health|maximum health|bonus armor|bonus magic resist|increased size/.test(d),
  };
}

export function computeOracleScore(input: OracleScoreInput): OracleScoreResult {
  const {
    augment,
    championWinRate,
    comboTier,
    pickedSetIds = [],
    augmentSetId,
    isSystemBreaker = false,
    abilityProfile,
  } = input;

  const rarity = augment.rarity;

  // Use augment's own win rate as base (not champion WR which is constant per champ).
  // Reject NaN/Infinity from malformed data so they can't propagate into total scores.
  const baseScore =
    typeof augment.win_rate === "number" && Number.isFinite(augment.win_rate)
      ? augment.win_rate
      : 50;
  // Champion WR as minor adjustment: +-2 pts max around 50% baseline
  const wr = typeof championWinRate === "number" && Number.isFinite(championWinRate) ? championWinRate : 50;
  const championAdj = (wr - 50) * 0.1;
  const championWr = baseScore + championAdj;
  const setTierBonus = SCORE_WEIGHTS.SET_TIER_BONUS[rarity];
  const rarityBonus = SCORE_WEIGHTS.RARITY_BONUS[rarity];

  const comboBonus =
    comboTier === "S" ? SCORE_WEIGHTS.STRONG_COMBO_BONUS : 0;
  const trapPenalty =
    comboTier === "C" ? SCORE_WEIGHTS.TRAP_PENALTY : 0;

  const sameSetSynergy =
    augmentSetId && pickedSetIds.includes(augmentSetId)
      ? SCORE_WEIGHTS.SAME_SET_SYNERGY
      : 0;

  const systemBreakerBonus = isSystemBreaker
    ? SCORE_WEIGHTS.SYSTEM_BREAKER_BONUS
    : 0;

  // ���─ Ability profile synergy bonuses ──
  let abilityTypeSynergy = 0;
  let attackTypeSynergy = 0;
  let ccSynergy = 0;
  let tagMismatch = 0;

  const scoringText = `${augment.wikiDescription ?? ""} ${augment.description ?? ""}`.trim();
  if (abilityProfile && scoringText) {
    const aug = detectAugmentProfile(scoringText);

    // ── Positive synergy: augment matches champion's profile ──
    if (
      (aug.prefersAP && abilityProfile.damageType === "magic") ||
      (aug.prefersAD && abilityProfile.damageType === "physical")
    ) {
      abilityTypeSynergy = SCORE_WEIGHTS.ABILITY_TYPE_SYNERGY;
    }

    if (
      (aug.prefersRanged && abilityProfile.attackType === "ranged") ||
      (aug.prefersMelee && abilityProfile.attackType === "melee")
    ) {
      attackTypeSynergy = SCORE_WEIGHTS.ATTACK_TYPE_SYNERGY;
    }

    if (aug.enhancesCC && abilityProfile.playstyle.crowdControl >= 3) {
      ccSynergy = SCORE_WEIGHTS.CC_SYNERGY;
    }

    // ── Negative penalty: augment clearly mismatches champion ──
    // Pure AD augment for pure magic champion (or vice versa)
    // Mixed-damage champions get no penalty (they use both)
    if (abilityProfile.damageType !== "mixed") {
      if (aug.prefersAD && !aug.prefersAP && abilityProfile.damageType === "magic") {
        tagMismatch = SCORE_WEIGHTS.TAG_MISMATCH_PENALTY;
      }
      if (aug.prefersAP && !aug.prefersAD && abilityProfile.damageType === "physical") {
        tagMismatch = SCORE_WEIGHTS.TAG_MISMATCH_PENALTY;
      }
    }

    // Attack type mismatch (augment prefers ranged but champion is melee, etc.).
    // Penalty is negative — use Math.min so an existing damage-type penalty isn't erased back to 0.
    if (
      (aug.prefersRanged && !aug.prefersMelee && abilityProfile.attackType === "melee") ||
      (aug.prefersMelee && !aug.prefersRanged && abilityProfile.attackType === "ranged")
    ) {
      tagMismatch = Math.min(tagMismatch, SCORE_WEIGHTS.TAG_MISMATCH_PENALTY);
    }
  }

  const breakdown = {
    championWr,
    setTierBonus,
    comboBonus,
    trapPenalty,
    sameSetSynergy,
    rarityBonus,
    systemBreakerBonus,
    abilityTypeSynergy,
    attackTypeSynergy,
    ccSynergy,
    tagMismatch,
  };

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

  return { total, breakdown };
}

/**
 * Baseline Oracle Score for an augment with no champion context.
 * Useful for sorting augments on the catalog page.
 * Uses the augment's global win rate as the champion_wr term.
 */
export function baselineOracleScore(augment: ScoredAugment): number {
  const result = computeOracleScore({
    augment,
    championWinRate: augment.win_rate ?? 50,
  });
  return Math.round(result.total * 10) / 10;
}
