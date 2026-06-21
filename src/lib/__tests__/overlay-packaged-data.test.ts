import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import type { DecisionContext, DecisionResult } from "../contracts/decision";
import { loadInternalDecisionData } from "../data/internal-loader";
import type { DecisionEngineData, DecisionAugment } from "../decision/evaluate";
import type { PoolRules } from "../types";
import { runLocalInference } from "../../../overlay/src/model/inference";
import type { DecisionModelConfig } from "../../../overlay/src/decision/model-config";

const ROOT = process.cwd();
const FIXTURE_NAMES = [
  "competitive-brand",
  "exploration-brand",
  "all-weak-brand",
  "hard-trap-garen",
] as const;

beforeAll(() => {
  execFileSync(process.execPath, ["overlay/scripts/sync-data.mjs"], {
    cwd: ROOT,
    stdio: "pipe",
  });
});

type OverlayChampion = {
  slug: string;
  win_rate?: number | null;
  kit_tags?: DecisionEngineData["champion"]["kitTags"];
  baseStats?: DecisionEngineData["champion"]["baseStats"];
};

type OverlayCombo = {
  champion: string;
  augment: string;
  augmentSlug?: string;
  tier: "S" | "A" | "B" | "C";
};

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf-8")) as T;
}

function packagedComboTiers(
  championSlug: string,
  combos: OverlayCombo[],
): Record<string, OverlayCombo["tier"]> {
  return Object.fromEntries(
    combos
      .filter((combo) => combo.champion === championSlug)
      .map((combo) => [combo.augmentSlug ?? combo.augment, combo.tier]),
  );
}

function loadPackagedOverlayDecisionData(championSlug: string): DecisionEngineData {
  const champions = readJson<{ champions: OverlayChampion[] }>(
    "overlay/public/data/champions.json",
  ).champions;
  const augments = readJson<{ augments: DecisionAugment[] }>(
    "overlay/public/data/augments.json",
  ).augments;
  const combos = readJson<{ combos: OverlayCombo[] }>(
    "overlay/public/data/combos.json",
  ).combos;
  const poolRules = readJson<PoolRules>("overlay/public/data/pool-rules.json");
  const abilityProfile = readJson<DecisionEngineData["champion"]["abilityProfile"]>(
    `overlay/public/data/abilities/${championSlug}.json`,
  );
  const champion = champions.find((entry) => entry.slug === championSlug);
  if (!champion) throw new Error(`Unknown packaged overlay champion: ${championSlug}`);

  return {
    champion: {
      slug: champion.slug,
      winRate: champion.win_rate,
      kitTags: champion.kit_tags ?? [],
      abilityProfile,
      baseStats: champion.baseStats,
    },
    augments,
    poolRules,
    comboTiers: packagedComboTiers(championSlug, combos),
  };
}

describe("packaged overlay decision data", () => {
  test("keeps website public data sanitized but packages member decision fields for overlay", () => {
    const internalAugments = readJson<{ augments: DecisionAugment[] }>(
      "data/internal/augments.json",
    ).augments;
    const publicAugments = readJson<{ augments: Array<Record<string, unknown>> }>(
      "public/data/augments.json",
    ).augments;
    const overlayAugments = readJson<{ augments: DecisionAugment[] }>(
      "overlay/public/data/augments.json",
    ).augments;
    const internalCombos = readJson<{ combos: OverlayCombo[] }>(
      "data/internal/combos.json",
    ).combos;
    const overlayCombos = readJson<{ combos: OverlayCombo[] }>(
      "overlay/public/data/combos.json",
    ).combos;

    expect(publicAugments.every((augment) => !("win_rate" in augment))).toBe(true);

    const internalSample = internalAugments.find(
      (augment) => typeof augment.win_rate === "number" && augment.name_ja,
    );
    expect(internalSample).toBeTruthy();
    const overlaySample = overlayAugments.find(
      (augment) => augment.slug === internalSample?.slug,
    );

    expect(overlaySample).toMatchObject({
      slug: internalSample?.slug,
      type: internalSample?.type,
      win_rate: internalSample?.win_rate,
      name_zh_CN: internalSample?.name_zh_CN,
      name_zh_TW: internalSample?.name_zh_TW,
      name_ja: internalSample?.name_ja,
      name_ko: internalSample?.name_ko,
    });
    expect(overlayCombos).toHaveLength(internalCombos.length);
    expect(new Set(overlayCombos.map((combo) => combo.tier))).toEqual(
      new Set(internalCombos.map((combo) => combo.tier)),
    );
  });

  test.each(FIXTURE_NAMES)(
    "matches internal/server inference when using packaged overlay data for %s",
    async (fixtureName) => {
      const fixture = readJson<{
        context: DecisionContext;
        result: DecisionResult;
      }>(`docs/handoffs/fixtures/m1/${fixtureName}.json`);
      const modelConfig = readJson<DecisionModelConfig>(
        "docs/handoffs/fixtures/m4/model-config.json",
      );
      const internalData = await loadInternalDecisionData(fixture.context.championSlug);
      const packagedData = loadPackagedOverlayDecisionData(
        fixture.context.championSlug,
      );

      expect(runLocalInference(fixture.context, packagedData, modelConfig)).toEqual(
        runLocalInference(fixture.context, internalData, modelConfig),
      );
    },
  );
});
