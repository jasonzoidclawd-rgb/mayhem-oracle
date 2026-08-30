import { tierForGrade, type TierLetter } from "./model/tier";
import {
  compactWinRateFromFraction,
  compactWinRateFromPercent,
} from "./winRateFormat";
import type {
  RoundContentFailureCategory,
  SemanticPublication,
} from "./badgeLayerDiagnostic";
import type { PoolAugment } from "./scoring/probability";
import type { SlotAramggResolution } from "./dev/useAramggTierFixture";

/**
 * THE single authority for what one badge chip shows.
 *
 * The renderer and the `[slot-publication]` / `[identity-publish]` diagnostics
 * both call this and read the SAME derived value. Nothing may recompute a
 * second "displayed" percentage from `pool.win_rate` or anywhere else: the
 * 2026-08-30 live acceptance run logged 38 `displayedStatText` percentages
 * that never reached the screen, because the diagnostic derived them from the
 * catalog while the renderer was painting LOADING DATA. A trace that disagrees
 * with the screen cannot certify anything.
 */

/** Structural view of a slot's identity resolution (App-internal type). */
export interface SlotStatResolution {
  pool: PoolAugment | null;
  aramgg: SlotAramggResolution | null;
}

export interface SlotStatPresentationInput {
  resolution: SlotStatResolution | null;
  /** Why an unresolved slot is unresolved, when `resolution` is null. */
  unresolvedState: "scanning" | "unmatched" | "ocr-error" | undefined;
  /** Decision-engine candidate for the pool match, when one graded it. */
  candidate: { grade: Parameters<typeof tierForGrade>[0] } | null;
}

export interface SlotStatPresentation {
  state:
    | "tier"
    | "scanning"
    | "unmatched"
    | "ocr-error"
    | "no-data"
    | "loading-data"
    | "data-error";
  tier: TierLetter | null;
  /** THE rendered percentage text. Null means no percentage is on screen. */
  winRateText: string | null;
  isNew: boolean;
  statScope: "champion" | null;
  /** Whether a percentage was actually rendered from an observed value. */
  statKind: "observed" | "missing";
  /** Provenance of the RENDERED statistic; null when nothing was rendered. */
  provenance: "champion" | null;
  terminalState: SemanticPublication["terminalState"];
  noDataVerified: boolean;
  failureCategory: RoundContentFailureCategory;
}

function withoutStat(
  state: SlotStatPresentation["state"],
  terminalState: SemanticPublication["terminalState"],
  failureCategory: RoundContentFailureCategory,
  noDataVerified = false,
): SlotStatPresentation {
  return {
    state,
    tier: null,
    winRateText: null,
    isNew: false,
    statScope: null,
    statKind: "missing",
    provenance: null,
    terminalState,
    noDataVerified,
    failureCategory,
  };
}

export function deriveSlotStatPresentation(
  input: SlotStatPresentationInput,
): SlotStatPresentation {
  const { resolution, unresolvedState, candidate } = input;

  if (resolution === null) {
    // Geometry confirms a card here, but its identity is pending (fresh
    // trigger, reroll re-read in flight, or unreadable) — SCANNING, never a
    // vanished chip and never a percentage.
    const pending = unresolvedState === "scanning" || unresolvedState == null;
    return withoutStat(
      unresolvedState ?? "scanning",
      pending ? "loading-data" : "error",
      pending ? null : "FAIL_IDENTITY",
    );
  }

  const staged = resolution.aramgg;
  if (staged) {
    if (staged.kind === "matched") {
      // Exact string pipeline from the raw ARAMGG fraction ("0.5915" →
      // "59.2%"); the raw value stays on the stat for diagnostics.
      const winRateText = compactWinRateFromFraction(staged.stat.rawWinRate);
      // Champion-only: a global-sourced statistic never reaches a chip.
      const isChampion = staged.stat.provenance === "champion";
      return {
        state: "tier",
        tier: staged.stat.tierLetter,
        winRateText,
        isNew: resolution.pool?.lifecycle === "added",
        statScope: isChampion ? "champion" : null,
        statKind: winRateText === null ? "missing" : "observed",
        provenance: winRateText !== null && isChampion ? "champion" : null,
        terminalState: "resolved",
        noDataVerified: false,
        failureCategory: null,
      };
    }
    if (staged.kind === "no-data") {
      // Identity resolved; the COMPLETE champion dataset has no row.
      return withoutStat("no-data", "no-data", null, true);
    }
    if (staged.kind === "loading") {
      // Champion dataset still loading (or partial): absence is unproven.
      return withoutStat("loading-data", "loading-data", null);
    }
    if (staged.kind === "error") {
      // Fetch failed — never fall back to a global value.
      return withoutStat("data-error", "error", "FAIL_DATA");
    }
    return withoutStat("unmatched", "error", "FAIL_IDENTITY");
  }

  // Engine path (no dev fixture): the local-catalog match backs the chip.
  const pool = resolution.pool;
  if (!pool) return withoutStat("unmatched", "error", "FAIL_IDENTITY");

  const winRateText = compactWinRateFromPercent(pool.win_rate);
  return {
    state: "tier",
    tier: candidate ? tierForGrade(candidate.grade) : pool.tier,
    winRateText,
    isNew: pool.lifecycle === "added",
    // The catalog is augment-global, so this path is never champion-scoped.
    statScope: null,
    statKind: winRateText === null ? "missing" : "observed",
    provenance: null,
    terminalState: "resolved",
    noDataVerified: false,
    failureCategory: null,
  };
}
