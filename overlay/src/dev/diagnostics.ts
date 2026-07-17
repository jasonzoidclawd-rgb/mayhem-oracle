export type SlotDiagnosticState =
  | "scanning"
  | "matched"
  | "no-data"
  | "unmatched";

export type SlotRejectionStage =
  | "capture"
  | "ocr"
  | "riot-catalog"
  | "aramgg"
  | null;

export interface OcrCardDiagnostic {
  regionIndex: number;
  cardRect: { x: number; y: number; width: number; height: number } | null;
  crop: { x: number; y: number; width: number; height: number } | null;
  captureSucceeded: boolean;
  rawText: string | null;
  error: string | null;
  captureWidth: number | null;
  captureHeight: number | null;
  normalizedText: string;
  bestCandidate: string | null;
  confidence: number | null;
  rejectionReason: string | null;
  /** Riot zh-TW catalog candidate (canonical name), when resolution ran. */
  riotCanonicalName: string | null;
  /** Canonical numeric augment ID resolved through the Riot catalog. */
  riotAugmentId: string | null;
  /** Riot title-resolution method (riot-zh-tw-exact / -fuzzy / -zh-cn-exact). */
  riotMethod: string | null;
  /** ARAMGG stat summary for the resolved ID, or null when missing. */
  aramggResult: string | null;
  /** Current per-slot lifecycle state. */
  slotState: SlotDiagnosticState;
  /** First pipeline stage that rejected this card (null when fully matched). */
  rejectionStage: SlotRejectionStage;
}

export interface OcrScanTimings {
  /** Native screenshot + crop extraction, ms. */
  captureMs: number | null;
  /** Native OCR recognition (all cards concurrently), ms. */
  ocrMs: number | null;
  /** Whole native scan, ms. */
  nativeTotalMs: number | null;
  /** Frontend catalog matching + state publication, ms. */
  matchMs: number | null;
  /** Scan start → state published, ms. */
  endToEndMs: number | null;
}

export interface OcrLifecycleSnapshot {
  phase: string;
  currentRound: number | null;
  active: boolean;
  lastScanStart: string | null;
  lastScanEnd: string | null;
  scanRunId: number | null;
  captureAttempted: boolean;
  cropCount: number;
  noCropReason: string | null;
  /** Monotonic latched-offer generation (bumps on reroll / new offer). */
  offerGeneration: number;
  timings: OcrScanTimings;
}

export const EMPTY_SCAN_TIMINGS: OcrScanTimings = {
  captureMs: null,
  ocrMs: null,
  nativeTotalMs: null,
  matchMs: null,
  endToEndMs: null,
};

export interface DiagnosticCounters {
  /** Cards whose crop capture succeeded in the latest scan. */
  cardsCaptured: number;
  /** Cards whose OCR produced a readable title. */
  titlesRead: number;
  /** Cards resolved to a canonical Riot augment ID. */
  riotResolved: number;
  /** Cards with a live ARAMGG stat record. */
  aramggMatched: number;
  ocrDetected: number;
  previewInjected: number;
  offeredMatched: number;
  catalogResolved: number;
  renderedRealBadges: number;
  renderedPreviewBadges: number;
}
