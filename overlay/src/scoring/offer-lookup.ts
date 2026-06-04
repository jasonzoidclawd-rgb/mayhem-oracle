import { computeOracleScore, type ComboTier, type ScoredAugment } from "./oracle-score";
import {
  parseSets,
  probabilityOfTarget,
  scoreToTier,
  type ChampionPoolBreakdown,
  type PoolAugment,
} from "./probability";
import type { AbilityProfile } from "./types";

export type OverlayAugmentLookup = Map<string, PoolAugment>;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
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

export function normalizeAugmentNameForLookup(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[\s:：'".,!！?？-]/g, "");
}

function addName(
  lookup: OverlayAugmentLookup,
  name: string | undefined,
  augment: PoolAugment,
) {
  if (!name) return;
  const key = normalizeAugmentNameForLookup(name);
  if (key) lookup.set(key, augment);
}

function poolAugmentsBySlug(poolData: ChampionPoolBreakdown | null): Map<string, PoolAugment> {
  const map = new Map<string, PoolAugment>();
  if (!poolData) return map;

  for (const augment of [
    ...poolData.silver.augments,
    ...poolData.gold.augments,
    ...poolData.prismatic.augments,
  ]) {
    map.set(augment.slug, augment);
  }

  return map;
}

function rarityCounts(augments: ScoredAugment[]): Record<ScoredAugment["rarity"], number> {
  return augments.reduce(
    (accumulator, augment) => {
      accumulator[augment.rarity] += 1;
      return accumulator;
    },
    { silver: 0, gold: 0, prismatic: 0 },
  );
}

function setsForAugment(augment: ScoredAugment): string[] {
  const fromGeneratedSet = parseSets(augment.set);
  return fromGeneratedSet.length > 0 ? fromGeneratedSet : parseSets(augment.wikiSet);
}

function fallbackScoredAugment(args: {
  augment: ScoredAugment;
  championWinRate?: number | null;
  comboTier?: ComboTier;
  abilityProfile?: AbilityProfile;
  rarityTotal: number;
}): PoolAugment {
  const { augment, championWinRate, comboTier, abilityProfile, rarityTotal } = args;
  const result = computeOracleScore({
    augment,
    championWinRate: championWinRate ?? undefined,
    comboTier,
    abilityProfile,
    isSystemBreaker: augment.flags?.system_breaker === true,
  });

  return {
    slug: augment.slug,
    name: augment.name,
    name_zh_TW: augment.name_zh_TW,
    sets: setsForAugment(augment),
    win_rate: augment.win_rate ?? 50,
    score: result.total,
    tier: scoreToTier(result.total),
    rarity: augment.rarity,
    probability: probabilityOfTarget(rarityTotal, 1, 3),
    probabilityWithReroll: probabilityOfTarget(rarityTotal, 1, 6),
  };
}

export function buildOverlayAugmentLookup(args: {
  allAugments: ScoredAugment[];
  poolData: ChampionPoolBreakdown | null;
  championWinRate?: number | null;
  comboTiers?: Map<string, ComboTier>;
  abilityProfile?: AbilityProfile;
}): OverlayAugmentLookup {
  const lookup: OverlayAugmentLookup = new Map();
  const poolBySlug = poolAugmentsBySlug(args.poolData);
  const counts = rarityCounts(args.allAugments);

  for (const augment of args.allAugments) {
    if (augment.flags?.lifecycle === "removed") continue;

    const scored = poolBySlug.get(augment.slug) ?? fallbackScoredAugment({
      augment,
      championWinRate: args.championWinRate,
      comboTier: args.comboTiers?.get(augment.slug),
      abilityProfile: args.abilityProfile,
      rarityTotal: counts[augment.rarity],
    });

    addName(lookup, augment.name, scored);
    addName(lookup, augment.name_zh_TW, scored);
    addName(lookup, augment.name_zh_CN, scored);
    addName(lookup, augment.name_ja, scored);
    addName(lookup, augment.name_ko, scored);
  }

  return lookup;
}

export function matchAugmentName(
  ocrText: string,
  lookup: OverlayAugmentLookup,
): PoolAugment | null {
  if (!ocrText) return null;
  const cleaned = normalizeAugmentNameForLookup(ocrText);
  if (!cleaned) return null;

  const exact = lookup.get(cleaned);
  if (exact) return exact;

  for (const [name, augment] of lookup) {
    if (cleaned.length >= 2 && name.length >= 2 && (cleaned.includes(name) || name.includes(cleaned))) {
      return augment;
    }
  }

  let bestMatch: PoolAugment | null = null;
  let bestDist = Infinity;
  for (const [name, augment] of lookup) {
    const dist = levenshtein(cleaned, name);
    const threshold = Math.ceil(Math.min(cleaned.length, name.length) * 0.3);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      bestMatch = augment;
    }
  }

  return bestMatch;
}
