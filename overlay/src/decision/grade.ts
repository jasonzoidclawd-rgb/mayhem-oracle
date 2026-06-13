import type { DecisionGrade } from "../contracts/decision";

export const GRADE_BANDS = {
  hot: [0, 0.1],
  strong: [0.1, 0.3],
  steady: [0.3, 0.6],
  average: [0.6, 0.85],
  weak: [0.85, 1],
} as const;

export function gradeForPercentile(percentile: number): DecisionGrade {
  const bounded = Math.max(0, Math.min(1, percentile));
  if (bounded < GRADE_BANDS.hot[1]) return "hot";
  if (bounded < GRADE_BANDS.strong[1]) return "strong";
  if (bounded < GRADE_BANDS.steady[1]) return "steady";
  if (bounded < GRADE_BANDS.average[1]) return "average";
  return "weak";
}

export function percentileForRank(rank: number, poolSize: number): number {
  if (poolSize <= 1) return 0;
  return rank / (poolSize - 1);
}
