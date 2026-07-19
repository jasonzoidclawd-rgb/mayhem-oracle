/**
 * DEVELOPMENT-ONLY React hook that loads the ARAMGG source and resolves each
 * Mayhem augment identity to a canonical ARAMGG record. Owns the live fetch,
 * the transparent dev cache (used only as a fallback AFTER ≥1 successful
 * fetch), force-refresh, and per-augment match logging.
 *
 * It NEVER produces synthetic statistics: an augment that does not resolve to a
 * live ARAMGG stat is simply absent from `resolvedBySlug` (diagnosed by the
 * debug panel, never faked).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAramggRaws,
  normalizeIconBase,
  parseAramggSource,
  resolveAugmentId,
  resolveOcrTitle,
  selectAramggStatsForChampion,
  type AramggRaws,
  type AramggSource,
  type AramggStat,
  type RiotTitleRejection,
  type RiotTitleResolution,
} from "./aramggSource";
import type { AramggFixtureCard } from "./tierFixture";

/** Minimal Mayhem augment identity the resolver needs (structural). */
export interface MayhemAugmentIdentity {
  slug: string;
  icon?: string;
  name_zh_CN?: string;
}

/**
 * Staged identity resolution for ONE OCR card title. The stages are explicit
 * so diagnostics can distinguish "Riot identity unresolved" from "Riot
 * identity resolved but ARAMGG record missing". The card icon is never
 * consulted — quest cards replace or obscure it.
 */
export type SlotAramggResolution =
  | {
      kind: "matched";
      riot: RiotTitleResolution;
      stat: AramggStat;
      localSlug: string | null;
    }
  | {
      kind: "no-data"; // Riot canonical ID resolved; ARAMGG has no stat record
      riot: RiotTitleResolution;
      localSlug: string | null;
    }
  | {
      kind: "unmatched"; // Riot identity unresolved (rejection carries stage/reason)
      rejection: RiotTitleRejection;
    };

export interface AramggFixtureState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** True when the ready source came from the dev cache, not a live fetch. */
  fromCache: boolean;
  patch: string | null;
  fetchedAt: number | null;
  sourceUrls: AramggSource["sourceUrls"] | null;
  /** slug → resolved record, only for augments matched to a LIVE stat. */
  resolvedBySlug: Map<string, AramggFixtureCard>;
  /**
   * OCR title → staged canonical resolution (zh-TW Riot catalog → numeric ID →
   * ARAMGG stats). Null until the source is ready.
   */
  resolveSlotTitle: ((ocrTitle: string) => SlotAramggResolution) | null;
  refresh: () => void;
}

// v2: raws now include the Riot zh-TW catalog; older cached shapes must not
// be parsed (they would silently lose the canonical zh-TW bridge).
const CACHE_KEY = "mayhem-aramgg-fixture-cache-v2";

interface CacheEntry {
  raws: AramggRaws;
  fetchedAt: number;
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.raws || typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* dev cache is best-effort; ignore quota/serialization errors */
  }
}

export function useAramggTierFixture(
  enabled: boolean,
  augments: MayhemAugmentIdentity[] | undefined,
  championKey: string | null,
): AramggFixtureState {
  const [source, setSource] = useState<AramggSource | null>(null);
  const [status, setStatus] = useState<AramggFixtureState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      setStatus("loading");
      setError(null);
      try {
        const raws = await fetchAramggRaws();
        const parsed = parseAramggSource(raws, Date.now());
        if (cancelled) return;
        writeCache({ raws, fetchedAt: parsed.fetchedAt });
        setSource(parsed);
        setFromCache(false);
        setStatus("ready");
      } catch (liveError) {
        if (cancelled) return;
        // Transparent fallback: only a cache written by a PRIOR successful
        // fetch. Labeled `fromCache` so the UI never presents it as live.
        const cached = readCache();
        if (cached) {
          try {
            const parsed = parseAramggSource(cached.raws, cached.fetchedAt);
            if (cancelled) return;
            setSource(parsed);
            setFromCache(true);
            setStatus("ready");
            return;
          } catch {
            /* fall through to error */
          }
        }
        setSource(null);
        setError(liveError instanceof Error ? liveError.message : "ARAMGG load failed");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  const selectedStatsById = useMemo(
    () => selectAramggStatsForChampion(source?.statsById ?? new Map(), championKey),
    [source, championKey],
  );

  const resolvedBySlug = useMemo(() => {
    const map = new Map<string, AramggFixtureCard>();
    if (!source || !augments) return map;
    for (const a of augments) {
      const res = resolveAugmentId(
        { iconBase: normalizeIconBase(a.icon), localizedName: a.name_zh_CN },
        source.catalog,
      );
      if (res.augmentId === null) continue;
      const stat = selectedStatsById.get(res.augmentId);
      if (!stat) continue;
      if (res.method === "localized-name") {
        // Explicitly log the last-resort match path (requirement).
        console.info(
          `[aramgg-fixture] localized-name fallback: "${a.slug}" → augmentId ${res.augmentId}`,
        );
      }
      map.set(a.slug, { slug: a.slug, stat, method: res.method });
    }
    return map;
  }, [source, augments, selectedStatsById]);

  // augmentId → local slug (unique inversions only) so a canonical Riot match
  // can be labeled with the local catalog slug when one exists.
  const localSlugByAugmentId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const [slug, card] of resolvedBySlug) {
      map.set(card.stat.augmentId, map.has(card.stat.augmentId) ? null : slug);
    }
    return map;
  }, [resolvedBySlug]);

  const resolveSlotTitle = useMemo(() => {
    if (!source) return null;
    return (ocrTitle: string): SlotAramggResolution => {
      const riot = resolveOcrTitle(ocrTitle, source.titleIndex);
      if (riot.augmentId === null) {
        return { kind: "unmatched", rejection: riot };
      }
      if (riot.method === "riot-zh-cn-exact") {
        // Explicitly-logged last resort: Traditional OCR resolved only via the
        // Simplified catalog name.
        console.info(
          `[aramgg-fixture] zh-CN last-resort title match: "${ocrTitle}" → augmentId ${riot.augmentId}`,
        );
      }
      const localSlug = localSlugByAugmentId.get(riot.augmentId) ?? null;
      const stat = selectedStatsById.get(riot.augmentId);
      if (!stat) return { kind: "no-data", riot, localSlug };
      return { kind: "matched", riot, stat, localSlug };
    };
  }, [source, localSlugByAugmentId, selectedStatsById]);

  return {
    status,
    error,
    fromCache,
    patch: source?.patch ?? null,
    fetchedAt: source?.fetchedAt ?? null,
    sourceUrls: source?.sourceUrls ?? null,
    resolvedBySlug,
    resolveSlotTitle,
    refresh,
  };
}
