import { logOverlayDiagnostic } from "./publicationDiagnostics";

/**
 * DEV-ONLY structured evidence at the ARAMGG / local-artifact fetch seams.
 *
 * The previous live acceptance log could not prove network behaviour at all:
 * 37 MB with no request records, so "gameplay made zero external ARAMGG
 * requests" was an assertion, not evidence. Every seam now emits a bounded
 * record so the log itself separates:
 *
 *   phase "mount"            — identity / changelog load through /aramgg-dev
 *   phase "champion-dataset" — the gameplay stat load
 *
 * and, within gameplay, `source` separates the same-origin local artifact from
 * any external /aramgg-dev request.
 *
 * Bounded enums, static paths, HTTP status and a duration only. NEVER response
 * bodies, headers, cookies, auth material or payload sizes.
 */

export type AramggFetchSource = "local-artifact" | "aramgg-dev";
export type AramggFetchPhase = "mount" | "champion-dataset";
export type AramggFetchEndpointKind =
  | "local-artifact-file"
  | "champion-augments-file"
  | "aramgg-stats"
  | "aramgg-catalog"
  | "aramgg-catalog-zh-tw"
  | "aramgg-changelog";

export interface AramggFetchTraceInput {
  source: AramggFetchSource;
  phase: AramggFetchPhase;
  endpointKind: AramggFetchEndpointKind;
  /** Static request path. Never carries a query string or credentials. */
  path: string;
  championId?: string | null;
  patch?: string | null;
}

/**
 * Trace one fetch from start to outcome. Returns the awaited value, so a seam
 * wraps its existing call without changing behaviour or error semantics.
 */
export async function traceAramggFetch<T>(
  input: AramggFetchTraceInput,
  run: () => Promise<T>,
): Promise<T> {
  const base = {
    source: input.source,
    phase: input.phase,
    endpointKind: input.endpointKind,
    path: input.path,
    championId: input.championId ?? null,
    patch: input.patch ?? null,
  };
  logOverlayDiagnostic("[aramgg-fetch]", { ...base, outcome: "start" });
  const startedAt = Date.now();
  try {
    const value = await run();
    logOverlayDiagnostic("[aramgg-fetch]", {
      ...base,
      outcome: "success",
      durationMs: Date.now() - startedAt,
    });
    return value;
  } catch (error) {
    // Only the HTTP status is recoverable evidence; the message may quote
    // upstream text, so it is never logged.
    logOverlayDiagnostic("[aramgg-fetch]", {
      ...base,
      outcome: "failure",
      durationMs: Date.now() - startedAt,
      status: httpStatusOf(error),
    });
    throw error;
  }
}

/** A fetch seam throws `… → HTTP <status>`; recover just that number. */
function httpStatusOf(error: unknown): number | null {
  const message = error instanceof Error ? error.message : "";
  const match = /HTTP (\d{3})$/.exec(message);
  return match ? Number(match[1]) : null;
}
