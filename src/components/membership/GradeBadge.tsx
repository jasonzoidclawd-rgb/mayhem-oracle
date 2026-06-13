import type { DecisionGrade } from "@/lib/contracts/decision";
import { gradeToken } from "@/lib/membership/grade-tokens";

interface GradeBadgeProps {
  grade: DecisionGrade;
  /** Localized grade label, from the `grades` i18n namespace. */
  label: string;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS: Record<NonNullable<GradeBadgeProps["size"]>, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
  lg: "px-3 py-1.5 text-base font-semibold",
};

export function GradeBadge({ grade, label, size = "md" }: GradeBadgeProps) {
  const token = gradeToken(grade);
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium tracking-wide ${token.className} ${SIZE_CLASS[size]}`}
      data-grade={grade}
      role="status"
    >
      {label}
    </span>
  );
}
