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
import {
  evaluateSurfacePresence,
  isPlausibleTitle,
} from "./surfacePresence";
import {
  DEFAULT_PROBE_CONFIG,
  FRAME_FRESHNESS_TTL_MS,
  PROBE_INTERVAL_MS,
  nextProbeAction,
} from "./surfaceProbeScheduler";
import {
  buildVisibleFrame,
  emptyVisibleFrame,
  frameResultIsCurrent,
  visibleFrameFresh,
  visibleFrameRenderable,
  type VisibleOfferFrame,
} from "./visibleOfferFrame";
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

  // Publish one probe's visible frame, rejecting stale async results: a frame
  // may publish only while its probe seq is still the newest started.
  const publishScanFrame = useCallback((
    captureSeq: number,
    capturedAt: number,
    applied: OfferState<SlotResolution>,
    freshRects: Array<PhysicalRect | null>,
    surface: { present: boolean; reason: string; confidence: number; plausibleTitles: number },
  ) => {
    if (!frameResultIsCurrent(captureSeq, scanSeqRef.current)) return;
    const frame = buildVisibleFrame<SlotResolution>({
      revision: (visibleRevisionRef.current += 1),
      captureSeq,
      capturedAt,
      offerState: applied,
      freshRects,
      surfaceValidated: surface.present,
    });
    visibleFrameRef.current = frame;
    setVisibleFrame(frame);
    setOcrLifecycle((previous) => ({
      ...previous,
      surfaceValidated: frame.surfaceValidated,
      surfaceReason: surface.reason,
      surfaceConfidence: surface.confidence,
      plausibleTitles: surface.plausibleTitles,
      freshRectCount: frame.slots.filter((slot) => slot.cardRect !== null).length,
      visibleFrameRevision: frame.revision,
      lifecycleDisagreement: applied.latched && !frame.surfaceValidated,
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
    // Freshness TTL: a positive frame renders only while its capture is recent.
    // renderClock forces this to re-run every ~250 ms, so the surface fails
    // closed when the scheduler stops refreshing it (no frozen chips).
    visibleFrameFresh(visibleFrame, renderClock, FRAME_FRESHNESS_TTL_MS);
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
      if (slot.fingerprint === null) {
        // Reroll in flight / unreadable slot — no identity to show yet.
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
    }
    bumpScanSeq();
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

  // ─── The single self-healing surface probe (Stage 1 + Stage 2) ───
  // ONE capture drives BOTH surface presence (title-quality only) and identity
  // resolution (catalog) — never two screenshots. Presence publishes the visible
  // frame (fresh or explicit-empty) EVERY probe, so a vanished surface clears
  // within one 250 ms tick. Identity only fills chip content. The in-flight guard
  // is released in `finally` on every path (success / stale-reject / throw), and
  // a stale result is rejected by probe seq + foreground epoch.
  const runSurfaceProbe = useCallback(async () => {
    probeInFlightRef.current = true;
    const startedAt = performance.now();
    probeInFlightSinceRef.current = startedAt;
    lastProbeStartedAtRef.current = startedAt;
    const captureSeq = bumpScanSeq();
    probeInFlightTokenRef.current = captureSeq;
    const foregroundEpoch = foregroundEpochRef.current;
    const previouslyPresent = visibleFrameRef.current?.surfaceValidated === true;
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
      const capturedAt = performance.now();
      const matchStartMs = performance.now();

      const rawTitles: Array<string | null> = [0, 1, 2].map(
        (regionIndex) =>
          scan.detected.find((entry) => entry.region_index === regionIndex)?.text ?? null,
      );
      // Stage 1 — SURFACE PRESENCE from title-quality alone (no catalog lookup):
      // only plausible titles seed a slot, and ≥2 (new) / ≥1 (already present)
      // decide presence. This is what a future geometry probe would replace.
      const plausibleTitles: Array<string | null> = rawTitles.map((title) =>
        title != null && isPlausibleTitle(normalizeAugmentNameForLookup(title)) ? title : null,
      );
      const plausibleCount = plausibleTitles.filter((title) => title !== null).length;
      const cropsCaptured = scan.diagnostics.filter((entry) => entry.captureSucceeded).length;
      const presence = evaluateSurfacePresence({
        cropsCaptured,
        plausibleTitles: plausibleCount,
        previouslyPresent,
      });
      const freshRects: Array<PhysicalRect | null> = [0, 1, 2].map((regionIndex) => {
        const diagnostic = scan.diagnostics.find((entry) => entry.regionIndex === regionIndex);
        return diagnostic && diagnostic.captureSucceeded && diagnostic.cardRect
          ? diagnostic.cardRect
          : null;
      });
      if (datasetCaptureOn) {
        // DEV-only redacted capture: card-region rects, name-band titles, and
        // the presence verdict only — never identity or full-screen data.
        lastFixtureInputRef.current = {
          capturedAt,
          present: presence.present,
          confidence: presence.confidence,
          cropsCaptured,
          titles: rawTitles,
          cardRects: freshRects,
          rejectionReasons: presence.rejectionReasons,
        };
      }

      // Stage 2 — IDENTITY. The latch keys on plausible-title presence
      // (titlePresent), not a catalog hit; each slot still carries its catalog
      // resolution so chips show tier / win rate / UNMATCHED / NO DATA.
      const applied = applyScanToOffer(
        offerStateRef.current,
        plausibleTitles,
        normalizeAugmentNameForLookup,
        resolveSlotTitle,
        titlePresent,
      );
      if (applied.replacedOffer) {
        // ≥2 slots swapped to new titles in one capture — a queued offer
        // replaced the completed one: strong completion evidence.
        recordRoundCompleted();
      }
      publishOffer(applied.state);
      // Publish the VISIBLE frame from THIS capture: fresh per-slot rects and the
      // Stage-1 presence verdict. Not present → explicit EMPTY frame, so a
      // vanished surface clears immediately (no wait for a poll or two misses).
      publishScanFrame(captureSeq, capturedAt, applied.state, freshRects, {
        present: presence.present,
        reason: presence.present ? "present" : presence.rejectionReasons[0] ?? "absent",
        confidence: presence.confidence,
        plausibleTitles: plausibleCount,
      });
      // Phase follows PRESENCE (the visible surface), never a level threshold or
      // stale telemetry: a present offer opens selection; an absent surface
      // returns to in-game so round bookkeeping can advance.
      if (presence.present && offerActive(applied.state)) {
        if (phaseRef.current !== "augment_selection") {
          ocrSelectionCompletedRef.current = false;
          updatePhase("augment_selection");
        }
      } else if (phaseRef.current === "augment_selection") {
        ocrSelectionCompletedRef.current = true;
        updatePhase("in_game");
      }
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

      // No separate "cleared" path: presence already drove the phase above and
      // publishScanFrame published an explicit-empty frame when absent.
    } catch (error) {
      // A stale or superseded probe (newer seq, or a foreground flip) must not
      // publish — even on error — so it can't resurrect an already-cleared frame.
      if (captureSeq !== scanSeqRef.current) return;
      if (foregroundEpoch !== foregroundEpochRef.current) return;
      const capturedAt = performance.now();
      const unavailable = ocrAvailabilityFromError(error);
      if (unavailable) setOcrAvailability(unavailable);
      // A capture failure is screen-absence evidence: advance the latch's grace
      // and publish an EMPTY frame so no chip survives a failed scan.
      const applied = applyScanToOffer(
        offerStateRef.current,
        [null, null, null],
        normalizeAugmentNameForLookup,
        () => {
          throw new Error("unreachable: empty scan never resolves");
        },
        () => false,
      );
      publishOffer(applied.state);
      publishScanFrame(captureSeq, capturedAt, applied.state, [null, null, null], {
        present: false,
        reason: "scan-error",
        confidence: 0,
        plausibleTitles: 0,
      });
      if (phaseRef.current === "augment_selection") {
        ocrSelectionCompletedRef.current = true;
        updatePhase("in_game");
      }
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
  }, [bumpScanSeq, collectorCaptureEnabled, datasetCaptureOn, ocrKnownNames, playerData, publishOffer, publishScanFrame, recordRoundCompleted, resolveSlotTitle, titlePresent, updatePhase]);

  // ─── Self-healing 250 ms scheduler tick ───
  // A pure reducer (nextProbeAction) decides start / skip / restart from live
  // refs ONLY — foreground, active-game, and in-flight timing. It NEVER reads
  // scanMode / pendingRounds / completedRounds / activeOfferRound / level /
  // death / phase / latch, so no stale telemetry read can stop it. The restart
  // branch IS the watchdog: an in-flight probe that overran the bounded timeout
  // is invalidated (seq bumped → its late return stale-rejects), its guard is
  // reset, and a fresh probe starts — no remount, no focus toggle. The whole
  // thing recovers a wedged scheduler on the next 250 ms tick.
  const surfaceProbeTick = useCallback(() => {
    const action = nextProbeAction(
      {
        foreground: foregroundStateRef.current.gameWindowForeground,
        activeGame: activeGameRef.current,
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
      // Watchdog recovery: drop the wedged probe and re-arm. Clearing the
      // ownership token neutralizes the wedged probe's eventual finally (it no
      // longer owns the guard), so the replacement probe below runs alone.
      bumpScanSeq();
      probeInFlightRef.current = false;
      probeInFlightSinceRef.current = null;
      probeInFlightTokenRef.current = null;
      probeRestartCountRef.current += 1;
      lastProbeFailureReasonRef.current = action.reason;
    }
    // Capability gates (NOT telemetry): capture must be available and the OCR
    // name catalog loaded, else there is nothing to scan. Neither can latch a
    // stale value that permanently stops probing — both re-check every tick.
    if (!canRunOcr(ocrAvailability)) {
      lastProbeSkipReasonRef.current = "ocr-unavailable";
      return;
    }
    if (!nameLookup.size) {
      lastProbeSkipReasonRef.current = "names-not-loaded";
      return;
    }
    lastProbeSkipReasonRef.current = action.kind === "restart" ? "watchdog-restart" : "due";
    void runSurfaceProbe();
  }, [bumpScanSeq, nameLookup, ocrAvailability, runSurfaceProbe]);

  useEffect(() => {
    surfaceProbeTickRef.current = surfaceProbeTick;
  }, [surfaceProbeTick]);

  // The single scan clock: fires every 250 ms for the life of the component and
  // is never cleared by telemetry, phase, or cancellation. It only ever calls
  // the latest tick via the ref, so re-created callbacks never orphan it.
  useEffect(() => {
    const intervalId = setInterval(() => {
      surfaceProbeTickRef.current();
    }, PROBE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  // Freshness re-evaluation clock: refresh renderClock every ~250 ms so the
  // render gate re-runs visibleFrameFresh() and a positive frame fails closed
  // once its capture ages past the TTL — even if no new probe publishes. In DEV
  // it also maintains the frame-age diagnostics (compiled out of production).
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
            ageMs > FRAME_FRESHNESS_TTL_MS,
        }));
      }
    }, Math.floor(FRAME_FRESHNESS_TTL_MS / 2));
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
