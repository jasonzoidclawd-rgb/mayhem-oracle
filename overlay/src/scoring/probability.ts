/**
 * Probability Engine — the mathematical backbone of Mayhem Oracle
 *
 * Builds each champion's tailored augment pool, computes hypergeometric odds
 * of seeing specific augments per round, and plans set completion paths
 * across the 4 augment selection rounds.
 */

import { computeOracleScore } from "./oracle-score";
import { getChampionAugmentPool } from "./pool-orchestrator";
import type { AbilityProfile, ChampionBaseStats, ChampionTag, PoolRules } from "./types";
import type { ScoredAugment, ComboTier, AugmentRarity } from "./oracle-score";

// ─── Constants ───

const ALL_SET_NAMES = [
  "Stackosaurus Rex",
  "Firecracker",
  "Snowday",
  "Wee Woo Wee Woo",
  "Archmage",
  "Fully Automated",
  "Dive Bomb",
  "Make it Rain",
  "High Roller",
];

const SET_ID_TO_NAME: Record<string, string> = {
  archmage: "Archmage",
  dive_bomb: "Dive Bomb",
  firecracker: "Firecracker",
  fully_automated: "Fully Automated",
  high_roller: "High Roller",
  make_it_rain: "Make it Rain",
  snowday: "Snowday",
  stackosaurus_rex: "Stackosaurus Rex",
  wee_woo: "Wee Woo Wee Woo",
};

// ─── Math ───

/** Binomial coefficient C(n, k) */
function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  if (k > n - k) k = n - k;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/**
 * Hypergeometric probability: P(seeing >=1 of K targets in n draws from N)
 * P = 1 - C(N-K, n) / C(N, n)
 */
export function probabilityOfTarget(
  poolSize: number,
  targetCount: number,
  totalSeen: number,
): number {
  if (targetCount <= 0 || poolSize <= 0) return 0;
  if (targetCount >= poolSize || totalSeen >= poolSize) return 1;
  if (totalSeen <= 0) return 0;
  const pZero =
    combinations(poolSize - targetCount, totalSeen) /
    combinations(poolSize, totalSeen);
  return 1 - pZero;
}

// ─── Types ───

export interface PoolAugment {
  slug: string;
  name: string;
  name_zh_TW?: string;
  sets: string[];
  win_rate: number;
  score: number;
  tier: "S" | "A" | "B" | "C";
  rarity: AugmentRarity;
  probability: number;
  probabilityWithReroll: number;
}

export interface TierPool {
  total: number;
  augments: PoolAugment[];
}

export interface ChampionPoolBreakdown {
  silver: TierPool;
  gold: TierPool;
  prismatic: TierPool;
}

export interface SetPath {
  setName: string;
  piecesInPool: { silver: number; gold: number; prismatic: number };
  currentPieces: number;
  piecesNeeded: number;
  /** P(completing set) by end of remaining round 1, 2, ... */
  completionProbByRound: number[];
}

// ─── Set parsing ───

/**
 * Parse the `set` field from augments.json into individual set names.
 * e.g. "Dive Bomb Fully Automated" -> ["Dive Bomb", "Fully Automated"]
 */
export function parseSets(setField: string | undefined): string[] {
  if (!setField) return [];
  const normalizedId = setField.trim().toLowerCase().replace(/[-\s]+/g, "_");
  const setName = SET_ID_TO_NAME[normalizedId];
  if (setName) return [setName];

  const result: string[] = [];
  let remaining = setField;

  // Match longer names first to avoid partial matches
  const sorted = [...ALL_SET_NAMES].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (remaining.includes(name)) {
      result.push(name);
      remaining = remaining.replace(name, "").trim();
    }
  }

  return result;
}

export function scoreToTier(score: number): "S" | "A" | "B" | "C" {
  if (score >= 75) return "S";
  if (score >= 65) return "A";
  if (score >= 55) return "B";
  return "C";
}

// ─── Pool construction ───

/**
 * Build complete augment pool breakdown for a champion.
 * Groups augments by rarity tier with Oracle Scores and probabilities.
 */
export function buildChampionPool(
  championSlug: string,
  allAugments: ScoredAugment[],
  champData: {
    win_rate: number | null;
    tags: string[];
    kit_tags?: ChampionTag[];
    baseStats?: ChampionBaseStats;
  },
  abilityProfile: AbilityProfile | undefined,
  combos: Map<string, ComboTier>,
  poolRules: PoolRules,
  ownedItems: string[] = [],
): ChampionPoolBreakdown {
  const champWr = champData.win_rate ?? 50;

  const { silver, gold, prismatic } = getChampionAugmentPool({
    championSlug,
    augments: allAugments,
    abilityProfile,
    baseStats: champData.baseStats,
    championKitTags: champData.kit_tags ?? [],
    poolRules,
    ownedItems,
  });

  const poolAugments: ScoredAugment[] = [...silver, ...gold, ...prismatic];

  const byRarity: Record<AugmentRarity, PoolAugment[]> = {
    silver: [],
    gold: [],
    prismatic: [],
  };

  for (const aug of poolAugments) {
    const comboTier = combos.get(aug.slug);
      const result = computeOracleScore({
        augment: aug,
        championWinRate: champWr,
        comboTier,
        abilityProfile,
        isSystemBreaker: aug.flags?.system_breaker === true,
      });

    byRarity[aug.rarity].push({
      slug: aug.slug,
      name: aug.name,
      name_zh_TW: aug.name_zh_TW,
      sets: parseSets(aug.set),
      win_rate: aug.win_rate ?? 50,
      score: result.total,
      tier: scoreToTier(result.total),
      rarity: aug.rarity,
      probability: 0,
      probabilityWithReroll: 0,
    });
  }

  for (const rarity of ["silver", "gold", "prismatic"] as const) {
    const tierAugs = byRarity[rarity];
    const N = tierAugs.length;
    for (const aug of tierAugs) {
      aug.probability = probabilityOfTarget(N, 1, 3);
      aug.probabilityWithReroll = probabilityOfTarget(N, 1, 6);
    }
    tierAugs.sort((a, b) => b.score - a.score);
  }

  return {
    silver: { total: byRarity.silver.length, augments: byRarity.silver },
    gold: { total: byRarity.gold.length, augments: byRarity.gold },
    prismatic: {
      total: byRarity.prismatic.length,
      augments: byRarity.prismatic,
    },
  };
}

// ─── Set path planning ───

/**
 * Calculate set completion paths across remaining rounds.
 *
 * Since we don't know future round tiers, we average the per-tier
 * probability of seeing a set piece equally across all 3 tiers.
 */
export function calculateSetPaths(
  pool: ChampionPoolBreakdown,
  pickedAugments: string[],
  remainingRounds: number,
): SetPath[] {
  const allAugs = [
    ...pool.silver.augments,
    ...pool.gold.augments,
    ...pool.prismatic.augments,
  ];

  const paths: SetPath[] = [];

  for (const setName of ALL_SET_NAMES) {
    const piecesInPool = {
      silver: pool.silver.augments.filter((a) => a.sets.includes(setName))
        .length,
      gold: pool.gold.augments.filter((a) => a.sets.includes(setName)).length,
      prismatic: pool.prismatic.augments.filter((a) =>
        a.sets.includes(setName),
      ).length,
    };

    const totalInPool =
      piecesInPool.silver + piecesInPool.gold + piecesInPool.prismatic;
    if (totalInPool === 0) continue;

    const currentPieces = pickedAugments.filter((slug) => {
      const aug = allAugs.find((a) => a.slug === slug);
      return aug?.sets.includes(setName);
    }).length;

    const piecesNeeded = Math.max(0, 2 - currentPieces);

    if (piecesNeeded === 0) {
      paths.push({
        setName,
        piecesInPool,
        currentPieces,
        piecesNeeded: 0,
        completionProbByRound: Array(remainingRounds).fill(1),
      });
      continue;
    }

    // P(seeing >=1 set piece this round), averaged across tiers (with reroll)
    const probPerRound =
      (1 / 3) *
      (probabilityOfTarget(pool.silver.total, piecesInPool.silver, 6) +
        probabilityOfTarget(pool.gold.total, piecesInPool.gold, 6) +
        probabilityOfTarget(pool.prismatic.total, piecesInPool.prismatic, 6));

    const completionProbByRound: number[] = [];

    for (let r = 1; r <= remainingRounds; r++) {
      if (r < piecesNeeded) {
        completionProbByRound.push(0);
        continue;
      }

      if (piecesNeeded === 1) {
        completionProbByRound.push(1 - Math.pow(1 - probPerRound, r));
      } else {
        // P(>=k successes in r trials) via binomial CDF complement
        let pLessThanK = 0;
        for (let i = 0; i < piecesNeeded; i++) {
          pLessThanK +=
            combinations(r, i) *
            Math.pow(probPerRound, i) *
            Math.pow(1 - probPerRound, r - i);
        }
        completionProbByRound.push(Math.max(0, 1 - pLessThanK));
      }
    }

    paths.push({
      setName,
      piecesInPool,
      currentPieces,
      piecesNeeded,
      completionProbByRound,
    });
  }

  // Most achievable paths first
  paths.sort((a, b) => {
    const aProb = a.completionProbByRound[0] ?? 0;
    const bProb = b.completionProbByRound[0] ?? 0;
    return bProb - aProb;
  });

  return paths;
}
