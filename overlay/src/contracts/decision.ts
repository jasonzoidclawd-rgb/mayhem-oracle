export type DecisionMode = "competitive" | "exploration";
export type DecisionGrade = "hot" | "strong" | "steady" | "average" | "weak";
export type AugmentRound = 1 | 2 | 3 | 4;
export type AugmentRarity = "silver" | "gold" | "prismatic";

export interface DecisionContext {
  championSlug: string;
  round: AugmentRound;
  screenRarity: AugmentRarity;
  mode: DecisionMode;
  ownedAugmentSlugs: string[];
  currentItemIds: string[];
  plannedItemIds: string[];
  offeredAugmentSlugs?: string[];
  seenOfferSlugs?: string[];
  rerollsRemaining: number;
  goldenRerollAvailable: boolean;
}

export interface DecisionCandidateResult {
  augmentSlug: string;
  grade: DecisionGrade;
  score: number;
  percentile: number;
  probability: {
    initialThree: number;
    withNormalRerolls: number;
  };
  warnings: string[];
  reasons: string[];
  confidence: "high" | "medium" | "low";
  breakdown: Record<string, number>;
}

export interface DecisionResult {
  modelVersion: string;
  context: DecisionContext;
  poolSize: number;
  candidates: DecisionCandidateResult[];
  reroll: {
    stance: "keep" | "consider" | "reroll" | "golden-reroll";
    reasons: string[];
  };
}
