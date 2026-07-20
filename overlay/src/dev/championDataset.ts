/**
 * DEVELOPMENT-ONLY live loader + cache + ownership for the champion-first
 * augment dataset (PR #46 Sections 3–4).
 *
 * The dataset is fetched ONCE when the final in-game champion becomes known and
 * cached by (championId, patch). ARAMGG server-renders each champion's own
 * augment table into the champion page flight payload; the RSC flight stream
 * (`text/x-component`) is requested with `RSC: 1` and both it and the HTML form
 * carry `access-control-allow-origin: *`. At dev runtime the request goes
 * THROUGH the Vite dev proxy (`/aramgg-dev` → https://aramgg.com) so the webview
 * fetch is same-origin under `connect-src 'self'`. Production builds stub the
 * dev fixture entirely and never import this module.
 *
 * Every published statistic must be guarded by an ownership token so a response
 * from a superseded champion/foreground epoch can never overwrite current state.
 */
import { ARAMGG_DEV_PROXY_PREFIX, ARAMGG_SOURCE } from "./aramggSource";
import {
  extractChampionFlightObject,
  parseChampionAugmentDataset,
  type ChampionAugmentDataset,
} from "./championStats";

/** The public champion-stats page path, recorded verbatim for provenance. */
export function championStatsPath(championId: string): string {
  return `/en/champion-stats/${championId}`;
}

/** Fetch one champion page's flight text through the dev proxy. Throws on HTTP error. */
export async function fetchChampionPageText(
  fetchImpl: typeof fetch,
  championId: string,
): Promise<string> {
  const url = `${ARAMGG_DEV_PROXY_PREFIX}${championStatsPath(championId)}`;
  // `RSC: 1` asks Next.js for the clean flight stream; the HTML form parses too.
  const res = await fetchImpl(url, { headers: { RSC: "1" } });
  if (!res.ok) {
    throw new Error(`champion-stats fetch failed: ${url} → HTTP ${res.status}`);
  }
  return res.text();
}

/**
 * Fetch and parse one champion's complete augment table. Fails EXPLICITLY
 * (throws) on any retrieval or parse failure — offline/cache-miss is never a
 * silent empty dataset. `source` is the canonical (non-proxy) URL for display.
 */
export async function loadChampionAugmentDataset(
  fetchImpl: typeof fetch,
  championId: string,
  patch: string | null,
): Promise<ChampionAugmentDataset> {
  const text = await fetchChampionPageText(fetchImpl, championId);
  const raw = extractChampionFlightObject(text);
  if (raw === null) {
    throw new Error(`champion-stats page for ${championId} had no augments block`);
  }
  return parseChampionAugmentDataset(raw, {
    championId,
    patch,
    source: `${ARAMGG_SOURCE.origin}${championStatsPath(championId)}`,
  });
}

// ─── Cache keyed by (championId, patch) with in-flight dedupe ───

function cacheKey(championId: string, patch: string | null): string {
  return `${championId}::${patch ?? "unknown"}`;
}

export class ChampionDatasetCache {
  private readonly ready = new Map<string, ChampionAugmentDataset>();
  private readonly inflight = new Map<string, Promise<ChampionAugmentDataset>>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** Cached dataset for this champion+patch, fetching (once) if absent. */
  get(championId: string, patch: string | null): Promise<ChampionAugmentDataset> {
    const key = cacheKey(championId, patch);
    const ready = this.ready.get(key);
    if (ready) return Promise.resolve(ready);
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;
    const promise = loadChampionAugmentDataset(this.fetchImpl, championId, patch)
      .then((ds) => {
        this.ready.set(key, ds);
        this.inflight.delete(key);
        return ds;
      })
      .catch((err) => {
        // A failed load must not poison the cache — a later attempt may succeed.
        this.inflight.delete(key);
        throw err;
      });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Already-resolved dataset without triggering a fetch, else null. */
  peek(championId: string, patch: string | null): ChampionAugmentDataset | null {
    return this.ready.get(cacheKey(championId, patch)) ?? null;
  }

  has(championId: string, patch: string | null): boolean {
    return this.ready.has(cacheKey(championId, patch));
  }
}

// ─── Ownership token: a stale response can never publish ───

export interface ChampionOwnershipToken {
  /** Foreground/active-game epoch at request time. */
  gameEpoch: number;
  /** Champion generation (bumps on every final-champion change). */
  championGeneration: number;
  /** Canonical numeric Riot champion ID. */
  championId: string;
  /** Monotonic dataset-request id. */
  requestId: number;
  /** Dataset patch/version. */
  patch: string | null;
}

/**
 * A dataset (or a statistic derived from it) may publish only when EVERY
 * ownership field still matches current state. A champion change, epoch change,
 * patch change, or a superseded request id all reject the publish.
 */
export function championOwnershipCurrent(
  token: ChampionOwnershipToken,
  current: ChampionOwnershipToken,
): boolean {
  return (
    token.gameEpoch === current.gameEpoch &&
    token.championGeneration === current.championGeneration &&
    token.championId === current.championId &&
    token.requestId === current.requestId &&
    token.patch === current.patch
  );
}
