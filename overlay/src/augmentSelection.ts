import type { PoolAugment } from "./scoring";

export function shouldStartAugmentSelection({
  augmentLevel,
}: {
  augmentLevel: number | undefined;
}): boolean {
  return augmentLevel !== undefined;
}

export function shouldEndAugmentSelectionForLevel({
  playerLevel,
  lastAugmentLevel,
}: {
  playerLevel: number;
  lastAugmentLevel: number;
}): boolean {
  return lastAugmentLevel > 0 && playerLevel > lastAugmentLevel;
}

export function advanceOcrSelection(
  state: { hasSeenCards: boolean; emptyPasses: number },
  detectedCardCount: number,
) {
  if (detectedCardCount > 0) {
    return { hasSeenCards: true, emptyPasses: 0, shouldStop: false };
  }
  if (!state.hasSeenCards) {
    return { ...state, shouldStop: false };
  }

  const emptyPasses = state.emptyPasses + 1;
  return {
    hasSeenCards: true,
    emptyPasses,
    shouldStop: emptyPasses >= 2,
  };
}

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

function isCjkText(value: string): boolean {
  return /^[\u3400-\u9fff:：]+$/.test(value);
}

function oneCharacterCjkMatch(
  cleaned: string,
  lookup: Map<string, PoolAugment>,
): PoolAugment | null {
  if (cleaned.length < 4 || !isCjkText(cleaned)) return null;

  let match: PoolAugment | null = null;
  for (const [name, aug] of lookup) {
    if (
      name.length === cleaned.length &&
      isCjkText(name) &&
      levenshtein(cleaned, name) === 1
    ) {
      if (match && match.slug !== aug.slug) return null;
      match = aug;
    }
  }

  return match;
}

export function addAugmentAliases(
  lookup: Map<string, PoolAugment>,
  augment: PoolAugment,
) {
  if (augment.slug !== "quest-steel-your-heart") return;
  lookup.set("任務:鋼鐵雄心", augment);
  lookup.set("任務：鋼鐵雄心", augment);
}

export function matchAugment(
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

  const cjkMatch = oneCharacterCjkMatch(cleaned, lookup);
  if (cjkMatch) return cjkMatch;

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
