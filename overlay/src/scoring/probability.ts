/**
 * Probability Engine — the mathematical backbone of Mayhem Oracle
 *
 * Builds each champion's tailored augment pool, computes hypergeometric odds
 * of seeing specific augments per round, and annotates picks with expected
 * value across the 4 augment selection rounds.
 */

import { abilityAugmentFit } from "./ability-augment-fit";
import { computeOracleScore } from "./oracle-score";
import { getChampionAugmentPool } from "./pool-orchestrator";
import type { AbilityProfile, ChampionBaseStats, ChampionTag, PoolRules } from "./types";
import type { ScoredAugment, ComboTier, AugmentRarity } from "./oracle-score";

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
  lifecycle?: string;
  win_rate: number | null;
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

// ─── Tiers & EV ───

export function scoreToTier(score: number): "S" | "A" | "B" | "C" {
  if (score >= 75) return "S";
  if (score >= 65) return "A";
  if (score >= 55) return "B";
  return "C";
}

/**
 * Round weight — HYPOTHESIS (plan §3): later rounds lock in less-correctable
 * picks. Validate against live 26.12 win rates before trusting the values.
 */
export const ROUND_WEIGHT: Record<1 | 2 | 3 | 4, number> = {
  1: 1.0,
  2: 1.0,
  3: 1.1,
  4: 1.2,
};

/** EV annotation = score × draw probability × round weight. */
export function expectedValue(
  score: number,
  probability: number,
  round: 1 | 2 | 3 | 4,
): number {
  return score * probability * (ROUND_WEIGHT[round] ?? 1);
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
        abilityAugmentFit: abilityAugmentFit(
          { slug: aug.slug, type: aug.type, wikiDescription: aug.wikiDescription },
          abilityProfile,
        ),
      });

    byRarity[aug.rarity].push({
      slug: aug.slug,
      name: aug.name,
      name_zh_TW: aug.name_zh_TW,
      lifecycle: aug.flags?.lifecycle,
      win_rate: aug.win_rate,
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
