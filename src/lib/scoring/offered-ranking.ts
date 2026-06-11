/**
 * Web-only helper for ranking the three offered augments in the advisor flow.
 * Overlay scoring is unchanged.
 */
import {
  computeOracleScore,
  type AugmentRarity,
  type ComboTier,
  type ScoredAugment,
} from "./oracle-score";
import {
  analyzeInteractions,
  type AugmentMechanic,
  type MechanicalInteraction,
} from "./augment-interactions";
import { computeAugmentDamageContext, type AugmentDamageContext } from "./damage-context";
import type { AbilityProfile, ChampionBaseStats } from "../types";

export type { AugmentDamageContext };

export type RankingStatus = "ranked" | "incomplete-offers";
export type RankingConfidence = "high" | "medium" | "low";
export type RankingReasonSource =
  | "oracle-score"
  | "combo-table"
  | "curated-mode-rule"
  | "augment-description-inference"
  | "mechanical-interaction-analysis";

export interface OfferedRankingReason {
  code: string;
  source: RankingReasonSource | string;
  confidence: RankingConfidence;
  ref?: string;
  message?: string;
}

export type ScoreBand = "excellent" | "good" | "average" | "weak";

export interface OfferedRankingRerollEv {
  stance: "same-tier-search" | "upgrade-opportunity" | "hold-current";
  confidence: RankingConfidence;
  factors: string[];
}

export interface OfferedRankingShopTiming {
  status: "open" | "closed" | "unknown" | string;
  message: string;
}

export interface RankedOfferedAugment {
  rank: number;
  augment: RankingAugment;
  score: number;
  scoreBand: ScoreBand;
  reasons: OfferedRankingReason[];
  rerollEv?: OfferedRankingRerollEv;
  shopTiming?: OfferedRankingShopTiming;
  flags?: string[];
  damageContext?: AugmentDamageContext;
}

export interface OfferedRankingResult {
  status: RankingStatus;
  rankings: RankedOfferedAugment[];
  rerollEv?: OfferedRankingRerollEv;
}

export interface RankingAugment {
  slug: string;
  name: string;
  rarity: AugmentRarity;
  win_rate: number | null;
  icon: string;
  set?: string;
  description?: string;
  wikiDescription?: string;
  notes?: string[];
  kit_tags?: string[];
  flags?: {
    system_breaker?: boolean;
    lifecycle?: string;
  };
}

export interface RankingChampion {
  slug?: string;
  id?: string;
  name: string;
  win_rate?: number;
  winRate?: number;
  abilityProfile?: AbilityProfile;
  baseStats?: ChampionBaseStats;
  modeMetadata?: {
    aramMayhem?: {
      preferredTags?: string[];
      trapTags?: string[];
    };
  };
}

export interface ComboMetadataEntry {
  tier: ComboTier;
  ref?: string;
  source?: string;
}

export interface ModeRuleSignal {
  code: string;
  source: string;
  confidence: RankingConfidence;
  ref?: string;
}

export interface ChampionModeOverrideEntry {
  scoreDelta: number;
  source?: string;
  ref?: string;
}

export interface RankOfferedAugmentsInput {
  champion: RankingChampion;
  offeredAugments: RankingAugment[];
  ownedAugments?: RankingAugment[];
  comboMetadata?: Record<string, ComboMetadataEntry>;
  comboMetadataBySlot?: Array<ComboMetadataEntry | undefined>;
  scoreBreakdowns?: Record<string, Partial<Record<string, number>>>;
  scoreBreakdownsBySlot?: Array<Partial<Record<string, number>> | undefined>;
  modeRules?: {
    championOverrides?: Record<string, {
      preferredAugments?: Record<string, ChampionModeOverrideEntry>;
      trapAugments?: Record<string, ChampionModeOverrideEntry>;
    }>;
    curatedSignals?: Record<string, ModeRuleSignal[]>;
    inferFromText?: boolean;
  };
  rerollContext?: {
    screenTier: AugmentRarity;
    rerollType: "normal" | "golden" | string;
    selectionRound?: "level-3" | "level-7" | "level-11" | "level-15" | string;
    normalRerollsRemaining?: number;
    seenRerolledOfferSlugs?: string[];
    poolDataComplete?: boolean;
  };
  shopAvailability?: {
    status: "open" | "closed" | "unknown" | string;
  };
}

function roundScore(score: number): number {
  return Math.round(score * 10) / 10;
}

function scoreBand(score: number): ScoreBand {
  if (score >= 70) return "excellent";
  if (score >= 60) return "good";
  if (score >= 50) return "average";
  return "weak";
}

function reason(code: string, source: OfferedRankingReason["source"], confidence: RankingConfidence, ref?: string): OfferedRankingReason {
  return ref ? { code, source, confidence, ref } : { code, source, confidence };
}

function descriptionText(augment: RankingAugment): string {
  return `${augment.wikiDescription ?? ""} ${augment.description ?? ""}`.toLowerCase();
}

function inferTextReasons(augment: RankingAugment): OfferedRankingReason[] {
  const text = descriptionText(augment);
  const reasons: OfferedRankingReason[] = [];

  if (/crowd control|immobiliz|root|slow|stun/.test(text)) {
    reasons.push(reason("text-inferred-crowd-control-synergy", "augment-description-inference", "low"));
  }

  return reasons;
}

function rerollEv(input: RankOfferedAugmentsInput): OfferedRankingRerollEv | undefined {
  const context = input.rerollContext;
  if (!context) return undefined;

  const factors: string[] = [];
  let stance: OfferedRankingRerollEv["stance"] = "same-tier-search";

  if (context.rerollType === "golden" && context.screenTier !== "prismatic") {
    stance = "upgrade-opportunity";
    factors.push("golden-reroll-upgrade-opportunity");
  } else {
    factors.push("same-tier-reroll");
  }

  if (
    context.normalRerollsRemaining !== undefined &&
    context.normalRerollsRemaining <= 0 &&
    context.rerollType !== "golden"
  ) {
    stance = "hold-current";
    factors.push("no-normal-rerolls-remaining");
  }

  if (context.selectionRound === "level-11" || context.selectionRound === "level-15") {
    factors.push("late-selection-round");
  }

  if ((context.seenRerolledOfferSlugs?.length ?? 0) > 0) {
    factors.push("seen-rerolled-offers");
  }

  if (context.poolDataComplete === false) {
    factors.push("incomplete-pool-data");
  }

  return {
    stance,
    confidence: context.poolDataComplete === false ? "low" : "medium",
    factors,
  };
}

function shopTiming(input: RankOfferedAugmentsInput): OfferedRankingShopTiming | undefined {
  const status = input.shopAvailability?.status;
  if (!status) return undefined;

  if (status === "open") {
    return { status, message: "Shop is open; decide before manually leaving the shop." };
  }

  if (status === "closed") {
    return { status, message: "Shop is closed; treat this as a manual next-shop planning note." };
  }

  return { status, message: "Shop timing is unknown; use this as manual advisory only." };
}

function championKey(champion: RankingChampion): string | undefined {
  return champion.slug ?? champion.id;
}

function normalizeChampionKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeAugmentSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lookupBySlug<T>(map: Record<string, T> | undefined, slug: string): T | undefined {
  if (!map) return undefined;
  const normalized = normalizeAugmentSlug(slug);
  for (const [k, v] of Object.entries(map)) {
    if (normalizeAugmentSlug(k) === normalized) return v;
  }
  return undefined;
}

/** Max absolute scoreDelta for curated override rules. */
const SCORE_DELTA_CLAMP = 30;

// These mechanics are already represented by computeOracleScore's broad
// damage-type, attack-type, CC, and mismatch components.
const ORACLE_PROFILE_MECHANICS: ReadonlySet<AugmentMechanic> = new Set([
  "ON_HIT",
  "ATTACK_SPEED",
  "MELEE_CONVERT",
  "AD_SCALING",
  "AP_SCALING",
  "IMMOBILIZE_TRIGGER",
]);

function addBreakdownReasons(
  reasons: OfferedRankingReason[],
  breakdown: Partial<Record<string, number>>,
  combo?: ComboMetadataEntry,
): void {
  if ((breakdown.comboBonus ?? 0) > 0) {
    reasons.push(reason("strong-combo", combo?.source ?? "oracle-score", "high", combo?.ref));
  }
  if ((breakdown.trapPenalty ?? 0) < 0) {
    reasons.push(reason(combo ? "trap-combo" : "trap-penalty", combo?.source ?? "oracle-score", "high", combo?.ref));
  }
  if ((breakdown.abilityTypeSynergy ?? 0) > 0) {
    reasons.push(reason("ability-type-synergy", "oracle-score", "medium"));
  }
  if ((breakdown.attackTypeSynergy ?? 0) > 0) {
    reasons.push(reason("attack-type-synergy", "oracle-score", "medium"));
  }
  if ((breakdown.ccSynergy ?? 0) > 0) {
    reasons.push(reason("crowd-control-synergy", "oracle-score", "medium"));
  }
  if ((breakdown.tagMismatch ?? 0) < 0) {
    reasons.push(reason("tag-mismatch", "oracle-score", "medium"));
  }
}

function strongestInteractionsBySlug(input: RankOfferedAugmentsInput, offeredAugments: RankingAugment[]): Map<string, MechanicalInteraction> {
  const { abilityProfile, baseStats } = input.champion;
  if (!abilityProfile || !baseStats || abilityProfile.abilities.length === 0) {
    return new Map();
  }

  const strongest = new Map<string, MechanicalInteraction>();
  for (const interaction of analyzeInteractions(
    {
      slug: input.champion.slug ?? input.champion.id ?? input.champion.name,
      name: input.champion.name,
      abilityProfile,
      baseStats,
    },
    offeredAugments.map((augment) => ({
      slug: augment.slug,
      name: augment.name,
      description: augment.description ?? "",
      wikiDescription: augment.wikiDescription,
    })),
  )) {
    if (ORACLE_PROFILE_MECHANICS.has(interaction.mechanic)) {
      continue;
    }

    const key = normalizeAugmentSlug(interaction.augmentSlug);
    const existing = strongest.get(key);
    if (!existing || interaction.strength > existing.strength) {
      strongest.set(key, interaction);
    }
  }

  return strongest;
}

export function rankOfferedAugments(input: RankOfferedAugmentsInput): OfferedRankingResult {
  // ARAM Mayhem always offers exactly 3 augments. If the caller passes more (e.g. from tests
  // or future UI changes), rank only the first 3 rather than silently returning incomplete-offers.
  const offeredAugments = input.offeredAugments.length > 3
    ? input.offeredAugments.slice(0, 3)
    : input.offeredAugments;
  if (offeredAugments.length !== 3) {
    return { status: "incomplete-offers", rankings: [] };
  }

  const duplicateSlugs = new Set(
    offeredAugments
      .map((augment) => normalizeAugmentSlug(augment.slug))
      .filter((slug, index, slugs) => slugs.indexOf(slug) !== index),
  );
  const champKey = championKey(input.champion);
  const normalizedChampKey = champKey ? normalizeChampionKey(champKey) : undefined;
  const championOverrides = (() => {
    if (!normalizedChampKey || !input.modeRules?.championOverrides) return undefined;
    for (const [k, v] of Object.entries(input.modeRules.championOverrides)) {
      if (normalizeChampionKey(k) === normalizedChampKey) return v;
    }
    return undefined;
  })();
  const qualitativeRerollEv = rerollEv(input);
  const qualitativeShopTiming = shopTiming(input);
  const damageContextEnabled = Boolean(
    input.champion.baseStats && input.champion.abilityProfile
  );
  const mechanicalInteractions = strongestInteractionsBySlug(input, offeredAugments);

  const ranked = offeredAugments.map((augment, originalIndex) => {
    const isDuplicate = duplicateSlugs.has(normalizeAugmentSlug(augment.slug));
    const combo = input.comboMetadataBySlot?.[originalIndex]
      ?? (isDuplicate ? undefined : lookupBySlug(input.comboMetadata, augment.slug));
    const mechanicalInteraction = mechanicalInteractions.get(normalizeAugmentSlug(augment.slug));
    const oracle = computeOracleScore({
      augment: augment as ScoredAugment,
      championWinRate: input.champion.win_rate ?? input.champion.winRate,
      comboTier: combo?.tier,
      abilityProfile: input.champion.abilityProfile,
      isSystemBreaker: augment.flags?.system_breaker === true,
      mechanicalInteraction,
    });
    const explicitBreakdown = input.scoreBreakdownsBySlot?.[originalIndex]
      ?? (isDuplicate ? undefined : lookupBySlug(input.scoreBreakdowns, augment.slug));
    const reasons: OfferedRankingReason[] = [];

    addBreakdownReasons(reasons, oracle.breakdown, combo);
    if (mechanicalInteraction && oracle.breakdown.mechanicalInteraction !== 0) {
      reasons.push(reason(
        mechanicalInteraction.type === "synergy" ? "mechanical-synergy" : "mechanical-trap",
        "mechanical-interaction-analysis",
        "medium",
        mechanicalInteraction.mechanic,
      ));
    }

    let adjustedScore = oracle.total;
    if (explicitBreakdown) {
      // Treat explicit breakdowns as reason metadata only — computeOracleScore already
      // accounts for combo/trap/synergy/etc., so adding them again would double-count.
      addBreakdownReasons(reasons, explicitBreakdown);
    }
    const preferredOverride = lookupBySlug(championOverrides?.preferredAugments, augment.slug);
    if (preferredOverride && Number.isFinite(preferredOverride.scoreDelta)) {
      adjustedScore += Math.min(SCORE_DELTA_CLAMP, Math.max(-SCORE_DELTA_CLAMP, preferredOverride.scoreDelta));
      reasons.push(reason("champion-mode-override", preferredOverride.source ?? "curated-mode-rule", "high", preferredOverride.ref));
    }

    const trapOverride = lookupBySlug(championOverrides?.trapAugments, augment.slug);
    if (trapOverride && Number.isFinite(trapOverride.scoreDelta)) {
      adjustedScore += Math.min(SCORE_DELTA_CLAMP, Math.max(-SCORE_DELTA_CLAMP, trapOverride.scoreDelta));
      reasons.push(reason("champion-mode-trap", trapOverride.source ?? "curated-mode-rule", "high", trapOverride.ref));
    }

    for (const signal of lookupBySlug(input.modeRules?.curatedSignals, augment.slug) ?? []) {
      reasons.push(reason(signal.code, signal.source, signal.confidence, signal.ref));
    }

    if (input.modeRules?.inferFromText) {
      reasons.push(...inferTextReasons(augment));
    }

    const flags = duplicateSlugs.has(normalizeAugmentSlug(augment.slug)) ? ["duplicate-offer"] : undefined;
    const score = roundScore(adjustedScore);
    const band = scoreBand(score);
    reasons.push(reason("oracle-score-band", "oracle-score", "medium"));
    reasons.push(reason(augment.win_rate === null ? "augment-win-rate-missing" : "augment-win-rate-available", "oracle-score", "medium"));

    const damageContext = damageContextEnabled
      ? computeAugmentDamageContext(
          `${augment.wikiDescription ?? ""} ${augment.description ?? ""}`.trim(),
          input.champion.baseStats!,
          input.champion.abilityProfile!,
        )
      : undefined;

    return {
      originalIndex,
      rank: 0,
      augment,
      score,
      scoreBand: band,
      reasons,
      rerollEv: qualitativeRerollEv,
      shopTiming: qualitativeShopTiming,
      flags,
      damageContext,
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const slugCompare = a.augment.slug.localeCompare(b.augment.slug);
    if (slugCompare !== 0) return slugCompare;
    return a.originalIndex - b.originalIndex;
  });

  return {
    status: "ranked",
    rankings: ranked.map((ranking, index) => ({
      rank: index + 1,
      augment: ranking.augment,
      score: ranking.score,
      scoreBand: ranking.scoreBand,
      reasons: ranking.reasons,
      rerollEv: ranking.rerollEv,
      shopTiming: ranking.shopTiming,
      flags: ranking.flags,
      damageContext: ranking.damageContext,
    })),
    rerollEv: qualitativeRerollEv,
  };
}
