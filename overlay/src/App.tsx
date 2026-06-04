import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildChampionPool,
  calculateSetPaths,
} from "./scoring";
import { buildOverlayAugmentLookup, matchAugmentName } from "./scoring/offer-lookup";
import type {
  AbilityProfile,
  ChampionBaseStats,
  ChampionPoolBreakdown,
  ChampionTag,
  PoolAugment,
  PoolRules,
  SetPath,
  ComboTier,
} from "./scoring";
import "./App.css";

// ─── Types ───

interface LivePlayerData {
  champion: string;
  level: number;
  is_dead: boolean;
  game_time: number;
  game_mode: string;
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

// Badge positions — centered below each card
const BADGE_POSITIONS = [
  { left: "30.5%", top: "62%" },
  { left: "50%", top: "62%" },
  { left: "69.5%", top: "62%" },
];

function normalizeChampionName(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

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
  const [lastAugmentLevel, setLastAugmentLevel] = useState(0);
  const [pickedAugments, setPickedAugments] = useState<string[]>([]);
  const [matchedCards, setMatchedCards] = useState<MatchedCard[]>([]);
  const [, setOcrActive] = useState(false);
  const ocrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showStartupTip, setShowStartupTip] = useState(true);
  const [leagueFocused, setLeagueFocused] = useState(true);
  const [overlayData, setOverlayData] = useState<OverlayData | null>(null);
  const [abilityProfiles, setAbilityProfiles] = useState<Record<string, AbilityProfile | null>>({});
  const [dataError, setDataError] = useState<string | null>(null);
  const runOcrRef = useRef<() => Promise<void>>(async () => {});
  const lastGameTimeRef = useRef<number | null>(null);

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
    if (!championSlug || abilityProfiles[championSlug] !== undefined) return;

    let cancelled = false;

    void loadJson<AbilityProfile>(`/data/abilities/${championSlug}.json`)
      .then((profile) => {
        if (cancelled) return;
        setAbilityProfiles((prev) => ({ ...prev, [championSlug]: profile }));
      })
      .catch(() => {
        if (cancelled) return;
        setAbilityProfiles((prev) => ({ ...prev, [championSlug]: null }));
        setDataError(`Failed to load ability profile for ${championSlug}`);
      });

    return () => {
      cancelled = true;
    };
  }, [abilityProfiles, championSlug]);

  // On mount: hide dock icon + check local OCR and capture prerequisites.
  useEffect(() => {
    invoke("set_dock_visible", { visible: false });
    invoke<boolean>("check_tesseract").then((ok) => {
      if (!ok) setDataError("Tesseract OCR is not installed or not available on PATH.");
    });
    invoke<boolean>("check_screen_capture_available").then((ok) => {
      if (!ok) invoke("open_screen_recording_settings");
    });
    const tipTimer = setTimeout(() => setShowStartupTip(false), 6000);
    return () => clearTimeout(tipTimer);
  }, []);

  // Fullscreen overlay must always be click-through
  useEffect(() => {
    invoke("set_click_through", { ignore: true });
  }, []);

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

  const champNameToSlug = useCallback(
    (name: string): string => {
      const exact =
        championSlugByName.get(name) ??
        championSlugByName.get(name.toLowerCase());
      if (exact) return exact;

      return championSlugByName.get(normalizeChampionName(name)) ?? normalizeChampionName(name);
    },
    [championSlugByName],
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

  // Set paths
  const setPaths = useMemo((): SetPath[] => {
    if (!poolData || !currentRound) return [];
    const remaining = 4 - currentRound.round;
    if (remaining <= 0) return [];
    return calculateSetPaths(poolData, pickedAugments, remaining);
  }, [poolData, currentRound, pickedAugments]);

  // Get set path for a specific augment
  const getSetPath = useCallback(
    (aug: PoolAugment): SetPath | null => {
      if (aug.sets.length === 0) return null;
      return setPaths.find((p) => aug.sets.includes(p.setName)) ?? null;
    },
    [setPaths],
  );

  // OCR detection
  const runOcr = useCallback(async () => {
    if (!nameLookup.size) return;
    try {
      const detected = await invoke<DetectedAugment[]>("detect_augment_names", {
        knownNames: ocrKnownNames,
      });

      const matched: MatchedCard[] = [];
      for (const det of detected) {
        const aug = matchAugmentName(det.text, nameLookup);
        if (aug) {
          matched.push({
            augment: aug,
            regionIndex: det.region_index,
            ocrText: det.text,
          });
        }
      }

      setMatchedCards(matched);
    } catch {
      // OCR not available or failed
    }
  }, [nameLookup, ocrKnownNames]);

  useEffect(() => {
    runOcrRef.current = runOcr;
  }, [runOcr]);

  // Start/stop OCR polling
  const startOcr = useCallback(() => {
    if (ocrIntervalRef.current) return;
    setOcrActive(true);
    void runOcrRef.current(); // immediate first run
    ocrIntervalRef.current = setInterval(() => {
      void runOcrRef.current();
    }, 3000);
  }, []);

  const stopOcr = useCallback(() => {
    if (ocrIntervalRef.current) {
      clearInterval(ocrIntervalRef.current);
      ocrIntervalRef.current = null;
    }
    setOcrActive(false);
    setMatchedCards([]);
  }, []);

  // Main polling loop
  const poll = useCallback(async () => {
    try {
      const focused = await invoke<boolean>("is_league_foreground");
      setLeagueFocused(focused);
    } catch {
      // macOS only — default to showing on other platforms
    }

    try {
      const data = await invoke<LivePlayerData | null>("get_live_player_data");
      if (data) {
        const lastGameTime = lastGameTimeRef.current;
        if (lastGameTime !== null && data.game_time + 5 < lastGameTime) {
          setLastAugmentLevel(0);
          setPickedAugments([]);
          setMatchedCards([]);
          stopOcr();
        }
        lastGameTimeRef.current = data.game_time;
        setPlayerData(data);
        const slug = champNameToSlug(data.champion);
        if (slug !== championSlug) {
          setChampionSlug(slug);
          setLastAugmentLevel(0);
          setPickedAugments([]);
          stopOcr();
        }

        const augmentLevel = [...AUGMENT_LEVELS]
          .reverse()
          .find((threshold) => data.level >= threshold && threshold > lastAugmentLevel);

        // Augment selection trigger:
        // Level 3 (round 1): at spawn (no death required)
        // Level 7, 11, 15: must be dead
        const shouldShowSelection =
          augmentLevel !== undefined &&
          (augmentLevel === 3 || data.is_dead);

        if (shouldShowSelection) {
          setLastAugmentLevel(augmentLevel);
          setPhase("augment_selection");
          startOcr();
        } else if (phase === "augment_selection") {
          // Round 1 (level 3): player never dies, exit once they level past 3
          // Rounds 2-4 (level 7/11/15): exit as soon as they respawn
          const pickedAtLevel3 = lastAugmentLevel === 3;
          const doneSelecting = pickedAtLevel3
            ? data.level > 3
            : !data.is_dead;
          if (doneSelecting) {
            setPhase("in_game");
            stopOcr();
          }
        } else {
          setPhase("in_game");
        }
        return;
      }
    } catch {
      // Live Client API not available
    }

    try {
      const clientFound = await invoke<boolean>("detect_league_client");
      setPlayerData(null);
      setChampionSlug(null);
      setLastAugmentLevel(0);
      setPickedAugments([]);
      setMatchedCards([]);
      lastGameTimeRef.current = null;
      stopOcr();
      if (clientFound) {
        setPhase("client_found");
      } else {
        setPhase("idle");
      }
    } catch {
      setPhase("idle");
    }
  }, [champNameToSlug, championSlug, lastAugmentLevel, phase, startOcr, stopOcr]);

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
      if (ocrIntervalRef.current) clearInterval(ocrIntervalRef.current);
    };
  }, []);

  // ─── Render ───

  return (
    <div className="overlay-root">
      {/* Status dot */}
      <div
        className={`status-dot ${
          phase === "augment_selection"
            ? "status-ocr"
            : phase === "in_game"
              ? "status-connected"
              : phase === "client_found"
                ? "status-waiting"
                : "status-disconnected"
        }`}
      />

      {/* Badges overlaid on augment cards during selection */}
      {phase === "augment_selection" && matchedCards.length > 0 && leagueFocused && (
        <>
          {matchedCards.map((card) => {
            const pos = BADGE_POSITIONS[card.regionIndex];
            if (!pos) return null;
            const setPath = getSetPath(card.augment);
            return (
              <div
                className={`badge badge-${card.augment.tier}`}
                key={card.augment.slug}
                style={{ left: pos.left, top: pos.top }}
              >
                {setPath && setPath.piecesNeeded > 0 && (
                  <div className="badge-set">
                    <span className="badge-set-name">{setPath.setName}</span>
                    <span className="badge-set-prob">
                      {setPath.currentPieces}/{setPath.currentPieces + setPath.piecesNeeded}
                      {" · "}
                      {Math.round(
                        (setPath.completionProbByRound[
                          setPath.completionProbByRound.length - 1
                        ] ?? 0) * 100,
                      )}%
                    </span>
                  </div>
                )}
                <span className="badge-label">Oracle</span>
                <span className={`badge-tier tier-${card.augment.tier}`}>
                  {card.augment.tier}
                </span>
                <span className="badge-score">
                  {Math.round(card.augment.score)}
                </span>
                <span className="badge-prob">
                  P:{Math.round(card.augment.probabilityWithReroll * 100)}%
                </span>
              </div>
            );
          })}
        </>
      )}

      {/* Minimal HUD when in-game but not selecting */}
      {phase === "in_game" && championSlug && leagueFocused && (
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
      {phase === "idle" && (
        <div className="idle-panel">Waiting for League client...</div>
      )}
      {phase === "client_found" && (
        <div className="idle-panel">Client found — waiting for game...</div>
      )}
      {dataError && (
        <div className="idle-panel">Overlay data failed to load: {dataError}</div>
      )}

      {/* Startup tip — auto-dismisses after 6s */}
      {showStartupTip && (
        <div className="startup-tip">
          <img src="/icon.png" alt="" className="startup-icon" />
          <div className="startup-tip-text">
            <div className="startup-title">Mayhem Oracle</div>
            <div className="startup-hint">⌘Q disabled — use menu bar icon to exit</div>
            <div className="startup-hint">Or ⌘⌥⎋ (Force Quit)</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
