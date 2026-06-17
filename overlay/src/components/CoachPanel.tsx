import type {
  DecisionMode,
  DecisionResult,
} from "../contracts/decision";
import { GRADE_TOKENS } from "../model/inference";
import { localizedGrade } from "../model/presentation";

interface CoachPanelProps {
  open: boolean;
  result: DecisionResult | null;
  mode: DecisionMode;
  onModeChange: (mode: DecisionMode) => void;
}

function interaction(
  candidate: DecisionResult["candidates"][number],
  match: (reason: string) => boolean,
): string {
  return candidate.reasons.find(match) ?? "neutral";
}

export function CoachPanel({
  open,
  result,
  mode,
  onModeChange,
}: CoachPanelProps) {
  if (!open) return null;

  return (
    <aside className="coach-panel">
      <header>
        <div>
          <strong>Oracle Coach</strong>
          <span>{result?.modelVersion ?? "Verified model unavailable"}</span>
        </div>
        <kbd>C</kbd>
      </header>
      <div className="coach-mode" role="group" aria-label="Decision mode">
        {(["competitive", "exploration"] as const).map((value) => (
          <button
            className={mode === value ? "active" : ""}
            key={value}
            onClick={() => onModeChange(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="coach-hint">Confirm a picked card with 1, 2, or 3.</p>
      {!result && <p>Open an augment screen to see ranked options.</p>}
      {result?.candidates.map((candidate, index) => (
        <section className="coach-candidate" key={candidate.augmentSlug}>
          <div className="coach-rank">
            <span>#{index + 1} {candidate.augmentSlug}</span>
            <strong style={{ color: GRADE_TOKENS[candidate.grade].color }}>
              {localizedGrade(candidate.grade, navigator.language)}
            </strong>
          </div>
          <span>{candidate.confidence} confidence</span>
          {candidate.warnings.length > 0 && (
            <strong className="coach-warning">{candidate.warnings.join(" · ")}</strong>
          )}
          <span>{candidate.reasons.join(" · ")}</span>
          <span>
            Skill: {interaction(candidate, (reason) =>
              reason.includes("ability") || reason.includes("mechanical"))}
          </span>
          <span>
            Items: {interaction(candidate, (reason) => reason.includes("items"))}
          </span>
          <span>
            Round: {interaction(candidate, (reason) => reason.startsWith("round:"))}
          </span>
        </section>
      ))}
    </aside>
  );
}
