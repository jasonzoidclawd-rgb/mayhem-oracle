import type { AugmentRound, DecisionMode } from "../contracts/decision";

export const ROUND_VALUE = {
  scaling: { 1: 6, 2: 3, 3: 0, 4: -6 },
  immediate: { 1: 0, 2: 1, 3: 3, 4: 5 },
  neutral: { 1: 0, 2: 0, 3: 0, 4: 0 },
} as const;

export const MODE_MULTIPLIERS = {
  competitive: { reliability: 1.2, synergy: 1.0, novelty: 0.0 },
  exploration: { reliability: 0.7, synergy: 1.2, novelty: 1.0 },
} as const;

export const ITEM_VALUE = {
  currentSynergy: 4,
  plannedSynergy: 2,
  currentCap: 8,
  plannedCap: 4,
  hardConflict: -15,
} as const;

export interface DecisionModelConfig {
  modelVersion: string;
  priorClamp: readonly [number, number];
  confidence: {
    missing: number;
    added: number;
    active: number;
  };
  roundValue: Record<
    "scaling" | "immediate" | "neutral",
    Record<AugmentRound, number>
  >;
  modeMultipliers: Record<
    DecisionMode,
    { reliability: number; synergy: number; novelty: number }
  >;
  itemValue: {
    currentSynergy: number;
    plannedSynergy: number;
    currentCap: number;
    plannedCap: number;
    hardConflict: number;
  };
}

export const DEFAULT_MODEL_CONFIG: DecisionModelConfig = {
  modelVersion: "decision-v1",
  priorClamp: [42, 62],
  confidence: {
    missing: 0,
    added: 0.35,
    active: 0.75,
  },
  roundValue: ROUND_VALUE,
  modeMultipliers: MODE_MULTIPLIERS,
  itemValue: ITEM_VALUE,
};
