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
  type AramggRaws,
  type AramggSource,
} from "./aramggSource";
import type { AramggFixtureCard } from "./tierFixture";

/** Minimal Mayhem augment identity the resolver needs (structural). */
export interface MayhemAugmentIdentity {
  slug: string;
  icon?: string;
  name_zh_CN?: string;
}

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
  refresh: () => void;
}

const CACHE_KEY = "mayhem-aramgg-fixture-cache-v1";

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

  const resolvedBySlug = useMemo(() => {
    const map = new Map<string, AramggFixtureCard>();
    if (!source || !augments) return map;
    for (const a of augments) {
      const res = resolveAugmentId(
        { iconBase: normalizeIconBase(a.icon), localizedName: a.name_zh_CN },
        source.catalog,
      );
      if (res.augmentId === null) continue;
      const stat = source.statsById.get(res.augmentId);
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
  }, [source, augments]);

  return {
    status,
    error,
    fromCache,
    patch: source?.patch ?? null,
    fetchedAt: source?.fetchedAt ?? null,
    sourceUrls: source?.sourceUrls ?? null,
    resolvedBySlug,
    refresh,
  };
}
