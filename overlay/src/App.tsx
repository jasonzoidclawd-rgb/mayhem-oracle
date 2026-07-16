import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildChampionPool,
} from "./scoring";
import {
  buildOverlayAugmentLookup,
  diagnoseAugmentMatch,
  matchAugmentName,
} from "./scoring/offer-lookup";
import {
  advanceOcrSelection,
  isCompleteThreeCardOffer,
  matchAugmentFrame,
  ocrRunIsCurrent,
  shouldClearOcrStateForGameflow,
  shouldEndAugmentSelectionForLevel,
  shouldRunOcrForGameflow,
} from "./augmentSelection";
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
import { formatWinRate, tierClassName, tierForGrade } from "./model/tier";
import {
  buildAramggDecisionResult,
  isTierFixtureEnabled,
  TIER_FIXTURE_MEMBER,
  type AramggFixtureCard,
} from "./dev/tierFixture";
import { useAramggTierFixture } from "./dev/useAramggTierFixture";
import { isGeometryPreviewEnabled, resolveOverlayFixtureMode } from "./dev/fixtureMode";
import {
  gameOverlayVisible,
  unknownForegroundState,
  type ForegroundState,
} from "./overlayVisibility";
import {
  canRunOcr,
  createOcrAvailability,
  ocrAvailabilityFromError,
  userFacingOcrStatus,
  type OcrAvailability,
} from "./ocrAvailability";
import {
  BADGE_ANCHORS,
  cssPointFromNormalizedAnchor,
  type OverlayCalibration,
} from "./calibration";
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
}

interface OcrCardDiagnostic extends NativeOcrCardDiagnostic {
  normalizedText: string;
  bestCandidate: string | null;
  confidence: number | null;
  rejectionReason: string | null;
}

interface MatchedCard {
  augment: PoolAugment;
  regionIndex: number;
  ocrText: string;
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

const AUGMENT_LEVELS = [3, 7, 11, 15];

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
  const [matchedCards, setMatchedCards] = useState<MatchedCard[]>([]);
  const [, setOcrActive] = useState(false);
  const phaseRef = useRef<Phase>("idle");
  const lastAugmentLevelRef = useRef(0);
  const ocrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ocrActiveRef = useRef(false);
  const ocrRunIdRef = useRef(0);
  const ocrHasSeenCardsRef = useRef(false);
  const ocrEmptyPassesRef = useRef(0);
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
  const [ocrDiagnostics, setOcrDiagnostics] = useState<OcrCardDiagnostic[]>([]);
  const [overlayData, setOverlayData] = useState<OverlayData | null>(null);
  const [abilityProfiles, setAbilityProfiles] = useState<Record<string, AbilityProfile | null>>({});
  const [dataError, setDataError] = useState<string | null>(null);
  const [ocrAvailability, setOcrAvailability] = useState<OcrAvailability>(
    createOcrAvailability(true),
  );
  const [calibration, setCalibration] = useState<OverlayCalibration | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const runOcrRef = useRef<(runId: number) => Promise<void>>(async () => {});
  const lastGameTimeRef = useRef<number | null>(null);
  const lastRecordedRoundRef = useRef("");
  const [collectorStatus, setCollectorStatus] = useState<CollectorSnapshot | null>(null);
  const [memberSnapshot, setMemberSnapshot] = useState<MemberSnapshot | null>(null);
  const [mode, setMode] = useState<DecisionMode>("competitive");
  const [coachOpen, setCoachOpen] = useState(false);
  // Dev debug panel (tier-fixture / preview only): pin keeps it visible when
  // League loses focus; collapse shrinks it so it never obscures a card.
  const [debugPinned, setDebugPinned] = useState(false);
  const [debugCollapsed, setDebugCollapsed] = useState(false);
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
  }, []);

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

  // Current round
  const currentRound = (() => {
    if (!playerData) return null;
    const level = playerData.level;
    for (let i = AUGMENT_LEVELS.length - 1; i >= 0; i--) {
      if (level >= AUGMENT_LEVELS[i]) {
        return { round: i + 1, level: AUGMENT_LEVELS[i] };
      }
    }
    return null;
  })();

  const decisionResult = useMemo((): DecisionResult | null => {
    if (
      !memberEnabled ||
      !memberSnapshot?.modelConfig ||
      !decisionData ||
      !currentRound ||
      !isCompleteThreeCardOffer(matchedCards)
    ) {
      return null;
    }
    const screenRarity = matchedCards[0].augment.rarity;
    return runLocalInference(
      {
        championSlug: decisionData.champion.slug,
        round: currentRound.round as 1 | 2 | 3 | 4,
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
    currentRound,
    decisionData,
    matchedCards,
    memberEnabled,
    memberSnapshot,
    mode,
    pickedAugments,
  ]);

  // ─── Dev ARAMGG fixture / geometry preview (dev flags only) ───
  // TIER_FIXTURE: canonical ARAMGG stats over REAL OCR-detected cards — never
  // injects geometry, never forces focus/phase, so it can never mask real OCR.
  // GEOMETRY_PREVIEW: synthetic cards, ONLY when League is absent, watermarked.
  const aramgg = useAramggTierFixture(
    tierFixtureOn || geometryPreviewOn,
    overlayData?.augments,
  );

  const fixtureMode = resolveOverlayFixtureMode({
    tierFixtureOn,
    previewOn: geometryPreviewOn,
    gameWindowForeground,
    phase,
    completeOffer: isCompleteThreeCardOffer(matchedCards),
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

  // Cards the fixture renders over: REAL matched cards for a real offer, or the
  // synthetic preview cards. Nothing is injected into the real-offer path.
  const fixtureCards = fixtureMode.kind === "preview" ? previewCards : matchedCards;
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
    if (fixtureMode.kind !== "real-offer" && fixtureMode.kind !== "preview") {
      return null;
    }
    const round = currentRound?.round ?? 1;
    const cards = [...fixtureCards]
      .sort((left, right) => left.regionIndex - right.regionIndex)
      .map((card): AramggFixtureCard | null => aramgg.resolvedBySlug.get(card.augment.slug) ?? null)
      .filter((card): card is AramggFixtureCard => card !== null);
    if (cards.length === 0) return null;
    return buildAramggDecisionResult(cards, round as 1 | 2 | 3 | 4);
  }, [fixtureMode.kind, fixtureCards, aramgg.resolvedBySlug, currentRound]);

  // Dev flag unlocks the member gate ONLY (no collector/entitlement) — it never
  // relaxes the focus/phase/complete-offer gates below.
  const effectiveMemberEnabled = tierFixtureOn ? effectiveMember?.enabled === true : memberEnabled;
  const isFixtureBacked = fixturePayload != null; // ARAMGG-backed → no fake P:50%

  const badgeDecisionResult = fixturePayload?.result ?? decisionResult;
  const badgeWinRateBySlug: Record<string, number | string | null> =
    fixturePayload?.winRateDisplayBySlug ?? winRateBySlug;

  // Real ARAMGG/engine badges: strictly gated on REAL focus + augment phase +
  // a confidently-matched complete offer. Preview badges: only in preview mode.
  const realBadgesReady =
    !isPreviewMode &&
    effectiveMemberEnabled &&
    phase === "augment_selection" &&
    isCompleteThreeCardOffer(matchedCards) &&
    gameWindowForeground &&
    badgeDecisionResult != null;
  const previewBadgesReady =
    isPreviewMode && fixturePayload != null && previewCards.length === 3;
  const showBadgeLayer = realBadgesReady || previewBadgesReady;

  // Diagnostics counters (never conflate injected with detected).
  const diag = {
    ocrDetected: matchedCards.length,
    previewInjected: isPreviewMode ? previewCards.length : 0,
    offeredMatched: matchedCards.filter((c) => aramgg.resolvedBySlug.has(c.augment.slug)).length,
    catalogResolved: aramgg.resolvedBySlug.size,
    renderedRealBadges: realBadgesReady ? matchedCards.length : 0,
    renderedPreviewBadges: previewBadgesReady ? previewCards.length : 0,
  };

  const stopOcr = useCallback(() => {
    ocrActiveRef.current = false;
    ocrRunIdRef.current += 1;
    ocrHasSeenCardsRef.current = false;
    ocrEmptyPassesRef.current = 0;
    if (ocrTimeoutRef.current) {
      clearTimeout(ocrTimeoutRef.current);
      ocrTimeoutRef.current = null;
    }
    setOcrActive(false);
    setMatchedCards([]);
    setOcrDiagnostics([]);
  }, []);

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
        "riotClientForeground",
        "gameRunning",
        "gameWindowDetected",
        "foregroundAppName",
        "foregroundBundleIdentifier",
        "foregroundOwnerName",
        "foregroundWindowTitle",
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
    lastAugmentLevelRef.current = 0;
    setPickedAugments([]);
    setMatchedCards([]);
    lastGameTimeRef.current = null;
    lastRecordedRoundRef.current = "";
    activeGameHashRef.current = null;
    setCoachOpen(false);
    stopOcr();
    updatePhase(nextPhase);
  }, [stopOcr, updatePhase]);

  // OCR detection
  const runOcr = useCallback(async (runId: number) => {
    if (
      !nameLookup.size ||
      !ocrRunIsCurrent({
        active: ocrActiveRef.current,
        currentRunId: ocrRunIdRef.current,
        runId,
      })
    ) return;

    try {
      const scan = await invoke<OcrScanResult>("detect_augment_names", {
        knownNames: ocrKnownNames,
      });

      if (
        !ocrRunIsCurrent({
          active: ocrActiveRef.current,
          currentRunId: ocrRunIdRef.current,
          runId,
        })
      ) return;

      const detected = scan.detected;
      setOcrDiagnostics(
        scan.diagnostics.map((diagnostic) => {
          if (!diagnostic.rawText) {
            return {
              ...diagnostic,
              normalizedText: "",
              bestCandidate: null,
              confidence: null,
              rejectionReason: diagnostic.error ?? "no-text-recognized",
            };
          }

          const match = diagnoseAugmentMatch(diagnostic.rawText, nameLookup);
          return {
            ...diagnostic,
            normalizedText: match.normalizedText,
            bestCandidate: match.bestCandidate,
            confidence: match.confidence,
            rejectionReason: match.rejectionReason,
          };
        }),
      );

      const matched: MatchedCard[] = matchAugmentFrame(
        detected,
        nameLookup,
        matchAugmentName,
      );

      const nextSelection = advanceOcrSelection(
        {
          hasSeenCards: ocrHasSeenCardsRef.current,
          emptyPasses: ocrEmptyPassesRef.current,
        },
        detected.length,
      );
      ocrHasSeenCardsRef.current = nextSelection.hasSeenCards;
      ocrEmptyPassesRef.current = nextSelection.emptyPasses;
      setMatchedCards(matched);
      if (
        collectorCaptureEnabled &&
        isCompleteThreeCardOffer(matched) &&
        playerData
      ) {
        const round = AUGMENT_LEVELS.reduce(
          (current, level, index) => (playerData.level >= level ? index + 1 : current),
          0,
        );
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

      if (nextSelection.shouldStop) {
        ocrSelectionCompletedRef.current = true;
        updatePhase("in_game");
        stopOcr();
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
        setMatchedCards([]);
        const message = error instanceof Error ? error.message : "ocr-scan-failed";
        setOcrDiagnostics(
          [0, 1, 2].map((regionIndex) => ({
            regionIndex,
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
          })),
        );
      }
    }
  }, [collectorCaptureEnabled, nameLookup, ocrKnownNames, playerData, stopOcr, updatePhase]);

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
    ocrHasSeenCardsRef.current = false;
    ocrEmptyPassesRef.current = 0;
    setOcrActive(true);
    scheduleNextOcr(++ocrRunIdRef.current);
  }, [ocrAvailability, scheduleNextOcr]);

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
            lastAugmentLevelRef.current = 0;
            setPickedAugments([]);
            setMatchedCards([]);
            lastRecordedRoundRef.current = "";
            stopOcr();
          }
          lastGameTimeRef.current = data.game_time;
          setPlayerData(data);
          const slug = champNameToSlug(data.champion);
          if (slug !== championSlug) {
            ocrSelectionCompletedRef.current = true;
            setChampionSlug(slug);
            lastAugmentLevelRef.current = 0;
            setPickedAugments([]);
            stopOcr();
          }

          const augmentLevel = [...AUGMENT_LEVELS]
            .reverse()
            .find((threshold) =>
              data.level >= threshold && threshold > lastAugmentLevelRef.current
            );

          const shouldShowSelection = augmentLevel !== undefined;

          if (shouldShowSelection) {
            ocrSelectionCompletedRef.current = false;
            lastAugmentLevelRef.current = augmentLevel;
            updatePhase("augment_selection");
            if (actualGameForeground) startOcr();
          } else if (phaseRef.current === "augment_selection") {
            if (ocrSelectionCompletedRef.current) {
              updatePhase("in_game");
              stopOcr();
              return;
            }

            const doneSelecting = shouldEndAugmentSelectionForLevel({
              playerLevel: data.level,
              lastAugmentLevel: lastAugmentLevelRef.current,
            });
            if (doneSelecting) {
              ocrSelectionCompletedRef.current = true;
              updatePhase("in_game");
              stopOcr();
            } else if (actualGameForeground) {
              startOcr();
            }
          } else {
            updatePhase("in_game");
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
    refreshForeground,
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
      if (selectedAugmentSlug && currentRound) {
        void invoke("confirm_contributor_round_selection", {
          round: currentRound.round,
          selectedAugmentSlug,
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentRound, matchedCards, memberEnabled, phase]);

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

  // ─── Render ───
  const ocrStatusMessage = userFacingOcrStatus(ocrAvailability);
  const badgePositions = useMemo(() => {
    if (!calibration) {
      return BADGE_ANCHORS.map((anchor) => ({
        left: `${anchor.x * 100}%`,
        top: `${anchor.y * 100}%`,
      }));
    }

    return BADGE_ANCHORS.map((anchor) =>
      cssPointFromNormalizedAnchor(
        anchor,
        calibration.viewport,
        calibration.monitor.scaleFactor,
      ),
    );
  }, [calibration]);

  return (
    <div className="overlay-root">
      {gameOverlayIsVisible && (calibration || calibrationError) && (
        <div className="calibration-panel">
          <div className="calibration-title">Calibration</div>
          {calibration ? (
            <>
              <div>Mode: {calibration.mode}</div>
              <div>
                Monitor: {calibration.monitor.x},{calibration.monitor.y}{" "}
                {calibration.monitor.width}x{calibration.monitor.height}
              </div>
              <div>
                League: {calibration.gameWindow
                  ? `${calibration.gameWindow.x},${calibration.gameWindow.y} ${calibration.gameWindow.width}x${calibration.gameWindow.height}`
                  : "not detected"}
              </div>
              <div>Scale: {calibration.monitor.scaleFactor.toFixed(2)}</div>
              <div>
                Viewport: {calibration.viewport.x},{calibration.viewport.y}{" "}
                {calibration.viewport.width}x{calibration.viewport.height}
              </div>
              {calibration.warnings.map((warning) => (
                <div className="calibration-warning" key={warning}>{warning}</div>
              ))}
            </>
          ) : (
            <div className="calibration-warning">{calibrationError}</div>
          )}
        </div>
      )}

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

      {/* Badges overlaid on augment cards. Rendered ONLY for a real focused
          complete offer (realBadgesReady) or explicit League-absent preview
          (previewBadgesReady) — never during a transient OCR gap, never while
          League is unfocused, never over a stale offer. See fixtureMode.ts. */}
      {showBadgeLayer && badgeDecisionResult && (
        <>
          {fixtureCards.map((card) => {
            const pos = badgePositions[card.regionIndex];
            if (!pos) return null;
            const candidate = badgeDecisionResult.candidates.find(
              (entry) => entry.augmentSlug === card.augment.slug,
            );
            if (!candidate) return null;
            const tier = tierForGrade(candidate.grade);
            // ARAMGG/preview badges display the exact win-rate string; the real
            // engine path uses the numeric augment win_rate.
            const winRate = isFixtureBacked
              ? badgeWinRateBySlug[card.augment.slug]
              : card.augment.win_rate;
            return (
              <div
                className={`badge badge-grade-${candidate.grade} ${tierClassName(tier)}${
                  isPreviewMode ? " badge-preview" : ""
                }`}
                key={card.augment.slug}
                style={{ left: pos.left, top: pos.top }}
              >
                {isPreviewMode && (
                  <span className="preview-watermark">PREVIEW</span>
                )}
                {card.augment.lifecycle === "added" && (
                  <span className="badge-new">NEW</span>
                )}
                <span className="badge-label">{mode}</span>
                <span className="badge-tier">{tier}</span>
                <span className="badge-wr">
                  {formatWinRate(winRate, { raw: isFixtureBacked })}
                </span>
                {/* No fake model probability for ARAMGG/preview badges; only the
                    real engine supplies a pick probability. */}
                {!isFixtureBacked && (
                  <span className="badge-prob">
                    P:{Math.round(candidate.probability.withNormalRerolls * 100)}%
                  </span>
                )}
                {candidate.warnings.includes("hard-incompatible") && (
                  <strong className="badge-warning">Hard warning</strong>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* OCR diagnostic (dev fixture): League focused on an augment screen but
          not three confident cards — show a diagnostic, never synthetic badges. */}
      {gameOverlayIsVisible && fixtureMode.kind === "ocr-unavailable" && (
        <div className="ocr-diagnostic">
          OCR unavailable — {diag.ocrDetected}/3 cards matched
          {aramgg.status !== "ready" && ` · ARAMGG ${aramgg.status}`}
        </div>
      )}

      {/* Minimal HUD when in-game but not selecting */}
      {memberEnabled && phase === "in_game" && championSlug && gameOverlayIsVisible && (
        <div className="hud">
          <span className="champion-tag">
            {playerData?.champion ?? championSlug}
          </span>
          <span className="hud-level">
            Lv.{playerData?.level ?? "?"}
            {currentRound && ` · R${currentRound.round}`}
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
      {collectorEnabled && gameOverlayIsVisible && ocrStatusMessage && (
        <div className="idle-panel">{ocrStatusMessage}</div>
      )}
      {collectorEnabled && gameOverlayIsVisible && effectiveMember?.error && (
        <div className="member-error">Member coach unavailable: {effectiveMember.error}</div>
      )}
      {/* Dev debug panel. Hidden on League focus-loss unless explicitly pinned
          (fix #4); collapsible/movable and bottom-right so it never obscures the
          left recommendation (fix #10). */}
      {(tierFixtureOn || geometryPreviewOn) && (gameOverlayIsVisible || debugPinned) && (
        <div
          className="aramgg-debug-panel"
          style={{
            position: "fixed",
            bottom: 8,
            right: 8,
            maxWidth: 520,
            padding: "8px 10px",
            font: "11px/1.4 ui-monospace, monospace",
            color: "#e5e7eb",
            background: "rgba(17,24,39,0.92)",
            border: "1px solid #f59e0b",
            borderRadius: 6,
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          <div style={{ color: "#fbbf24", fontWeight: 700 }}>
            ARAMGG {isPreviewMode ? "PREVIEW" : "TIER FIXTURE"} (dev) ·{" "}
            {aramgg.status === "ready"
              ? aramgg.fromCache
                ? "CACHED"
                : "LIVE"
              : aramgg.status.toUpperCase()}
            <button
              onClick={() => setDebugCollapsed((c) => !c)}
              style={{ marginLeft: 8, font: "inherit", cursor: "pointer" }}
            >
              {debugCollapsed ? "expand" : "collapse"}
            </button>
            <button
              onClick={() => setDebugPinned((p) => !p)}
              style={{ marginLeft: 4, font: "inherit", cursor: "pointer" }}
            >
              {debugPinned ? "unpin" : "pin"}
            </button>
            <button
              onClick={aramgg.refresh}
              style={{ marginLeft: 4, font: "inherit", cursor: "pointer" }}
            >
              force-refresh
            </button>
          </div>
          {!debugCollapsed && (
            <>
              <div>Source: ARAMGG (aramgg.com static JSON)</div>
              {aramgg.status === "error" && (
                <div style={{ color: "#f87171" }}>ERROR: {aramgg.error}</div>
              )}
              {/* Diagnostics: injected preview cards are NEVER labelled "detected". */}
              <div style={{ marginTop: 4 }}>
                OCR cards detected: {diag.ocrDetected} · preview cards injected:{" "}
                {diag.previewInjected} · offered cards matched: {diag.offeredMatched} ·
                catalog records resolved: {diag.catalogResolved}
              </div>
              <div>
                rendered real badges: {diag.renderedRealBadges} · rendered preview
                badges: {diag.renderedPreviewBadges}
              </div>
              <div style={{ marginTop: 4, opacity: 0.85 }}>
                Foreground: app={foregroundState.foregroundAppName ?? "?"} · bundle=
                {foregroundState.foregroundBundleIdentifier ?? "?"} · owner=
                {foregroundState.foregroundOwnerName ?? "?"} · title=
                {foregroundState.foregroundWindowTitle || "?"} · gameForeground=
                {String(foregroundState.gameWindowForeground)} · riotClientForeground=
                {String(foregroundState.riotClientForeground)} · gameRunning=
                {String(foregroundState.gameRunning)} · gameWindowDetected=
                {String(foregroundState.gameWindowDetected)}
              </div>
              {ocrDiagnostics.map((diagnostic) => {
                const crop = diagnostic.crop
                  ? `${diagnostic.crop.x},${diagnostic.crop.y} ${diagnostic.crop.width}x${diagnostic.crop.height}`
                  : "none";
                const captureSize = diagnostic.captureWidth && diagnostic.captureHeight
                  ? `${diagnostic.captureWidth}x${diagnostic.captureHeight}`
                  : "none";
                const confidence = diagnostic.confidence === null
                  ? "?"
                  : diagnostic.confidence.toFixed(2);
                return (
                  <div key={`ocr-diagnostic-${diagnostic.regionIndex}`} style={{ marginTop: 2 }}>
                    card {diagnostic.regionIndex + 1} · crop={crop} · image={captureSize} · capture=
                    {String(diagnostic.captureSucceeded)} · raw={diagnostic.rawText ?? ""} ·
                    normalized={diagnostic.normalizedText} · best=
                    {diagnostic.bestCandidate ?? "none"} · confidence={confidence} · reject=
                    {diagnostic.rejectionReason ?? "none"}
                  </div>
                );
              })}
              {aramgg.status === "ready" && (
                <>
                  <div>
                    Patch/version: {aramgg.patch ?? "?"} · fetched{" "}
                    {aramgg.fetchedAt
                      ? new Date(aramgg.fetchedAt).toISOString()
                      : "?"}
                    {aramgg.fromCache && " (cache — not live)"}
                  </div>
                  <div style={{ opacity: 0.7 }}>{aramgg.sourceUrls?.stats}</div>
                  <div style={{ opacity: 0.7 }}>{aramgg.sourceUrls?.catalog}</div>
                  {fixturePayload?.debugRows.map((row) => {
                    const lastResort = row.method === "localized-name";
                    return (
                      <div
                        key={row.slug}
                        style={{
                          marginTop: 2,
                          color: lastResort ? "#fbbf24" : undefined,
                        }}
                      >
                        {row.slug} · id={row.augmentId} ·{" "}
                        {lastResort
                          ? `${row.method} (LAST-RESORT fallback)`
                          : row.method}{" "}
                        · wr={row.rawWinRate} → {row.winRatePercent}% · n=
                        {row.numGames} · tier {row.upstreamTier}→{row.cardTier}
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
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
