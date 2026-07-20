import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildChampionPool,
} from "./scoring";
import {
  buildOverlayAugmentLookup,
  diagnoseAugmentMatch,
  normalizeAugmentNameForLookup,
  type AugmentMatchDiagnostic,
} from "./scoring/offer-lookup";
import {
  isCompleteThreeCardOffer,
  shouldClearOcrStateForGameflow,
  shouldRunOcrForGameflow,
} from "./augmentSelection";
import {
  resolveRoundDelivery,
  TOTAL_AUGMENT_ROUNDS,
  type RoundDeliveryDecision,
} from "./roundDelivery";
import {
  applyScanToOffer,
  emptyOfferState,
  offerActive,
  type OfferState,
} from "./offerLifecycle";
import {
  CollectorOverlayController,
  type CollectorSnapshot,
} from "./collector/CollectorStatus";
import {
  overlayShouldIgnoreMouseEvents,
} from "./collector/collectorWindows";
import { normalizeChampionName, resolveKnownChampionSlug } from "./championResolve";
import type {
  AbilityProfile,
  ChampionBaseStats,
  ChampionPoolBreakdown,
  ChampionTag,
  PoolAugment,
  PoolRules,
  ComboTier,
} from "./scoring";
import type {
  DecisionMode,
  DecisionResult,
} from "./contracts/decision";
import type { DecisionEngineData } from "./decision/evaluate";
import {
  bootstrapMember,
  disabledMember,
  memberRecommendationsVisible,
  shouldVerifyGameStart,
  verifyMemberGameStart,
  type MemberSnapshot,
} from "./auth/member";
import { CoachPanel } from "./components/CoachPanel";
import { TierBadgeLabel } from "./TierBadgeLabel";
import { runLocalInference } from "./model/inference";
import { confirmPickedAugment } from "./model/presentation";
import { tierClassName, tierForGrade, type TierLetter } from "./model/tier";
import {
  compactWinRateFromFraction,
  compactWinRateFromPercent,
} from "./winRateFormat";
import {
  buildAramggDecisionResult,
  isTierFixtureEnabled,
  TIER_FIXTURE_MEMBER,
  type AramggFixtureCard,
} from "./dev/tierFixture";
import {
  useAramggTierFixture,
  type SlotAramggResolution,
} from "./dev/useAramggTierFixture";
import { isGeometryPreviewEnabled, resolveOverlayFixtureMode } from "./dev/fixtureMode";
import { DevOverlayDiagnostics } from "./dev/DevOverlayDiagnostics";
import { devPanelsVisible } from "./dev/productionSurfaces";
import {
  boundedDiagnosticHash,
  logOverlayDiagnostic,
} from "./dev/publicationDiagnostics";
import {
  SurfaceFixtureBuffer,
  buildSurfaceFixtureRecord,
  isDatasetCaptureEnabled,
  type DatasetLabel,
  type SurfaceFixtureInput,
} from "./dev/datasetCapture";
import {
  foregroundPollMayStart,
  resolveWithTimeout,
  FOREGROUND_POLL_TIMEOUT_MS,
} from "./foregroundWatchdog";
import { isPlausibleTitle } from "./surfacePresence";
import {
  DEFAULT_PROBE_CONFIG,
  PROBE_TIMEOUT_MS,
  nextProbeAction,
  type ProbeSchedulerConfig,
} from "./surfaceProbeScheduler";
import {
  emptyVisibleFrame,
  frameResultIsCurrent,
  visibleFrameRenderable,
  type VisibleOfferFrame,
} from "./visibleOfferFrame";
import {
  GEOMETRY_INTERVAL_MS,
  GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS,
  IDENTITY_RETRY_MS,
  advanceGeometrySurface,
  buildGeometryVisibleFrame,
  classifyGeometryObservation,
  createGeometrySurfaceState,
  emptyGeometryObservation,
  geometrySchedulerHealthy,
  hammingDistance,
  identityForSlot,
  newOfferDetected,
  type GeometryClassification,
  type GeometryHideReason,
  type GeometryObservation,
  type GeometrySurfaceState,
  type IdentityRecord,
} from "./surfaceGeometry";
import { applyRerollInvalidation, ocrRunSuperseded } from "./rerollInvalidation";
import {
  reconcileSlotIdentity,
  type SlotIdentity,
} from "./publicationOwnership";
import { decideOcrTrigger } from "./ocrTrigger";
import {
  OcrOwnerRegistry,
  executeOcrRun,
  failurePublication,
  ownerCurrent,
  type OcrOwnerContext,
} from "./ocrOwner";
import {
  advanceOfferSurface,
  createOfferSurfaceState,
  type OfferSurfaceState,
} from "./offerSurfaceState";
import {
  EMPTY_SCAN_TIMINGS,
  type OcrCardDiagnostic as DevOcrCardDiagnostic,
  type OcrLifecycleSnapshot,
  type SlotDiagnosticState,
  type SlotRejectionStage,
} from "./dev/diagnostics";
import {
  gameOverlayVisible,
  unknownForegroundState,
  type ForegroundState,
} from "./overlayVisibility";
import {
  canRunOcr,
  createOcrAvailability,
  ocrAvailabilityFromError,
  type OcrAvailability,
} from "./ocrAvailability";
import {
  cssRectFromCalibratedRect,
  type OverlayCalibration,
  type PhysicalRect,
} from "./calibration";
import {
  cardFrameFromNameRect,
  overlayAvoidRectsCss,
  placeBadgeAboveCard,
} from "./badgeLayout";
import "./App.css";

// The geometry track runs the SAME self-healing scheduler as OCR (start / skip /
// watchdog-restart) but on the fast cadence: presence/occlusion/visual freshness
// update independently of a slow OCR pass. Timeout is the shared
// bounded watchdog so a wedged capture re-arms within one cycle.
const GEOMETRY_PROBE_CONFIG: ProbeSchedulerConfig = {
  intervalMs: GEOMETRY_INTERVAL_MS,
  timeoutMs: PROBE_TIMEOUT_MS,
};

type GeometryDiagnosticHideReason = GeometryHideReason
  | "ttl-expired"
  | "foreground-lost"
  | "probe-timeout"
  | "other";

interface GeometryProbeDiagnostic {
  probeSeq: number;
  scheduledAt: number;
  startedAt: number;
  captureStartedAt: number;
  captureFinishedAt: number;
  analysisFinishedAt: number;
  publishedAt: number;
  preCaptureMs: number;
  captureMs: number;
  nativeTotalMs: number;
  ipcMs: number;
  analysisMs: number;
  totalProbeMs: number;
  gapSincePreviousStartMs: number | null;
  gapSincePreviousCompletedMs: number | null;
  inFlightMs: number;
  schedulerRestartCount: number;
  classification: GeometryClassification;
  present: boolean;
  occluded: boolean;
  confidence: number;
  cards: GeometryObservation["cards"];
  rejectionReasons: string[];
  previousSurfaceState: "present" | "hidden";
  nextSurfaceState: "present" | "hidden";
  hiddenReason: GeometryDiagnosticHideReason | null;
}

// ─── Types ───

interface LivePlayerData {
  champion: string;
  level: number;
  is_dead: boolean;
  game_time: number;
  game_mode: string;
}

interface LcuGameflowState {
  phase: string;
  liveCaptureAllowed: boolean;
}

interface DetectedAugment {
  text: string;
  region_index: number;
}

interface NativeOcrCardDiagnostic {
  regionIndex: number;
  cardRect: { x: number; y: number; width: number; height: number } | null;
  crop: { x: number; y: number; width: number; height: number } | null;
  captureSucceeded: boolean;
  rawText: string | null;
  error: string | null;
  captureWidth: number | null;
  captureHeight: number | null;
}

interface OcrScanResult {
  detected: DetectedAugment[];
  diagnostics: NativeOcrCardDiagnostic[];
  captureAttempted: boolean;
  cropCount: number;
  captureMs: number;
  ocrMs: number;
  totalMs: number;
}

interface MatchedCard {
  augment: PoolAugment;
  regionIndex: number;
  ocrText: string;
}

/**
 * One per-slot badge chip: a real recommendation (`tier`) or an explicit slot
 * state — SCANNING (reroll/unreadable), UNMATCHED (Riot identity unresolved),
 * NO ARAMGG DATA (identity resolved, no stat record).
 */
interface SlotChip {
  regionIndex: number;
  key: string;
  state: "tier" | "scanning" | "unmatched" | "ocr-error" | "no-data";
  tier: TierLetter | null;
  winRateText: string | null;
  isNew: boolean;
  statScope: "champion" | "global" | null;
}

/**
 * Per-slot identity resolution, computed once when a slot's title fingerprint
 * changes and retained while the fingerprint is stable.
 */
interface SlotResolution {
  /** Local-catalog match (the real decision-engine path). */
  pool: PoolAugment | null;
  poolDiagnostic: AugmentMatchDiagnostic;
  /** Dev fixture: staged zh-TW Riot catalog → canonical ID → ARAMGG stats. */
  aramgg: SlotAramggResolution | null;
}

/**
 * Canonical augment ID of a resolved slot (empty while pending/unmatched). The
 * dev ARAMGG path carries the numeric Riot augment ID; the engine path uses the
 * local catalog slug. Used by the immutability guard to detect a conflicting
 * re-read of the same card (Phase A).
 */
function slotResolutionAugmentId(resolution: SlotResolution | null): string {
  if (!resolution) return "";
  const aramgg = resolution.aramgg;
  if (aramgg && aramgg.kind !== "unmatched") return aramgg.riot.augmentId;
  return resolution.pool?.slug ?? "";
}

/**
 * The one live reconciliation bridge. Canonical identity is immutable inside
 * an ownership scope; the derived resolution may refresh for the same id when
 * the current champion dataset moves from GLOBAL fallback to CHAMP.
 */
function reconcileIdentityRecord(
  previous: IdentityRecord<SlotResolution> | null,
  incoming: IdentityRecord<SlotResolution>,
): IdentityRecord<SlotResolution> {
  if (incoming.resolution === null || (incoming.augmentId ?? "").length === 0) {
    return previous?.resolution ? previous : incoming;
  }
  const asIdentity = (record: IdentityRecord<SlotResolution>): SlotIdentity<SlotResolution> => ({
    foregroundEpoch: record.foregroundEpoch ?? 0,
    gameEpoch: record.gameEpoch ?? 0,
    fingerprint: record.fingerprint,
    championGeneration: record.championGeneration ?? 0,
    offerGeneration: record.offerGeneration ?? 0,
    augmentId: record.augmentId ?? "",
    resolution: record.resolution as SlotResolution,
    slotGeneration: record.slotGeneration ?? 0,
    ocrRunId: record.ocrRunId ?? 0,
    conflictCount: record.conflictCount ?? 0,
  });
  const reconciled = reconcileSlotIdentity(
    previous?.resolution ? asIdentity(previous) : null,
    asIdentity(incoming),
  );
  if (reconciled.action === "keep") {
    return { ...previous!, conflictCount: reconciled.identity.conflictCount };
  }
  if (reconciled.action === "recompute-stat") {
    return {
      ...previous!,
      resolution: reconciled.identity.resolution,
      resolvedAt: incoming.resolvedAt,
      ocrRunId: incoming.ocrRunId,
      championRequestId: incoming.championRequestId,
      championPatch: incoming.championPatch,
    };
  }
  return incoming;
}

interface OverlayAugment {
  slug: string;
  name: string;
  name_zh_CN?: string;
  name_zh_TW?: string;
  name_ja?: string;
  name_ko?: string;
  rarity: "silver" | "gold" | "prismatic";
  win_rate: number | null;
  icon: string;
  description?: string;
  wikiDescription?: string;
  notes?: string[];
  set?: string;
  wikiSet?: string;
  kit_tags?: ChampionTag[];
  flags?: {
    system_breaker?: boolean;
    lifecycle?: string;
  };
}

interface OverlayChampion {
  slug: string;
  champion_key: string;
  name: string;
  name_zh_TW?: string;
  name_zh_CN?: string;
  name_ja?: string;
  name_ko?: string;
  win_rate: number | null;
  tags: string[];
  kit_tags?: ChampionTag[];
  baseStats?: ChampionBaseStats;
}

interface OverlayCombo {
  champion: string;
  augment: string;
  augmentSlug?: string;
  tier: string;
}

interface OverlayData {
  augments: OverlayAugment[];
  champions: OverlayChampion[];
  combos: OverlayCombo[];
  poolRules: PoolRules;
}

type Phase = "idle" | "client_found" | "in_game" | "augment_selection";

// ─── Constants ───

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin));
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// ─── App ───

function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [playerData, setPlayerData] = useState<LivePlayerData | null>(null);
  const [championSlug, setChampionSlug] = useState<string | null>(null);
  const [pickedAugments, setPickedAugments] = useState<string[]>([]);
  const [offerState, setOfferState] = useState<OfferState<SlotResolution>>(
    () => emptyOfferState(),
  );
  const offerStateRef = useRef(offerState);
  const [offerSurface, setOfferSurface] = useState<OfferSurfaceState>(
    () => createOfferSurfaceState(),
  );
  const offerSurfaceRef = useRef(offerSurface);
  // VisibleOfferFrame — the ONLY state rendered chips/placeholders read. The
  // internal latch above (offerState) is nonvisual grace bookkeeping and never
  // renders directly. Every scan publishes a fresh-or-empty frame here; the
  // render gate is `visibleFrameRenderable`. See visibleOfferFrame.ts.
  const [visibleFrame, setVisibleFrame] = useState<VisibleOfferFrame<SlotResolution> | null>(null);
  const visibleFrameRef = useRef<VisibleOfferFrame<SlotResolution> | null>(null);
  // Monotonic probe sequence: bumped at every probe START, every synchronous
  // clear, and every watchdog restart. A probe result may publish its frame
  // only while its seq is still the latest AND its foreground epoch is unchanged
  // — a delayed/stuck probe can never restore a superseded frame.
  const scanSeqRef = useRef(0);
  const visibleRevisionRef = useRef(0);
  // Foreground epoch: bumped whenever gameWindowForeground flips, so a probe
  // that captured under an earlier focus can never publish after a change.
  const foregroundEpochRef = useRef(0);
  // Active-game epoch changes on every capture-allowed game transition or
  // reconnect. Async work from a previous game can never publish into the next.
  const gameEpochRef = useRef(0);
  // Self-healing surface-probe scheduler bookkeeping (a single probe at a time).
  const probeInFlightRef = useRef(false);
  const probeInFlightSinceRef = useRef<number | null>(null);
  // Ownership token: the captureSeq of the probe that currently holds the
  // in-flight guard. Only that probe may release the guard in its finally, so a
  // watchdog-superseded probe returning late can never free the guard held by
  // its replacement (which would let two probes overlap).
  const ocrOwnersRef = useRef(new OcrOwnerRegistry());
  const lastProbeStartedAtRef = useRef<number | null>(null);
  const lastProbeFinishedAtRef = useRef<number | null>(null);
  const probeRestartCountRef = useRef(0);
  const lastProbeSkipReasonRef = useRef<string>("idle");
  const lastProbeFailureReasonRef = useRef<string | null>(null);
  // ─── Round-6 geometry track (presence/occlusion/visual-freshness authority) ───
  // A cheap Rust pixel probe (probe_augment_surface) runs on its own fast
  // scheduler with its own single-in-flight guard, ownership token, seq, and
  // watchdog — a mirror of the OCR guards above so the two tracks never stall
  // each other. Geometry owns whether an offer is present, whether a modal has
  // occluded it, and the current card geometry/fingerprints. Scheduler health
  // independently owns fail-closed expiry. OCR NEVER decides those; it only
  // fills identity.
  const geometryInFlightRef = useRef(false);
  const geometryInFlightSinceRef = useRef<number | null>(null);
  const geometryInFlightTokenRef = useRef<number | null>(null);
  const geometrySeqRef = useRef(0);
  const lastGeometryStartedAtRef = useRef<number | null>(null);
  const geometryRestartCountRef = useRef(0);
  const geometryObservationRef = useRef<GeometryObservation | null>(null);
  const geometrySurfaceStateRef = useRef<GeometrySurfaceState>(
    createGeometrySurfaceState(),
  );
  const lastGeometryCompletedAtRef = useRef<number | null>(null);
  const geometryDiagnosticsRef = useRef<GeometryProbeDiagnostic[]>([]);
  const lastRawGeometryClassificationRef = useRef<GeometryClassification | null>(null);
  const lastGeometryRenderableRef = useRef(false);
  const geometryFreshnessWarningSeqRef = useRef<number | null>(null);
  const geometryExpiryWarningSeqRef = useRef<number | null>(null);
  // Render generation, bumped on each NEW offer (absent→present or a queued
  // round replacement) so chip keys reset between offers.
  const geometryGenerationRef = useRef(0);
  // Per-slot identity keyed by the GEOMETRY fingerprint it was resolved against.
  // identityForSlot returns a record only while its fingerprint still matches the
  // live card, so a late OCR result from a superseded generation can never paint
  // the new card (the identity stale-result guard).
  const identityStoreRef = useRef<Array<IdentityRecord<SlotResolution> | null>>([null, null, null]);
  // Champion generation: bumps on every final-champion change so each resolved
  // slot recomputes against the new champion's dataset, while within a
  // generation the reconcile guard keeps each verified identity immutable.
  const championGenerationRef = useRef(0);
  const championIdRef = useRef<string | null>(null);
  // Per-slot generation: bumps ONLY for the slot whose fingerprint changed
  // (a single-slot reroll), so an OCR run stamped with the old generation is
  // rejected atomically and cannot repaint the new card (Phase B).
  const slotGenerationsRef = useRef<number[]>([0, 0, 0]);
  const acceptedSlotFingerprintsRef = useRef<string[]>(["", "", ""]);
  // Cross-track OCR-trigger coordination: the geometry track decides which slots
  // need a (re)read and stamps the fingerprints those reads are keyed to.
  const ocrPendingSlotsRef = useRef<number[]>([]);
  const ocrTriggerFingerprintsRef = useRef<string[]>(["", "", ""]);
  const forceOcrSlotsRef = useRef<number[]>([]);
  // DEV-only geometry latency ring (capture+analyze ms) for p50/p95/p99 logging.
  const geometryLatenciesRef = useRef<number[]>([]);
  const geometryProbeCountRef = useRef(0);
  // Whether the last poll saw an active, capture-allowed game (coarse gate).
  const activeGameRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  // Rounds completed on STRONG evidence only (confirmed pick / queued-offer
  // replacement) — can only undercount, which keeps probing alive and never
  // suppresses a real offer. See roundDelivery.ts.
  const completedRoundsRef = useRef(0);
  const roundDeliveryRef = useRef<RoundDeliveryDecision | null>(null);
  const [roundDelivery, setRoundDelivery] = useState<RoundDeliveryDecision | null>(null);
  const ocrSelectionCompletedRef = useRef(false);
  const gameflowCaptureAllowedRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const pollPendingRef = useRef(false);
  const pollRef = useRef<() => Promise<void>>(async () => {});
  const foregroundPollStartedAtRef = useRef<number | null>(null);
  const [showStartupTip, setShowStartupTip] = useState(true);
  const [foregroundState, setForegroundState] = useState<ForegroundState>(
    unknownForegroundState(),
  );
  const foregroundStateRef = useRef<ForegroundState>(unknownForegroundState());
  const [ocrDiagnostics, setOcrDiagnostics] = useState<DevOcrCardDiagnostic[]>([]);
  const [ocrLifecycle, setOcrLifecycle] = useState<OcrLifecycleSnapshot>({
    phase: "idle",
    currentRound: null,
    active: false,
    lastScanStart: null,
    lastScanEnd: null,
    scanRunId: null,
    captureAttempted: false,
    cropCount: 0,
    noCropReason: "not-started",
    offerGeneration: 0,
    surfaceValidated: false,
    surfaceReason: null,
    freshRectCount: 0,
    visibleFrameRevision: 0,
    lifecycleDisagreement: false,
    probeSeq: 0,
    lastProbeStartedAt: null,
    lastProbeFinishedAt: null,
    probeInFlightSince: null,
    probeRestartCount: 0,
    probeSkipReason: "idle",
    probeFailureReason: null,
    surfaceConfidence: 0,
    plausibleTitles: 0,
    frameAgeMs: null,
    frameHiddenByTtl: false,
    timings: EMPTY_SCAN_TIMINGS,
  });
  const [overlayData, setOverlayData] = useState<OverlayData | null>(null);
  const [abilityProfiles, setAbilityProfiles] = useState<Record<string, AbilityProfile | null>>({});
  const [dataError, setDataError] = useState<string | null>(null);
  const [ocrAvailability, setOcrAvailability] = useState<OcrAvailability>(
    createOcrAvailability(true),
  );
  const [calibration, setCalibration] = useState<OverlayCalibration | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  // CSS size of the overlay window as the webview itself reports it — one leg
  // of the anchor-ratio conversion (see cssRectFromCalibratedRect).
  const [cssWindow, setCssWindow] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const surfaceProbeTickRef = useRef<() => void>(() => {});
  // DEV-ONLY, opt-in dataset capture (disabled by default). When on, each probe
  // stashes its REDACTED surface evidence here for manual, session-only fixture
  // export. The leading import.meta.env.DEV lets the production build statically
  // fold this to false and dead-code-eliminate the whole wire. See dev/datasetCapture.
  const datasetCaptureOn = import.meta.env.DEV && isDatasetCaptureEnabled();
  const lastFixtureInputRef = useRef<Omit<SurfaceFixtureInput, "timestamp" | "label"> | null>(null);
  // Reactive scheduler-health gate. It remains true while a normal newer probe
  // is in flight, then fails closed if probe activity exceeds the derived bound.
  const [geometrySchedulerIsHealthy, setGeometrySchedulerIsHealthy] = useState(false);
  const lastGameTimeRef = useRef<number | null>(null);
  const lastRecordedRoundRef = useRef("");
  const [collectorStatus, setCollectorStatus] = useState<CollectorSnapshot | null>(null);
  const [memberSnapshot, setMemberSnapshot] = useState<MemberSnapshot | null>(null);
  const [mode, setMode] = useState<DecisionMode>("competitive");
  const [coachOpen, setCoachOpen] = useState(false);
  // Dev debug panel (tier-fixture / preview only): starts collapsed so it
  // cannot obscure a badge. Its visibility always goes through the single
  // devPanelsVisible gate — there is no pin/bypass that can keep it painted
  // when the game loses foreground.
  const [debugCollapsed, setDebugCollapsed] = useState(true);
  const activeGameHashRef = useRef<string | null>(null);
  const memberBootstrapCompleteRef = useRef(false);
  const gameWindowForeground = foregroundState.gameWindowForeground;
  const collectorEnabled = collectorStatus?.consent === "accepted";
  const collectorCaptureEnabled = collectorEnabled && !collectorStatus?.paused;
  // Dev-only: bypass ONLY the member-coach auth/data. Everything else (OCR,
  // calibration, positioning, collector consent, focus, phase) stays on the
  // real path. Geometry preview is a SEPARATE, independently-gated flag.
  const tierFixtureOn = isTierFixtureEnabled();
  const geometryPreviewOn = isGeometryPreviewEnabled();
  const effectiveMember = tierFixtureOn ? TIER_FIXTURE_MEMBER : memberSnapshot;
  const memberEnabled = memberRecommendationsVisible(
    collectorEnabled,
    effectiveMember,
  );

  const updatePhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
    setOcrLifecycle((previous) => ({ ...previous, phase: nextPhase }));
  }, []);

  const setActiveGame = useCallback((active: boolean) => {
    if (activeGameRef.current !== active) gameEpochRef.current += 1;
    activeGameRef.current = active;
  }, []);

  // Atomic offer publication: the ref and the rendered state always hold the
  // same complete snapshot, so no consumer can observe a mixed generation.
  const publishOffer = useCallback((next: OfferState<SlotResolution>) => {
    offerStateRef.current = next;
    setOfferState(next);
    setOcrLifecycle((previous) => ({ ...previous, offerGeneration: next.generation }));
  }, []);

  const resetOffer = useCallback(() => {
    publishOffer(emptyOfferState(offerStateRef.current.generation + 1));
  }, [publishOffer]);

  // Advance the probe sequence (a new probe started, a synchronous clear, or a
  // watchdog restart) — invalidates any in-flight probe's late result.
  const bumpScanSeq = useCallback(() => (scanSeqRef.current += 1), []);

  // Publish an EXPLICIT empty visible frame: zero chips, zero placeholders,
  // zero card rects. Called whenever probing stops or the current capture finds
  // insufficient title-presence, so the previous frame is never left painted.
  const publishEmptyVisibleFrame = useCallback((captureSeq: number, capturedAt: number) => {
    const frame = emptyVisibleFrame<SlotResolution>(
      (visibleRevisionRef.current += 1),
      captureSeq,
      offerStateRef.current.generation,
      capturedAt,
    );
    visibleFrameRef.current = frame;
    setVisibleFrame(frame);
    setOcrLifecycle((previous) => ({
      ...previous,
      surfaceValidated: false,
      surfaceConfidence: 0,
      plausibleTitles: 0,
      freshRectCount: 0,
      visibleFrameRevision: frame.revision,
    }));
  }, []);

  // Publish the visible frame FROM THE GEOMETRY OBSERVATION. This is the single
  // authority for what renders: presence/occlusion/rects/fingerprints come from
  // the pixel probe, per-slot identity is layered via identityForSlot (null →
  // SCANNING). Called by the geometry track every probe (it always has the
  // newest seq) and by the OCR track after it writes new identities (with the
  // current geometry seq, so it repaints the live frame). Stale geometry results
  // are rejected by frameResultIsCurrent(captureSeq, geometrySeqRef).
  const republishGeometryFrame = useCallback((captureSeq: number) => {
    const observation = geometryObservationRef.current;
    if (observation == null) return;
    if (!frameResultIsCurrent(captureSeq, geometrySeqRef.current)) return;
    const frame = buildGeometryVisibleFrame<SlotResolution>({
      revision: (visibleRevisionRef.current += 1),
      captureSeq,
      observation,
      generation: geometryGenerationRef.current,
      resolveIdentity: (regionIndex, fingerprint) =>
        identityForSlot(identityStoreRef.current[regionIndex], fingerprint),
      resolveUnresolvedState: (regionIndex, fingerprint) => {
        const record = identityStoreRef.current[regionIndex];
        if (!record || record.fingerprint !== fingerprint || record.resolution !== null) return "scanning";
        return record.unresolvedState ?? "scanning";
      },
    });
    visibleFrameRef.current = frame;
    setVisibleFrame(frame);
    setOcrLifecycle((previous) => ({
      ...previous,
      surfaceValidated: frame.surfaceValidated,
      surfaceReason: observation.present
        ? (observation.occluded ? "occluded" : "present")
        : observation.rejectionReasons[0] ?? "absent",
      surfaceConfidence: observation.confidence,
      plausibleTitles: observation.cards.filter((card) => card.present).length,
      freshRectCount: frame.slots.filter((slot) => slot.cardRect !== null).length,
      visibleFrameRevision: frame.revision,
    }));
  }, []);

  // STRONG completion evidence arrived (confirmed pick or a queued offer
  // replacing the current one): advance the round model immediately so
  // recording and labels carry the true round without waiting for a poll tick.
  const recordRoundCompleted = useCallback(() => {
    completedRoundsRef.current = Math.min(
      completedRoundsRef.current + 1,
      TOTAL_AUGMENT_ROUNDS,
    );
    const current = roundDeliveryRef.current;
    if (!current) return;
    const next: RoundDeliveryDecision = {
      ...current,
      pendingRounds: Math.max(0, current.eligibleRounds - completedRoundsRef.current),
      activeOfferRound: Math.min(completedRoundsRef.current + 1, TOTAL_AUGMENT_ROUNDS),
    };
    roundDeliveryRef.current = next;
    setRoundDelivery(next);
  }, []);

  // Slots whose title resolved to a local-catalog augment — the decision-engine
  // path. Derived from the latched offer; always a single generation.
  const matchedCards = useMemo(
    (): MatchedCard[] =>
      offerState.slots.flatMap((slot) =>
        slot.resolution?.pool && slot.title
          ? [{
              augment: slot.resolution.pool,
              regionIndex: slot.regionIndex,
              ocrText: slot.title,
            }]
          : [],
      ),
    [offerState],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [augmentsFile, championsFile, combosFile, poolRulesFile] =
          await Promise.all([
            loadJson<{ augments: OverlayAugment[] }>("/data/augments.json"),
            loadJson<{ champions: OverlayChampion[] }>("/data/champions.json"),
            loadJson<{ combos: OverlayCombo[] }>("/data/combos.json"),
            loadJson<PoolRules>("/data/pool-rules.json"),
          ]);

        if (cancelled) return;

        setOverlayData({
          augments: augmentsFile.augments,
          champions: championsFile.champions,
          combos: combosFile.combos,
          poolRules: poolRulesFile,
        });
      } catch (error) {
        if (!cancelled) {
          setDataError(error instanceof Error ? error.message : "Failed to load overlay data");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Dev tier-fixture: skip the real auth fetch entirely; the effective member
    // snapshot is overridden above. Nothing else in the member path runs.
    if (tierFixtureOn) {
      memberBootstrapCompleteRef.current = true;
      return;
    }
    let cancelled = false;
    void bootstrapMember()
      .then((snapshot) => {
        memberBootstrapCompleteRef.current = true;
        if (!cancelled) setMemberSnapshot(snapshot);
      })
      .catch((error) => {
        memberBootstrapCompleteRef.current = true;
        if (!cancelled) {
          setMemberSnapshot(
            disabledMember(error instanceof Error ? error.message : "member-bootstrap-failed"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tierFixtureOn]);

  useEffect(() => {
    if (!championSlug || abilityProfiles[championSlug] !== undefined) return;

    let cancelled = false;

    void loadJson<AbilityProfile>(`/data/abilities/${championSlug}.json`)
      .then((profile) => {
        if (cancelled) return;
        setAbilityProfiles((prev) => ({ ...prev, [championSlug]: profile }));
      })
      .catch(() => {
        if (cancelled) return;
        // Degrade to kit-agnostic scoring instead of a hard error banner —
        // a missing per-champion profile must not break augment screens.
        setAbilityProfiles((prev) => ({ ...prev, [championSlug]: null }));
        console.warn(`ability profile unavailable for ${championSlug}; scoring without kit fit`);
      });

    return () => {
      cancelled = true;
    };
  }, [abilityProfiles, championSlug]);

  // On mount: check local OCR and capture prerequisites.
  useEffect(() => {
    let cancelled = false;
    invoke<boolean>("check_ocr").then((ok) => {
      if (!cancelled) setOcrAvailability(createOcrAvailability(ok));
    }).catch(() => {
      if (!cancelled) setOcrAvailability(createOcrAvailability(false));
    });
    invoke<boolean>("check_screen_capture_available").then((ok) => {
      if (!ok) invoke("open_screen_recording_settings");
    });
    const tipTimer = setTimeout(() => setShowStartupTip(false), 6000);
    return () => {
      cancelled = true;
      clearTimeout(tipTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshCalibration = async () => {
      try {
        const nextCalibration = await invoke<OverlayCalibration>("get_overlay_calibration");
        if (!cancelled) {
          setCalibration(nextCalibration);
          setCalibrationError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setCalibrationError(
            error instanceof Error ? error.message : "overlay-calibration-unavailable",
          );
        }
      }
    };

    void refreshCalibration();
    const intervalId = setInterval(() => {
      void refreshCalibration();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!collectorStatus) return;
    invoke("set_dock_visible", { visible: collectorStatus.consent === "pending" });
  }, [collectorStatus]);

  const championSlugByName = useMemo(() => {
    const map = new Map<string, string>();
    const champs = overlayData?.champions ?? [];

    for (const champion of champs) {
      map.set(champion.name.toLowerCase(), champion.slug);
      map.set(normalizeChampionName(champion.name), champion.slug);
      if (champion.name_zh_TW) map.set(champion.name_zh_TW, champion.slug);
      if (champion.name_zh_CN) map.set(champion.name_zh_CN, champion.slug);
      if (champion.name_ja) map.set(champion.name_ja, champion.slug);
      if (champion.name_ko) map.set(champion.name_ko, champion.slug);
    }

    return map;
  }, [overlayData]);

  const knownChampionSlugs = useMemo(
    () => new Set((overlayData?.champions ?? []).map((champion) => champion.slug)),
    [overlayData],
  );

  const champNameToSlug = useCallback(
    (name: string): string | null =>
      resolveKnownChampionSlug(name, championSlugByName, knownChampionSlugs),
    [championSlugByName, knownChampionSlugs],
  );

  const comboBySlug = useMemo(() => {
    if (!championSlug || !overlayData) return new Map<string, ComboTier>();

    return new Map<string, ComboTier>(
      overlayData.combos
        .filter((combo) => combo.champion === championSlug)
        .map((combo) => [
          combo.augmentSlug ?? combo.augment.replace(/ /g, "-"),
          combo.tier as ComboTier,
        ]),
    );
  }, [championSlug, overlayData]);

  // Build champion pool
  const poolData = useMemo((): ChampionPoolBreakdown | null => {
    if (!championSlug || !overlayData) return null;

    const champ = overlayData.champions.find((c) => c.slug === championSlug);
    if (!champ) return null;

    const abilityProfileState = abilityProfiles[championSlug];
    if (abilityProfileState === undefined) return null;

    const abilityProfile = abilityProfileState ?? undefined;

    return buildChampionPool(
      championSlug,
      overlayData.augments,
      {
        win_rate: champ.win_rate,
        tags: champ.tags,
        kit_tags: champ.kit_tags,
        baseStats: champ.baseStats,
      },
      abilityProfile,
      comboBySlug,
      overlayData.poolRules,
    );
  }, [abilityProfiles, championSlug, comboBySlug, overlayData]);

  // Build all-name lookup for OCR matching. Champion-pool scores override fallback
  // scores, but real in-game offers outside the predicted pool still match.
  const nameLookup = useMemo(() => {
    if (!championSlug || !overlayData) return new Map<string, PoolAugment>();

    const champ = overlayData.champions.find((c) => c.slug === championSlug);
    if (!champ) return new Map<string, PoolAugment>();

    const abilityProfileState = abilityProfiles[championSlug];
    if (abilityProfileState === undefined) return new Map<string, PoolAugment>();

    return buildOverlayAugmentLookup({
      allAugments: overlayData.augments,
      championWinRate: champ.win_rate,
      comboTiers: comboBySlug,
      poolData,
      abilityProfile: abilityProfileState ?? undefined,
    });
  }, [abilityProfiles, championSlug, comboBySlug, overlayData, poolData]);

  const decisionData = useMemo((): DecisionEngineData | null => {
    if (!championSlug || !overlayData) return null;
    const champion = overlayData.champions.find((entry) => entry.slug === championSlug);
    const abilityProfileState = abilityProfiles[championSlug];
    if (!champion || abilityProfileState === undefined) return null;
    return {
      champion: {
        slug: champion.slug,
        winRate: champion.win_rate,
        kitTags: champion.kit_tags ?? [],
        abilityProfile: abilityProfileState ?? undefined,
        baseStats: champion.baseStats,
      },
      augments: overlayData.augments as DecisionEngineData["augments"],
      poolRules: overlayData.poolRules,
      comboTiers: Object.fromEntries(comboBySlug),
    };
  }, [abilityProfiles, championSlug, comboBySlug, overlayData]);

  const winRateBySlug = useMemo(
    () =>
      Object.fromEntries(
        (overlayData?.augments ?? []).map((augment) => [augment.slug, augment.win_rate]),
      ),
    [overlayData],
  );

  const ocrKnownNames = useMemo(() => {
    if (!overlayData) return [];

    return overlayData.augments.flatMap((augment) =>
      [
        augment.name,
        augment.name_zh_TW,
        augment.name_zh_CN,
        augment.name_ja,
        augment.name_ko,
      ].filter((name): name is string => Boolean(name)),
    );
  }, [overlayData]);

  const decisionResult = useMemo((): DecisionResult | null => {
    if (
      !memberEnabled ||
      !memberSnapshot?.modelConfig ||
      !decisionData ||
      !roundDelivery ||
      !isCompleteThreeCardOffer(matchedCards)
    ) {
      return null;
    }
    const screenRarity = matchedCards[0].augment.rarity;
    return runLocalInference(
      {
        championSlug: decisionData.champion.slug,
        round: roundDelivery.activeOfferRound as 1 | 2 | 3 | 4,
        screenRarity,
        mode,
        ownedAugmentSlugs: pickedAugments,
        currentItemIds: [],
        plannedItemIds: [],
        offeredAugmentSlugs: matchedCards.map((card) => card.augment.slug),
        rerollsRemaining: 1,
        goldenRerollAvailable: false,
      },
      decisionData,
      memberSnapshot.modelConfig,
    );
  }, [
    decisionData,
    matchedCards,
    memberEnabled,
    memberSnapshot,
    mode,
    pickedAugments,
    roundDelivery,
  ]);

  // ─── Dev ARAMGG fixture / geometry preview (dev flags only) ───
  // TIER_FIXTURE: canonical ARAMGG stats over REAL OCR-detected cards — never
  // injects geometry, never forces focus/phase, so it can never mask real OCR.
  // GEOMETRY_PREVIEW: synthetic cards, ONLY when League is absent, watermarked.
  const currentChampionId =
    overlayData?.champions.find((champion) => champion.slug === championSlug)?.champion_key ?? null;
  const aramgg = useAramggTierFixture(
    tierFixtureOn || geometryPreviewOn,
    overlayData?.augments,
    currentChampionId,
  );
  // A final-champion change starts a new champion generation and invalidates
  // every resolved slot, so each re-resolves against the new champion's own
  // dataset (Section 6: champion change recomputes every resolved slot). Within
  // a generation the reconcile guard then holds each verified identity immutable.
  useEffect(() => {
    championGenerationRef.current += 1;
    championIdRef.current = currentChampionId;
    ocrOwnersRef.current.invalidate();
    probeInFlightRef.current = false;
    probeInFlightSinceRef.current = null;
    identityStoreRef.current = [null, null, null];
    // Advance every slot generation so any in-flight OCR run from the previous
    // champion is superseded and rejected on completion (Phase B).
    slotGenerationsRef.current = slotGenerationsRef.current.map((g) => g + 1);
  }, [championSlug, currentChampionId]);

  // Ref so the OCR loop always resolves against the freshest ARAMGG source
  // without re-creating the scan callback when the source loads.
  const aramggResolveRef = useRef(aramgg.resolveSlotTitle);
  useEffect(() => {
    aramggResolveRef.current = aramgg.resolveSlotTitle;
  }, [aramgg.resolveSlotTitle]);

  const fixtureMode = resolveOverlayFixtureMode({
    tierFixtureOn,
    previewOn: geometryPreviewOn,
    gameWindowForeground,
    phase,
    offerActive: offerActive(offerState),
    aramggReady: aramgg.status === "ready",
  });

  // Synthetic cards exist ONLY in explicit preview mode (League absent). They
  // are never used to fill a real offer or a transient OCR gap.
  const previewCards = useMemo((): MatchedCard[] => {
    if (fixtureMode.kind !== "preview" || !overlayData) return [];
    const chosen = overlayData.augments
      .filter((a) => aramgg.resolvedBySlug.has(a.slug))
      .sort((l, r) => l.slug.localeCompare(r.slug))
      .slice(0, 3);
    if (chosen.length < 3) return [];
    return chosen.map((a, regionIndex) => ({
      regionIndex,
      ocrText: a.name,
      augment: {
        slug: a.slug,
        name: a.name,
        name_zh_TW: a.name_zh_TW,
        lifecycle: a.flags?.lifecycle,
        win_rate: a.win_rate ?? 50,
        score: 0,
        tier: "A",
        rarity: a.rarity,
        probability: 0,
        probabilityWithReroll: 0,
      },
    }));
  }, [fixtureMode.kind, aramgg.resolvedBySlug, overlayData]);

  const isPreviewMode = fixtureMode.kind === "preview";
  const gameOverlayIsVisible = gameOverlayVisible({
    gameWindowForeground,
    previewMode: isPreviewMode,
  });

  // The full-screen visual overlay must not capture the desktop. Bounded
  // consent/collector windows own their own mouse interaction.
  useEffect(() => {
    invoke("set_click_through", {
      ignore: overlayShouldIgnoreMouseEvents({
        coachOpen: coachOpen && gameOverlayIsVisible,
      }),
    });
  }, [coachOpen, gameOverlayIsVisible]);

  // Build the ARAMGG-backed decision result from whichever cards are active.
  const fixturePayload = useMemo(() => {
    const round = (roundDelivery?.activeOfferRound ?? 1) as 1 | 2 | 3 | 4;
    if (fixtureMode.kind === "real-offer") {
      // Latched slots whose staged resolution reached a live ARAMGG record.
      const cards = offerState.slots.flatMap((slot): AramggFixtureCard[] => {
        const staged = slot.resolution?.aramgg;
        if (!staged || staged.kind !== "matched") return [];
        const slug =
          staged.localSlug ??
          staged.riot.canonicalName ??
          `riot-${staged.riot.augmentId}`;
        return [{ slug, stat: staged.stat, method: staged.riot.method }];
      });
      if (cards.length === 0) return null;
      return buildAramggDecisionResult(cards, round);
    }
    if (fixtureMode.kind === "preview") {
      const cards = [...previewCards]
        .sort((left, right) => left.regionIndex - right.regionIndex)
        .map((card): AramggFixtureCard | null => aramgg.resolvedBySlug.get(card.augment.slug) ?? null)
        .filter((card): card is AramggFixtureCard => card !== null);
      if (cards.length === 0) return null;
      return buildAramggDecisionResult(cards, round);
    }
    return null;
  }, [fixtureMode.kind, offerState, previewCards, aramgg.resolvedBySlug, roundDelivery]);

  // Dev flag unlocks the member gate ONLY (no collector/entitlement) — it never
  // relaxes the focus/phase/complete-offer gates below.
  const effectiveMemberEnabled = tierFixtureOn ? effectiveMember?.enabled === true : memberEnabled;
  const isFixtureBacked = fixturePayload != null; // ARAMGG-backed → no fake P:50%

  const badgeDecisionResult = fixturePayload?.result ?? decisionResult;
  const badgeWinRateBySlug: Record<string, number | string | null> =
    fixturePayload?.winRateDisplayBySlug ?? winRateBySlug;

  // Real per-slot chips: driven SOLELY by the VisibleOfferFrame — the current
  // capture's fresh, multi-signal-validated evidence — never by the internal
  // latch. A slot renders only when this capture supplied it a card rect; a
  // capture that does not validate the surface yields an empty frame, so no
  // chip or placeholder can linger over combat, respawn, the scoreboard, or a
  // new map. Preview chips: only in preview mode.
  const realFrameRenderable =
    !isPreviewMode &&
    effectiveMemberEnabled &&
    visibleFrameRenderable(visibleFrame, gameWindowForeground) &&
    offerSurface.render &&
    // Scheduler health, not the age of the last positive pixels, owns expiry.
    // A valid frame therefore survives while the next normal probe is in flight,
    // but still fails closed on a stalled scheduler, focus loss, or game exit.
    geometrySchedulerIsHealthy;
  const previewBadgesReady =
    isPreviewMode && fixturePayload != null && previewCards.length === 3;
  const showBadgeLayer = realFrameRenderable || previewBadgesReady;

  const slotChips = useMemo((): SlotChip[] => {
    if (previewBadgesReady && fixturePayload) {
      return previewCards.flatMap((card): SlotChip[] => {
        const candidate = fixturePayload.result.candidates.find(
          (entry) => entry.augmentSlug === card.augment.slug,
        );
        if (!candidate) return [];
        return [{
          regionIndex: card.regionIndex,
          key: `preview-${card.regionIndex}-${card.augment.slug}`,
          state: "tier",
          tier: tierForGrade(candidate.grade),
          winRateText: compactWinRateFromPercent(
            fixturePayload.winRateDisplayBySlug[card.augment.slug],
          ),
          isNew: card.augment.lifecycle === "added",
          statScope: aramgg.resolvedBySlug.get(card.augment.slug)?.stat.provenance ?? null,
        }];
      });
    }
    if (!realFrameRenderable || !visibleFrame) return [];
    return visibleFrame.slots.flatMap((slot): SlotChip[] => {
      // A slot with no fresh rect from THIS capture is never rendered — the
      // rectangle must belong to the current frame's generation, not history.
      if (slot.cardRect === null) return [];
      const base = {
        regionIndex: slot.regionIndex,
        key: `slot-${slot.regionIndex}-g${visibleFrame.generation}`,
      };
      if (slot.resolution === null) {
        // Geometry confirms a card here, but its identity is pending (fresh
        // trigger, reroll re-read in flight, or unreadable) — show SCANNING, not
        // nothing: the chip must never vanish merely because OCR hasn't caught up.
        return [{
          ...base,
          state: slot.unresolvedState ?? "scanning",
          tier: null,
          winRateText: null,
          isNew: false,
          statScope: null,
        }];
      }
      const staged = slot.resolution?.aramgg;
      if (staged) {
        if (staged.kind === "matched") {
          return [{
            ...base,
            state: "tier",
            tier: staged.stat.tierLetter,
            // Exact string pipeline from the raw ARAMGG fraction ("0.5915" →
            // "59.2%"); the raw value stays on the stat for diagnostics.
            winRateText: compactWinRateFromFraction(staged.stat.rawWinRate),
            isNew: slot.resolution?.pool?.lifecycle === "added",
            statScope: staged.stat.provenance,
          }];
        }
        if (staged.kind === "no-data") {
          // Riot identity resolved, but ARAMGG carries no stat record.
          return [{ ...base, state: "no-data", tier: null, winRateText: null, isNew: false, statScope: null }];
        }
        return [{ ...base, state: "unmatched", tier: null, winRateText: null, isNew: false, statScope: null }];
      }
      // Engine path (no dev fixture): the local-catalog match backs the chip.
      const pool = slot.resolution?.pool ?? null;
      if (!pool) {
        return [{ ...base, state: "unmatched", tier: null, winRateText: null, isNew: false, statScope: null }];
      }
      const candidate = decisionResult?.candidates.find(
        (entry) => entry.augmentSlug === pool.slug,
      );
      return [{
        ...base,
        state: "tier",
        tier: candidate ? tierForGrade(candidate.grade) : pool.tier,
        winRateText: compactWinRateFromPercent(pool.win_rate),
        isNew: pool.lifecycle === "added",
        statScope: null,
      }];
    });
  }, [previewBadgesReady, fixturePayload, previewCards, realFrameRenderable, visibleFrame, decisionResult, aramgg.resolvedBySlug]);

  // Staged diagnostics counters (never conflate injected with detected).
  const diag = {
    cardsCaptured: ocrDiagnostics.filter((d) => d.captureSucceeded).length,
    titlesRead: ocrDiagnostics.filter((d) => d.rawText).length,
    riotResolved: offerState.slots.filter(
      (slot) => slot.resolution?.aramgg && slot.resolution.aramgg.kind !== "unmatched",
    ).length,
    aramggMatched: offerState.slots.filter(
      (slot) => slot.resolution?.aramgg?.kind === "matched",
    ).length,
    ocrDetected: offerState.slots.filter((slot) => slot.fingerprint !== null).length,
    previewInjected: isPreviewMode ? previewCards.length : 0,
    offeredMatched: matchedCards.length,
    catalogResolved: aramgg.resolvedBySlug.size,
    renderedRealBadges: realFrameRenderable
      ? slotChips.filter((chip) => chip.state === "tier").length
      : 0,
    renderedPreviewBadges: previewBadgesReady ? slotChips.length : 0,
  };

  // Synchronously clear the visible surface. Advancing the probe seq invalidates
  // any in-flight probe's late result (it can never repaint a stale frame), then
  // an explicit empty frame is published immediately — no wait for the next
  // probe, two misses, or a telemetry poll. `clearLatch` also drops the internal
  // identity latch (game exit / focus loss); otherwise the latch stays as
  // nonvisual grace for brief restoration.
  const clearSurface = useCallback((clearLatch: boolean) => {
    const closedSurface: OfferSurfaceState = {
      ...createOfferSurfaceState(),
      offerGeneration: offerSurfaceRef.current.offerGeneration + 1,
      captureValid: true,
    };
    offerSurfaceRef.current = closedSurface;
    geometryGenerationRef.current = closedSurface.offerGeneration;
    setOfferSurface(closedSurface);
    if (clearLatch) {
      resetOffer();
      setOcrDiagnostics([]);
      // Drop the geometry-keyed identity store and last observation so a stale
      // present result cannot repaint after a game exit / focus loss. Advancing
      // the geometry seq stale-rejects any in-flight geometry probe too.
      identityStoreRef.current = [null, null, null];
      acceptedSlotFingerprintsRef.current = ["", "", ""];
      geometryObservationRef.current = null;
      geometrySurfaceStateRef.current = createGeometrySurfaceState();
      lastGeometryCompletedAtRef.current = null;
      ocrPendingSlotsRef.current = [];
    }
    lastGeometryRenderableRef.current = false;
    setGeometrySchedulerIsHealthy(false);
    geometryFreshnessWarningSeqRef.current = null;
    geometryExpiryWarningSeqRef.current = null;
    bumpScanSeq();
    ocrOwnersRef.current.invalidate();
    probeInFlightRef.current = false;
    probeInFlightSinceRef.current = null;
    geometrySeqRef.current += 1;
    publishEmptyVisibleFrame(scanSeqRef.current, performance.now());
    setOcrLifecycle((previous) => ({
      ...previous,
      phase: phaseRef.current,
      currentRound: roundDeliveryRef.current?.activeOfferRound ?? null,
      active: false,
      scanRunId: null,
      captureAttempted: false,
      cropCount: 0,
      noCropReason: "surface-cleared",
    }));
  }, [bumpScanSeq, publishEmptyVisibleFrame, resetOffer]);

  const stopOcr = useCallback(() => {
    clearSurface(true);
  }, [clearSurface]);

  const finishOcr = useCallback(() => {
    clearSurface(false);
  }, [clearSurface]);

  const refreshForeground = useCallback(async (): Promise<ForegroundState | null> => {
    const startedAt = Date.now();
    if (!foregroundPollMayStart(startedAt, foregroundPollStartedAtRef.current)) return null;
    foregroundPollStartedAtRef.current = startedAt;
    try {
      // A hung native call must never latch the previous state forever: after
      // the timeout the state degrades to unknown (everything hidden), and the
      // stuck deadline above lets later ticks poll again.
      const nextForeground = await resolveWithTimeout(
        invoke<ForegroundState>("get_foreground_state")
          .catch(() => unknownForegroundState()),
        FOREGROUND_POLL_TIMEOUT_MS,
        unknownForegroundState(),
      );
      const previousForeground = foregroundStateRef.current;
      foregroundStateRef.current = nextForeground;
      if (nextForeground.gameWindowForeground !== previousForeground.gameWindowForeground) {
        // A focus flip starts a new foreground epoch: a probe that captured
        // under the old focus can never publish after the change.
        foregroundEpochRef.current += 1;
      }
      const changed = [
        "gameWindowForeground",
        "leagueClientForeground",
        "riotClientForeground",
        "gameRunning",
        "gameWindowDetected",
        "foregroundAppName",
        "foregroundBundleIdentifier",
        "foregroundOwnerName",
        "foregroundWindowTitle",
        "foregroundExecutablePath",
        "foregroundWindowHandle",
      ].some((key) => (
        nextForeground[key as keyof ForegroundState] !==
        previousForeground[key as keyof ForegroundState]
      ));
      if (changed) setForegroundState(nextForeground);
      if (
        import.meta.env.DEV &&
        nextForeground.gameWindowForeground !== previousForeground.gameWindowForeground
      ) {
        // DEV-only: dump the full native candidate walk (every window, its
        // exclusion verdict, the selected authority, the decision reason)
        // whenever the classification flips. Compiled out of production.
        void invoke("get_foreground_diagnostic")
          .then((diagnostic) => {
            console.info("[foreground-diagnostic]", JSON.stringify(diagnostic));
          })
          .catch(() => {});
      }
      if (!nextForeground.gameWindowForeground && previousForeground.gameWindowForeground) {
        // Focus left the game: hide the surface immediately (the probe would
        // skip anyway, but we must not wait for the health clock on a blur).
        stopOcr();
      }
      return nextForeground;
    } finally {
      foregroundPollStartedAtRef.current = null;
    }
  }, [stopOcr]);

  const clearGameOnlyState = useCallback((nextPhase: Phase) => {
    ocrSelectionCompletedRef.current = true;
    setActiveGame(false);
    setPlayerData(null);
    setChampionSlug(null);
    completedRoundsRef.current = 0;
    roundDeliveryRef.current = null;
    setRoundDelivery(null);
    setPickedAugments([]);
    lastGameTimeRef.current = null;
    lastRecordedRoundRef.current = "";
    activeGameHashRef.current = null;
    setCoachOpen(false);
    stopOcr();
    updatePhase(nextPhase);
  }, [setActiveGame, stopOcr, updatePhase]);

  // Stage 2 per-slot identity resolution: maps a plausible title to its catalog
  // (Riot/ARAMGG) identity for chip content. Presence (Stage 1) never depends on
  // this succeeding — an offer whose names don't resolve is still a live offer.
  const resolveSlotTitle = useCallback((title: string): SlotResolution => {
    const match = diagnoseAugmentMatch(title, nameLookup);
    return {
      pool: match.augment,
      poolDiagnostic: match,
      aramgg: aramggResolveRef.current ? aramggResolveRef.current(title) : null,
    };
  }, [nameLookup]);

  // Stage 2 latch predicate: an offer latches on plausible TITLE presence, never
  // on catalog identity (an offer whose names are unknown is still an offer).
  const titlePresent = useCallback(() => true, []);

  // Champion-data completion may legitimately change only the statistic for
  // an already-verified canonical augment (GLOBAL → CHAMP). Reconcile the
  // stored OCR identity without invoking OCR again.
  useEffect(() => {
    if (!aramgg.resolveSlotTitle) return;
    let changed = false;
    const nextStore = identityStoreRef.current.map((record, regionIndex) => {
      if (!record?.resolution || !record.ocrTitle) return record;
      const resolution = resolveSlotTitle(record.ocrTitle);
      const incoming: IdentityRecord<SlotResolution> = {
        ...record,
        resolution,
        resolvedAt: performance.now(),
        championGeneration: championGenerationRef.current,
        championRequestId: aramgg.championRequestId,
        championPatch: aramgg.championPatch,
        augmentId: slotResolutionAugmentId(resolution),
        foregroundEpoch: foregroundEpochRef.current,
        gameEpoch: gameEpochRef.current,
        offerGeneration: geometryGenerationRef.current,
        slotGeneration: slotGenerationsRef.current[regionIndex] ?? 0,
      };
      const reconciled = reconcileIdentityRecord(record, incoming);
      if (reconciled.resolution !== record.resolution) changed = true;
      return reconciled;
    });
    if (!changed) return;
    identityStoreRef.current = nextStore;
    const currentOffer = offerStateRef.current;
    publishOffer({
      ...currentOffer,
      slots: currentOffer.slots.map((slot) => ({
        ...slot,
        resolution: nextStore[slot.regionIndex]?.resolution ?? slot.resolution,
      })),
    });
    republishGeometryFrame(geometrySeqRef.current);
  }, [
    aramgg.championPatch,
    aramgg.championRequestId,
    aramgg.resolveSlotTitle,
    publishOffer,
    republishGeometryFrame,
    resolveSlotTitle,
  ]);

  // ─── TRACK 1: geometry probe — presence / occlusion / visual freshness ──────
  // A cheap Rust PIXEL probe classifies the surface (present / occluded / absent)
  // and feeds a three-state hysteresis reducer. A single uncertain observation
  // preserves the last accepted frame; explicit absence/occlusion clears. It
  // NEVER runs OCR — it only decides which slots the OCR track should (re)read.
  const runGeometryProbe = useCallback(async (scheduledAt: number) => {
    geometryInFlightRef.current = true;
    const startedAt = performance.now();
    const previousStartedAt = lastGeometryStartedAtRef.current;
    const previousCompletedAt = lastGeometryCompletedAtRef.current;
    geometryInFlightSinceRef.current = startedAt;
    lastGeometryStartedAtRef.current = startedAt;
    const captureSeq = (geometrySeqRef.current += 1);
    geometryInFlightTokenRef.current = captureSeq;
    const foregroundEpoch = foregroundEpochRef.current;
    const capturedAt = performance.now();
    try {
      let observation: GeometryObservation;
      try {
        observation = await invoke<GeometryObservation>("probe_augment_surface", {
          probeSeq: captureSeq,
          capturedAt,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "geometry-probe-failed";
        observation = emptyGeometryObservation(captureSeq, performance.now(), reason);
      }
      const completedAt = performance.now();
      // Stale-result rejection: apply only while this probe's seq is still newest
      // AND the foreground epoch it captured under is unchanged.
      if (captureSeq !== geometrySeqRef.current) return;
      if (foregroundEpoch !== foregroundEpochRef.current) return;
      lastGeometryCompletedAtRef.current = completedAt;
      setGeometrySchedulerIsHealthy(true);

      const previousSurface = geometrySurfaceStateRef.current;
      const transition = advanceGeometrySurface(previousSurface, observation);
      geometrySurfaceStateRef.current = transition.state;
      geometryObservationRef.current = transition.action === "preserve"
        ? previousSurface.visualObservation
        : transition.action === "publish"
          ? transition.state.visualObservation
          : observation;

      // A NEW offer (absent→present or ≥2 slots swapped) bumps the render
      // generation; a queued-round REPLACEMENT (previous offer was present) is
      // strong round-completion evidence. A first appearance is NOT a completion.
      const publishedObservation = transition.state.visualObservation;
      const detectedNewOffer =
        transition.action === "publish" &&
        publishedObservation != null &&
        newOfferDetected(previousSurface.lastPositiveObservation, publishedObservation);
      const priorOfferSurface = offerSurfaceRef.current;
      // FIX 1 — during bounded negative continuity (a preserved 0/3 or 1-card
      // frame) the offer-surface machine must see the PRESERVED visible surface,
      // not the raw negative capture, so it stays OFFER_VISIBLE in lock-step with
      // geometry instead of independently flipping to NO_OFFER and blanking the
      // resolved badges. On a clear, publishedObservation is null → the raw
      // (0-card) observation drives the correct clear.
      const effectiveObservation = publishedObservation ?? observation;
      const nextOfferSurface = advanceOfferSurface(priorOfferSurface, {
        now: completedAt,
        captureValid: observation.captureWidth > 0 && observation.captureHeight > 0,
        blueControlPresent: effectiveObservation.blueControl?.present === true,
        blueControlConfidence: effectiveObservation.blueControl?.confidence ?? 0,
        validCardCount: effectiveObservation.cards.filter((card) => card.present).length,
        occlusionReason: observation.occluded
          ? observation.rejectionReasons.find((reason) => reason.startsWith("occluded-")) ?? "opaque-surface"
          : null,
        // No genuine collapsed-offer fixture exists yet. Never infer hidden from
        // the control alone; keep OFFER_HIDDEN gated pending controlled evidence.
        hiddenEvidence: false,
        newOfferEvidence: detectedNewOffer,
      });
      offerSurfaceRef.current = nextOfferSurface;
      geometryGenerationRef.current = nextOfferSurface.offerGeneration;
      setOfferSurface(nextOfferSurface);
      if (import.meta.env.DEV && (
        priorOfferSurface.state !== nextOfferSurface.state ||
        priorOfferSurface.render !== nextOfferSurface.render
      )) {
        logOverlayDiagnostic("[offer-state]", {
          priorState: priorOfferSurface.state,
          nextState: nextOfferSurface.state,
          blueControlConfidence: nextOfferSurface.blueControlConfidence,
          validCardCount: nextOfferSurface.validCardCount,
          occlusionReason: nextOfferSurface.occlusionReason,
          captureValid: nextOfferSurface.captureValid,
          renderDecision: nextOfferSurface.render,
          offerGeneration: nextOfferSurface.offerGeneration,
        });
      }
      if (detectedNewOffer && previousSurface.lastPositiveObservation != null) {
        recordRoundCompleted();
      }
      if (
        nextOfferSurface.state === "NO_OFFER" &&
        priorOfferSurface.state !== "NO_OFFER"
      ) {
        identityStoreRef.current = [null, null, null];
        acceptedSlotFingerprintsRef.current = ["", "", ""];
        slotGenerationsRef.current = slotGenerationsRef.current.map((generation) => generation + 1);
        ocrPendingSlotsRef.current = [];
        ocrOwnersRef.current.invalidate();
        probeInFlightRef.current = false;
        probeInFlightSinceRef.current = null;
        bumpScanSeq();
        resetOffer();
      } else if (nextOfferSurface.state === "OCCLUDED") {
        // Retain identities internally, but invalidate every async render owner.
        ocrPendingSlotsRef.current = [];
        ocrOwnersRef.current.invalidate();
        probeInFlightRef.current = false;
        probeInFlightSinceRef.current = null;
        bumpScanSeq();
      }

      // PHASE B — atomic per-slot reroll invalidation. The first published
      // observation whose slot fingerprint changed clears ONLY that slot's
      // identity (→ SCANNING) and bumps ONLY its generation, so no stale chip
      // can paint the new card and any OCR run keyed to the old slot generation
      // is rejected on completion. Neighbours are retained untouched.
      if (transition.action === "publish" && publishedObservation != null) {
        const priorAcceptedFingerprints = acceptedSlotFingerprintsRef.current;
        const reroll = applyRerollInvalidation({
          store: identityStoreRef.current,
          acceptedFingerprints: acceptedSlotFingerprintsRef.current,
          slotGenerations: slotGenerationsRef.current,
          observation: publishedObservation,
          championGeneration: championGenerationRef.current,
          now: performance.now(),
          newOffer: detectedNewOffer,
        });
        identityStoreRef.current = reroll.store;
        slotGenerationsRef.current = reroll.slotGenerations;
        acceptedSlotFingerprintsRef.current = reroll.acceptedFingerprints;
        if (import.meta.env.DEV) {
          for (const slot of reroll.invalidated) {
            const previousFingerprint = priorAcceptedFingerprints[slot] ?? "";
            const currentFingerprint = publishedObservation.cards[slot]?.fingerprint ?? "";
            logOverlayDiagnostic("[slot-publication]", {
              foregroundEpoch: foregroundEpochRef.current,
              gameEpoch: gameEpochRef.current,
              championId: championIdRef.current,
              championGeneration: championGenerationRef.current,
              championDatasetRequestId: aramgg.championRequestId,
              offerGeneration: nextOfferSurface.offerGeneration,
              geometrySequence: captureSeq,
              slot,
              slotGeneration: reroll.slotGenerations[slot],
              fingerprint: boundedDiagnosticHash(currentFingerprint),
              fingerprintHammingDistance: hammingDistance(previousFingerprint, currentFingerprint),
              ocrRunId: null,
              normalizedOcrTitleHash: null,
              canonicalAugmentId: null,
              statProvenance: null,
              rawWinRate: null,
              tier: null,
              publicationReason: detectedNewOffer ? "new-offer-invalidated" : "reroll-invalidated",
            });
          }
        }
        if (reroll.invalidated.length > 0) {
          ocrOwnersRef.current.invalidate();
          probeInFlightRef.current = false;
          probeInFlightSinceRef.current = null;
          bumpScanSeq();
        }
        if (import.meta.env.DEV && reroll.invalidated.length > 0) {
          console.info(
            "[slot-reroll]",
            JSON.stringify({
              invalidated: reroll.invalidated,
              slotGenerations: reroll.slotGenerations,
            }),
          );
        }
      }

      // Publish/preserve/clear from the hysteresis result. A preserved uncertain
      // frame retains its resolved chip content; geometry uncertainty alone never
      // degrades the three slots to SCANNING.
      republishGeometryFrame(captureSeq);
      const publishedAt = performance.now();

      // Phase follows the visible SURFACE: a present, unoccluded offer opens
      // selection; confirmed absence returns to in-game. Occlusion is transient
      // and an initial uncertainty is not evidence the selection closed.
      if (transition.state.visualObservation != null) {
        if (phaseRef.current !== "augment_selection") {
          ocrSelectionCompletedRef.current = false;
          updatePhase("augment_selection");
        }
      } else if (
        transition.hideReason !== "occluded" &&
        transition.hideReason !== "uncertain-without-positive" &&
        phaseRef.current === "augment_selection"
      ) {
        ocrSelectionCompletedRef.current = true;
        updatePhase("in_game");
      }

      // Tell the OCR track which slots need a (re)read this cycle, keyed to the
      // live geometry fingerprints.
      if (transition.action === "publish" && publishedObservation != null) {
        const decision = decideOcrTrigger<SlotResolution>({
          observation: publishedObservation,
          identities: identityStoreRef.current,
          now: performance.now(),
          retryMs: IDENTITY_RETRY_MS,
          forceSlots: forceOcrSlotsRef.current,
        });
        forceOcrSlotsRef.current = [];
        ocrPendingSlotsRef.current = decision.slots;
        if (decision.slots.length > 0) {
          ocrTriggerFingerprintsRef.current = publishedObservation.cards.map(
            (card) => card.fingerprint,
          );
          if (import.meta.env.DEV) {
            logOverlayDiagnostic("[identity-trigger]", {
              foregroundEpoch: foregroundEpochRef.current,
              gameEpoch: gameEpochRef.current,
              championId: championIdRef.current,
              championGeneration: championGenerationRef.current,
              offerGeneration: nextOfferSurface.offerGeneration,
              geometrySequence: captureSeq,
              requestedSlots: decision.slots,
              slotGenerations: decision.slots.map((slot) => slotGenerationsRef.current[slot]),
              fingerprints: decision.slots.map((slot) =>
                boundedDiagnosticHash(publishedObservation.cards[slot]?.fingerprint ?? null)),
              reason: decision.reason,
            });
            if (decision.reason.includes("retry:")) {
              logOverlayDiagnostic("[identity-retry]", {
                requestedSlots: decision.slots,
                reason: decision.reason,
                offerGeneration: nextOfferSurface.offerGeneration,
              });
            }
          }
        }
      } else if (transition.action === "clear") {
        ocrPendingSlotsRef.current = [];
      }

      if (datasetCaptureOn) {
        // DEV-only redacted capture: card-region rects, the geometry presence
        // verdict, and rejection reasons only — never identity or full-screen data.
        lastFixtureInputRef.current = {
          capturedAt,
          present: observation.present && !observation.occluded,
          confidence: observation.confidence,
          cropsCaptured: observation.cards.filter((card) => card.present).length,
          titles: [null, null, null],
          cardRects: observation.cards.map((card) => card.cardRect),
          rejectionReasons: observation.rejectionReasons,
        };
      }

      if (import.meta.env.DEV) {
        const classification = classifyGeometryObservation(observation);
        const totalProbeMs = publishedAt - startedAt;
        const diagnostic: GeometryProbeDiagnostic = {
          probeSeq: captureSeq,
          scheduledAt,
          startedAt,
          captureStartedAt: startedAt + observation.preCaptureMs,
          captureFinishedAt:
            startedAt + observation.preCaptureMs + observation.captureMs,
          analysisFinishedAt:
            startedAt + observation.preCaptureMs + observation.captureMs + observation.analysisMs,
          publishedAt,
          preCaptureMs: observation.preCaptureMs,
          captureMs: observation.captureMs,
          nativeTotalMs: observation.elapsedMs,
          ipcMs: Math.max(0, completedAt - startedAt - observation.elapsedMs),
          analysisMs: observation.analysisMs,
          totalProbeMs,
          gapSincePreviousStartMs:
            previousStartedAt == null ? null : startedAt - previousStartedAt,
          gapSincePreviousCompletedMs:
            previousCompletedAt == null ? null : completedAt - previousCompletedAt,
          inFlightMs: completedAt - startedAt,
          schedulerRestartCount: geometryRestartCountRef.current,
          classification,
          present: observation.present,
          occluded: observation.occluded,
          confidence: observation.confidence,
          cards: observation.cards,
          rejectionReasons: observation.rejectionReasons,
          previousSurfaceState:
            previousSurface.visualObservation == null ? "hidden" : "present",
          nextSurfaceState:
            transition.state.visualObservation == null ? "hidden" : "present",
          hiddenReason: transition.action === "clear" ? transition.hideReason : null,
        };
        const diagnostics = geometryDiagnosticsRef.current;
        diagnostics.push(diagnostic);
        if (diagnostics.length > 200) diagnostics.shift();

        const ring = geometryLatenciesRef.current;
        ring.push(totalProbeMs);
        if (ring.length > 200) ring.shift();
        geometryProbeCountRef.current += 1;
        const classificationChanged =
          lastRawGeometryClassificationRef.current !== classification;
        const chipsHidden =
          diagnostic.previousSurfaceState === "present" &&
          diagnostic.nextSurfaceState === "hidden";
        if (classificationChanged || chipsHidden || totalProbeMs > 250) {
          console.info("[geometry-probe]", JSON.stringify(diagnostic));
        }
        lastRawGeometryClassificationRef.current = classification;
        if (geometryProbeCountRef.current % 40 === 0 && ring.length > 0) {
          const sorted = [...ring].sort((a, b) => a - b);
          const at = (q: number) => sorted[Math.min(
            sorted.length - 1,
            Math.floor(q * sorted.length),
          )];
          console.info(
            `[geometry-full-latency] n=${sorted.length} p50=${at(0.5).toFixed(1)} ` +
              `p95=${at(0.95).toFixed(1)} p99=${at(0.99).toFixed(1)} ms`,
          );
        }
      }
    } finally {
      // Release the guard ONLY if this probe still owns it (a watchdog restart
      // hands ownership to the replacement — its late return must not free it).
      if (geometryInFlightTokenRef.current === captureSeq) {
        geometryInFlightSinceRef.current = null;
        geometryInFlightRef.current = false;
        geometryInFlightTokenRef.current = null;
      }
    }
  }, [aramgg.championRequestId, bumpScanSeq, datasetCaptureOn, recordRoundCompleted, republishGeometryFrame, resetOffer, updatePhase]);

  // ─── TRACK 2: OCR/identity probe — TRIGGERED by the geometry track ───────────
  // Supplies per-slot identity ONLY: never presence, occlusion, or visual freshness. It
  // reads just the slots geometry flagged (new / reroll / retry / force) and
  // writes each result into the geometry-fingerprint-keyed identity store, so a
  // late result from a superseded generation can never paint the live card.
  const runIdentityProbe = useCallback(async (
    slots: number[],
    triggerFingerprints: string[],
    triggerSlotGenerations: number[],
  ) => {
    probeInFlightRef.current = true;
    const startedAt = performance.now();
    probeInFlightSinceRef.current = startedAt;
    lastProbeStartedAtRef.current = startedAt;
    const captureSeq = bumpScanSeq();
    const foregroundEpoch = foregroundEpochRef.current;
    const gameEpoch = gameEpochRef.current;
    const championGenerationAtStart = championGenerationRef.current;
    const championIdAtStart = championIdRef.current;
    const offerGenerationAtStart = geometryGenerationRef.current;
    const championRequestIdAtStart = aramgg.championRequestId;
    const championPatchAtStart = aramgg.championPatch;
    const owner = ocrOwnersRef.current.start({
      foregroundEpoch,
      gameEpoch,
      championGeneration: championGenerationAtStart,
      championId: championIdAtStart,
      offerGeneration: offerGenerationAtStart,
      requestedSlots: slots,
      slotGenerations: triggerSlotGenerations,
      fingerprints: triggerFingerprints,
    }, startedAt);
    if (import.meta.env.DEV) {
      logOverlayDiagnostic("[identity-start]", {
        runId: owner.runId,
        foregroundEpoch: owner.foregroundEpoch,
        gameEpoch: owner.gameEpoch,
        championId: owner.championId,
        championGeneration: owner.championGeneration,
        offerGeneration: owner.offerGeneration,
        requestedSlots: owner.requestedSlots,
        slotGenerations: owner.requestedSlots.map((slot) => owner.slotGenerations[slot]),
        fingerprints: owner.requestedSlots.map((slot) =>
          boundedDiagnosticHash(owner.fingerprints[slot] ?? null)),
        startedAt: owner.startedAt,
        timeoutDeadline: owner.timeoutDeadline,
      });
    }
    const currentOwnerContext = (): OcrOwnerContext => ({
      foregroundEpoch: foregroundEpochRef.current,
      gameEpoch: gameEpochRef.current,
      championGeneration: championGenerationRef.current,
      championId: championIdRef.current,
      offerGeneration: geometryGenerationRef.current,
      requestedSlots: slots,
      slotGenerations: slotGenerationsRef.current,
      fingerprints: acceptedSlotFingerprintsRef.current,
    });
    const scanStart = new Date().toISOString();
    setOcrLifecycle((previous) => ({
      ...previous,
      phase: phaseRef.current,
      currentRound: roundDeliveryRef.current?.activeOfferRound ?? null,
      active: true,
      lastScanStart: scanStart,
      lastScanEnd: null,
      scanRunId: owner.runId,
      probeSeq: captureSeq,
      lastProbeStartedAt: startedAt,
      probeInFlightSince: startedAt,
      probeRestartCount: probeRestartCountRef.current,
      probeSkipReason: lastProbeSkipReasonRef.current,
      captureAttempted: false,
      cropCount: 0,
      noCropReason: "capture-pending",
    }));

    const scanStartMs = performance.now();
    try {
      const execution = await executeOcrRun(
        () => invoke<OcrScanResult>("detect_augment_names", { knownNames: ocrKnownNames }),
        (scan) => scan,
      );
      if (execution.kind === "failure") throw new Error(execution.reason);
      const scan = execution.value;
      if (import.meta.env.DEV) {
        logOverlayDiagnostic("[identity-native-finish]", {
          runId: owner.runId,
          captureAttempted: scan.captureAttempted,
          cropCount: scan.cropCount,
          captureMs: scan.captureMs,
          ocrMs: scan.ocrMs,
          nativeTotalMs: scan.totalMs,
        });
      }

      // Stale-result rejection: publish only while this probe's seq is still the
      // newest AND the foreground epoch it captured under is unchanged. A delayed
      // or watchdog-superseded probe can never restore an already-cleared frame.
      if (
        captureSeq !== scanSeqRef.current ||
        !ownerCurrent(owner, ocrOwnersRef.current.current, currentOwnerContext())
      ) {
        if (import.meta.env.DEV) {
          logOverlayDiagnostic("[identity-stale-reject]", {
            runId: owner.runId,
            reason: "owner-superseded-before-publication",
          });
        }
        return;
      }
      if (foregroundEpoch !== foregroundEpochRef.current) return;
      if (gameEpoch !== gameEpochRef.current) return;
      if (championGenerationAtStart !== championGenerationRef.current) return;
      if (championIdAtStart !== championIdRef.current) return;
      if (offerGenerationAtStart !== geometryGenerationRef.current) return;
      if (championRequestIdAtStart !== aramgg.championRequestId) return;
      if (championPatchAtStart !== aramgg.championPatch) return;
      if (slots.some((regionIndex) => ocrRunSuperseded(
        triggerSlotGenerations[regionIndex] ?? 0,
        slotGenerationsRef.current[regionIndex] ?? 0,
      ))) return;
      const matchStartMs = performance.now();

      const rawTitles: Array<string | null> = [0, 1, 2].map(
        (regionIndex) =>
          scan.detected.find((entry) => entry.region_index === regionIndex)?.text ?? null,
      );
      // Re-read ONLY the triggered slots; untouched slots keep their prior title
      // so applyScanToOffer leaves their identity intact (geometry already
      // confirmed those cards did not reroll). A triggered slot with no plausible
      // title this pass resolves to null → SCANNING → retry after the deadline.
      const titlesForScan: Array<string | null> = [0, 1, 2].map((regionIndex) => {
        if (!slots.includes(regionIndex)) return offerStateRef.current.slots[regionIndex].title;
        const raw = rawTitles[regionIndex];
        return raw != null && isPlausibleTitle(normalizeAugmentNameForLookup(raw)) ? raw : null;
      });
      // The offer LATCH (feeds the decision engine + collector) keeps grace; the
      // identity STORE (what renders) is strict and geometry-fingerprint-keyed.
      const applied = applyScanToOffer(
        offerStateRef.current,
        titlesForScan,
        normalizeAugmentNameForLookup,
        resolveSlotTitle,
        titlePresent,
      );
      publishOffer(applied.state);
      // Write the identity store for the triggered slots, keyed to the geometry
      // fingerprint that triggered the read. Resolve STRICTLY from this pass's
      // plausible title (never applyScanToOffer's grace) so a rerolled slot whose
      // new title was unreadable stays SCANNING instead of showing the stale one.
      const resolvedAt = performance.now();
      const championGeneration = championGenerationRef.current;
      for (const regionIndex of slots) {
        const raw = rawTitles[regionIndex];
        const readable = raw != null && isPlausibleTitle(normalizeAugmentNameForLookup(raw));
        // Reject a run whose slot rerolled again during the read: its generation
        // is now behind. The store was already invalidated to SCANNING by the
        // geometry track, and this stale read must not repaint the new card.
        if (ocrRunSuperseded(
          triggerSlotGenerations[regionIndex] ?? 0,
          slotGenerationsRef.current[regionIndex] ?? 0,
        )) continue;
        const fingerprint = triggerFingerprints[regionIndex] ?? "";
        const prev = identityStoreRef.current[regionIndex];
        const resolution = readable ? resolveSlotTitle(raw as string) : null;
        const failure = resolution === null
          ? failurePublication((prev?.failureCount ?? 0) + 1, resolvedAt)
          : null;
        const incoming: IdentityRecord<SlotResolution> = {
          fingerprint,
          resolution,
          resolvedAt,
          championGeneration,
          augmentId: slotResolutionAugmentId(resolution),
          ocrTitle: readable ? raw : null,
          foregroundEpoch,
          gameEpoch,
          offerGeneration: offerGenerationAtStart,
          slotGeneration: triggerSlotGenerations[regionIndex] ?? 0,
          ocrRunId: owner.runId,
          championRequestId: championRequestIdAtStart,
          championPatch: championPatchAtStart,
          conflictCount: 0,
          unresolvedState: failure?.state,
          failureCount: failure?.failureCount ?? 0,
          retryAt: failure?.retryAt,
        };
        const stored = reconcileIdentityRecord(prev, incoming);
        identityStoreRef.current[regionIndex] = stored;
        if (import.meta.env.DEV) {
          const stat = stored.resolution?.aramgg?.kind === "matched"
            ? stored.resolution.aramgg.stat
            : null;
          const diagnostic = {
            foregroundEpoch,
            gameEpoch,
            championId: championIdAtStart,
            championGeneration,
            championDatasetRequestId: championRequestIdAtStart,
            offerGeneration: offerGenerationAtStart,
            geometrySequence: geometrySeqRef.current,
            slot: regionIndex,
            slotGeneration: triggerSlotGenerations[regionIndex] ?? 0,
            fingerprint: boundedDiagnosticHash(fingerprint),
            fingerprintHammingDistance: prev
              ? hammingDistance(prev.fingerprint, fingerprint)
              : null,
            ocrRunId: owner.runId,
            normalizedOcrTitleHash: boundedDiagnosticHash(readable ? raw : null),
            canonicalAugmentId: stored.augmentId ?? null,
            statProvenance: stat?.provenance ?? null,
            rawWinRate: stat?.rawWinRate ?? null,
            tier: stat?.tierLetter ?? null,
            publicationReason: stored === prev ? "identity-conflict-rejected" : "identity-published",
          };
          logOverlayDiagnostic("[identity-publish]", diagnostic);
          logOverlayDiagnostic("[slot-publication]", diagnostic);
        }
      }
      // Clear the pending queue; the next geometry tick re-populates it if any
      // slot is still unresolved past the retry deadline (or rerolls again).
      ocrPendingSlotsRef.current = [];
      // Repaint the LIVE geometry frame with the new identities (geometry owns
      // presence/freshness; this only refreshes chip content).
      republishGeometryFrame(geometrySeqRef.current);
      const matchMs = performance.now() - matchStartMs;

      setOcrLifecycle((previous) => ({
        ...previous,
        lastScanEnd: new Date().toISOString(),
        captureAttempted: scan.captureAttempted,
        cropCount: scan.cropCount,
        noCropReason: scan.cropCount === 0
          ? scan.diagnostics.find((diagnostic) => diagnostic.error)?.error ?? "no-crops-returned"
          : null,
        offerGeneration: applied.state.generation,
        timings: {
          captureMs: scan.captureMs,
          ocrMs: scan.ocrMs,
          nativeTotalMs: scan.totalMs,
          matchMs: Math.round(matchMs),
          endToEndMs: Math.round(performance.now() - scanStartMs),
        },
      }));
      setOcrDiagnostics(
        scan.diagnostics.map((diagnostic) => {
          const slot = applied.state.slots[diagnostic.regionIndex];
          const resolution = slot?.resolution ?? null;
          const aramggResolution = resolution?.aramgg ?? null;
          const slotState: SlotDiagnosticState =
            !slot || slot.fingerprint === null
              ? "scanning"
              : aramggResolution
                ? aramggResolution.kind
                : resolution?.pool
                  ? "matched"
                  : "unmatched";
          const rejectionStage: SlotRejectionStage = !diagnostic.captureSucceeded
            ? "capture"
            : !diagnostic.rawText
              ? "ocr"
              : slotState === "unmatched"
                ? "riot-catalog"
                : slotState === "no-data"
                  ? "aramgg"
                  : null;
          const poolDiagnostic = resolution?.poolDiagnostic;
          return {
            ...diagnostic,
            normalizedText: slot?.fingerprint ?? poolDiagnostic?.normalizedText ?? "",
            bestCandidate: poolDiagnostic?.bestCandidate ?? null,
            confidence:
              aramggResolution && aramggResolution.kind !== "unmatched"
                ? aramggResolution.riot.confidence
                : poolDiagnostic?.confidence ?? null,
            rejectionReason: !diagnostic.rawText
              ? diagnostic.error ?? "no-text-recognized"
              : aramggResolution?.kind === "unmatched"
                ? `${aramggResolution.rejection.reason}${
                    "detail" in aramggResolution.rejection && aramggResolution.rejection.detail
                      ? `: ${aramggResolution.rejection.detail}`
                      : ""
                  }`
                : aramggResolution?.kind === "no-data"
                  ? "riot-resolved-no-aramgg-record"
                  : poolDiagnostic?.rejectionReason ?? null,
            riotCanonicalName:
              aramggResolution && aramggResolution.kind !== "unmatched"
                ? aramggResolution.riot.canonicalName
                : null,
            riotAugmentId:
              aramggResolution && aramggResolution.kind !== "unmatched"
                ? aramggResolution.riot.augmentId
                : null,
            riotMethod:
              aramggResolution && aramggResolution.kind !== "unmatched"
                ? aramggResolution.riot.method
                : null,
            aramggResult:
              aramggResolution?.kind === "matched"
                ? `wr=${aramggResolution.stat.winRatePercent}% n=${aramggResolution.stat.numGames} tier=${aramggResolution.stat.tierLetter}`
                : aramggResolution?.kind === "no-data"
                  ? "no-record"
                  : null,
            slotState,
            rejectionStage,
          };
        }),
      );

      const matched: MatchedCard[] = applied.state.slots.flatMap((slot) =>
        slot.resolution?.pool && slot.title
          ? [{
              augment: slot.resolution.pool,
              regionIndex: slot.regionIndex,
              ocrText: slot.title,
            }]
          : [],
      );
      if (
        collectorCaptureEnabled &&
        isCompleteThreeCardOffer(matched) &&
        playerData
      ) {
        const round = roundDeliveryRef.current?.activeOfferRound ?? 0;
        const offeredAugmentSlugs = matched
          .map((card) => card.augment.slug)
          .sort();
        const roundKey = `${round}:${offeredAugmentSlugs.join(",")}`;
        if (round > 0 && roundKey !== lastRecordedRoundRef.current) {
          lastRecordedRoundRef.current = roundKey;
          void invoke("record_contributor_round", {
            round,
            offeredAugmentSlugs,
            ocrConfidence: matched.length / 3,
          });
        }
      }

      // Presence, occlusion, and clearing are the geometry track's job — this
      // identity pass only refreshed chip content on the live geometry frame.
    } catch (error) {
      // A stale or superseded OCR probe (newer seq, or a foreground flip) must not
      // write identities — geometry, not OCR, decides presence and clearing.
      if (
        captureSeq !== scanSeqRef.current ||
        !ownerCurrent(owner, ocrOwnersRef.current.current, currentOwnerContext())
      ) {
        if (import.meta.env.DEV) {
          logOverlayDiagnostic("[identity-stale-reject]", {
            runId: owner.runId,
            reason: "owner-superseded-during-failure",
          });
        }
        return;
      }
      if (foregroundEpoch !== foregroundEpochRef.current) return;
      if (gameEpoch !== gameEpochRef.current) return;
      if (championGenerationAtStart !== championGenerationRef.current) return;
      if (championIdAtStart !== championIdRef.current) return;
      if (offerGenerationAtStart !== geometryGenerationRef.current) return;
      if (slots.some((regionIndex) => ocrRunSuperseded(
        triggerSlotGenerations[regionIndex] ?? 0,
        slotGenerationsRef.current[regionIndex] ?? 0,
      ))) return;
      const unavailable = ocrAvailabilityFromError(error);
      if (unavailable) setOcrAvailability(unavailable);
      // Identity-only failure: mark the triggered slots unresolved (retry after
      // the deadline). Presence/freshness are unaffected — the geometry track
      // keeps publishing, so a readable offer still shows SCANNING chips.
      const failedAt = performance.now();
      for (const regionIndex of slots) {
        const priorFailures = identityStoreRef.current[regionIndex]?.failureCount ?? 0;
        const failure = failurePublication(priorFailures + 1, failedAt);
        identityStoreRef.current[regionIndex] = {
          fingerprint: triggerFingerprints[regionIndex] ?? "",
          resolution: null,
          resolvedAt: failedAt,
          championGeneration: championGenerationAtStart,
          foregroundEpoch,
          gameEpoch,
          offerGeneration: offerGenerationAtStart,
          slotGeneration: triggerSlotGenerations[regionIndex] ?? 0,
          ocrRunId: owner.runId,
          championRequestId: championRequestIdAtStart,
          championPatch: championPatchAtStart,
          unresolvedState: failure.state,
          failureCount: failure.failureCount,
          retryAt: failure.retryAt,
        };
      }
      ocrPendingSlotsRef.current = [];
      republishGeometryFrame(geometrySeqRef.current);
      const message = error instanceof Error ? error.message : "ocr-scan-failed";
      if (import.meta.env.DEV) {
        logOverlayDiagnostic(
          message === "timeout" ? "[identity-timeout]" : "[identity-retry]",
          {
            runId: owner.runId,
            requestedSlots: slots,
            reason: message,
            failures: slots.map((slot) => identityStoreRef.current[slot]?.failureCount ?? 0),
          },
        );
      }
      setOcrDiagnostics(
        [0, 1, 2].map((regionIndex) => ({
          regionIndex,
          cardRect: null,
          crop: null,
          captureSucceeded: false,
          rawText: null,
          error: message,
          captureWidth: null,
          captureHeight: null,
          normalizedText: "",
          bestCandidate: null,
          confidence: null,
          rejectionReason: message,
          riotCanonicalName: null,
          riotAugmentId: null,
          riotMethod: null,
          aramggResult: null,
          slotState: "scanning" as const,
          rejectionStage: "capture" as const,
        })),
      );
      lastProbeFailureReasonRef.current = message;
      setOcrLifecycle((previous) => ({
        ...previous,
        lastScanEnd: new Date().toISOString(),
        captureAttempted: false,
        cropCount: 0,
        noCropReason: message,
        probeFailureReason: message,
      }));
    } finally {
      // Release the in-flight guard on EVERY path — success, stale-reject return,
      // throw, or timeout — so a single stuck capture can never wedge the
      // scheduler asleep. This try/finally is the permanent-sleep fix. Release
      // ONLY if this probe still owns the guard: a watchdog restart hands
      // ownership to the replacement probe, whose guard a late return must not
      // free (that would let two probes overlap).
      if (ocrOwnersRef.current.release(owner.runId)) {
        const finishedAt = performance.now();
        lastProbeFinishedAtRef.current = finishedAt;
        probeInFlightSinceRef.current = null;
        probeInFlightRef.current = false;
        setOcrLifecycle((previous) => ({
          ...previous,
          active: false,
          lastProbeFinishedAt: finishedAt,
          probeInFlightSince: null,
        }));
      }
    }
  }, [aramgg.championPatch, aramgg.championRequestId, bumpScanSeq, collectorCaptureEnabled, ocrKnownNames, playerData, publishOffer, republishGeometryFrame, resolveSlotTitle, titlePresent]);

  // ─── TRACK 1 scheduler tick: the fast geometry probe ─────────────────────────
  // Same pure reducer (nextProbeAction) as OCR — start / skip / watchdog-restart
  // from live refs ONLY (foreground, active-game, in-flight timing), never
  // telemetry — but on the geometry config and the geometry guards. The restart
  // branch IS the watchdog: a wedged geometry probe is invalidated (seq bumped →
  // late return stale-rejects), its guard reset, and a fresh probe starts.
  const geometryProbeTick = useCallback(() => {
    const scheduledAt = performance.now();
    const action = nextProbeAction(
      {
        foreground: foregroundStateRef.current.gameWindowForeground,
        activeGame: activeGameRef.current,
        inFlight: geometryInFlightRef.current,
        inFlightSince: geometryInFlightSinceRef.current,
        lastProbeStartedAt: lastGeometryStartedAtRef.current,
      },
      GEOMETRY_PROBE_CONFIG,
      scheduledAt,
    );
    if (action.kind === "skip") return;
    if (action.kind === "restart") {
      if (import.meta.env.DEV) {
        console.info("[geometry-watchdog]", JSON.stringify({
          probeSeq: geometrySeqRef.current,
          scheduledAt,
          inFlightSince: geometryInFlightSinceRef.current,
          inFlightMs:
            geometryInFlightSinceRef.current == null
              ? null
              : scheduledAt - geometryInFlightSinceRef.current,
          schedulerRestartCount: geometryRestartCountRef.current + 1,
          hiddenReason: "probe-timeout",
        }));
      }
      geometrySeqRef.current += 1;
      geometryInFlightRef.current = false;
      geometryInFlightSinceRef.current = null;
      geometryInFlightTokenRef.current = null;
      geometryRestartCountRef.current += 1;
    }
    // Geometry owns presence even when the OS OCR backend is unavailable. The
    // native probe reports screen-capture failures explicitly (as uncertain,
    // never confirmed combat), so OCR capability must never suppress this track.
    void runGeometryProbe(scheduledAt);
  }, [runGeometryProbe]);

  // ─── TRACK 2 scheduler tick: the TRIGGERED OCR/identity probe ────────────────
  // Its "active game" gate is whether the geometry track queued any slots — OCR
  // NEVER runs on a fixed cadence. It reuses the OCR guards + watchdog so a slow
  // read can never wedge either track, and it still honours the OCR interval so a
  // burst of triggers cannot hammer the capture pipeline.
  const identityProbeTick = useCallback(() => {
    const action = nextProbeAction(
      {
        foreground: foregroundStateRef.current.gameWindowForeground,
        activeGame: ocrPendingSlotsRef.current.length > 0,
        inFlight: probeInFlightRef.current,
        inFlightSince: probeInFlightSinceRef.current,
        lastProbeStartedAt: lastProbeStartedAtRef.current,
      },
      DEFAULT_PROBE_CONFIG,
      performance.now(),
    );
    if (action.kind === "skip") {
      lastProbeSkipReasonRef.current = action.reason;
      return;
    }
    if (action.kind === "restart") {
      const expiredOwner = ocrOwnersRef.current.current;
      if (import.meta.env.DEV) {
        logOverlayDiagnostic("[identity-watchdog-restart]", {
          runId: expiredOwner?.runId ?? null,
          inFlightSince: probeInFlightSinceRef.current,
          reason: action.reason,
        });
      }
      bumpScanSeq();
      probeInFlightRef.current = false;
      probeInFlightSinceRef.current = null;
      ocrOwnersRef.current.invalidate();
      probeRestartCountRef.current += 1;
      lastProbeFailureReasonRef.current = action.reason;
    }
    if (!canRunOcr(ocrAvailability)) {
      lastProbeSkipReasonRef.current = "ocr-unavailable";
      return;
    }
    if (!nameLookup.size) {
      lastProbeSkipReasonRef.current = "names-not-loaded";
      return;
    }
    const slots = ocrPendingSlotsRef.current;
    if (slots.length === 0) return;
    lastProbeSkipReasonRef.current = action.kind === "restart" ? "watchdog-restart" : "due";
    void runIdentityProbe(
      slots,
      ocrTriggerFingerprintsRef.current,
      slotGenerationsRef.current.slice(),
    );
  }, [bumpScanSeq, nameLookup, ocrAvailability, runIdentityProbe]);

  // The single tick drives BOTH tracks: geometry (fast, authoritative) first so a
  // fresh trigger decision is in place before the identity track reads it.
  const surfaceProbeTick = useCallback(() => {
    geometryProbeTick();
    identityProbeTick();
  }, [geometryProbeTick, identityProbeTick]);

  useEffect(() => {
    surfaceProbeTickRef.current = surfaceProbeTick;
  }, [surfaceProbeTick]);

  // The single scan clock: fires on the fast GEOMETRY cadence for the life of the
  // component and is never cleared by telemetry, phase, or cancellation. Each
  // tick drives both tracks (geometry every tick; OCR only when triggered). It
  // only ever calls the latest tick via the ref, so re-created callbacks never
  // orphan it.
  useEffect(() => {
    const intervalId = setInterval(() => {
      surfaceProbeTickRef.current();
    }, GEOMETRY_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  // Scheduler-health clock: frame age is deliberately irrelevant while a newer
  // probe is legitimately in flight. This clock fails closed only when geometry
  // activity exceeds the derived health deadline (or foreground/game gates fail).
  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = performance.now();
      const inFlightSince = geometryInFlightSinceRef.current;
      const healthy = geometrySchedulerHealthy({
        now,
        foreground: foregroundStateRef.current.gameWindowForeground,
        activeGame: activeGameRef.current,
        inFlightSince,
        lastProbeStartedAt: lastGeometryStartedAtRef.current,
        lastProbeCompletedAt: lastGeometryCompletedAtRef.current,
      });
      setGeometrySchedulerIsHealthy(healthy);
      if (import.meta.env.DEV) {
        const frame = visibleFrameRef.current;
        const lastActivityAt = inFlightSince ?? Math.max(
          lastGeometryStartedAtRef.current ?? Number.NEGATIVE_INFINITY,
          lastGeometryCompletedAtRef.current ?? Number.NEGATIVE_INFINITY,
        );
        const ageMs = Number.isFinite(lastActivityAt) ? now - lastActivityAt : null;
        const structurallyVisible =
          frame != null &&
          frame.surfaceValidated &&
          foregroundStateRef.current.gameWindowForeground;
        const renderable = structurallyVisible && healthy;
        const probeSeq = geometrySeqRef.current;
        if (
          structurallyVisible &&
          ageMs != null &&
          ageMs >= GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS * 0.75 &&
          geometryFreshnessWarningSeqRef.current !== probeSeq
        ) {
          geometryFreshnessWarningSeqRef.current = probeSeq;
          console.info("[geometry-freshness-75]", JSON.stringify({
            probeSeq,
            ageMs,
            deadlineMs: GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS,
            inFlight: inFlightSince != null,
          }));
        }
        if (
          lastGeometryRenderableRef.current &&
          !renderable &&
          geometryExpiryWarningSeqRef.current !== probeSeq
        ) {
          geometryExpiryWarningSeqRef.current = probeSeq;
          const hiddenReason: GeometryDiagnosticHideReason =
            !foregroundStateRef.current.gameWindowForeground
              ? "foreground-lost"
              : inFlightSince != null && now - inFlightSince >= PROBE_TIMEOUT_MS
                ? "probe-timeout"
                : "ttl-expired";
          console.info("[geometry-hidden]", JSON.stringify({
            probeSeq,
            hiddenReason,
            ageMs,
            deadlineMs: GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS,
            inFlightMs: inFlightSince == null ? null : now - inFlightSince,
            schedulerRestartCount: geometryRestartCountRef.current,
          }));
        }
        lastGeometryRenderableRef.current = renderable;
        setOcrLifecycle((previous) => ({
          ...previous,
          frameAgeMs: ageMs,
          frameHiddenByTtl: structurallyVisible && !healthy,
        }));
      }
    }, GEOMETRY_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  // Development-only rolling access to the last 200 complete geometry probes.
  // The production build folds this branch away with all diagnostic strings.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const hooks = window as unknown as {
      __getGeometryProbeDiagnostics?: () => GeometryProbeDiagnostic[];
    };
    hooks.__getGeometryProbeDiagnostics = () => [...geometryDiagnosticsRef.current];
    return () => {
      delete hooks.__getGeometryProbeDiagnostics;
    };
  }, []);

  // DEV-ONLY, opt-in fixture capture (disabled by default). Exposes manual,
  // console-driven hooks to snapshot the current REDACTED surface evidence with
  // a ground-truth label and export a JSONL manifest by hand. Nothing is
  // persisted, uploaded, or committed; the effect no-ops in production.
  useEffect(() => {
    if (!datasetCaptureOn) return;
    const buffer = new SurfaceFixtureBuffer();
    const hooks = window as unknown as {
      __captureOfferFixture?: (label: DatasetLabel) => number;
      __exportOfferFixtures?: () => string;
      __clearOfferFixtures?: () => void;
    };
    hooks.__captureOfferFixture = (label) => {
      const stashed = lastFixtureInputRef.current;
      if (!stashed) return 0;
      return buffer.add(
        buildSurfaceFixtureRecord({ ...stashed, label, timestamp: new Date().toISOString() }),
      );
    };
    hooks.__exportOfferFixtures = () => {
      const manifest = buffer.serialize();
      console.info(`[dataset-capture] ${buffer.all().length} record(s)\n${manifest}`);
      return manifest;
    };
    hooks.__clearOfferFixtures = () => buffer.clear();
    console.info(
      "[dataset-capture] enabled — window.__captureOfferFixture('offer'|'combat'|" +
        "'scoreboard'|'respawn'|'unknown') to label the current frame, then " +
        "window.__exportOfferFixtures() for the JSONL manifest.",
    );
    return () => {
      delete hooks.__captureOfferFixture;
      delete hooks.__exportOfferFixtures;
      delete hooks.__clearOfferFixtures;
    };
  }, [datasetCaptureOn]);

  // Main polling loop
  const poll = useCallback(async () => {
    if (pollInFlightRef.current) {
      pollPendingRef.current = true;
      return;
    }
    pollInFlightRef.current = true;

    try {
      if (!collectorEnabled) {
        setActiveGame(false);
        stopOcr();
        updatePhase("idle");
        return;
      }

      await refreshForeground();

      const gameflow = await invoke<LcuGameflowState | null>("get_lcu_gameflow_state")
        .catch(() => null);
      gameflowCaptureAllowedRef.current = shouldRunOcrForGameflow(gameflow);
      // The scheduler's coarse "active game" gate: capture is compliant only in
      // a live game. This is the ONLY telemetry the probe scheduler consults,
      // and it can never wedge asleep because the poll re-sets it every tick.
      setActiveGame(gameflowCaptureAllowedRef.current);
      if (shouldClearOcrStateForGameflow(gameflow)) {
        const clientFound = await invoke<boolean>("detect_league_client").catch(() => false);
        clearGameOnlyState(clientFound ? "client_found" : "idle");
        return;
      }

      try {
        const data = await invoke<LivePlayerData | null>("get_live_player_data");
        if (data) {
          const gameHash = await invoke<string | null>("get_game_hash").catch(() => null);
          if (!gameHash) {
            setMemberSnapshot(disabledMember("game-hash-unavailable"));
          } else if (
            memberBootstrapCompleteRef.current &&
            shouldVerifyGameStart(activeGameHashRef.current, gameHash)
          ) {
            activeGameHashRef.current = gameHash;
            setMemberSnapshot(disabledMember("game-session-verification-pending"));
            const snapshot = await verifyMemberGameStart(gameHash).catch((error) =>
              disabledMember(
                error instanceof Error ? error.message : "game-session-verification-failed",
              ),
            );
            setMemberSnapshot(snapshot);
          }
          const lastGameTime = lastGameTimeRef.current;
          if (lastGameTime !== null && data.game_time + 5 < lastGameTime) {
            ocrSelectionCompletedRef.current = true;
            completedRoundsRef.current = 0;
            setPickedAugments([]);
            lastRecordedRoundRef.current = "";
            gameEpochRef.current += 1;
            stopOcr();
          }
          lastGameTimeRef.current = data.game_time;
          setPlayerData(data);
          const slug = champNameToSlug(data.champion);
          if (slug !== championSlug) {
            ocrSelectionCompletedRef.current = true;
            setChampionSlug(slug);
            completedRoundsRef.current = 0;
            setPickedAugments([]);
            stopOcr();
          }

          // Round DELIVERY: level thresholds only create eligibility. R1 is
          // delivered at the level-3 timing; R2/R3/R4 deliver during a death
          // sequence after crossing 7/11/15 — reaching a threshold while
          // ALIVE never enters selection, never renders chips, never consumes
          // a round, and never suppresses the future death-triggered offer.
          const decision = resolveRoundDelivery({
            playerLevel: data.level,
            isDead: data.is_dead,
            completedRounds: completedRoundsRef.current,
            offerLatched: offerActive(offerStateRef.current),
          });
          roundDeliveryRef.current = decision;
          setRoundDelivery((previous) =>
            previous &&
            previous.eligibleRounds === decision.eligibleRounds &&
            previous.pendingRounds === decision.pendingRounds &&
            previous.scanMode === decision.scanMode &&
            previous.activeOfferRound === decision.activeOfferRound
              ? previous
              : decision,
          );

          // A confirmed pick (keydown) set selectionCompleted: close the offer
          // and return to in-game. Scanning itself is NOT gated here — the
          // independent 250 ms scheduler keeps probing; the poll only labels
          // rounds and reconciles phase on strong completion evidence.
          if (phaseRef.current === "augment_selection" && ocrSelectionCompletedRef.current) {
            updatePhase("in_game");
            finishOcr();
          }
          return;
        }
      } catch {
        // Live Client API not available
      }

      try {
        const clientFound = await invoke<boolean>("detect_league_client");
        clearGameOnlyState(clientFound ? "client_found" : "idle");
      } catch {
        clearGameOnlyState("idle");
      }
    } finally {
      pollInFlightRef.current = false;
      if (pollPendingRef.current) {
        pollPendingRef.current = false;
        void pollRef.current();
      }
    }
  }, [
    champNameToSlug,
    championSlug,
    clearGameOnlyState,
    collectorEnabled,
    finishOcr,
    refreshForeground,
    setActiveGame,
    stopOcr,
    updatePhase,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key.toLowerCase() === "c" && memberEnabled) {
        setCoachOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") {
        setCoachOpen(false);
        return;
      }
      const regionIndex = Number(event.key) - 1;
      if (
        !memberEnabled ||
        phase !== "augment_selection" ||
        !isCompleteThreeCardOffer(matchedCards) ||
        !Number.isInteger(regionIndex) ||
        regionIndex < 0 ||
        regionIndex > 2
      ) {
        return;
      }
      const offered = [...matchedCards]
        .sort((left, right) => left.regionIndex - right.regionIndex)
        .map((card) => card.augment.slug);
      setPickedAugments((current) =>
        confirmPickedAugment(current, offered, regionIndex),
      );
      const selectedAugmentSlug = offered[regionIndex];
      const confirmRound = roundDeliveryRef.current?.activeOfferRound ?? null;
      if (selectedAugmentSlug && confirmRound) {
        void invoke("confirm_contributor_round_selection", {
          round: confirmRound,
          selectedAugmentSlug,
        });
      }
      // A confirmed choice is STRONG completion evidence and ends the offer:
      // count the round, clear the latched state, and return to in-game
      // immediately instead of waiting for surface absence.
      recordRoundCompleted();
      ocrSelectionCompletedRef.current = true;
      stopOcr();
      updatePhase("in_game");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [matchedCards, memberEnabled, phase, recordRoundCompleted, stopOcr, updatePhase]);

  useEffect(() => {
    const foregroundIntervalId = setInterval(() => {
      void refreshForeground();
    }, 250);
    void refreshForeground();
    return () => clearInterval(foregroundIntervalId);
  }, [refreshForeground]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      void poll();
    }, 1500);
    const initialPollId = setTimeout(() => {
      void poll();
    }, 0);
    return () => {
      clearInterval(intervalId);
      clearTimeout(initialPollId);
    };
  }, [poll]);

  // Fix #5: force an immediate scan the instant the game regains focus, rather
  // than waiting up to 1.5s for the next poll tick. Stale matched cards were
  // already cleared on blur (foreground refresh → stopOcr()), so refocus rebuilds
  // the three-card offer atomically from a fresh OCR pass; badges stay hidden
  // until all three current cards are confidently matched.
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);
  useEffect(() => {
    if (gameWindowForeground) void pollRef.current();
  }, [gameWindowForeground]);

  // Component teardown: invalidate any in-flight probe (its late return will be
  // stale-rejected) and release the scheduler guard so a remount starts clean.
  // Clearing the token also no-ops the wedged probe's finally (no setState on an
  // unmounted component).
  useEffect(() => {
    const ocrOwners = ocrOwnersRef.current;
    return () => {
      bumpScanSeq();
      probeInFlightRef.current = false;
      probeInFlightSinceRef.current = null;
      ocrOwners.invalidate();
      geometrySeqRef.current += 1;
      geometryInFlightRef.current = false;
      geometryInFlightSinceRef.current = null;
      geometryInFlightTokenRef.current = null;
    };
  }, [bumpScanSeq]);

  useEffect(() => {
    const onResize = () =>
      setCssWindow({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ─── Render ───
  const badgePositions = useMemo(() => {
    const positions = new Map<number, { left: string; top: string }>();
    if (!calibration || !visibleFrame) return positions;

    // Chip geometry comes ONLY from the current frame's fresh per-slot rects.
    // A slot without a rect from THIS capture is never positioned — no
    // historical or calibrated fallback geometry can anchor a stale chip.
    const regionRects = new Map<number, PhysicalRect>();
    for (const slot of visibleFrame.slots) {
      if (slot.cardRect) regionRects.set(slot.regionIndex, slot.cardRect);
    }

    // THE coordinate boundary: every calibrated rect converts to
    // overlay-window CSS exactly once, as a pure ratio against the overlay
    // anchor. scaleFactor never re-enters, so a flapping monitor scale or a
    // detected-window↔monitor-fallback switch cannot move the chips.
    const toCss = (rect: PhysicalRect) =>
      cssRectFromCalibratedRect(rect, calibration.overlayAnchor, cssWindow);
    const cssGameRect = toCss(calibration.viewport);
    const cssRegionRects = new Map(
      [...regionRects.entries()].map(([regionIndex, rect]) => [regionIndex, toCss(rect)]),
    );
    const avoidRects = overlayAvoidRectsCss(cssWindow, cssGameRect);

    for (const chip of slotChips) {
      const cardRect = cssRegionRects.get(chip.regionIndex);
      if (!cardRect) continue;
      // A chip must never cover a NEIGHBORING card either — the other card
      // frames are additional keep-out rects.
      const otherFrames = [...cssRegionRects.entries()]
        .filter(([regionIndex]) => regionIndex !== chip.regionIndex)
        .map(([, rect]) => cardFrameFromNameRect(rect, cssGameRect));
      const placement = placeBadgeAboveCard({
        cardRect,
        gameRect: cssGameRect,
        avoidRects: [...avoidRects, ...otherFrames],
      });
      if (placement) {
        positions.set(chip.regionIndex, placement);
      }
    }

    return positions;
  }, [calibration, cssWindow, visibleFrame, slotChips]);

  return (
    <div className="overlay-root">
      {/* Status dot */}
      {collectorEnabled && gameOverlayIsVisible && <div
        className={`status-dot ${
          phase === "augment_selection"
            ? "status-ocr"
            : phase === "in_game"
              ? "status-connected"
              : phase === "client_found"
                ? "status-waiting"
                : "status-disconnected"
        }`}
      />}

      {/* Per-slot badge chips rendered OUTSIDE the card frames (above the
          derived card frame, side-anchored as fallback). Rendered ONLY for a
          real focused LATCHED offer (realBadgesReady) or explicit League-absent
          preview (previewBadgesReady). Each chip reflects its slot's own
          pipeline state — never stale, never invented. See fixtureMode.ts. */}
      {showBadgeLayer && (
        <>
          {slotChips.map((chip) => {
            const pos = badgePositions.get(chip.regionIndex);
            if (!pos) return null;
            if (chip.state !== "tier") {
              const label =
                chip.state === "scanning"
                  ? "SCANNING"
                  : chip.state === "ocr-error"
                    ? "OCR ERROR"
                    : chip.state === "no-data"
                    ? "NO ARAMGG DATA"
                    : "UNMATCHED";
              return (
                <div
                  className={`badge-chip badge-chip-${chip.state}`}
                  key={chip.key}
                  style={{ left: pos.left, top: pos.top }}
                >
                  <span className="badge-chip-state">{label}</span>
                </div>
              );
            }
            return (
              <div
                className={`badge-chip ${chip.tier ? tierClassName(chip.tier) : ""}${
                  isPreviewMode ? " badge-preview" : ""
                }`}
                key={chip.key}
                style={{ left: pos.left, top: pos.top }}
              >
                {isPreviewMode && (
                  <span className="preview-watermark">PREVIEW</span>
                )}
                {chip.isNew && <span className="badge-new">NEW</span>}
                {chip.tier && (
                  <TierBadgeLabel
                    tier={chip.tier}
                    winRateText={chip.winRateText}
                    statScope={chip.statScope}
                  />
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Minimal HUD when in-game but not selecting */}
      {memberEnabled && phase === "in_game" && championSlug && gameOverlayIsVisible && (
        <div className="hud">
          <span className="champion-tag">
            {playerData?.champion ?? championSlug}
          </span>
          <span className="hud-level">
            Lv.{playerData?.level ?? "?"}
            {roundDelivery && roundDelivery.eligibleRounds > 0 &&
              ` · R${roundDelivery.activeOfferRound}`}
          </span>
        </div>
      )}

      {/* Idle / waiting */}
      {collectorEnabled && gameOverlayIsVisible && phase === "idle" && (
        <div className="idle-panel">Waiting for League client...</div>
      )}
      {collectorEnabled && gameOverlayIsVisible && phase === "client_found" && (
        <div className="idle-panel">Client found — waiting for game...</div>
      )}
      {collectorEnabled && gameOverlayIsVisible && dataError && (
        <div className="idle-panel">Overlay data failed to load: {dataError}</div>
      )}
      {collectorEnabled && gameOverlayIsVisible && effectiveMember?.error && (
        <div className="member-error">Member coach unavailable: {effectiveMember.error}</div>
      )}
      {devPanelsVisible({ devBuild: import.meta.env.DEV, gameOverlayIsVisible }) && (
        <DevOverlayDiagnostics
          gameOverlayIsVisible={gameOverlayIsVisible}
          fixtureModeKind={fixtureMode.kind}
          tierFixtureOn={tierFixtureOn}
          geometryPreviewOn={geometryPreviewOn}
          isPreviewMode={isPreviewMode}
          debugCollapsed={debugCollapsed}
          setDebugCollapsed={setDebugCollapsed}
          calibration={calibration}
          calibrationError={calibrationError}
          aramgg={aramgg}
          diag={diag}
          foregroundState={foregroundState}
          ocrDiagnostics={ocrDiagnostics}
          ocrLifecycle={ocrLifecycle}
          fixturePayload={fixturePayload}
        />
      )}

      {/* Startup tip — auto-dismisses after 6s */}
      {collectorEnabled && gameOverlayIsVisible && showStartupTip && (
        <div className="startup-tip">
          <img src="/icon.png" alt="" className="startup-icon" />
          <div className="startup-tip-text">
            <div className="startup-title">Mayhem Oracle</div>
            <div className="startup-hint">⌘Q disabled — use menu bar icon to exit</div>
            <div className="startup-hint">Or ⌘⌥⎋ (Force Quit)</div>
          </div>
        </div>
      )}
      <CoachPanel
        open={effectiveMemberEnabled && coachOpen && gameOverlayIsVisible}
        result={badgeDecisionResult}
        mode={mode}
        onModeChange={setMode}
        winRateBySlug={badgeWinRateBySlug}
        rawWinRate={isFixtureBacked}
      />
      <CollectorOverlayController
        onStatus={setCollectorStatus}
        showPanel={gameOverlayIsVisible}
      />
    </div>
  );
}

export default App;
