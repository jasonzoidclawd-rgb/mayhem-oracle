import type { DecisionGrade } from "../contracts/decision";

/**
 * The one source of truth for the five-grade visual language (夯/強/穩/普/拉).
 * Web and overlay both render from this so a grade looks identical everywhere
 * (strategy §5 item 1). Labels are localized via the `grades` i18n namespace;
 * this module owns only color, ordering, and intensity.
 */
export interface GradeToken {
  grade: DecisionGrade;
  /** Ascending display order, hot = 0. */
  order: number;
  /** 0..1 strength used for animated reveal / bar fill. */
  intensity: number;
  /** Tailwind classes for the badge chip. */
  className: string;
  /** Accent hex for non-Tailwind surfaces (overlay canvas, OG images). */
  accent: string;
  /** Whether this grade is a hard-avoid signal. */
  isWarning: boolean;
}

export const GRADE_TOKENS: Record<DecisionGrade, GradeToken> = {
  hot: {
    grade: "hot",
    order: 0,
    intensity: 1,
    className: "bg-amber-400/15 text-amber-300 border border-amber-400/40 ring-1 ring-amber-400/20",
    accent: "#fbbf24",
    isWarning: false,
  },
  strong: {
    grade: "strong",
    order: 1,
    intensity: 0.8,
    className: "bg-emerald-400/15 text-emerald-300 border border-emerald-400/40",
    accent: "#34d399",
    isWarning: false,
  },
  steady: {
    grade: "steady",
    order: 2,
    intensity: 0.6,
    className: "bg-sky-400/15 text-sky-300 border border-sky-400/40",
    accent: "#38bdf8",
    isWarning: false,
  },
  average: {
    grade: "average",
    order: 3,
    intensity: 0.4,
    className: "bg-slate-400/10 text-slate-300 border border-slate-400/30",
    accent: "#94a3b8",
    isWarning: false,
  },
  weak: {
    grade: "weak",
    order: 4,
    intensity: 0.2,
    className: "bg-rose-500/15 text-rose-300 border border-rose-500/40",
    accent: "#fb7185",
    isWarning: true,
  },
};

export const GRADES_IN_ORDER: DecisionGrade[] = Object.values(GRADE_TOKENS)
  .sort((a, b) => a.order - b.order)
  .map((token) => token.grade);

export function gradeToken(grade: DecisionGrade): GradeToken {
  return GRADE_TOKENS[grade];
}
