import type {
  DecisionCandidateResult,
  DecisionContext,
  DecisionGrade,
  DecisionResult,
} from "../contracts/decision";
import { abilityAugmentFit } from "../scoring/ability-augment-fit";
import {
  computeOracleScore,
  type ComboTier,
  type MechanicalInteractionScoreSignal,
  type ScoredAugment,
} from "../scoring/oracle-score";
import {
  getChampionAugmentPool,
  type PoolAugmentInput,
} from "../scoring/pool-orchestrator";
import type {
  AbilityProfile,
  ChampionBaseStats,
  ChampionTag,
  PoolRules,
} from "../scoring/types";
import { gradeForPercentile, percentileForRank } from "./grade";
import type { DecisionModelConfig } from "./model-config";
import { roundValueFor } from "./round-value";

export interface DecisionAugment extends ScoredAugment, PoolAugmentInput {}

export interface DecisionChampionData {
  slug: string;
  winRate?: number | null;
  kitTags: ChampionTag[];
  abilityProfile?: AbilityProfile;
  baseStats?: ChampionBaseStats;
}

export interface DecisionEngineData {
  champion: DecisionChampionData;
  augments: DecisionAugment[];
  poolRules: PoolRules;
  comboTiers?: Record<string, ComboTier>;
  mechanicalInteractions?: Record<string, MechanicalInteractionScoreSignal>;
  itemSynergies?: Record<string, string[]>;
}

interface CandidateEvaluation {
  augment: DecisionAugment;
  score: number;
  warnings: string[];
  reasons: string[];
  confidence: DecisionCandidateResult["confidence"];
  breakdown: Record<string, number>;
}

const GRADE_ORDER: Record<DecisionGrade, number> = {
  hot: 0,
  strong: 1,
  steady: 2,
  average: 3,
  weak: 4,
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lookupNormalized<T>(
  values: Record<string, T> | undefined,
  slug: string,
): T | undefined {
  if (!values) return undefined;
  const key = normalize(slug);
  return Object.entries(values).find(([candidate]) => normalize(candidate) === key)?.[1];
}

function median(values: number[]): number {
  if (values.length === 0) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function isOfferableForPrior(
  augment: DecisionAugment,
  data: DecisionEngineData,
): boolean {
  const slug = normalize(augment.slug);
  const availabilityStatus = augment.availability?.status;
  if (availabilityStatus) return availabilityStatus === "confirmed_live";

  const disabled = new Set(data.poolRules.disabled.map(normalize));
  const removed = new Set(Object.keys(data.poolRules.lifecycle.removed).map(normalize));
  return !disabled.has(slug) && !removed.has(slug) && augment.flags?.lifecycle !== "removed";
}

function rarityPrior(
  context: DecisionContext,
  data: DecisionEngineData,
  modelConfig: DecisionModelConfig,
): number {
  const observed = data.augments
    .filter(
      (augment) =>
        augment.rarity === context.screenRarity &&
        isOfferableForPrior(augment, data) &&
        typeof augment.win_rate === "number" &&
        Number.isFinite(augment.win_rate),
    )
    .map((augment) => augment.win_rate as number);
  const [minimum, maximum] = modelConfig.priorClamp;
  return Math.max(minimum, Math.min(maximum, median(observed)));
}

function telemetryConfidence(
  augment: DecisionAugment,
  modelConfig: DecisionModelConfig,
): number {
  if (typeof augment.win_rate !== "number" || !Number.isFinite(augment.win_rate)) {
    return modelConfig.confidence.missing;
  }
  if (augment.flags?.lifecycle === "added") return modelConfig.confidence.added;
  return modelConfig.confidence.active;
}

function itemValue(
  augment: DecisionAugment,
  context: DecisionContext,
  data: DecisionEngineData,
  modelConfig: DecisionModelConfig,
): { current: number; planned: number } {
  const synergies = new Set(
    (lookupNormalized(data.itemSynergies, augment.slug) ?? []).map(normalize),
  );
  const currentMatches = new Set(
    context.currentItemIds.map(normalize).filter((item) => synergies.has(item)),
  ).size;
  const plannedMatches = new Set(
    context.plannedItemIds.map(normalize).filter((item) => synergies.has(item)),
  ).size;

  return {
    current: Math.min(
      modelConfig.itemValue.currentCap,
      currentMatches * modelConfig.itemValue.currentSynergy,
    ),
    planned: Math.min(
      modelConfig.itemValue.plannedCap,
      plannedMatches * modelConfig.itemValue.plannedSynergy,
    ),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function evaluateCandidate(
  augment: DecisionAugment,
  context: DecisionContext,
  data: DecisionEngineData,
  modelConfig: DecisionModelConfig,
  prior: number,
  exclusionReason?: string,
): CandidateEvaluation {
  const confidenceValue = telemetryConfidence(augment, modelConfig);
  const observed =
    typeof augment.win_rate === "number" && Number.isFinite(augment.win_rate)
      ? augment.win_rate
      : prior;
  const baseQuality = confidenceValue * observed + (1 - confidenceValue) * prior;
  const reliability = baseQuality + confidenceValue * 2;
  const mechanicalInteraction = lookupNormalized(
    data.mechanicalInteractions,
    augment.slug,
  );
  const oracle = computeOracleScore({
    augment,
    championWinRate: data.champion.winRate ?? undefined,
    comboTier: lookupNormalized(data.comboTiers, augment.slug),
    isSystemBreaker: augment.flags?.system_breaker === true,
    abilityProfile: data.champion.abilityProfile,
    mechanicalInteraction,
    abilityAugmentFit: abilityAugmentFit(
      {
        slug: augment.slug,
        type: augment.type,
        wikiDescription: augment.wikiDescription,
      },
      data.champion.abilityProfile,
    ),
  });
  const items = itemValue(augment, context, data, modelConfig);

  const synergy =
    Math.max(0, oracle.breakdown.comboBonus) +
    Math.max(0, oracle.breakdown.abilityTypeSynergy) +
    Math.max(0, oracle.breakdown.attackTypeSynergy) +
    Math.max(0, oracle.breakdown.ccSynergy) +
    Math.max(0, oracle.breakdown.mechanicalInteraction) +
    Math.max(0, oracle.breakdown.abilityAugmentFit) +
    items.current +
    items.planned;
  const novelty = Math.max(0, oracle.breakdown.systemBreakerBonus);
  const hardConflict =
    exclusionReason === "item-exclusion" ? modelConfig.itemValue.hardConflict : 0;
  const penalties =
    Math.min(0, oracle.breakdown.trapPenalty) +
    Math.min(0, oracle.breakdown.tagMismatch) +
    Math.min(0, oracle.breakdown.mechanicalInteraction) +
    Math.min(0, oracle.breakdown.abilityAugmentFit) +
    hardConflict;
  const roundValue = roundValueFor(augment, context.round, modelConfig);
  const multipliers = modelConfig.modeMultipliers[context.mode];
  const score =
    reliability * multipliers.reliability +
    synergy * multipliers.synergy +
    novelty * multipliers.novelty +
    penalties +
    roundValue;

  const warnings: string[] = [];
  const reasons: string[] = [];
  if (exclusionReason) {
    warnings.push("hard-incompatible", `excluded:${exclusionReason}`);
  }
  if (oracle.breakdown.trapPenalty < 0 || oracle.breakdown.mechanicalInteraction < 0) {
    warnings.push("mechanical-trap");
  }
  if (oracle.breakdown.tagMismatch < 0 || oracle.breakdown.abilityAugmentFit < 0) {
    warnings.push("kit-mismatch");
  }
  reasons.push(
    confidenceValue >= modelConfig.confidence.active
      ? "reliability:high-confidence"
      : confidenceValue > 0
        ? "reliability:bounded-confidence"
        : "reliability:rarity-prior",
  );
  if (oracle.breakdown.comboBonus > 0) reasons.push("synergy:combo");
  if (oracle.breakdown.mechanicalInteraction > 0) reasons.push("synergy:mechanical");
  if (oracle.breakdown.abilityAugmentFit > 0) reasons.push("synergy:ability-fit");
  if (items.current > 0) reasons.push("synergy:current-items");
  if (items.planned > 0) reasons.push("synergy:planned-items");
  if (novelty > 0) reasons.push("novelty:system-breaker");
  if (roundValue !== 0) {
    reasons.push(roundValue > 0 ? "round:value-positive" : "round:value-negative");
  }

  return {
    augment,
    score: round(score),
    warnings,
    reasons,
    confidence:
      confidenceValue >= modelConfig.confidence.active
        ? "high"
        : confidenceValue > 0
          ? "medium"
          : "low",
    breakdown: {
      reliability: round(reliability),
      synergy: round(synergy),
      novelty: round(novelty),
      penalties: round(penalties),
      roundValue: round(roundValue),
    },
  };
}

function targetProbability(poolSize: number, draws: number): number {
  if (poolSize <= 0 || draws <= 0) return 0;
  return round(Math.min(poolSize, draws) / poolSize);
}

function candidateResult(
  evaluation: CandidateEvaluation,
  percentile: number,
  poolSize: number,
  context: DecisionContext,
  hardIncompatible: boolean,
): DecisionCandidateResult {
  const initialThree = hardIncompatible ? 0 : targetProbability(poolSize, 3);
  const normalDraws = 3 + Math.max(0, Math.min(3, context.rerollsRemaining));

  return {
    augmentSlug: evaluation.augment.slug,
    grade: hardIncompatible ? "weak" : gradeForPercentile(percentile),
    score: evaluation.score,
    percentile: round(percentile),
    probability: {
      initialThree,
      withNormalRerolls: hardIncompatible
        ? 0
        : targetProbability(poolSize, normalDraws),
    },
    warnings: evaluation.warnings,
    reasons: evaluation.reasons,
    confidence: evaluation.confidence,
    breakdown: evaluation.breakdown,
  };
}

function rerollResult(
  context: DecisionContext,
  candidates: DecisionCandidateResult[],
): DecisionResult["reroll"] {
  if (context.goldenRerollAvailable) {
    return {
      stance: "golden-reroll",
      reasons: ["golden-reroll-separate-pool"],
    };
  }
  const best = candidates[0];
  if (!best || context.rerollsRemaining <= 0 || GRADE_ORDER[best.grade] <= GRADE_ORDER.strong) {
    return {
      stance: "keep",
      reasons: [best ? "best-offer-worth-keeping" : "no-candidates"],
    };
  }
  if (best.grade === "steady" || best.grade === "average") {
    return { stance: "consider", reasons: ["residual-pool-has-upside"] };
  }
  return { stance: "reroll", reasons: ["all-visible-offers-weak"] };
}

export function evaluateDecision(
  context: DecisionContext,
  data: DecisionEngineData,
  modelConfig: DecisionModelConfig,
): DecisionResult {
  const pool = getChampionAugmentPool({
    championSlug: context.championSlug,
    augments: data.augments,
    abilityProfile: data.champion.abilityProfile,
    baseStats: data.champion.baseStats,
    championKitTags: data.champion.kitTags,
    poolRules: data.poolRules,
    ownedItems: context.currentItemIds,
    ownedAugments: context.ownedAugmentSlugs,
    seenOffers: context.seenOfferSlugs,
  });
  const eligible = pool[context.screenRarity];
  const prior = rarityPrior(context, data, modelConfig);
  const exclusions = new Map(pool.excluded.map((entry) => [normalize(entry.slug), entry.reason]));

  const rankedEligible = eligible
    .map((augment) => evaluateCandidate(augment, context, data, modelConfig, prior))
    .sort(
      (left, right) =>
        right.score - left.score || left.augment.slug.localeCompare(right.augment.slug),
    );
  const eligibleResults = new Map(
    rankedEligible.map((evaluation, rank) => [
      normalize(evaluation.augment.slug),
      candidateResult(
        evaluation,
        percentileForRank(rank, rankedEligible.length),
        rankedEligible.length,
        context,
        false,
      ),
    ]),
  );

  const candidateSlugs =
    context.offeredAugmentSlugs ?? rankedEligible.map((evaluation) => evaluation.augment.slug);
  const bySlug = new Map(data.augments.map((augment) => [normalize(augment.slug), augment]));
  const candidates = candidateSlugs
    .map((slug) => {
      const key = normalize(slug);
      const eligibleResult = eligibleResults.get(key);
      if (eligibleResult) return eligibleResult;
      const augment = bySlug.get(key);
      if (!augment) return undefined;
      const exclusionReason =
        augment.rarity !== context.screenRarity
          ? "wrong-rarity"
          : exclusions.get(key) ?? "not-in-residual-pool";
      return candidateResult(
        evaluateCandidate(augment, context, data, modelConfig, prior, exclusionReason),
        1,
        rankedEligible.length,
        context,
        true,
      );
    })
    .filter((candidate): candidate is DecisionCandidateResult => candidate !== undefined)
    .sort(
      (left, right) =>
        GRADE_ORDER[left.grade] - GRADE_ORDER[right.grade] ||
        right.score - left.score ||
        left.augmentSlug.localeCompare(right.augmentSlug),
    );

  return {
    modelVersion: modelConfig.modelVersion,
    context,
    poolSize: rankedEligible.length,
    candidates,
    reroll: rerollResult(context, candidates),
  };
}
