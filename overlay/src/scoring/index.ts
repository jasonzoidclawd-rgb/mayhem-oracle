// Re-export all scoring functions and types
export { computeOracleScore, baselineOracleScore } from "./oracle-score";
export type { ScoredAugment, OracleScoreInput, OracleScoreResult, AugmentRarity, ComboTier } from "./oracle-score";

export { isInAugmentPool, buildPoolProfile, getChampionResource } from "./augment-tailoring";
export type { ChampionPoolProfile, AugmentPoolInput, ResourceType } from "./augment-tailoring";

export { analyzeInteractions, analyzeKit } from "./augment-interactions";
export type { MechanicalInteraction, AugmentMechanic, KitAnalysis } from "./augment-interactions";

export { evaluateAllSetSynergies } from "./set-synergy";

export { probabilityOfTarget, buildChampionPool, calculateSetPaths } from "./probability";
export type { PoolAugment, TierPool, ChampionPoolBreakdown, SetPath } from "./probability";

export { getChampionAugmentPool } from "./pool-orchestrator";
export type { PoolAugmentInput, PoolOutput } from "./pool-orchestrator";

export { SCORE_WEIGHTS } from "./types";
export type {
  Champion, Augment, ChampionBaseStats, AbilityProfile, AbilityEntry,
  AbilityStats, Tier, AugmentRarity as AugmentRarityType,
  ChampionTag, PoolRules, PoolItemExclusion, PoolAllyExclusion,
} from "./types";
