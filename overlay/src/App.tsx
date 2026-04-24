import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildChampionPool,
  calculateSetPaths,
} from "@mayhem-oracle/scoring";
import type {
  AbilityProfile,
  ChampionBaseStats,
  ChampionPoolBreakdown,
  PoolAugment,
  SetPath,
  ComboTier,
} from "@mayhem-oracle/scoring";
import "./App.css";

// ─── Data imports ───
import augmentsData from "./assets/data/augments.json";
import championsData from "./assets/data/champions.json";
import combosData from "./assets/data/combos.json";
import abilitiesData from "./assets/data/abilities.json";

// ─── Types ───

interface LivePlayerData {
  champion: string;
  summoner_name: string;
  level: number;
  is_dead: boolean;
  game_time: number;
  game_mode: string;
}

interface LeagueClientInfo {
  port: number;
  auth_token: string;
  pid: number;
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
  name_zh_TW?: string;
  rarity: "silver" | "gold" | "prismatic";
  win_rate: number | null;
  icon: string;
  description?: string;
  wikiDescription?: string;
  notes?: string[];
  set?: string;
}

type Phase = "idle" | "client_found" | "in_game" | "augment_selection";

// ─── Constants ───

const AUGMENT_LEVELS = [3, 7, 11, 15];

// Card name regions as fraction of screen (calibrated for 2560x1440 / 1920x1080)
// These target the augment name text area on each of the 3 cards
const CARD_NAME_REGIONS = [
  { x: 0.248, y: 0.365, w: 0.115, h: 0.04 },
  { x: 0.442, y: 0.365, w: 0.115, h: 0.04 },
  { x: 0.636, y: 0.365, w: 0.115, h: 0.04 },
];

// Badge positions — centered below each card
const BADGE_POSITIONS = [
  { left: "30.5%", top: "62%" },
  { left: "50%", top: "62%" },
  { left: "69.5%", top: "62%" },
];

// ─── Name lookup ───

const CHAMP_NAME_TO_SLUG: Map<string, string> = (() => {
  const map = new Map<string, string>();
  const champs = championsData.champions as Array<{
    slug: string;
    name: string;
    name_zh_TW?: string;
    name_zh_CN?: string;
    name_ja?: string;
    name_ko?: string;
  }>;
  for (const c of champs) {
    map.set(c.name.toLowerCase(), c.slug);
    map.set(c.name.toLowerCase().replace(/[^a-z]/g, ""), c.slug);
    if (c.name_zh_TW) map.set(c.name_zh_TW, c.slug);
    if (c.name_zh_CN) map.set(c.name_zh_CN, c.slug);
    if (c.name_ja) map.set(c.name_ja, c.slug);
    if (c.name_ko) map.set(c.name_ko, c.slug);
  }
  return map;
})();

function champNameToSlug(name: string): string {
  const exact =
    CHAMP_NAME_TO_SLUG.get(name) ??
    CHAMP_NAME_TO_SLUG.get(name.toLowerCase());
  if (exact) return exact;
  return (
    CHAMP_NAME_TO_SLUG.get(name.toLowerCase().replace(/[^a-z]/g, "")) ??
    name.toLowerCase().replace(/[^a-z]/g, "")
  );
}

// ─── Fuzzy matching ───

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function matchAugment(
  ocrText: string,
  lookup: Map<string, PoolAugment>,
): PoolAugment | null {
  if (!ocrText) return null;
  const cleaned = ocrText.replace(/\s/g, "");

  // Exact match
  const exact = lookup.get(cleaned);
  if (exact) return exact;

  // Substring match
  for (const [name, aug] of lookup) {
    if (cleaned.includes(name) || name.includes(cleaned)) return aug;
  }

  // Levenshtein fuzzy match (threshold: 30% of shorter string length)
  let bestMatch: PoolAugment | null = null;
  let bestDist = Infinity;
  for (const [name, aug] of lookup) {
    const dist = levenshtein(cleaned, name);
    const threshold = Math.ceil(Math.min(cleaned.length, name.length) * 0.3);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      bestMatch = aug;
    }
  }

  return bestMatch;
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

  // On mount: hide dock icon + check screen recording permission
  useEffect(() => {
    invoke("set_dock_visible", { visible: false });
    invoke<boolean>("check_tesseract").then((ok) => {
      if (!ok) invoke("open_screen_recording_settings");
    });
    const tipTimer = setTimeout(() => setShowStartupTip(false), 6000);
    return () => clearTimeout(tipTimer);
  }, []);

  // Fullscreen overlay must always be click-through
  useEffect(() => {
    invoke("set_click_through", { ignore: true });
  }, []);

  // Build champion pool
  const poolData = useMemo((): ChampionPoolBreakdown | null => {
    if (!championSlug) return null;

    const allAugments = augmentsData.augments as OverlayAugment[];
    const allChampions = championsData.champions as Array<{
      slug: string;
      name: string;
      win_rate: number | null;
      tags: string[];
      baseStats?: ChampionBaseStats;
    }>;
    const allCombos = combosData.combos as Array<{
      champion: string;
      augment: string;
      tier: string;
    }>;
    const abilities = (
      abilitiesData as { profiles?: Record<string, AbilityProfile> }
    ).profiles ?? {};

    const champ = allChampions.find((c) => c.slug === championSlug);
    if (!champ) return null;

    const abilityProfile = abilities[championSlug];
    const champCombos = allCombos.filter((c) => c.champion === championSlug);
    const comboBySlug = new Map<string, ComboTier>(
      champCombos.map((c) => [
        c.augment.replace(/ /g, "-"),
        c.tier as ComboTier,
      ]),
    );

    return buildChampionPool(
      championSlug,
      allAugments,
      { win_rate: champ.win_rate, tags: champ.tags, baseStats: champ.baseStats },
      abilityProfile,
      comboBySlug,
    );
  }, [championSlug]);

  // Build zh-TW name lookup for OCR matching
  const nameLookup = useMemo(() => {
    if (!poolData) return new Map<string, PoolAugment>();
    const map = new Map<string, PoolAugment>();
    for (const tier of ["silver", "gold", "prismatic"] as const) {
      for (const aug of poolData[tier].augments) {
        if (aug.name_zh_TW) map.set(aug.name_zh_TW, aug);
        map.set(aug.name, aug);
      }
    }
    return map;
  }, [poolData]);

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
        regions: CARD_NAME_REGIONS,
      });

      const matched: MatchedCard[] = [];
      for (const det of detected) {
        const aug = matchAugment(det.text, nameLookup);
        if (aug) {
          matched.push({
            augment: aug,
            regionIndex: det.region_index,
            ocrText: det.text,
          });
        }
      }

      if (matched.length > 0) {
        setMatchedCards(matched);
      }
    } catch {
      // OCR not available or failed
    }
  }, [nameLookup]);

  // Start/stop OCR polling
  const startOcr = useCallback(() => {
    if (ocrIntervalRef.current) return;
    setOcrActive(true);
    runOcr(); // immediate first run
    ocrIntervalRef.current = setInterval(runOcr, 3000);
  }, [runOcr]);

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
      const data = await invoke<LivePlayerData | null>("get_live_player_data");
      if (data) {
        setPlayerData(data);
        const slug = champNameToSlug(data.champion);
        if (slug !== championSlug) {
          setChampionSlug(slug);
          setLastAugmentLevel(0);
          setPickedAugments([]);
          stopOcr();
        }

        const level = data.level;
        const isAtAugmentLevel = AUGMENT_LEVELS.includes(level);

        // Augment selection trigger:
        // Level 3 (round 1): at spawn (no death required)
        // Level 7, 11, 15: must be dead
        const shouldShowSelection =
          isAtAugmentLevel &&
          level > lastAugmentLevel &&
          (level === 3 || data.is_dead);

        if (shouldShowSelection) {
          setLastAugmentLevel(level);
          setPhase("augment_selection");
          startOcr();
        } else if (phase === "augment_selection") {
          // Exit augment selection when player is alive for a while
          // or level has changed past the threshold
          if (!data.is_dead && !isAtAugmentLevel) {
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
      const info = await invoke<LeagueClientInfo | null>("detect_league_client");
      if (info) {
        setPhase("client_found");
      } else {
        setPhase("idle");
        setPlayerData(null);
        setChampionSlug(null);
        stopOcr();
      }
    } catch {
      setPhase("idle");
    }
  }, [championSlug, lastAugmentLevel, phase, startOcr, stopOcr]);

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
      {phase === "augment_selection" && matchedCards.length > 0 && (
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
      {phase === "in_game" && championSlug && (
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
