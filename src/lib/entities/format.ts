import type { EntityStat } from "./types";

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Human-facing normalized values; arrays become semantic ranges. */
export function formatEntityStatValue(value: unknown, unit: EntityStat["unit"]): string {
  if (Array.isArray(value)) {
    const numeric = value.filter((entry): entry is number => typeof entry === "number");
    if (numeric.length === value.length && numeric.length > 1) {
      const first = formatEntityStatValue(numeric[0], unit);
      const last = formatEntityStatValue(numeric[numeric.length - 1], unit);
      return first === last ? first : `${first}–${last}`;
    }
    if (numeric.length === 1 && value.length === 1) return formatEntityStatValue(numeric[0], unit);
    return "—";
  }
  if (typeof value === "number") {
    const number = formatNumber(value);
    if (unit === "percent") return `${number}%`;
    if (unit === "multiplier") return `${number}×`;
    if (unit === "per5") return `${number}/5s`;
    if (unit === "gold") return `${number}g`;
    if (unit === "seconds") return `${number}s`;
    if (unit === "units") return String(number);
    return number;
  }
  return typeof value === "string" ? value : "—";
}
