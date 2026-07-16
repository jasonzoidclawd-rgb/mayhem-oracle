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
}

export interface DiagnosticCounters {
  ocrDetected: number;
  previewInjected: number;
  offeredMatched: number;
  catalogResolved: number;
  renderedRealBadges: number;
  renderedPreviewBadges: number;
}
