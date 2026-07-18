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
  GEOMETRY_FRESHNESS_TTL_MS,
  IDENTITY_RETRY_MS,
  buildGeometryVisibleFrame,
  emptyGeometryObservation,
  geometryFrameFresh,
  identityForSlot,
  newOfferDetected,
  type GeometryObservation,
  type IdentityRecord,
} from "./surfaceGeometry";
import { decideOcrTrigger } from "./ocrTrigger";
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
// watchdog-restart) but on the fast cadence: presence/occlusion/freshness must
// refresh sub-second, independent of a slow OCR pass. Timeout is the shared
// bounded watchdog so a wedged capture re-arms within one cycle.
const GEOMETRY_PROBE_CONFIG: ProbeSchedulerConfig = {
  intervalMs: GEOMETRY_INTERVAL_MS,
  timeoutMs: PROBE_TIMEOUT_MS,
};

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
  state: "tier" | "scanning" | "unmatched" | "no-data";
  tier: TierLetter | null;
  winRateText: string | null;
  isNew: boolean;
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
  // Self-healing surface-probe scheduler bookkeeping (a single probe at a time).
  const probeInFlightRef = useRef(false);
  const probeInFlightSinceRef = useRef<number | null>(null);
  // Ownership token: the captureSeq of the probe that currently holds the
  // in-flight guard. Only that probe may release the guard in its finally, so a
  // watchdog-superseded probe returning late can never free the guard held by
  // its replacement (which would let two probes overlap).
  const probeInFlightTokenRef = useRef<number | null>(null);
  const lastProbeStartedAtRef = useRef<number | null>(null);
  const lastProbeFinishedAtRef = useRef<number | null>(null);
  const probeRestartCountRef = useRef(0);
  const lastProbeSkipReasonRef = useRef<string>("idle");
  const lastProbeFailureReasonRef = useRef<string | null>(null);
  // ─── Round-6 geometry track (the presence/occlusion/freshness AUTHORITY) ───
  // A cheap Rust pixel probe (probe_augment_surface) runs on its own fast
  // scheduler with its own single-in-flight guard, ownership token, seq, and
  // watchdog — a mirror of the OCR guards above so the two tracks never stall
  // each other. Geometry owns whether an offer is present, whether a modal has
  // occluded it, and the capture clock the render gate ages against. OCR NEVER
  // decides those; it only fills identity.
  const geometryInFlightRef = useRef(false);
  const geometryInFlightSinceRef = useRef<number | null>(null);
  const geometryInFlightTokenRef = useRef<number | null>(null);
  const geometrySeqRef = useRef(0);
  const lastGeometryStartedAtRef = useRef<number | null>(null);
  const geometryRestartCountRef = useRef(0);
  const geometryObservationRef = useRef<GeometryObservation | null>(null);
  // Render generation, bumped on each NEW offer (absent→present or a queued
  // round replacement) so chip keys reset between offers.
  const geometryGenerationRef = useRef(0);
  // Per-slot identity keyed by the GEOMETRY fingerprint it was resolved against.
  // identityForSlot returns a record only while its fingerprint still matches the
  // live card, so a late OCR result from a superseded generation can never paint
  // the new card (the identity stale-result guard).
  const identityStoreRef = useRef<Array<IdentityRecord<SlotResolution> | null>>([null, null, null]);
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
  // Monotonic clock (performance.now()) refreshed every ~250 ms so the render
  // gate re-checks the frame freshness TTL even when no probe publishes — a
  // stalled/dead scheduler then fails closed (hides) instead of freezing.
  const [renderClock, setRenderClock] = useState<number>(() => performance.now());
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
  const aramgg = useAramggTierFixture(
    tierFixtureOn || geometryPreviewOn,
    overlayData?.augments,
  );
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
    // Geometry freshness TTL: a positive frame renders only while its GEOMETRY
    // capture is recent. renderClock forces this to re-run every ~250 ms, so the
    // surface fails closed when the geometry scheduler stops refreshing it. This
    // is decoupled from OCR duration — the exact blink fix.
    geometryFrameFresh(visibleFrame?.capturedAt ?? null, renderClock, GEOMETRY_FRESHNESS_TTL_MS);
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
        return [{ ...base, state: "scanning", tier: null, winRateText: null, isNew: false }];
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
          }];
        }
        if (staged.kind === "no-data") {
          // Riot identity resolved, but ARAMGG carries no stat record.
          return [{ ...base, state: "no-data", tier: null, winRateText: null, isNew: false }];
        }
        return [{ ...base, state: "unmatched", tier: null, winRateText: null, isNew: false }];
      }
      // Engine path (no dev fixture): the local-catalog match backs the chip.
      const pool = slot.resolution?.pool ?? null;
      if (!pool) {
        return [{ ...base, state: "unmatched", tier: null, winRateText: null, isNew: false }];
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
      }];
    });
  }, [previewBadgesReady, fixturePayload, previewCards, realFrameRenderable, visibleFrame, decisionResult]);

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
    if (clearLatch) {
      resetOffer();
      setOcrDiagnostics([]);
      // Drop the geometry-keyed identity store and last observation so a stale
      // present result cannot repaint after a game exit / focus loss. Advancing
      // the geometry seq stale-rejects any in-flight geometry probe too.
      identityStoreRef.current = [null, null, null];
      geometryObservationRef.current = null;
      ocrPendingSlotsRef.current = [];
    }
    bumpScanSeq();
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
        // skip anyway, but we must not wait out the freshness TTL on a blur).
        stopOcr();
      }
      return nextForeground;
    } finally {
      foregroundPollStartedAtRef.current = null;
    }
  }, [stopOcr]);

  const clearGameOnlyState = useCallback((nextPhase: Phase) => {
    ocrSelectionCompletedRef.current = true;
    activeGameRef.current = false;
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
  }, [stopOcr, updatePhase]);

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

  // ─── TRACK 1: geometry probe — presence / occlusion / freshness authority ───
  // A cheap Rust PIXEL probe classifies the surface (present / occluded / absent)
  // and publishes the visible frame EVERY probe on the fast cadence. This is the
  // blink fix: a static offer's freshness refreshes every ~150 ms regardless of
  // how long OCR takes. It NEVER runs OCR — it only decides which slots the OCR
  // track should (re)read. Its single-in-flight guard is released in `finally` on
  // every path, and stale results are rejected by geometry seq + foreground epoch.
  const runGeometryProbe = useCallback(async () => {
    geometryInFlightRef.current = true;
    const startedAt = performance.now();
    geometryInFlightSinceRef.current = startedAt;
    lastGeometryStartedAtRef.current = startedAt;
    const captureSeq = (geometrySeqRef.current += 1);
    geometryInFlightTokenRef.current = captureSeq;
    const foregroundEpoch = foregroundEpochRef.current;
    const capturedAt = performance.now();
    try {
      const observation = await invoke<GeometryObservation>("probe_augment_surface", {
        probeSeq: captureSeq,
        capturedAt,
      });
      // Stale-result rejection: apply only while this probe's seq is still newest
      // AND the foreground epoch it captured under is unchanged.
      if (captureSeq !== geometrySeqRef.current) return;
      if (foregroundEpoch !== foregroundEpochRef.current) return;

      if (import.meta.env.DEV) {
        // Live p50/p95/p99 capture+analyze latency (compiled out of production).
        const ring = geometryLatenciesRef.current;
        ring.push(observation.elapsedMs);
        if (ring.length > 200) ring.shift();
        geometryProbeCountRef.current += 1;
        if (geometryProbeCountRef.current % 40 === 0 && ring.length > 0) {
          const sorted = [...ring].sort((a, b) => a - b);
          const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
          console.info(
            `[geometry-latency] n=${sorted.length} p50=${at(0.5).toFixed(1)} ` +
              `p95=${at(0.95).toFixed(1)} p99=${at(0.99).toFixed(1)} ms`,
          );
        }
      }

      const previous = geometryObservationRef.current;
      geometryObservationRef.current = observation;

      // A NEW offer (absent→present or ≥2 slots swapped) bumps the render
      // generation; a queued-round REPLACEMENT (previous offer was present) is
      // strong round-completion evidence. A first appearance is NOT a completion.
      if (newOfferDetected(previous, observation)) {
        geometryGenerationRef.current += 1;
        if (previous?.present && !previous.occluded) recordRoundCompleted();
      }

      // Publish the visible frame from geometry presence + current identities.
      republishGeometryFrame(captureSeq);

      // Phase follows the visible SURFACE: a present, unoccluded offer opens
      // selection; an absent surface returns to in-game. Occlusion is transient
      // (a modal over a live offer) — keep the phase and identities.
      if (observation.present && !observation.occluded) {
        if (phaseRef.current !== "augment_selection") {
          ocrSelectionCompletedRef.current = false;
          updatePhase("augment_selection");
        }
      } else if (!observation.present && phaseRef.current === "augment_selection") {
        ocrSelectionCompletedRef.current = true;
        updatePhase("in_game");
      }

      // Tell the OCR track which slots need a (re)read this cycle, keyed to the
      // live geometry fingerprints.
      const decision = decideOcrTrigger<SlotResolution>({
        observation,
        identities: identityStoreRef.current,
        now: performance.now(),
        retryMs: IDENTITY_RETRY_MS,
        forceSlots: forceOcrSlotsRef.current,
      });
      forceOcrSlotsRef.current = [];
      ocrPendingSlotsRef.current = decision.slots;
      if (decision.slots.length > 0) {
        ocrTriggerFingerprintsRef.current = observation.cards.map((card) => card.fingerprint);
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
    } catch (error) {
      if (captureSeq !== geometrySeqRef.current) return;
      if (foregroundEpoch !== foregroundEpochRef.current) return;
      // A geometry probe failure is screen-absence evidence: publish an empty
      // frame so no chip survives, and stand the OCR track down.
      const reason = error instanceof Error ? error.message : "geometry-probe-failed";
      geometryObservationRef.current = emptyGeometryObservation(captureSeq, performance.now(), reason);
      ocrPendingSlotsRef.current = [];
      republishGeometryFrame(captureSeq);
      if (phaseRef.current === "augment_selection") {
        ocrSelectionCompletedRef.current = true;
        updatePhase("in_game");
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
  }, [datasetCaptureOn, recordRoundCompleted, republishGeometryFrame, updatePhase]);

  // ─── TRACK 2: OCR/identity probe — TRIGGERED by the geometry track ───────────
  // Supplies per-slot identity ONLY: never presence, occlusion, or freshness. It
  // reads just the slots geometry flagged (new / reroll / retry / force) and
  // writes each result into the geometry-fingerprint-keyed identity store, so a
  // late result from a superseded generation can never paint the live card.
  const runIdentityProbe = useCallback(async (slots: number[], triggerFingerprints: string[]) => {
    probeInFlightRef.current = true;
    const startedAt = performance.now();
    probeInFlightSinceRef.current = startedAt;
    lastProbeStartedAtRef.current = startedAt;
    const captureSeq = bumpScanSeq();
    probeInFlightTokenRef.current = captureSeq;
    const foregroundEpoch = foregroundEpochRef.current;
    const scanStart = new Date().toISOString();
    setOcrLifecycle((previous) => ({
      ...previous,
      phase: phaseRef.current,
      currentRound: roundDeliveryRef.current?.activeOfferRound ?? null,
      active: true,
      lastScanStart: scanStart,
      lastScanEnd: null,
      scanRunId: captureSeq,
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
      const scan = await invoke<OcrScanResult>("detect_augment_names", {
        knownNames: ocrKnownNames,
      });

      // Stale-result rejection: publish only while this probe's seq is still the
      // newest AND the foreground epoch it captured under is unchanged. A delayed
      // or watchdog-superseded probe can never restore an already-cleared frame.
      if (captureSeq !== scanSeqRef.current) return;
      if (foregroundEpoch !== foregroundEpochRef.current) return;
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
      for (const regionIndex of slots) {
        const raw = rawTitles[regionIndex];
        const readable = raw != null && isPlausibleTitle(normalizeAugmentNameForLookup(raw));
        identityStoreRef.current[regionIndex] = {
          fingerprint: triggerFingerprints[regionIndex] ?? "",
          resolution: readable ? resolveSlotTitle(raw as string) : null,
          resolvedAt,
        };
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
      if (captureSeq !== scanSeqRef.current) return;
      if (foregroundEpoch !== foregroundEpochRef.current) return;
      const unavailable = ocrAvailabilityFromError(error);
      if (unavailable) setOcrAvailability(unavailable);
      // Identity-only failure: mark the triggered slots unresolved (retry after
      // the deadline). Presence/freshness are unaffected — the geometry track
      // keeps publishing, so a readable offer still shows SCANNING chips.
      const failedAt = performance.now();
      for (const regionIndex of slots) {
        identityStoreRef.current[regionIndex] = {
          fingerprint: triggerFingerprints[regionIndex] ?? "",
          resolution: null,
          resolvedAt: failedAt,
        };
      }
      ocrPendingSlotsRef.current = [];
      republishGeometryFrame(geometrySeqRef.current);
      const message = error instanceof Error ? error.message : "ocr-scan-failed";
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
      if (probeInFlightTokenRef.current === captureSeq) {
        const finishedAt = performance.now();
        lastProbeFinishedAtRef.current = finishedAt;
        probeInFlightSinceRef.current = null;
        probeInFlightRef.current = false;
        probeInFlightTokenRef.current = null;
        setOcrLifecycle((previous) => ({
          ...previous,
          active: false,
          lastProbeFinishedAt: finishedAt,
          probeInFlightSince: null,
        }));
      }
    }
  }, [bumpScanSeq, collectorCaptureEnabled, ocrKnownNames, playerData, publishOffer, republishGeometryFrame, resolveSlotTitle, titlePresent]);

  // ─── TRACK 1 scheduler tick: the fast geometry probe ─────────────────────────
  // Same pure reducer (nextProbeAction) as OCR — start / skip / watchdog-restart
  // from live refs ONLY (foreground, active-game, in-flight timing), never
  // telemetry — but on the geometry config and the geometry guards. The restart
  // branch IS the watchdog: a wedged geometry probe is invalidated (seq bumped →
  // late return stale-rejects), its guard reset, and a fresh probe starts.
  const geometryProbeTick = useCallback(() => {
    const action = nextProbeAction(
      {
        foreground: foregroundStateRef.current.gameWindowForeground,
        activeGame: activeGameRef.current,
        inFlight: geometryInFlightRef.current,
        inFlightSince: geometryInFlightSinceRef.current,
        lastProbeStartedAt: lastGeometryStartedAtRef.current,
      },
      GEOMETRY_PROBE_CONFIG,
      performance.now(),
    );
    if (action.kind === "skip") return;
    if (action.kind === "restart") {
      geometrySeqRef.current += 1;
      geometryInFlightRef.current = false;
      geometryInFlightSinceRef.current = null;
      geometryInFlightTokenRef.current = null;
      geometryRestartCountRef.current += 1;
    }
    // Geometry owns presence even when the OS OCR backend is unavailable. The
    // native probe handles screen-capture failures as explicit absence, so OCR
    // capability must never suppress this track.
    void runGeometryProbe();
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
      bumpScanSeq();
      probeInFlightRef.current = false;
      probeInFlightSinceRef.current = null;
      probeInFlightTokenRef.current = null;
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
    void runIdentityProbe(slots, ocrTriggerFingerprintsRef.current);
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

  // Freshness re-evaluation clock: refresh renderClock every ~250 ms so the
  // render gate re-runs geometryFrameFresh() and a positive frame fails closed
  // once its GEOMETRY capture ages past the TTL — even if no new probe publishes.
  // In DEV it also maintains the frame-age diagnostics (compiled out of prod).
  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = performance.now();
      setRenderClock(now);
      if (import.meta.env.DEV) {
        const frame = visibleFrameRef.current;
        const ageMs = frame ? now - frame.capturedAt : null;
        setOcrLifecycle((previous) => ({
          ...previous,
          frameAgeMs: ageMs,
          frameHiddenByTtl:
            frame != null &&
            frame.surfaceValidated &&
            ageMs != null &&
            ageMs > GEOMETRY_FRESHNESS_TTL_MS,
        }));
      }
    }, Math.floor(GEOMETRY_FRESHNESS_TTL_MS / 2));
    return () => clearInterval(intervalId);
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
        activeGameRef.current = false;
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
      activeGameRef.current = gameflowCaptureAllowedRef.current;
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
    return () => {
      bumpScanSeq();
      probeInFlightRef.current = false;
      probeInFlightSinceRef.current = null;
      probeInFlightTokenRef.current = null;
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
                <span
                  className={`badge-tier${
                    chip.tier && chip.tier.length > 1 ? " badge-tier-two-char" : ""
                  }`}
                >
                  {chip.tier}
                </span>
                {chip.winRateText !== null && (
                  <>
                    <span className="badge-chip-sep">·</span>
                    <span className="badge-wr">{chip.winRateText}</span>
                  </>
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
