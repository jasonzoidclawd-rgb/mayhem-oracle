import type {
  DecisionContext,
  DecisionGrade,
  DecisionResult,
} from "../contracts/decision";
import {
  evaluateDecision,
  type DecisionEngineData,
} from "../decision/evaluate";
import type { DecisionModelConfig } from "../decision/model-config";

export const GRADE_TOKENS: Record<
  DecisionGrade,
  { color: string; warning: boolean }
> = {
  hot: { color: "#fbbf24", warning: false },
  strong: { color: "#34d399", warning: false },
  steady: { color: "#38bdf8", warning: false },
  average: { color: "#94a3b8", warning: false },
  weak: { color: "#fb7185", warning: true },
};

export function runLocalInference(
  context: DecisionContext,
  data: DecisionEngineData,
  modelConfig: DecisionModelConfig,
): DecisionResult {
  return evaluateDecision(context, data, modelConfig);
}
