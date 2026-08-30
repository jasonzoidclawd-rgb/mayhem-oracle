import { logOverlayDiagnostic } from "./publicationDiagnostics";
import { patchesMatch } from "./championDataset";
import type { ChampionAugmentDataset } from "./championStats";

/**
 * DEV-ONLY structured evidence for the champion-dataset load/publish seam.
 *
 * The 2026-08-30 acceptance run displayed zero percentages: every slot stayed
 * `champion-loading` for the whole game even though the local Step-4 artifact
 * resolved all 19 published augment ids offline at the matching patch. The log
 * could not say why, because nothing observed the seam between "loader
 * resolved" and "activeChampionDataset is non-null".
 *
 * These records answer exactly two questions from the log alone:
 *
 *   loader resolved?                          YES / NO
 *   if YES, why wasn't the dataset published? one bounded reason
 *
 * Bounded scalars only — never augment rows, payloads or dataset objects.
 */

export type ChampionDatasetTraceEvent =
  | "request-start"
  | "loader-resolved"
  | "loader-failed"
  | "publish-attempt"
  | "published"
  | "discarded-stale"
  | "cleared"
  | "status-changed"
  | "gate-evaluated"
  | "source-resolved";

/** Why a resolved dataset did not become the active one. */
export type ChampionDatasetGateReason =
  | "status-not-ready"
  | "no-dataset"
  | "no-champion"
  | "champion-changed"
  | "patch-mismatch";

/** Why an in-flight request never published. */
export type ChampionDatasetDiscardReason = "effect-cancelled" | "superseded-request";

export interface ChampionDatasetTraceRecord {
  event: ChampionDatasetTraceEvent;
  championId?: string | null;
  championGeneration?: number | null;
  requestId?: number | null;
  currentRequestId?: number | null;
  requestedPatch?: string | null;
  datasetPatch?: string | null;
  patchesMatch?: boolean | null;
  completeness?: "partial" | "complete" | null;
  loadedCount?: number | null;
  currentChampionId?: string | null;
  status?: "idle" | "loading" | "ready" | "error" | null;
  sourceKind?: ChampionDatasetSourceKind;
  reason?: string | null;
  /** Short bounded classification. Truncated; never a payload or a body. */
  detail?: string | null;
}

/** Diagnostics carry a classification, never an unbounded upstream string. */
const MAX_DETAIL = 120;

export function traceChampionDatasetState(record: ChampionDatasetTraceRecord): void {
  logOverlayDiagnostic("[champion-dataset-state]", {
    event: record.event,
    championId: record.championId ?? null,
    championGeneration: record.championGeneration ?? null,
    requestId: record.requestId ?? null,
    currentRequestId: record.currentRequestId ?? null,
    requestedPatch: record.requestedPatch ?? null,
    datasetPatch: record.datasetPatch ?? null,
    patchesMatch: record.patchesMatch ?? null,
    completeness: record.completeness ?? null,
    loadedCount: record.loadedCount ?? null,
    currentChampionId: record.currentChampionId ?? null,
    status: record.status ?? null,
    sourceKind: record.sourceKind ?? null,
    reason: record.reason ?? null,
    detail: record.detail ? record.detail.slice(0, MAX_DETAIL) : null,
  });
}

// ─── Which path actually backed a dataset ───

export type ChampionDatasetSourceKind = "local-artifact" | "aramgg-dev" | "unknown" | null;

/**
 * Derive the source kind from the dataset's own provenance URL.
 *
 * The `[slot-publication]` diagnostic previously hardcoded
 * `endpointKind: "champion-augments-file"` — the EXTERNAL path — while gameplay
 * ran entirely on the local artifact and issued no such request. A label that
 * names an endpoint nobody called is not evidence, so this reads the dataset
 * that is actually active, and reports null when none is.
 */
export function championDatasetSourceKind(
  source: string | null | undefined,
): ChampionDatasetSourceKind {
  if (!source) return null;
  if (source.startsWith("/local-aramgg-artifact.json")) return "local-artifact";
  if (source.includes("/data/champion-augments/")) return "aramgg-dev";
  return "unknown";
}

// ─── The publish gate, as a pure decision ───

export interface ChampionDatasetGateInput {
  status: "idle" | "loading" | "ready" | "error";
  dataset: ChampionAugmentDataset | null;
  championKey: string | null;
  sourcePatch: string | null;
}

export interface ChampionDatasetGateResult {
  dataset: ChampionAugmentDataset | null;
  /** Null exactly when a dataset is active. */
  reason: ChampionDatasetGateReason | null;
}

/**
 * The single decision behind `activeChampionDataset`, extracted so the reason a
 * dataset is withheld is observable instead of being an unexplained null.
 * Behaviour is identical to the inline expression it replaces: ready status,
 * a dataset, a current champion it belongs to, and a matching patch.
 */
export function resolveActiveChampionDataset(
  input: ChampionDatasetGateInput,
): ChampionDatasetGateResult {
  const { status, dataset, championKey, sourcePatch } = input;
  if (status !== "ready") return { dataset: null, reason: "status-not-ready" };
  if (!dataset) return { dataset: null, reason: "no-dataset" };
  if (!championKey) return { dataset: null, reason: "no-champion" };
  if (dataset.championId !== championKey) return { dataset: null, reason: "champion-changed" };
  if (!patchesMatch(dataset.patch, sourcePatch)) {
    return { dataset: null, reason: "patch-mismatch" };
  }
  return { dataset, reason: null };
}
