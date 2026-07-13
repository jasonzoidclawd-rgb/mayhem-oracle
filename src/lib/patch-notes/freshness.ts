export type FreshnessState = "today" | "days" | "stale" | "unavailable";

export interface FreshnessDescription {
  state: FreshnessState;
  days: number | null;
}

const STALE_AFTER_HOURS = 36;

/**
 * Present an observation as a day-level signal. A stale or missing source is
 * intentionally distinct from a fresh source that happened to report no rows.
 */
export function describeFreshness(
  sourceStatus: string | null | undefined,
  observedAt: string | null | undefined,
  now: Date = new Date(),
): FreshnessDescription {
  const observed = observedAt ? new Date(observedAt) : null;
  if (
    sourceStatus === "unavailable" ||
    sourceStatus === "not_yet_confirmed" ||
    !observed ||
    Number.isNaN(observed.getTime())
  ) {
    return { state: "unavailable", days: null };
  }
  const ageHours = Math.max(0, now.getTime() - observed.getTime()) / 3_600_000;
  const days = Math.floor(ageHours / 24);
  if (sourceStatus === "stale" || ageHours > STALE_AFTER_HOURS) {
    return { state: "stale", days };
  }
  return { state: days === 0 ? "today" : "days", days };
}
