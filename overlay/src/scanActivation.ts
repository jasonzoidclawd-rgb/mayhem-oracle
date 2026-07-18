import type { OverlayPhase } from "./dev/fixtureMode";
import type { RoundDeliveryDecision } from "./roundDelivery";

export type ScanActivation = "fast-loop" | "ambient-probe" | "none";

/** Whether this tick activated scanning from telemetry cadence or purely from
 *  the standing "the game is in front" signal. Development diagnostics only. */
export type ActivationSource = "none" | "telemetry-fast" | "visual-ambient" | "selection-open";

/**
 * What the poll tick may activate, from FRESH inputs only. There is no memory
 * here: a stale foreground value from an earlier tick can never suppress (or
 * sustain) scanning — each tick decides from the current predicate, so the
 * game regaining focus reactivates scanning on the next tick.
 *
 * Telemetry (scanMode) NEVER vetoes scanning. The visual surface is the ground
 * truth that an offer exists; round bookkeeping only estimates which round it
 * is. So whenever the game is foreground and in-game, an ambient probe always
 * runs — even when `scanMode` is "off" because completedRounds/pendingRounds
 * are stale or unexpected (e.g. a death-triggered offer after the round count
 * was overcounted). A fast delivery window (death sequence / latched offer)
 * only ESCALATES the cadence to the 20ms fast loop; it is never a precondition
 * for scanning at all.
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
  // In-game and foreground: scan unconditionally. Fast cadence when telemetry
  // says a delivery window is open; otherwise a single ambient probe per tick
  // so a real surface still latches when telemetry disagrees with the screen.
  if (input.scanMode === "fast") return "fast-loop";
  return "ambient-probe";
}

/** Classify how the tick's activation was reached (dev diagnostics). */
export function activationSource(
  activation: ScanActivation,
  phase: OverlayPhase,
  scanMode: RoundDeliveryDecision["scanMode"],
): ActivationSource {
  if (activation === "none") return "none";
  if (phase === "augment_selection") return "selection-open";
  if (scanMode === "fast") return "telemetry-fast";
  return "visual-ambient";
}
