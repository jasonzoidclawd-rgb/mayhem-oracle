import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildChampionPool,
} from "./scoring";
import { buildOverlayAugmentLookup, matchAugmentName } from "./scoring/offer-lookup";
import {
  advanceOcrSelection,
  isCompleteThreeCardOffer,
  matchAugmentFrame,
  shouldClearOcrStateForGameflow,
  shouldEndAugmentSelectionForLevel,
  shouldRunOcrForGameflow,
} from "./augmentSelection";
import {
  CollectorOverlayController,
  type CollectorSnapshot,
} from "./collector/CollectorStatus";
import { overlayShouldIgnoreMouseEvents } from "./collector/collectorWindows";
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
  const [showStartupTip, setShowStartupTip] = useState(true);
  const [leagueFocused, setLeagueFocused] = useState(false);
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
  const activeGameHashRef = useRef<string | null>(null);
  const memberBootstrapCompleteRef = useRef(false);
  const collectorEnabled = collectorStatus?.consent === "accepted";
  const collectorCaptureEnabled = collectorEnabled && !collectorStatus?.paused;
  // Dev-only: bypass ONLY the member-coach auth/data. Everything else (OCR,
  // calibration, positioning, collector consent) stays on the real path.
  const tierFixtureOn = isTierFixtureEnabled();
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

  // The full-screen visual overlay must not capture the desktop. Bounded
  // consent/collector windows own their own mouse interaction.
  useEffect(() => {
    invoke("set_click_through", {
      ignore: overlayShouldIgnoreMouseEvents({ coachOpen }),
    });
  }, [coachOpen]);

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

  // ─── Dev ARAMGG tier-fixture (dev + MAYHEM_OVERLAY_TIER_FIXTURE=1 only) ───
  // Canonical, non-synthetic augment stats from ARAMGG drive the REAL PR #46
  // render path. Statistics never fall back to synthetic/local values; only
  // card geometry is injected when live OCR detection is unavailable.
  const aramgg = useAramggTierFixture(tierFixtureOn, overlayData?.augments);

  // Deterministic geometry fallback: when there is no live 3-card detection,
  // synthesize a 3-card offer from the first resolved-with-stats augments so
  // the real render path can be exercised without a live game. `badgePositions`
  // supplies responsive positions (its calibration-free % anchors).
  const syntheticMatchedCards = useMemo((): MatchedCard[] => {
    if (
      !tierFixtureOn ||
      aramgg.status !== "ready" ||
      isCompleteThreeCardOffer(matchedCards) ||
      !overlayData
    ) {
      return [];
    }
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
  }, [tierFixtureOn, aramgg.status, aramgg.resolvedBySlug, matchedCards, overlayData]);

  const injectingGeometry =
    tierFixtureOn &&
    !isCompleteThreeCardOffer(matchedCards) &&
    syntheticMatchedCards.length === 3;

  const effectiveMatchedCards = injectingGeometry ? syntheticMatchedCards : matchedCards;
  const effectivePhase: Phase = injectingGeometry ? "augment_selection" : phase;
  const effectiveLeagueFocused = injectingGeometry ? true : leagueFocused;
  // Dev flag unlocks the badge/coach gate without real collector+member auth.
  const effectiveMemberEnabled = tierFixtureOn ? effectiveMember?.enabled === true : memberEnabled;

  const tierFixture = useMemo(() => {
    const round = currentRound?.round ?? (tierFixtureOn ? 1 : null);
    if (
      !tierFixtureOn ||
      aramgg.status !== "ready" ||
      round === null ||
      !isCompleteThreeCardOffer(effectiveMatchedCards)
    ) {
      return null;
    }
    const cards = [...effectiveMatchedCards]
      .sort((left, right) => left.regionIndex - right.regionIndex)
      .map((card): AramggFixtureCard | null => aramgg.resolvedBySlug.get(card.augment.slug) ?? null)
      .filter((card): card is AramggFixtureCard => card !== null);
    if (cards.length === 0) return null;
    return buildAramggDecisionResult(cards, round as 1 | 2 | 3 | 4);
  }, [tierFixtureOn, aramgg.status, aramgg.resolvedBySlug, currentRound, effectiveMatchedCards]);

  const effectiveDecisionResult = tierFixture?.result ?? decisionResult;
  const effectiveWinRateBySlug: Record<string, number | string | null> =
    tierFixture?.winRateDisplayBySlug ?? winRateBySlug;

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
  }, []);

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
      !ocrActiveRef.current ||
      ocrRunIdRef.current !== runId
    ) return;

    try {
      const detected = await invoke<DetectedAugment[]>("detect_augment_names", {
        knownNames: ocrKnownNames,
      });

      if (!ocrActiveRef.current || ocrRunIdRef.current !== runId) return;

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
      if (ocrActiveRef.current && ocrRunIdRef.current === runId) {
        const unavailable = ocrAvailabilityFromError(error);
        if (unavailable) setOcrAvailability(unavailable);
        setMatchedCards([]);
      }
    }
  }, [collectorCaptureEnabled, nameLookup, ocrKnownNames, playerData, stopOcr, updatePhase]);

  useEffect(() => {
    runOcrRef.current = runOcr;
  }, [runOcr]);

  const scheduleNextOcr = useCallback(function scheduleNextOcr(runId: number) {
    ocrTimeoutRef.current = setTimeout(async () => {
      await runOcrRef.current(runId);
      if (ocrActiveRef.current && ocrRunIdRef.current === runId) {
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
    if (!collectorEnabled) {
      stopOcr();
      updatePhase("idle");
      return;
    }

    let leagueIsFocused = leagueFocused;
    try {
      leagueIsFocused = await invoke<boolean>("is_league_foreground");
      setLeagueFocused(leagueIsFocused);
      if (!leagueIsFocused) {
        setMatchedCards([]);
        stopOcr();
      }
    } catch {
      // macOS only — default to showing on other platforms
    }

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
          if (leagueIsFocused) startOcr();
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
          } else if (leagueIsFocused) {
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
      if (clientFound) {
        clearGameOnlyState("client_found");
      } else {
        clearGameOnlyState("idle");
      }
    } catch {
      clearGameOnlyState("idle");
    }
  }, [
    champNameToSlug,
    championSlug,
    clearGameOnlyState,
    collectorEnabled,
    leagueFocused,
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
      {(calibration || calibrationError) && (
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
      {collectorEnabled && <div
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

      {/* Badges overlaid on augment cards during selection */}
      {effectiveMemberEnabled &&
        effectivePhase === "augment_selection" &&
        isCompleteThreeCardOffer(effectiveMatchedCards) &&
        effectiveLeagueFocused &&
        effectiveDecisionResult && (
        <>
          {effectiveMatchedCards.map((card) => {
            const pos = badgePositions[card.regionIndex];
            if (!pos) return null;
            const candidate = effectiveDecisionResult.candidates.find(
              (entry) => entry.augmentSlug === card.augment.slug,
            );
            if (!candidate) return null;
            const tier = tierForGrade(candidate.grade);
            const winRate = tierFixtureOn
              ? effectiveWinRateBySlug[card.augment.slug]
              : card.augment.win_rate;
            return (
              <div
                className={`badge badge-grade-${candidate.grade} ${tierClassName(tier)}`}
                key={card.augment.slug}
                style={{ left: pos.left, top: pos.top }}
              >
                {card.augment.lifecycle === "added" && (
                  <span className="badge-new">NEW</span>
                )}
                <span className="badge-label">{mode}</span>
                <span className="badge-tier">{tier}</span>
                <span className="badge-wr">{formatWinRate(winRate, { raw: tierFixtureOn })}</span>
                <span className="badge-prob">
                  P:{Math.round(candidate.probability.withNormalRerolls * 100)}%
                </span>
                {candidate.warnings.includes("hard-incompatible") && (
                  <strong className="badge-warning">Hard warning</strong>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Minimal HUD when in-game but not selecting */}
      {memberEnabled && phase === "in_game" && championSlug && leagueFocused && (
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
      {collectorEnabled && phase === "idle" && (
        <div className="idle-panel">Waiting for League client...</div>
      )}
      {collectorEnabled && phase === "client_found" && (
        <div className="idle-panel">Client found — waiting for game...</div>
      )}
      {collectorEnabled && dataError && (
        <div className="idle-panel">Overlay data failed to load: {dataError}</div>
      )}
      {collectorEnabled && ocrStatusMessage && (
        <div className="idle-panel">{ocrStatusMessage}</div>
      )}
      {collectorEnabled && effectiveMember?.error && (
        <div className="member-error">Member coach unavailable: {effectiveMember.error}</div>
      )}
      {tierFixtureOn && (
        <div
          className="aramgg-debug-panel"
          style={{
            position: "fixed",
            bottom: 8,
            left: 8,
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
            ARAMGG TIER FIXTURE (dev) — upstream tier relabeled ·{" "}
            {aramgg.status === "ready"
              ? aramgg.fromCache
                ? "CACHED"
                : "LIVE"
              : aramgg.status.toUpperCase()}
            <button
              onClick={aramgg.refresh}
              style={{ marginLeft: 8, font: "inherit", cursor: "pointer" }}
            >
              force-refresh
            </button>
          </div>
          <div>Source: ARAMGG (aramgg.com static JSON)</div>
          {aramgg.status === "error" && (
            <div style={{ color: "#f87171" }}>ERROR: {aramgg.error}</div>
          )}
          {aramgg.status === "ready" && (
            <>
              <div>
                Patch/version: {aramgg.patch ?? "?"} · fetched{" "}
                {aramgg.fetchedAt ? new Date(aramgg.fetchedAt).toISOString() : "?"}
                {aramgg.fromCache && " (cache — not live)"}
              </div>
              <div style={{ opacity: 0.7 }}>{aramgg.sourceUrls?.stats}</div>
              <div style={{ opacity: 0.7 }}>{aramgg.sourceUrls?.catalog}</div>
              <div style={{ marginTop: 4 }}>
                detected cards: {effectiveMatchedCards.length}
                {injectingGeometry && " (injected geometry)"} · ARAMGG matched:{" "}
                {aramgg.resolvedBySlug.size} · rendered badges:{" "}
                {tierFixture?.debugRows.length ?? 0}
              </div>
              {tierFixture?.debugRows.map((row) => {
                const lastResort = row.method === "localized-name";
                return (
                  <div
                    key={row.slug}
                    style={{ marginTop: 2, color: lastResort ? "#fbbf24" : undefined }}
                  >
                    {row.slug} · id={row.augmentId} ·{" "}
                    {lastResort ? `${row.method} (LAST-RESORT fallback)` : row.method} · wr=
                    {row.rawWinRate} → {row.winRatePercent}% · n={row.numGames} · tier{" "}
                    {row.upstreamTier}→{row.cardTier}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Startup tip — auto-dismisses after 6s */}
      {collectorEnabled && showStartupTip && (
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
        open={effectiveMemberEnabled && coachOpen}
        result={effectiveDecisionResult}
        mode={mode}
        onModeChange={setMode}
        winRateBySlug={effectiveWinRateBySlug}
        rawWinRate={tierFixtureOn}
      />
      <CollectorOverlayController onStatus={setCollectorStatus} />
    </div>
  );
}

export default App;
