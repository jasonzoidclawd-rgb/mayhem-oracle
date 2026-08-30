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
import { traceAramggFetch } from "./aramggFetchTrace";
import {
  parseChampionAugmentDataset,
  type ChampionAugmentDataset,
} from "./championStats";

/**
 * The authoritative COMPLETE per-champion augment file. Unlike the champion
 * PAGE (`/en/champion-stats/{id}`), which embeds only a top-augments subset
 * (~60 rows) and so silently drops champion-specific rows for less-picked
 * augments, this static data file carries EVERY augment the champion has data
 * for. Reading the page subset is what caused absent rows to fall through to the
 * (now removed) global fallback; the complete file makes absence provable.
 */
export function championAugmentsDataPath(championId: string): string {
  return `/data/champion-augments/${championId}.json`;
}

/** Fetch one champion's complete augment data file through the dev proxy. Throws on HTTP error. */
export async function fetchChampionAugmentsText(
  fetchImpl: typeof fetch,
  championId: string,
): Promise<string> {
  const path = championAugmentsDataPath(championId);
  const url = `${ARAMGG_DEV_PROXY_PREFIX}${path}`;
  return traceAramggFetch(
    {
      source: "aramgg-dev",
      phase: "champion-dataset",
      endpointKind: "champion-augments-file",
      path: url,
      championId,
    },
    async () => {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`champion-augments fetch failed: ${url} → HTTP ${res.status}`);
      }
      return res.text();
    },
  );
}

/**
 * The file is a list of `[championId, statsJSONString]` pairs (usually one). The
 * second element is a JSON STRING that must be parsed again into the
 * `{"augments":{…}, "tier", "win_rate", …}` champion detail object. Returns null
 * when no matching champion entry is present. Never throws on malformed text.
 */
export function parseChampionAugmentsFile(text: string, championId: string): unknown {
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (Array.isArray(entry) && String(entry[0]) === championId && typeof entry[1] === "string") {
      try {
        return JSON.parse(entry[1]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Fetch and parse one champion's COMPLETE augment table. Fails EXPLICITLY
 * (throws) on any retrieval or parse failure — offline/cache-miss is never a
 * silent empty dataset. The dataset is marked `complete`, so an absent augment
 * row resolves to NO CHAMP DATA, never to a global value.
 */
export async function loadChampionAugmentDataset(
  fetchImpl: typeof fetch,
  championId: string,
  patch: string | null,
): Promise<ChampionAugmentDataset> {
  const text = await fetchChampionAugmentsText(fetchImpl, championId);
  const raw = parseChampionAugmentsFile(text, championId);
  if (raw === null) {
    throw new Error(`champion-augments file for ${championId} had no augments block`);
  }
  return parseChampionAugmentDataset(raw, {
    championId,
    patch,
    source: `${ARAMGG_SOURCE.origin}${championAugmentsDataPath(championId)}`,
    completeness: "complete",
  });
}

// ─── Local Step-4 artifact loader (Path B: no /aramgg-dev at runtime) ───

/**
 * Dev-server URL for the locally generated ARAMGG champion×augment artifact
 * (`data/internal/aramgg-champion-augments.artifact.json`), served same-origin
 * by the Vite middleware in `vite.config.ts`. Same-origin so it satisfies the
 * webview's `connect-src 'self'` CSP with no proxy and no external request.
 * The `tauri build` bundle has no such middleware and never imports this module.
 */
export const LOCAL_ARTIFACT_URL = "/local-aramgg-artifact.json";

/**
 * Build one champion's COMPLETE augment dataset from the local Step-4 artifact.
 *
 * The artifact's per-champion `rows` carry the same numeric ARAMGG augment id
 * (`aramggAugmentId`) the identity/OCR resolvers produce and the raw decimal
 * strings ARAMGG published, so each row maps 1:1 onto the `{augments:{…}}`
 * shape `parseChampionAugmentDataset` already consumes. A row ARAMGG published
 * with no win rate (below its minimum sample size) is carried through verbatim
 * and dropped by `parseRow`, so it resolves to NO CHAMP DATA — never a
 * stand-in value.
 *
 * A rostered champion the artifact lists in `championsWithoutCurrentSource`
 * (ARAMGG serves no current-patch file for it) THROWS, exactly as the live
 * endpoint's 404 did: the slot shows DATA ERROR, never a percentage.
 *
 * The dataset is stamped with the artifact's OWN serving patch, not the
 * caller's: the ownership guard in `useAramggTierFixture` then rejects display
 * when the live changelog has moved past what the artifact actually observed,
 * instead of relabelling stale numbers to the current patch.
 */
export function championDatasetFromArtifact(
  artifact: unknown,
  championId: string,
  patch: string | null,
): ChampionAugmentDataset {
  const payload =
    artifact !== null && typeof artifact === "object"
      ? (artifact as Record<string, unknown>).payload
      : null;
  if (payload === null || typeof payload !== "object") {
    throw new Error("local ARAMGG artifact: missing payload object");
  }
  const p = payload as Record<string, unknown>;

  const champions = Array.isArray(p.champions) ? p.champions : [];
  const champion = champions.find(
    (c) =>
      c !== null &&
      typeof c === "object" &&
      String((c as Record<string, unknown>).championKey) === championId,
  ) as Record<string, unknown> | undefined;

  if (!champion) {
    const absent = (Array.isArray(p.championsWithoutCurrentSource)
      ? p.championsWithoutCurrentSource
      : []
    ).find(
      (c) =>
        c !== null &&
        typeof c === "object" &&
        String((c as Record<string, unknown>).championKey) === championId,
    ) as Record<string, unknown> | undefined;
    if (absent) {
      throw new Error(
        `local ARAMGG artifact: champion ${championId} has no current-source file ` +
          `(absent, HTTP ${String(absent.httpStatus)})`,
      );
    }
    throw new Error(`local ARAMGG artifact: champion ${championId} not in artifact roster`);
  }

  const rows = Array.isArray(champion.rows) ? champion.rows : [];
  const augments: Record<string, unknown> = {};
  for (const entry of rows) {
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id =
      typeof row.aramggAugmentId === "string"
        ? row.aramggAugmentId
        : String(row.aramggAugmentId ?? "");
    if (!/^\d+$/.test(id)) continue;
    augments[id] = {
      tier: row.tier,
      rank: row.rank,
      win_rate: row.winRateRaw,
      num_games: row.numGames,
      pick_rate: row.pickRateRaw,
    };
  }

  const servingPatch =
    typeof champion.servingPatchRaw === "string" && champion.servingPatchRaw.length > 0
      ? champion.servingPatchRaw
      : readArtifactServingPatch(p) ?? patch;

  return parseChampionAugmentDataset(
    { augments },
    {
      championId,
      patch: servingPatch,
      source: `${LOCAL_ARTIFACT_URL}#${championId}`,
      completeness: "complete",
    },
  );
}

function readArtifactServingPatch(payload: Record<string, unknown>): string | null {
  const sp = payload.sourcePatch;
  if (sp === null || typeof sp !== "object") return null;
  const serving = (sp as Record<string, unknown>).serving;
  if (serving === null || typeof serving !== "object") return null;
  const raw = (serving as Record<string, unknown>).rawValue;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

let localArtifactPromise: Promise<unknown> | null = null;

/**
 * Fetch the local artifact JSON. Memoized for the real webview (one same-origin
 * request per session); an injected `fetchImpl` (tests) is never memoized.
 */
export function fetchLocalArtifact(fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const load = async (): Promise<unknown> => traceAramggFetch(
    {
      source: "local-artifact",
      phase: "champion-dataset",
      endpointKind: "local-artifact-file",
      path: LOCAL_ARTIFACT_URL,
    },
    async () => {
      const res = await fetchImpl(LOCAL_ARTIFACT_URL);
      if (!res.ok) {
        throw new Error(
          `local ARAMGG artifact fetch failed: ${LOCAL_ARTIFACT_URL} → HTTP ${res.status}`,
        );
      }
      return res.json();
    },
  );
  if (fetchImpl !== fetch) return load();
  if (!localArtifactPromise) {
    localArtifactPromise = load().catch((err) => {
      localArtifactPromise = null; // a failed load must not poison later attempts
      throw err;
    });
  }
  return localArtifactPromise;
}

/** Local-artifact drop-in for `loadChampionAugmentDataset` (identical signature). */
export async function loadChampionAugmentDatasetLocal(
  fetchImpl: typeof fetch,
  championId: string,
  patch: string | null,
): Promise<ChampionAugmentDataset> {
  return championDatasetFromArtifact(await fetchLocalArtifact(fetchImpl), championId, patch);
}

// ─── Cache keyed by (championId, patch) with in-flight dedupe ───

function cacheKey(championId: string, patch: string | null): string {
  return `${championId}::${patch ?? "unknown"}`;
}

export class ChampionDatasetCache {
  private readonly ready = new Map<string, ChampionAugmentDataset>();
  private readonly inflight = new Map<string, Promise<ChampionAugmentDataset>>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    /**
     * How one champion's dataset is loaded. Defaults to the live
     * `/aramgg-dev` endpoint; the dev fixture passes
     * `loadChampionAugmentDatasetLocal` so gameplay reads the local Step-4
     * artifact and issues no ARAMGG request.
     */
    private readonly loader: (
      fetchImpl: typeof fetch,
      championId: string,
      patch: string | null,
    ) => Promise<ChampionAugmentDataset> = loadChampionAugmentDataset,
  ) {}

  /** Cached dataset for this champion+patch, fetching (once) if absent. */
  get(championId: string, patch: string | null): Promise<ChampionAugmentDataset> {
    const key = cacheKey(championId, patch);
    const ready = this.ready.get(key);
    if (ready) return Promise.resolve(ready);
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;
    const promise = this.loader(this.fetchImpl, championId, patch)
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
    patchesMatch(token.patch, current.patch)
  );
}

/**
 * Patch equality where an UNRESOLVED patch matches nothing — not even another
 * unresolved patch.
 *
 * A plain `===` treated two independent resolution failures as the same patch
 * (`null === null`, and previously `"unknown" === "unknown"` once
 * `aramggSource` had substituted its sentinel), which let a champion dataset
 * fetched under one unknown patch satisfy the ownership guard for a different
 * unknown patch. Cross-patch statistics could reach a badge that way.
 *
 * Absence is not a value, so it cannot be equal to anything.
 */
export function patchesMatch(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}
