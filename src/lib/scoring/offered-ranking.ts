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
import type { AbilityProfile } from "../types";

export type RankingStatus = "ranked" | "incomplete-offers";
export type RankingConfidence = "high" | "medium" | "low";
export type RankingReasonSource =
  | "oracle-score"
  | "augment-set-metadata"
  | "combo-table"
  | "curated-mode-rule"
  | "augment-description-inference";

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
  shopTiming?: OfferedRankingShopTiming;
  flags?: string[];
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
}

export interface RankingChampion {
  slug?: string;
  id?: string;
  name: string;
  win_rate?: number;
  winRate?: number;
  abilityProfile?: AbilityProfile;
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

const EXPLICIT_BREAKDOWN_KEYS = new Set<string>([
  "comboBonus", "trapPenalty", "abilityTypeSynergy", "attackTypeSynergy",
  "ccSynergy", "tagMismatch", "championWr", "setTierBonus", "sameSetSynergy",
  "rarityBonus", "systemBreakerBonus",
]);

function normalizeSetId(setId: string | undefined): string | undefined {
  const normalized = setId?.trim().toLowerCase();
  return normalized || undefined;
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

export function rankOfferedAugments(input: RankOfferedAugmentsInput): OfferedRankingResult {
  if (input.offeredAugments.length !== 3) {
    return { status: "incomplete-offers", rankings: [] };
  }

  const pickedSetIds = (input.ownedAugments ?? [])
    .map((augment) => normalizeSetId(augment.set))
    .filter((setId): setId is string => Boolean(setId));
  const duplicateSlugs = new Set(
    input.offeredAugments
      .map((augment) => augment.slug)
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

  const ranked = input.offeredAugments.map((augment, originalIndex) => {
    const augmentSetId = normalizeSetId(augment.set);
    const isDuplicate = duplicateSlugs.has(augment.slug);
    const combo = input.comboMetadataBySlot?.[originalIndex]
      ?? (isDuplicate ? undefined : input.comboMetadata?.[augment.slug]);
    const oracle = computeOracleScore({
      augment: augment as ScoredAugment,
      championWinRate: input.champion.win_rate ?? input.champion.winRate,
      comboTier: combo?.tier,
      pickedSetIds,
      augmentSetId,
      abilityProfile: input.champion.abilityProfile,
    });
    const explicitBreakdown = input.scoreBreakdownsBySlot?.[originalIndex]
      ?? (isDuplicate ? undefined : input.scoreBreakdowns?.[augment.slug]);
    const reasons: OfferedRankingReason[] = [];

    if (augmentSetId && pickedSetIds.includes(augmentSetId)) {
      reasons.push(reason("same-set-2-piece-progress", "augment-set-metadata", "high"));
    }

    addBreakdownReasons(reasons, oracle.breakdown, combo);

    let adjustedScore = oracle.total;
    if (explicitBreakdown) {
      for (const [k, v] of Object.entries(explicitBreakdown)) {
        if (EXPLICIT_BREAKDOWN_KEYS.has(k) && Number.isFinite(v)) {
          adjustedScore += v as number;
        }
      }
      addBreakdownReasons(reasons, explicitBreakdown);
    }
    const preferredOverride = championOverrides?.preferredAugments?.[augment.slug];
    if (preferredOverride) {
      adjustedScore += preferredOverride.scoreDelta;
      reasons.push(reason("champion-mode-override", preferredOverride.source ?? "curated-mode-rule", "high", preferredOverride.ref));
    }

    const trapOverride = championOverrides?.trapAugments?.[augment.slug];
    if (trapOverride) {
      adjustedScore += trapOverride.scoreDelta;
      reasons.push(reason("champion-mode-trap", trapOverride.source ?? "curated-mode-rule", "high", trapOverride.ref));
    }

    for (const signal of input.modeRules?.curatedSignals?.[augment.slug] ?? []) {
      reasons.push(reason(signal.code, signal.source, signal.confidence, signal.ref));
    }

    if (input.modeRules?.inferFromText) {
      reasons.push(...inferTextReasons(augment));
    }

    const flags = duplicateSlugs.has(augment.slug) ? ["duplicate-offer"] : undefined;
    const score = roundScore(adjustedScore);
    const band = scoreBand(score);
    reasons.push(reason("oracle-score-band", "oracle-score", "medium"));
    reasons.push(reason(augment.win_rate === null ? "augment-win-rate-missing" : "augment-win-rate-available", "oracle-score", "medium"));

    return {
      originalIndex,
      rank: 0,
      augment,
      score,
      scoreBand: band,
      reasons,
      shopTiming: qualitativeShopTiming,
      flags,
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
      shopTiming: ranking.shopTiming,
      flags: ranking.flags,
    })),
    rerollEv: qualitativeRerollEv,
  };
}
