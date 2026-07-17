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
  ocrRunIsCurrent,
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
import { developmentSurfaceVisible } from "./dev/productionSurfaces";
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
  CARD_NAME_REGIONS,
  cssRectFromCalibratedRect,
  physicalRectForNormalizedRegion,
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

/**
 * A slot counts as a VALIDATED card identity only when its OCR title reached a
 * known augment (local catalog or staged Riot identity). Noise text read off
 * gameplay or an occluding screen validates nothing, so it can never latch an
 * offer or keep placeholder chips alive (offerLifecycle contract).
 */
function validateSlotResolution(resolution: SlotResolution): boolean {
  return (
    resolution.pool !== null ||
    (resolution.aramgg !== null && resolution.aramgg.kind !== "unmatched")
  );
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
  const [, setOcrActive] = useState(false);
  const phaseRef = useRef<Phase>("idle");
  // Rounds completed on STRONG evidence only (confirmed pick / queued-offer
  // replacement) — can only undercount, which keeps probing alive and never
  // suppresses a real offer. See roundDelivery.ts.
  const completedRoundsRef = useRef(0);
  const roundDeliveryRef = useRef<RoundDeliveryDecision | null>(null);
  const [roundDelivery, setRoundDelivery] = useState<RoundDeliveryDecision | null>(null);
  const ocrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ocrActiveRef = useRef(false);
  const ocrRunIdRef = useRef(0);
  const ocrSelectionCompletedRef = useRef(false);
  const gameflowCaptureAllowedRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const pollPendingRef = useRef(false);
  const pollRef = useRef<() => Promise<void>>(async () => {});
  const foregroundPollInFlightRef = useRef(false);
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
  const runOcrRef = useRef<(runId: number) => Promise<void>>(async () => {});
  const lastGameTimeRef = useRef<number | null>(null);
  const lastRecordedRoundRef = useRef("");
  const [collectorStatus, setCollectorStatus] = useState<CollectorSnapshot | null>(null);
  const [memberSnapshot, setMemberSnapshot] = useState<MemberSnapshot | null>(null);
  const [mode, setMode] = useState<DecisionMode>("competitive");
  const [coachOpen, setCoachOpen] = useState(false);
  // Dev debug panel (tier-fixture / preview only): pin keeps it visible when
  // League loses focus; it starts collapsed so it cannot obscure a badge.
  const [debugPinned, setDebugPinned] = useState(false);
  const [debugCollapsed, setDebugCollapsed] = useState(true);
  const activeGameHashRef = useRef<string | null>(null);
  const memberBootstrapCompleteRef = useRef(false);
  const gameWindowForeground = foregroundState.gameWindowForeground;
  const devDiagnosticsEnabled = developmentSurfaceVisible(import.meta.env.DEV);
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

  // Real per-slot chips: strictly gated on REAL focus + augment phase + a
  // LATCHED offer whose validated surface is CURRENTLY on screen. Each slot
  // renders its own pipeline state (matched tier / SCANNING / UNMATCHED /
  // NO ARAMGG DATA) — never stale, never invented, and always from one offer
  // generation. A latched offer whose surface is absent or occluded
  // (scoreboard, death recap, tooltip) is internal state, never pixels.
  // Preview chips: only in preview mode.
  const realBadgesReady =
    !isPreviewMode &&
    effectiveMemberEnabled &&
    phase === "augment_selection" &&
    offerActive(offerState) &&
    offerState.surfaceVisible &&
    gameWindowForeground;
  const previewBadgesReady =
    isPreviewMode && fixturePayload != null && previewCards.length === 3;
  const showBadgeLayer = realBadgesReady || previewBadgesReady;

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
    if (!realBadgesReady) return [];
    return offerState.slots.map((slot): SlotChip => {
      const base = {
        regionIndex: slot.regionIndex,
        key: `slot-${slot.regionIndex}-g${offerState.generation}`,
      };
      if (slot.fingerprint === null) {
        // Reroll in flight / unreadable slot — no identity to show yet.
        return { ...base, state: "scanning", tier: null, winRateText: null, isNew: false };
      }
      const staged = slot.resolution?.aramgg;
      if (staged) {
        if (staged.kind === "matched") {
          return {
            ...base,
            state: "tier",
            tier: staged.stat.tierLetter,
            // Exact string pipeline from the raw ARAMGG fraction ("0.5915" →
            // "59.2%"); the raw value stays on the stat for diagnostics.
            winRateText: compactWinRateFromFraction(staged.stat.rawWinRate),
            isNew: slot.resolution?.pool?.lifecycle === "added",
          };
        }
        if (staged.kind === "no-data") {
          // Riot identity resolved, but ARAMGG carries no stat record.
          return { ...base, state: "no-data", tier: null, winRateText: null, isNew: false };
        }
        return { ...base, state: "unmatched", tier: null, winRateText: null, isNew: false };
      }
      // Engine path (no dev fixture): the local-catalog match backs the chip.
      const pool = slot.resolution?.pool ?? null;
      if (!pool) {
        return { ...base, state: "unmatched", tier: null, winRateText: null, isNew: false };
      }
      const candidate = decisionResult?.candidates.find(
        (entry) => entry.augmentSlug === pool.slug,
      );
      return {
        ...base,
        state: "tier",
        tier: candidate ? tierForGrade(candidate.grade) : pool.tier,
        winRateText: compactWinRateFromPercent(pool.win_rate),
        isNew: pool.lifecycle === "added",
      };
    });
  }, [previewBadgesReady, fixturePayload, previewCards, realBadgesReady, offerState, decisionResult]);

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
    renderedRealBadges: realBadgesReady
      ? slotChips.filter((chip) => chip.state === "tier").length
      : 0,
    renderedPreviewBadges: previewBadgesReady ? slotChips.length : 0,
  };

  const cancelOcrRun = useCallback((clearVisibleState: boolean) => {
    ocrActiveRef.current = false;
    ocrRunIdRef.current += 1;
    if (ocrTimeoutRef.current) {
      clearTimeout(ocrTimeoutRef.current);
      ocrTimeoutRef.current = null;
    }
    setOcrActive(false);
    setOcrLifecycle((previous) => ({
      ...previous,
      phase: phaseRef.current,
      currentRound: roundDeliveryRef.current?.activeOfferRound ?? null,
      active: false,
      scanRunId: null,
      captureAttempted: false,
      cropCount: 0,
      noCropReason: "ocr-run-cancelled",
    }));
    if (clearVisibleState) {
      resetOffer();
      setOcrDiagnostics([]);
    }
  }, [resetOffer]);

  const stopOcr = useCallback(() => {
    cancelOcrRun(true);
  }, [cancelOcrRun]);

  const finishOcr = useCallback(() => {
    cancelOcrRun(false);
  }, [cancelOcrRun]);

  const refreshForeground = useCallback(async (): Promise<ForegroundState | null> => {
    if (foregroundPollInFlightRef.current) return null;
    foregroundPollInFlightRef.current = true;
    try {
      const nextForeground = await invoke<ForegroundState>("get_foreground_state")
        .catch(() => unknownForegroundState());
      const previousForeground = foregroundStateRef.current;
      foregroundStateRef.current = nextForeground;
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
      if (!nextForeground.gameWindowForeground && (
        previousForeground.gameWindowForeground || ocrActiveRef.current
      )) {
        stopOcr();
      }
      return nextForeground;
    } finally {
      foregroundPollInFlightRef.current = false;
    }
  }, [stopOcr]);

  const clearGameOnlyState = useCallback((nextPhase: Phase) => {
    ocrSelectionCompletedRef.current = true;
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

  // Per-slot identity resolution, shared by the fast OCR loop and the ambient
  // probe so both apply identical latch/validation semantics.
  const resolveSlotTitle = useCallback((title: string): SlotResolution => {
    const match = diagnoseAugmentMatch(title, nameLookup);
    return {
      pool: match.augment,
      poolDiagnostic: match,
      aramgg: aramggResolveRef.current ? aramggResolveRef.current(title) : null,
    };
  }, [nameLookup]);

  // OCR detection
  const runOcr = useCallback(async (runId: number) => {
    if (!ocrRunIsCurrent({
      active: ocrActiveRef.current,
      currentRunId: ocrRunIdRef.current,
      runId,
    })) return;

    const scanStart = new Date().toISOString();
    setOcrLifecycle((previous) => ({
      ...previous,
      phase: phaseRef.current,
      currentRound: roundDeliveryRef.current?.activeOfferRound ?? null,
      active: true,
      lastScanStart: scanStart,
      lastScanEnd: null,
      scanRunId: runId,
      captureAttempted: false,
      cropCount: 0,
      noCropReason: nameLookup.size ? "capture-pending" : "name-lookup-not-ready",
    }));

    if (!nameLookup.size) {
      setOcrLifecycle((previous) => ({
        ...previous,
        lastScanEnd: new Date().toISOString(),
        captureAttempted: false,
        cropCount: 0,
        noCropReason: "name-lookup-not-ready",
      }));
      return;
    }

    const scanStartMs = performance.now();
    try {
      const scan = await invoke<OcrScanResult>("detect_augment_names", {
        knownNames: ocrKnownNames,
      });

      // Stale-run guard: a cancelled or superseded scan can never publish —
      // a stale OCR result cannot restore an old offer.
      if (
        !ocrRunIsCurrent({
          active: ocrActiveRef.current,
          currentRunId: ocrRunIdRef.current,
          runId,
        })
      ) return;

      const matchStartMs = performance.now();
      const titles: Array<string | null> = [0, 1, 2].map(
        (regionIndex) =>
          scan.detected.find((entry) => entry.region_index === regionIndex)?.text ?? null,
      );
      const applied = applyScanToOffer(
        offerStateRef.current,
        titles,
        normalizeAugmentNameForLookup,
        resolveSlotTitle,
        validateSlotResolution,
      );
      if (applied.replacedOffer) {
        // A queued offer replaced the completed one mid-death-sequence —
        // strong completion evidence for the previous round.
        recordRoundCompleted();
      }
      publishOffer(applied.state);
      if (offerActive(applied.state) && phaseRef.current !== "augment_selection") {
        // A validated card surface latching is what enters augment selection —
        // never a level threshold, and never blocked by stale telemetry.
        ocrSelectionCompletedRef.current = false;
        updatePhase("augment_selection");
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

      if (applied.cleared) {
        // The selection surface has been absent long enough — the offer is over.
        ocrSelectionCompletedRef.current = true;
        updatePhase("in_game");
        finishOcr();
      }
    } catch (error) {
      if (
        ocrRunIsCurrent({
          active: ocrActiveRef.current,
          currentRunId: ocrRunIdRef.current,
          runId,
        })
      ) {
        const unavailable = ocrAvailabilityFromError(error);
        if (unavailable) setOcrAvailability(unavailable);
        // A failed scan is screen-absence EVIDENCE, not an instant clear: the
        // lifecycle tolerates one gap, then clears on sustained absence.
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
        if (applied.cleared) {
          ocrSelectionCompletedRef.current = true;
          updatePhase("in_game");
          finishOcr();
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
        setOcrLifecycle((previous) => ({
          ...previous,
          lastScanEnd: new Date().toISOString(),
          captureAttempted: false,
          cropCount: 0,
          noCropReason: message,
        }));
      }
    }
  }, [collectorCaptureEnabled, nameLookup, ocrKnownNames, playerData, publishOffer, recordRoundCompleted, resolveSlotTitle, finishOcr, updatePhase]);

  useEffect(() => {
    runOcrRef.current = runOcr;
  }, [runOcr]);

  const scheduleNextOcr = useCallback(function scheduleNextOcr(runId: number) {
    ocrTimeoutRef.current = setTimeout(async () => {
      await runOcrRef.current(runId);
      if (
        ocrRunIsCurrent({
          active: ocrActiveRef.current,
          currentRunId: ocrRunIdRef.current,
          runId,
        })
      ) {
        scheduleNextOcr(runId);
      }
    }, 20);
  }, []);

  // Start/stop OCR polling
  const startOcr = useCallback(() => {
    if (!gameflowCaptureAllowedRef.current) return;
    if (!canRunOcr(ocrAvailability)) return;
    if (ocrActiveRef.current) return;
    ocrActiveRef.current = true;
    setOcrActive(true);
    const runId = ++ocrRunIdRef.current;
    setOcrLifecycle((previous) => ({
      ...previous,
      phase: phaseRef.current,
      currentRound: roundDeliveryRef.current?.activeOfferRound ?? null,
      active: true,
      scanRunId: runId,
      captureAttempted: false,
      cropCount: 0,
      noCropReason: "scan-scheduled",
    }));
    scheduleNextOcr(runId);
  }, [ocrAvailability, scheduleNextOcr]);

  // Ambient probe: ONE scan per poll tick while rounds are pending but no
  // offer is latched and no death window is open. Telemetry must never block
  // scanning a clearly visible surface — this latches a real offer even when
  // death/level telemetry is briefly stale, without the 20ms fast loop burning
  // capture during normal gameplay. On latch it escalates to the fast loop.
  const ambientProbeInFlightRef = useRef(false);
  const runAmbientProbe = useCallback(async () => {
    if (ocrActiveRef.current || ambientProbeInFlightRef.current) return;
    if (!gameflowCaptureAllowedRef.current) return;
    if (!canRunOcr(ocrAvailability)) return;
    if (!nameLookup.size) return;
    ambientProbeInFlightRef.current = true;
    try {
      const scan = await invoke<OcrScanResult>("detect_augment_names", {
        knownNames: ocrKnownNames,
      });
      // The fast loop owns publishing once it starts — drop a probe that lost
      // the race so a stale result can never overwrite live scans.
      if (ocrActiveRef.current) return;
      const titles: Array<string | null> = [0, 1, 2].map(
        (regionIndex) =>
          scan.detected.find((entry) => entry.region_index === regionIndex)?.text ?? null,
      );
      const applied = applyScanToOffer(
        offerStateRef.current,
        titles,
        normalizeAugmentNameForLookup,
        resolveSlotTitle,
        validateSlotResolution,
      );
      if (applied.replacedOffer) recordRoundCompleted();
      publishOffer(applied.state);
      if (offerActive(applied.state)) {
        // A real surface latched from the probe: enter selection and escalate
        // to the fast loop for reroll/occlusion tracking.
        ocrSelectionCompletedRef.current = false;
        updatePhase("augment_selection");
        startOcr();
      }
    } catch {
      // Probe failures are silent — the fast loop owns diagnostics/absence.
    } finally {
      ambientProbeInFlightRef.current = false;
    }
  }, [nameLookup, ocrAvailability, ocrKnownNames, publishOffer, recordRoundCompleted, resolveSlotTitle, startOcr, updatePhase]);

  // Main polling loop
  const poll = useCallback(async () => {
    if (pollInFlightRef.current) {
      pollPendingRef.current = true;
      return;
    }
    pollInFlightRef.current = true;

    try {
      if (!collectorEnabled) {
        stopOcr();
        updatePhase("idle");
        return;
      }

      const nextForeground = await refreshForeground();
      const actualGameForeground = nextForeground?.gameWindowForeground === true;

      const gameflow = await invoke<LcuGameflowState | null>("get_lcu_gameflow_state")
        .catch(() => null);
      gameflowCaptureAllowedRef.current = shouldRunOcrForGameflow(gameflow);
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

          if (phaseRef.current === "augment_selection") {
            if (ocrSelectionCompletedRef.current) {
              updatePhase("in_game");
              finishOcr();
              return;
            }
            // Level gained while the offer is still open must NOT end the
            // selection — completion comes only from the offer lifecycle
            // (surface absence / confirmed pick), never from champion level.
            if (actualGameForeground) startOcr();
          } else if (decision.scanMode === "fast") {
            // Death sequence with rounds pending: the delivery window is open
            // RIGHT NOW. Run the fast loop so the offer latches immediately;
            // the phase flips to augment_selection only when a validated
            // surface actually latches (inside the scan).
            updatePhase("in_game");
            if (actualGameForeground) startOcr();
          } else {
            // ambient/off: no offer and no delivery window. Stop any leftover
            // fast loop WITHOUT clearing state, and (ambient) run one probe
            // this tick so a real surface still latches on stale telemetry.
            if (ocrActiveRef.current) finishOcr();
            updatePhase("in_game");
            if (decision.scanMode === "ambient" && actualGameForeground) {
              void runAmbientProbe();
            }
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
    runAmbientProbe,
    startOcr,
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

  // Cleanup OCR on unmount
  useEffect(() => {
    return () => {
      ocrActiveRef.current = false;
      ocrRunIdRef.current += 1;
      if (ocrTimeoutRef.current) clearTimeout(ocrTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const onResize = () =>
      setCssWindow({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ─── Render ───
  const badgePositions = useMemo(() => {
    const positions = new Map<number, { left: string; top: string }>();
    if (!calibration) return positions;

    const detectedRects = new Map(
      ocrDiagnostics
        .filter((diagnostic) => diagnostic.cardRect !== null)
        .map((diagnostic) => [diagnostic.regionIndex, diagnostic.cardRect!]),
    );
    // Every region resolves to a rect: the natively detected one when the last
    // scan supplied it, else the calibrated normalized region — so SCANNING /
    // reroll slots still anchor their chip to the right card position.
    const regionRects = new Map<number, PhysicalRect>();
    CARD_NAME_REGIONS.forEach((region, regionIndex) => {
      const detected = detectedRects.get(regionIndex);
      regionRects.set(
        regionIndex,
        detected ?? physicalRectForNormalizedRegion(region, calibration.viewport),
      );
    });

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
  }, [calibration, cssWindow, ocrDiagnostics, slotChips]);

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
      {devDiagnosticsEnabled && (
        <DevOverlayDiagnostics
          gameOverlayIsVisible={gameOverlayIsVisible}
          fixtureModeKind={fixtureMode.kind}
          tierFixtureOn={tierFixtureOn}
          geometryPreviewOn={geometryPreviewOn}
          isPreviewMode={isPreviewMode}
          debugPinned={debugPinned}
          debugCollapsed={debugCollapsed}
          setDebugPinned={setDebugPinned}
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
