import type { OverlayPhase } from "./dev/fixtureMode";
import type { RoundDeliveryDecision } from "./roundDelivery";

export type ScanActivation = "fast-loop" | "ambient-probe" | "none";

/**
 * What the poll tick may activate, from FRESH inputs only. There is no memory
 * here: a stale foreground value from an earlier tick can never suppress (or
 * sustain) scanning — each tick decides from the current predicate, so the
 * game regaining focus reactivates scanning on the next tick.
 */
export function resolveScanActivation(input: {
  gameWindowForeground: boolean;
  phase: OverlayPhase;
  scanMode: RoundDeliveryDecision["scanMode"];
  selectionCompleted: boolean;
}): ScanActivation {
  if (!input.gameWindowForeground) return "none";
  if (input.phase === "augment_selection") {
    return input.selectionCompleted ? "none" : "fast-loop";
  }
  if (input.scanMode === "fast") return "fast-loop";
  if (input.scanMode === "ambient") return "ambient-probe";
  return "none";
}
