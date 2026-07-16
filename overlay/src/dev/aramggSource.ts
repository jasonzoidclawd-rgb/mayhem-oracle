/**
 * DEVELOPMENT-ONLY ARAMGG data adapter for evaluating PR #46's tier card.
 *
 * ARAMGG (aramgg.com) is the CANONICAL, non-synthetic source of augment win
 * rate, sample size and tier for the dev tier-fixture. This module fetches and
 * parses ARAMGG's public static JSON and resolves each League/CDragon augment
 * identity to an ARAMGG record. It NEVER invents statistics and NEVER falls
 * back to local `augments.json` win rates: an augment that cannot be matched to
 * a live ARAMGG record simply has no stat (diagnosed, never faked).
 *
 * Only pure functions and an injectable `loadAramggSource(fetch)` live here so
 * the parsing/matching/formatting logic is unit-testable without a browser or
 * `import.meta`. The DEV+flag gate lives in `tierFixture.ts`.
 */
import type { DecisionGrade } from "../contracts/decision";
import type { TierLetter } from "../model/tier";

// Canonical source URLs, recorded verbatim for provenance display. At dev
// runtime the overlay fetches these THROUGH the Vite dev proxy
// (`/aramgg-dev` → https://aramgg.com, see vite.config.ts) so the request is
// same-origin and satisfies the webview's `connect-src 'self'` CSP without
// weakening it. Production builds never import this module's loader.
export const ARAMGG_SOURCE = {
  origin: "https://aramgg.com",
  stats: "/data/augments-stats-raw.json",
  catalog: "/data/aram-mayhem-augments.zh_cn.json",
  changelog: "/data/augments-changelog/index.json",
} as const;

/** Dev-only proxy prefix; forwarded server-side by Vite to ARAMGG_SOURCE.origin. */
export const ARAMGG_DEV_PROXY_PREFIX = "/aramgg-dev";

// ─── Types ───

export interface AramggStat {
  augmentId: string;
  /** Raw win rate string exactly as ARAMGG supplies it, e.g. "0.563213". */
  rawWinRate: string;
  /** Exact percentage via string decimal shift (×100), e.g. "56.3213". */
  winRatePercent: string;
  numGames: string;
  pickRate: string;
  /** Upstream numeric tier (1 = best … 5 = worst). */
  tier: number;
  /** Presentation-relabeled card tier (ARAMGG upstream tier, relabeled). */
  tierLetter: TierLetter;
  /** Decision grade whose `tierForGrade` yields the same letter. */
  grade: DecisionGrade;
}

export interface AramggCatalogEntry {
  augmentId: string;
  /** Language-independent CDragon/API canonical name, e.g. "ARAM_ImTheJuggernaut". */
  canonicalName: string | null;
  /** Localized (zh_cn) display name. */
  displayName: string | null;
  /** Normalized CDragon icon-asset base (the canonical bridge key). */
  iconBase: string | null;
}

export interface AramggCatalogIndex {
  entries: Map<string, AramggCatalogEntry>;
  /** normalized icon base → augmentId[] (collision list). */
  byIconBase: Map<string, string[]>;
  /** normalized display name → augmentId[] (collision list). */
  byName: Map<string, string[]>;
  /** normalized canonical name → augmentId[] (collision list). */
  byCanonicalName: Map<string, string[]>;
}

export type MatchMethod =
  | "cdragon-icon" // priority 2: language-independent CDragon asset (unambiguous)
  | "cdragon-icon+zh-tiebreak" // ambiguous icon disambiguated by localized name
  | "canonical-name" // priority 2: ARAM_* canonical name (when the caller has it)
  | "localized-name"; // priority 3: last resort (explicitly logged)

export interface AramggResolution {
  augmentId: string;
  method: MatchMethod;
}

export interface AramggResolutionFailure {
  augmentId: null;
  reason: "ambiguous-icon" | "ambiguous-name" | "unmatched";
  detail?: string;
}

export interface AramggSource {
  statsById: Map<string, AramggStat>;
  catalog: AramggCatalogIndex;
  /** ARAMGG data patch, e.g. "16.13" (site displays "26.13"). */
  patch: string;
  fetchedAt: number;
  sourceUrls: { stats: string; catalog: string; changelog: string };
}

// ─── Pure: win-rate percentage via exact string decimal shift ───

/**
 * Convert a 0–1 fraction STRING to a percentage STRING by shifting the decimal
 * point right two places on the digits themselves — never floating-point
 * multiplication, which would produce IEEE-754 artifacts (0.563213 * 100 =
 * 56.32130000000001). Trailing fractional zeros are preserved (source
 * precision); leading integer zeros are stripped.
 *
 *   "0.563213" → "56.3213"   "0.5" → "50"   "0.5000" → "50.00"
 *   "1" → "100"              "0"   → "0"
 *
 * Throws on any non-`\d+(\.\d+)?` input so malformed data never renders.
 */
export function decimalShiftPercent(fraction: string): string {
  if (typeof fraction !== "string" || !/^\d+(\.\d+)?$/.test(fraction)) {
    throw new Error(`decimalShiftPercent: malformed fraction "${fraction}"`);
  }
  const [intPart, fracPart = ""] = fraction.split(".");
  const digits = intPart + fracPart;
  const pointPos = intPart.length + 2; // ×100 shifts the point right by 2
  let out: string;
  if (pointPos >= digits.length) {
    out = digits + "0".repeat(pointPos - digits.length);
  } else {
    out = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
  }
  // Strip leading integer zeros but keep at least one digit; leave the
  // fractional part (and its trailing zeros) untouched.
  return out.replace(/^0+(?=\d)/, "");
}

// ─── Pure: numeric tier → letter / grade ───

const TIER_LETTER_BY_NUM: Record<number, TierLetter> = {
  1: "S+",
  2: "S",
  3: "A",
  4: "B",
  5: "C",
};

// 1→hot(S+) 2→strong(S) 3→steady(A) 4→average(B) 5→weak(C) so the real
// `tierForGrade` presentation reproduces the relabeled ARAMGG tier exactly.
const GRADE_BY_NUM: Record<number, DecisionGrade> = {
  1: "hot",
  2: "strong",
  3: "steady",
  4: "average",
  5: "weak",
};

export function parseNumericTier(tier: string): number {
  if (typeof tier !== "string" || !/^[1-5]$/.test(tier.trim())) {
    throw new Error(`parseNumericTier: malformed tier "${tier}"`);
  }
  return Number(tier.trim());
}

export function numericTierToLetter(tier: string): TierLetter {
  return TIER_LETTER_BY_NUM[parseNumericTier(tier)];
}

export function numericTierToGrade(tier: string): DecisionGrade {
  return GRADE_BY_NUM[parseNumericTier(tier)];
}

// ─── Pure: identity normalization (the canonical bridge) ───

export function normalizeIconBase(iconPath: string | null | undefined): string | null {
  if (!iconPath) return null;
  let b = iconPath.split(/[\\/]/).pop() ?? iconPath;
  b = b.replace(/\.(png|jpg|jpeg|webp)$/i, "");
  b = b.replace(/_(large|small)$/i, "");
  let x = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Mayhem CDragon icons sometimes carry a "MayhemAugment"/"Augment" suffix
  // that ARAMGG's catalog omits; strip it so the bases align.
  x = x.replace(/mayhemaugment$/, "").replace(/augment$/, "");
  return x.length > 0 ? x : null;
}

export function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  // Keep CJK code points (localized names) and alphanumerics; drop punctuation
  // and whitespace so display-name matching is stable across separators.
  const x = name.toLowerCase().replace(/[^0-9a-z㐀-鿿]/g, "");
  return x.length > 0 ? x : null;
}

// ─── Pure: parse ARAMGG stats list ───

/**
 * ARAMGG stats are a list of `[augmentId, statsJSONString]` pairs where the
 * second element is a JSON STRING that must be parsed a second time. Entry
 * lengths are not uniform (an observed first entry had length 5), so iterate
 * defensively: take element 0 as the id and the first string element as the
 * blob. Every record is validated; malformed records are skipped and counted,
 * never coerced.
 */
export function parseStatsList(raw: unknown): {
  stats: Map<string, AramggStat>;
  skipped: number;
} {
  const stats = new Map<string, AramggStat>();
  let skipped = 0;
  if (!Array.isArray(raw)) {
    throw new Error("parseStatsList: expected a JSON array");
  }
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) {
      skipped++;
      continue;
    }
    const augmentId = String(entry[0]);
    // The stats blob is reliably element 1 (true even for the observed length-5
    // entry, whose trailing elements are metadata); fall back to the first
    // string after the id if element 1 is not a string. A wrong pick fails
    // validation below and is skipped, never coerced.
    const blob = (
      typeof entry[1] === "string"
        ? entry[1]
        : entry.find((e, i) => i > 0 && typeof e === "string")
    ) as string | undefined;
    if (!augmentId || !/^\d+$/.test(augmentId) || !blob) {
      skipped++;
      continue;
    }
    try {
      const parsed = JSON.parse(blob) as Record<string, unknown>;
      const rawWinRate = parsed.win_rate;
      const numGames = parsed.num_games;
      const tierRaw = parsed.tier;
      if (
        typeof rawWinRate !== "string" ||
        typeof numGames !== "string" ||
        typeof tierRaw !== "string"
      ) {
        skipped++;
        continue;
      }
      const tier = parseNumericTier(tierRaw); // throws on malformed → caught
      stats.set(augmentId, {
        augmentId,
        rawWinRate,
        winRatePercent: decimalShiftPercent(rawWinRate), // throws → caught
        numGames,
        pickRate: typeof parsed.pick_rate === "string" ? parsed.pick_rate : "",
        tier,
        tierLetter: TIER_LETTER_BY_NUM[tier],
        grade: GRADE_BY_NUM[tier],
      });
    } catch {
      skipped++;
    }
  }
  return { stats, skipped };
}

// ─── Pure: build catalog index ───

export function buildCatalogIndex(catalog: unknown): AramggCatalogIndex {
  const entries = new Map<string, AramggCatalogEntry>();
  const byIconBase = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const byCanonicalName = new Map<string, string[]>();
  if (catalog === null || typeof catalog !== "object") {
    throw new Error("buildCatalogIndex: expected a JSON object");
  }
  for (const [augmentId, value] of Object.entries(catalog as Record<string, unknown>)) {
    if (!/^\d+$/.test(augmentId) || value === null || typeof value !== "object") {
      continue;
    }
    const rec = value as Record<string, unknown>;
    const iconBase = normalizeIconBase(
      (typeof rec.iconLarge === "string" && rec.iconLarge) ||
        (typeof rec.iconSmall === "string" && rec.iconSmall) ||
        null,
    );
    const displayName = typeof rec.displayName === "string" ? rec.displayName : null;
    const canonicalName = typeof rec.name === "string" ? rec.name : null;
    entries.set(augmentId, { augmentId, canonicalName, displayName, iconBase });
    if (iconBase) byIconBase.set(iconBase, [...(byIconBase.get(iconBase) ?? []), augmentId]);
    const nn = normalizeName(displayName);
    if (nn) byName.set(nn, [...(byName.get(nn) ?? []), augmentId]);
    const cn = normalizeName(canonicalName);
    if (cn) byCanonicalName.set(cn, [...(byCanonicalName.get(cn) ?? []), augmentId]);
  }
  return { entries, byIconBase, byName, byCanonicalName };
}

// ─── Pure: resolve a League/CDragon augment identity → ARAMGG augmentId ───

/**
 * Matching priority (never silently accepts an ambiguous localized name):
 *   1. numeric canonical augment ID — Mayhem augment data carries none, so
 *      unavailable from the caller; the loop begins at priority 2.
 *   2. language-independent identity: the ARAM_* canonical name if the caller
 *      supplies one, else the normalized CDragon icon-asset base. An icon base
 *      shared by >1 augmentId is ambiguous → disambiguated only by an exact
 *      localized-name tie-break, otherwise rejected.
 *   3. normalized localized display name — explicitly-logged last resort.
 */
export function resolveAugmentId(
  input: {
    numericId?: string | null;
    canonicalName?: string | null;
    iconBase?: string | null;
    localizedName?: string | null;
  },
  index: AramggCatalogIndex,
): AramggResolution | AramggResolutionFailure {
  // Priority 1: numeric canonical augment ID (direct catalog key).
  if (input.numericId && index.entries.has(String(input.numericId))) {
    return { augmentId: String(input.numericId), method: "canonical-name" };
  }
  // Priority 2a: ARAM_* canonical name (language-independent).
  const cn = normalizeName(input.canonicalName);
  if (cn) {
    const ids = index.byCanonicalName.get(cn);
    if (ids && ids.length === 1) return { augmentId: ids[0], method: "canonical-name" };
  }
  // Priority 2b: CDragon icon-asset base (language-independent).
  if (input.iconBase) {
    const ids = index.byIconBase.get(input.iconBase);
    if (ids && ids.length === 1) {
      return { augmentId: ids[0], method: "cdragon-icon" };
    }
    if (ids && ids.length > 1) {
      const nn = normalizeName(input.localizedName);
      const tie = nn
        ? ids.filter((id) => normalizeName(index.entries.get(id)?.displayName) === nn)
        : [];
      if (tie.length === 1) {
        return { augmentId: tie[0], method: "cdragon-icon+zh-tiebreak" };
      }
      return {
        augmentId: null,
        reason: "ambiguous-icon",
        detail: `${ids.length} augmentIds share icon base "${input.iconBase}"`,
      };
    }
  }
  // Priority 3: localized display-name last resort (logged by the caller).
  const nn = normalizeName(input.localizedName);
  if (nn) {
    const ids = index.byName.get(nn);
    if (ids && ids.length === 1) return { augmentId: ids[0], method: "localized-name" };
    if (ids && ids.length > 1) {
      return {
        augmentId: null,
        reason: "ambiguous-name",
        detail: `${ids.length} augmentIds share localized name`,
      };
    }
  }
  return { augmentId: null, reason: "unmatched" };
}

// ─── Async: load the live ARAMGG source ───

/** The three raw JSON payloads — plain, fully serializable (cacheable). */
export interface AramggRaws {
  stats: unknown;
  catalog: unknown;
  changelog: unknown;
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`ARAMGG fetch failed: ${url} → HTTP ${res.status}`);
  }
  return res.json();
}

/** Fetch all three ARAMGG files through the dev proxy. Throws on any HTTP error. */
export async function fetchAramggRaws(
  fetchImpl: typeof fetch = fetch,
): Promise<AramggRaws> {
  const url = (path: string) => `${ARAMGG_DEV_PROXY_PREFIX}${path}`;
  const [stats, catalog, changelog] = await Promise.all([
    fetchJson(fetchImpl, url(ARAMGG_SOURCE.stats)),
    fetchJson(fetchImpl, url(ARAMGG_SOURCE.catalog)),
    fetchJson(fetchImpl, url(ARAMGG_SOURCE.changelog)),
  ]);
  return { stats, catalog, changelog };
}

/**
 * Parse raw ARAMGG payloads into a resolved source. Fails EXPLICITLY (throws)
 * on any parse failure — the caller surfaces the diagnostic and stops; it must
 * never substitute invented or local statistics.
 */
export function parseAramggSource(raws: AramggRaws, fetchedAt: number): AramggSource {
  const { stats: statsRaw, catalog: catalogRaw, changelog: changelogRaw } = raws;

  const { stats } = parseStatsList(statsRaw);
  if (stats.size === 0) {
    throw new Error("ARAMGG stats parsed to zero valid records");
  }
  const catalog = buildCatalogIndex(catalogRaw);
  if (catalog.entries.size === 0) {
    throw new Error("ARAMGG catalog parsed to zero valid entries");
  }
  const patch =
    changelogRaw !== null &&
    typeof changelogRaw === "object" &&
    typeof (changelogRaw as Record<string, unknown>).latest === "string"
      ? ((changelogRaw as Record<string, unknown>).latest as string)
      : "unknown";

  return {
    statsById: stats,
    catalog,
    patch,
    fetchedAt,
    sourceUrls: {
      stats: `${ARAMGG_SOURCE.origin}${ARAMGG_SOURCE.stats}`,
      catalog: `${ARAMGG_SOURCE.origin}${ARAMGG_SOURCE.catalog}`,
      changelog: `${ARAMGG_SOURCE.origin}${ARAMGG_SOURCE.changelog}`,
    },
  };
}

/**
 * Fetch and parse all three ARAMGG files. Fails EXPLICITLY (throws) on any
 * retrieval or parse failure — the caller surfaces the diagnostic and stops.
 */
export async function loadAramggSource(
  fetchImpl: typeof fetch = fetch,
): Promise<AramggSource> {
  return parseAramggSource(await fetchAramggRaws(fetchImpl), Date.now());
}
