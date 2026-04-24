/**
 * ARAM Mayhem — Augment Selection Probability Engine
 *
 * Implements the verified reroll mechanics:
 * - 3 slots per round, each with independent reroll
 * - k = 3 (no rerolls) to 6 (all rerolls used)
 * - Smart Tailoring reduces effective pool size (N_tailored)
 * - Combo probability across multiple rounds
 */

import type { AugmentRarity } from "./types";

// ─── Constants ───

/** Max augments viewable per round (3 initial + 3 rerolls) */
export const MAX_VIEWABLE = 6;

/** Selection rounds and their level thresholds */
export const SELECTION_ROUNDS = [
  { round: 1, level: 3, requiresDeath: false },
  { round: 2, level: 7, requiresDeath: true },
  { round: 3, level: 11, requiresDeath: true },
  { round: 4, level: 15, requiresDeath: true },
] as const;

// ─── Champion Archetype Pool Estimates ───
// These are approximate N_tailored values per archetype.
// TODO: Replace with actual data from augment database scrape.

export type ChampionArchetype =
  | "pure_tank"
  | "ad_fighter"
  | "ad_assassin"
  | "ap_mage"
  | "marksman"
  | "support_enchanter"
  | "support_tank"
  | "hybrid";

/**
 * Estimated effective pool size (N_tailored) per tier per archetype.
 * Smart Tailoring filters the full augment list down to what's relevant
 * for each champion's tags.
 *
 * ⚠️ UNVERIFIED — These are estimates pending actual data mining.
 */
export const ESTIMATED_POOL_SIZE: Record<
  ChampionArchetype,
  Record<AugmentRarity, number>
> = {
  pure_tank:          { silver: 18, gold: 15, prismatic: 12 },
  ad_fighter:         { silver: 22, gold: 18, prismatic: 14 },
  ad_assassin:        { silver: 20, gold: 16, prismatic: 13 },
  ap_mage:            { silver: 24, gold: 20, prismatic: 15 },
  marksman:           { silver: 22, gold: 18, prismatic: 14 },
  support_enchanter:  { silver: 20, gold: 16, prismatic: 12 },
  support_tank:       { silver: 18, gold: 15, prismatic: 11 },
  hybrid:             { silver: 30, gold: 25, prismatic: 18 },
};

// ─── Core Probability Functions ───

/**
 * Probability of finding a specific augment in one selection round.
 *
 * Formula: P = k / N
 *
 * Where:
 *   k = number of unique augments viewable (3 without rerolls, up to 6 with)
 *   N = effective pool size after Smart Tailoring
 *
 * This is a simplification of the hypergeometric distribution for small k/N.
 */
export function pFindAugment(
  poolSize: number,
  rerollsUsed: number = 3, // 0-3 rerolls used
): number {
  const k = Math.min(3 + rerollsUsed, MAX_VIEWABLE);
  if (poolSize <= 0) return 0;
  return Math.min(k / poolSize, 1);
}

/**
 * Probability of finding at least one of several target augments.
 *
 * P(at least one) = 1 - P(none)
 * P(none for one slot) = (N - targets) / N
 * P(none across k slots) = ((N - targets) / N)^k
 *
 * More accurate than k/N when targeting multiple augments.
 */
export function pFindAnyOf(
  poolSize: number,
  targetCount: number,
  rerollsUsed: number = 3,
): number {
  const k = Math.min(3 + rerollsUsed, MAX_VIEWABLE);
  if (poolSize <= 0 || targetCount <= 0) return 0;
  if (targetCount >= poolSize) return 1;

  // P(miss all k draws) = product of (N-t)/(N) for each draw without replacement
  let pMiss = 1;
  for (let i = 0; i < k; i++) {
    pMiss *= (poolSize - targetCount - i) / (poolSize - i);
  }
  return Math.max(0, 1 - pMiss);
}

/**
 * Probability of assembling a multi-piece combo across multiple rounds.
 *
 * Each piece must be found in a round where its tier is available.
 * Assumes independence between rounds (pieces are in different tiers).
 */
export function pCombo(
  pieces: Array<{
    poolSize: number;
    rerollsUsed?: number;
  }>,
): number {
  return pieces.reduce((acc, piece) => {
    return acc * pFindAugment(piece.poolSize, piece.rerollsUsed ?? 3);
  }, 1);
}

/**
 * Expected number of games needed to assemble a specific combo.
 */
export function expectedGamesForCombo(
  pieces: Array<{
    poolSize: number;
    rerollsUsed?: number;
  }>,
): number {
  const p = pCombo(pieces);
  if (p <= 0) return Infinity;
  return Math.ceil(1 / p);
}

// ─── Qualitative Change Detection ───

/**
 * Known "System Breaker" augments that rewrite champion mechanics.
 * These are qualitative change augments whose value transcends their tier color.
 *
 * The Oracle Score algorithm gives these a special multiplier because
 * finding one fundamentally changes the champion's ceiling.
 */
export const SYSTEM_BREAKERS: Array<{
  id: string;
  name: string;
  tier: AugmentRarity;
  tags: string[];
  description: string;
}> = [
  {
    id: "marksmage",
    name: "Marksmage",
    tier: "gold",
    tags: ["attack", "ability"],
    description: "AP converts to auto-attack damage. Enables AP→AD hybrid builds.",
  },
  {
    id: "jeweled_gauntlet",
    name: "Jeweled Gauntlet",
    tier: "prismatic",
    tags: ["ability", "crit"],
    description: "Abilities can crit. Unlocks crit scaling for DoT and ability champions.",
  },
  {
    id: "vulnerability",
    name: "Vulnerability",
    tier: "silver",
    tags: ["attack", "crit"],
    description: "On-hit effects and DoT can crit. Exponential scaling for effect-heavy kits.",
  },
  {
    id: "tap_dancer",
    name: "Tap Dancer",
    tier: "prismatic",
    tags: ["attack", "movement"],
    description: "Attack speed converts to movement speed. Broken on fixed-AS champions (Urgot W).",
  },
  {
    id: "mystic_punch",
    name: "Mystic Punch",
    tier: "prismatic",
    tags: ["attack", "haste"],
    description: "Auto-attacks reduce ability cooldowns. Enables infinite-CC loops.",
  },
  {
    id: "master_of_duality",
    name: "Master of Duality",
    tier: "gold",  // ⚠️ tier unverified
    tags: ["attack", "ability"],
    description: "Attacks grant AP, abilities grant AD. Infinite stacking via ability toggle.",
  },
  {
    id: "slow_and_steady",
    name: "Slow and Steady",
    tier: "gold",  // ⚠️ tier unverified
    tags: ["attack"],
    description: "Bonus attack speed converts to AD. Rescues wasted AS on fixed-AS champions.",
  },
  {
    id: "draw_your_sword",
    name: "Draw Your Sword",
    tier: "gold",  // ⚠️ tier unverified
    tags: ["attack"],
    description: "Converts ranged→melee. Removes ranged penalties on items and runes.",
  },
  {
    id: "earthwake",
    name: "Earthwake",
    tier: "prismatic",
    tags: ["movement", "damage"],
    description: "Dash paths deal AoE damage. Turns mobility into primary damage source.",
  },
];

/**
 * Check if a champion can access a system breaker based on tag overlap.
 */
export function canAccessSystemBreaker(
  championTags: string[],
  breakerId: string,
): boolean {
  const breaker = SYSTEM_BREAKERS.find((b) => b.id === breakerId);
  if (!breaker) return false;
  return breaker.tags.some((tag) => championTags.includes(tag));
}

/**
 * Get all system breakers accessible to a champion.
 */
export function getAccessibleSystemBreakers(
  championTags: string[],
): typeof SYSTEM_BREAKERS {
  return SYSTEM_BREAKERS.filter((b) =>
    b.tags.some((tag) => championTags.includes(tag)),
  );
}

// ─── Oracle Score Integration ───

/**
 * Calculate the "ceiling score" for a champion — how broken they CAN get
 * if they hit their best possible augment combo.
 *
 * This is different from average performance. Mayhem is about variance:
 * the Oracle should tell players "if things go right, here's how insane it gets."
 */
export function ceilingScore(
  baseWinRate: number,
  archetype: ChampionArchetype,
  championTags: string[],
): {
  ceiling: number;
  bestCombo: string[];
  comboProb: number;
  expectedGames: number;
} {
  const accessible = getAccessibleSystemBreakers(championTags);

  if (accessible.length === 0) {
    return {
      ceiling: baseWinRate,
      bestCombo: [],
      comboProb: 1,
      expectedGames: 1,
    };
  }

  // Find the highest-impact accessible combo (top 2 system breakers)
  const bestCombo = accessible.slice(0, 2);
  const pieces = bestCombo.map((b) => ({
    poolSize: ESTIMATED_POOL_SIZE[archetype][b.tier],
    rerollsUsed: 3, // assume player uses all rerolls
  }));

  const prob = bestCombo.length === 1
    ? pFindAugment(pieces[0].poolSize, 3)
    : pCombo(pieces);

  // Ceiling boost: each system breaker adds ~3-8% win rate
  const ceilingBoost = bestCombo.length * 5;

  return {
    ceiling: Math.min(baseWinRate + ceilingBoost, 75),
    bestCombo: bestCombo.map((b) => b.name),
    comboProb: prob,
    expectedGames: Math.ceil(1 / Math.max(prob, 0.001)),
  };
}
