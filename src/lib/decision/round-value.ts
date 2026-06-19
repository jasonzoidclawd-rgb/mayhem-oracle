import type { AugmentRound } from "../contracts/decision";
import type { DecisionModelConfig } from "./model-config";

export type RoundValueArchetype = "scaling" | "immediate" | "neutral";

export function roundValueArchetype(augment: {
  type?: "ability" | "quest" | "standalone";
}): RoundValueArchetype {
  if (augment.type === "quest") return "scaling";
  if (augment.type === "ability") return "immediate";
  return "neutral";
}

export function roundValueFor(
  augment: { type?: "ability" | "quest" | "standalone" },
  round: AugmentRound,
  modelConfig: DecisionModelConfig,
): number {
  return modelConfig.roundValue[roundValueArchetype(augment)][round];
}
