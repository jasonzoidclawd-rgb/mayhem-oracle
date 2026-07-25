/**
 * DEVELOPMENT-ONLY trace replay/analyzer.
 *
 * Consumes a tee'd overlay diagnostic log (see `publicationDiagnostics.ts` and
 * the Rust `emit_overlay_diagnostic` sink, both emitting `[marker] {json}` lines)
 * and reconstructs the OCR-identity lifecycle so a live `resolved 0/3` failure
 * has an inspectable cause without replaying the game. It reads only the already
 * privacy-bounded diagnostic stream — never raw OCR text, names, or account ids.
 *
 * Not imported by the overlay runtime; used by `scripts/replay-trace.mjs` and
 * unit tests.
 */

export interface TraceEvent {
  marker: string;
  payload: Record<string, unknown>;
}

const DIAGNOSTIC_LINE = /^\s*(\[[a-z0-9-]+\])\s+(\{.*\})\s*$/i;

/** Parse a tee'd log into diagnostic events; non-diagnostic and malformed lines are skipped. */
export function parseOverlayTrace(logText: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of logText.split("\n")) {
    const match = DIAGNOSTIC_LINE.exec(line);
    if (!match) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[2]);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    events.push({ marker: match[1], payload: parsed as Record<string, unknown> });
  }
  return events;
}

export interface NumericSummary {
  count: number;
  min: number;
  median: number;
  max: number;
}

/** Min/median/max of a numeric sample; an empty sample summarizes to all zeros. */
export function numericSummary(values: number[]): NumericSummary {
  if (values.length === 0) return { count: 0, min: 0, median: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { count: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], median };
}

export interface OcrCaptureSummary {
  samples: number;
  captureAttempted: number;
  zeroCropCount: number;
  cropCount: NumericSummary;
  ocrMs: NumericSummary;
  captureMs: NumericSummary;
}

export interface OcrTraceSummary {
  markerCounts: Record<string, number>;
  triggers: number;
  starts: number;
  nativeFinishes: number;
  publishes: number;
  timeouts: number;
  retries: number;
  staleRejects: number;
  watchdogRestarts: number;
  capture: OcrCaptureSummary;
  /** Geometry-probe watchdog restarts + how long geometry was blocked each time. */
  geometryWatchdogs: number;
  geometryInFlightMs: NumericSummary;
  /** Native OCR calls that returned (incl. AFTER the JS timeout abandoned them). */
  nativeReturns: number;
  nativeMs: NumericSummary;
  geometryTimings: number;
  geometryPreCaptureMs: NumericSummary;
  geometryCaptureMs: NumericSummary;
  geometryAnalysisMs: NumericSummary;
  geometryNativeElapsedMs: NumericSummary;
  geometryRoundTripMs: NumericSummary;
  staleGeometryResults: number;
  geometryTimeoutClassifications: Record<string, number>;
  geometryStaleHides: number;
  geometryRecoveries: number;
  continuousUnhealthyAgeMs: NumericSummary;
  acceptedGeometryAgeMs: NumericSummary;
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Aggregate the identity lifecycle. The counts and capture stats localize a
 * `resolved N/3` failure to a stage:
 *   - starts ≫ nativeFinishes → the native OCR call is not returning (timeouts).
 *   - nativeFinishes with high zeroCropCount → capture produced no crops.
 *   - nativeFinishes with crops but publishes 0 → matching/ownership rejection
 *     (see staleRejects) or champion-data gaps.
 *   - large ocrMs → the OCR call itself is starved/slow.
 */
export function summarizeOcrTrace(events: TraceEvent[]): OcrTraceSummary {
  const markerCounts: Record<string, number> = {};
  const cropCounts: number[] = [];
  const ocrMsValues: number[] = [];
  const captureMsValues: number[] = [];
  const geometryInFlightValues: number[] = [];
  const nativeMsValues: number[] = [];
  const geometryPreCaptureValues: number[] = [];
  const geometryCaptureValues: number[] = [];
  const geometryAnalysisValues: number[] = [];
  const geometryNativeElapsedValues: number[] = [];
  const geometryRoundTripValues: number[] = [];
  const continuousUnhealthyAgeValues: number[] = [];
  const acceptedGeometryAgeValues: number[] = [];
  const geometryTimeoutClassifications: Record<string, number> = {};
  let captureAttempted = 0;
  let zeroCropCount = 0;
  let nativeSamples = 0;
  let staleGeometryResults = 0;
  let geometryStaleHides = 0;

  for (const event of events) {
    markerCounts[event.marker] = (markerCounts[event.marker] ?? 0) + 1;
    if (event.marker.startsWith("[geometry-")) {
      const continuousAge = readNumber(event.payload, "continuousUnhealthyAgeMs");
      if (continuousAge !== null) continuousUnhealthyAgeValues.push(continuousAge);
      const acceptedAge = readNumber(event.payload, "acceptedGeometryAgeMs");
      if (acceptedAge !== null) acceptedGeometryAgeValues.push(acceptedAge);
    }
    if (event.marker === "[geometry-watchdog]") {
      const inFlightMs = readNumber(event.payload, "inFlightMs");
      if (inFlightMs !== null) geometryInFlightValues.push(inFlightMs);
      continue;
    }
    if (event.marker === "[geometry-timing]") {
      const preCaptureMs = readNumber(event.payload, "preCaptureMs");
      if (preCaptureMs !== null) geometryPreCaptureValues.push(preCaptureMs);
      const captureMs = readNumber(event.payload, "captureMs");
      if (captureMs !== null) geometryCaptureValues.push(captureMs);
      const analysisMs = readNumber(event.payload, "analysisMs");
      if (analysisMs !== null) geometryAnalysisValues.push(analysisMs);
      const nativeElapsedMs = readNumber(event.payload, "nativeElapsedMs");
      if (nativeElapsedMs !== null) geometryNativeElapsedValues.push(nativeElapsedMs);
      const roundTripMs = readNumber(event.payload, "roundTripMs");
      if (roundTripMs !== null) geometryRoundTripValues.push(roundTripMs);
      if (event.payload.stale === true) staleGeometryResults += 1;
      const timeout = event.payload.timeoutClassification;
      if (typeof timeout === "string") {
        geometryTimeoutClassifications[timeout] =
          (geometryTimeoutClassifications[timeout] ?? 0) + 1;
      }
      continue;
    }
    if (event.marker === "[geometry-hidden]") {
      if (event.payload.staleHide === true) geometryStaleHides += 1;
      continue;
    }
    if (event.marker === "[geometry-recovery]") continue;
    if (event.marker === "[identity-native-return]") {
      const nativeMs = readNumber(event.payload, "nativeMs");
      if (nativeMs !== null) nativeMsValues.push(nativeMs);
      continue;
    }
    if (event.marker !== "[identity-native-finish]") continue;
    nativeSamples += 1;
    if (event.payload.captureAttempted === true) captureAttempted += 1;
    const crop = readNumber(event.payload, "cropCount");
    if (crop !== null) {
      cropCounts.push(crop);
      if (crop === 0) zeroCropCount += 1;
    }
    const ocrMs = readNumber(event.payload, "ocrMs");
    if (ocrMs !== null) ocrMsValues.push(ocrMs);
    const captureMs = readNumber(event.payload, "captureMs");
    if (captureMs !== null) captureMsValues.push(captureMs);
  }

  return {
    markerCounts,
    triggers: markerCounts["[identity-trigger]"] ?? 0,
    starts: markerCounts["[identity-start]"] ?? 0,
    nativeFinishes: markerCounts["[identity-native-finish]"] ?? 0,
    publishes: markerCounts["[identity-publish]"] ?? 0,
    timeouts: markerCounts["[identity-timeout]"] ?? 0,
    retries: markerCounts["[identity-retry]"] ?? 0,
    staleRejects: markerCounts["[identity-stale-reject]"] ?? 0,
    watchdogRestarts: markerCounts["[identity-watchdog-restart]"] ?? 0,
    capture: {
      samples: nativeSamples,
      captureAttempted,
      zeroCropCount,
      cropCount: numericSummary(cropCounts),
      ocrMs: numericSummary(ocrMsValues),
      captureMs: numericSummary(captureMsValues),
    },
    geometryWatchdogs: markerCounts["[geometry-watchdog]"] ?? 0,
    geometryInFlightMs: numericSummary(geometryInFlightValues),
    nativeReturns: markerCounts["[identity-native-return]"] ?? 0,
    nativeMs: numericSummary(nativeMsValues),
    geometryTimings: markerCounts["[geometry-timing]"] ?? 0,
    geometryPreCaptureMs: numericSummary(geometryPreCaptureValues),
    geometryCaptureMs: numericSummary(geometryCaptureValues),
    geometryAnalysisMs: numericSummary(geometryAnalysisValues),
    geometryNativeElapsedMs: numericSummary(geometryNativeElapsedValues),
    geometryRoundTripMs: numericSummary(geometryRoundTripValues),
    staleGeometryResults,
    geometryTimeoutClassifications,
    geometryStaleHides,
    geometryRecoveries: markerCounts["[geometry-recovery]"] ?? 0,
    continuousUnhealthyAgeMs: numericSummary(continuousUnhealthyAgeValues),
    acceptedGeometryAgeMs: numericSummary(acceptedGeometryAgeValues),
  };
}
