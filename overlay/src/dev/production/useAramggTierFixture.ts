import { useCallback } from "react";
import type { AramggFixtureCard } from "./tierFixture";

export interface MayhemAugmentIdentity {
  slug: string;
  icon?: string;
  name_zh_CN?: string;
}

export interface AramggFixtureState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  fromCache: boolean;
  patch: string | null;
  fetchedAt: number | null;
  sourceUrls: { stats: string; catalog: string } | null;
  resolvedBySlug: Map<string, AramggFixtureCard>;
  refresh: () => void;
}

export function useAramggTierFixture(
  _enabled: boolean,
  _augments: MayhemAugmentIdentity[] | undefined,
): AramggFixtureState {
  void _enabled;
  void _augments;
  const refresh = useCallback(() => {}, []);
  return {
    status: "idle",
    error: null,
    fromCache: false,
    patch: null,
    fetchedAt: null,
    sourceUrls: null,
    resolvedBySlug: new Map(),
    refresh,
  };
}
