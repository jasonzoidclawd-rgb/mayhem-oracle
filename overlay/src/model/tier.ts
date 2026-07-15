import type { DecisionGrade } from "../contracts/decision";

export type TierLetter = "S+" | "S" | "A" | "B" | "C";

// Presentation-only mapping of the five decision grades onto the DESIGN.md
// tier scale (God/S+ → Weak/C). The engine result is unchanged; this is the
// scoring-card face of the same percentile bands.
const TIER_BY_GRADE: Record<DecisionGrade, TierLetter> = {
  hot: "S+",
  strong: "S",
  steady: "A",
  average: "B",
  weak: "C",
};

// Frozen DESIGN.md tier tokens: tier-god / tier-strong / tier-good /
// tier-average / tier-weak.
export const TIER_COLORS: Record<TierLetter, string> = {
  "S+": "#ff4655",
  S: "#ff8c00",
  A: "#3b82f6",
  B: "#22c55e",
  C: "#6b7280",
};

const TIER_CLASS: Record<TierLetter, string> = {
  "S+": "tier-splus",
  S: "tier-s",
  A: "tier-a",
  B: "tier-b",
  C: "tier-c",
};

export function tierForGrade(grade: DecisionGrade): TierLetter {
  return TIER_BY_GRADE[grade];
}

export function tierClassName(letter: TierLetter): string {
  return TIER_CLASS[letter];
}

export function formatWinRate(winRate: number | null | undefined): string {
  if (typeof winRate !== "number" || !Number.isFinite(winRate)) return "WR —";
  return `${winRate.toFixed(1)}% WR`;
}
