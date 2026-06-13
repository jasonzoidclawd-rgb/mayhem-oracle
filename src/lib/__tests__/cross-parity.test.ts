import { describe, expect, test } from "vitest";
import abilitiesData from "../../../data/internal/abilities.json";
import augmentsData from "../../../data/internal/augments.json";
import championsData from "../../../data/internal/champions.json";
import poolRulesData from "../../../data/internal/pool-rules.json";
import {
  getChampionAugmentPool as webPool,
  type PoolAugmentInput as WebPoolAugment,
  type PoolOutput,
} from "../scoring/pool-orchestrator";
import {
  computeOracleScore as webScore,
  type OracleScoreInput as WebScoreInput,
} from "../scoring/oracle-score";
import { getChampionAugmentPool as overlayPool } from "../../../overlay/src/scoring/pool-orchestrator";
import { computeOracleScore as overlayScore } from "../../../overlay/src/scoring/oracle-score";
import type { AbilityProfile, ChampionTag, PoolRules } from "../types";

/**
 * Cross-parity harness (plan Session 5).
 *
 * Feeds IDENTICAL inputs — the full `data/internal/*.json` files — to both the web
 * and overlay scoring stacks, so this suite isolates CODE drift from overlay
 * data staleness (data sync freshness is Session 11's separate check).
 *
 * PARITY_BUDGET documents the current, known divergence (plan §0.4: overlay is
 * missing the Layer 2.5 resource-tag gate, the Layer 3 RESOURCE_TAGS strip, and
 * tailoring normalization fixes). Session 11 ports the fixes and flips this to 0.
 */
const PARITY_BUDGET = 0;

type ChampionRow = {
  slug: string;
  win_rate?: number | null;
  kit_tags?: ChampionTag[];
};

type ScorableAugment = WebPoolAugment & {
  name?: string;
  win_rate?: number | null;
  icon?: string;
};

const profiles = (
  abilitiesData as unknown as { profiles: Record<string, AbilityProfile> }
).profiles;

function poolSlugSets(result: PoolOutput<ScorableAugment>) {
  return {
    silver: new Set(result.silver.map((a) => a.slug)),
    gold: new Set(result.gold.map((a) => a.slug)),
    prismatic: new Set(result.prismatic.map((a) => a.slug)),
  };
}

function setDiff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((s) => !b.has(s));
}

export interface ChampionDivergence {
  slug: string;
  reasons: string[];
}

export function measureDivergence(): ChampionDivergence[] {
  const augments = augmentsData.augments as unknown as ScorableAugment[];
  const poolRules = poolRulesData as unknown as PoolRules;
  const diverged: ChampionDivergence[] = [];

  for (const champ of championsData.champions as unknown as ChampionRow[]) {
    const reasons: string[] = [];
    const abilityProfile = profiles[champ.slug];
    const championKitTags = champ.kit_tags ?? [];

    const args = {
      championSlug: champ.slug,
      augments,
      abilityProfile,
      championKitTags,
      poolRules,
    };
    const web = webPool(args);
    const overlay = overlayPool(
      args as unknown as Parameters<typeof overlayPool>[0],
    ) as unknown as PoolOutput<ScorableAugment>;

    const webSets = poolSlugSets(web);
    const overlaySets = poolSlugSets(overlay);

    for (const rarity of ["silver", "gold", "prismatic"] as const) {
      const webOnly = setDiff(webSets[rarity], overlaySets[rarity]);
      const overlayOnly = setDiff(overlaySets[rarity], webSets[rarity]);
      if (webOnly.length > 0 || overlayOnly.length > 0) {
        reasons.push(
          `pool:${rarity} web-only=[${webOnly.slice(0, 4).join(",")}]` +
            ` overlay-only=[${overlayOnly.slice(0, 4).join(",")}]`,
        );
      }
    }

    // Score every augment both sides agree belongs in the pool.
    const sharedAugments = [
      ...web.silver,
      ...web.gold,
      ...web.prismatic,
    ].filter(
      (a) =>
        overlaySets.silver.has(a.slug) ||
        overlaySets.gold.has(a.slug) ||
        overlaySets.prismatic.has(a.slug),
    );
    for (const aug of sharedAugments) {
      const input = {
        augment: aug,
        championWinRate: champ.win_rate ?? 50,
        abilityProfile,
      } as unknown as WebScoreInput;
      const webTotal = webScore(input).total;
      const overlayTotal = overlayScore(
        input as unknown as Parameters<typeof overlayScore>[0],
      ).total;
      if (webTotal !== overlayTotal) {
        reasons.push(`score:${aug.slug} web=${webTotal} overlay=${overlayTotal}`);
        if (reasons.length >= 6) break;
      }
    }

    if (reasons.length > 0) {
      diverged.push({ slug: champ.slug, reasons: reasons.slice(0, 4) });
    }
  }

  return diverged;
}

describe("web ↔ overlay cross-parity (identical inputs)", () => {
  test(`divergedChampions is within PARITY_BUDGET (${PARITY_BUDGET})`, () => {
    const diverged = measureDivergence();

    if (diverged.length > 0) {
      const sample = diverged
        .slice(0, 10)
        .map((d) => `  ${d.slug}: ${d.reasons[0]}`)
        .join("\n");
      console.log(
        `divergedChampions: ${diverged.length}/${championsData.champions.length}\n${sample}`,
      );
    }

    expect(diverged.length).toBeLessThanOrEqual(PARITY_BUDGET);
  });
});
