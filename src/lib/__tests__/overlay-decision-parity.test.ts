import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { DecisionContext, DecisionResult } from "../contracts/decision";
import type { DecisionEngineData } from "../decision/evaluate";
import {
  GRADE_TOKENS,
  runLocalInference,
} from "../../../overlay/src/model/inference";
import {
  memberRecommendationsVisible,
  shouldVerifyGameStart,
} from "../../../overlay/src/auth/member";
import {
  confirmPickedAugment,
  localizedGrade,
} from "../../../overlay/src/model/presentation";
import type { DecisionModelConfig } from "../../../overlay/src/decision/model-config";

const FIXTURE_NAMES = [
  "competitive-brand",
  "exploration-brand",
  "all-weak-brand",
  "hard-trap-garen",
] as const;

type M1DecisionDataSnapshot = {
  source: {
    commit: string;
    files: string[];
    champions: string[];
    purpose: string;
  };
  champions: Record<string, DecisionEngineData>;
};

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(
    await readFile(path.join(process.cwd(), relativePath), "utf-8"),
  ) as T;
}

function fixtureData(
  snapshot: M1DecisionDataSnapshot,
  context: DecisionContext,
): DecisionEngineData {
  const data = snapshot.champions[context.championSlug];
  if (!data) {
    throw new Error(`No M1 decision data snapshot for ${context.championSlug}`);
  }
  return data;
}

describe("member overlay decision parity", () => {
  test.each(FIXTURE_NAMES)(
    "matches the frozen web result for %s",
    async (fixtureName) => {
      const fixture = await readJson<{
        context: DecisionContext;
        result: DecisionResult;
      }>(`docs/handoffs/fixtures/m1/${fixtureName}.json`);
      const modelConfig = await readJson<DecisionModelConfig>(
        "docs/handoffs/fixtures/m4/model-config.json",
      );
      const snapshot = await readJson<M1DecisionDataSnapshot>(
        "docs/handoffs/fixtures/m1/decision-data-snapshot.json",
      );
      const data = fixtureData(snapshot, fixture.context);

      expect(runLocalInference(fixture.context, data, modelConfig)).toEqual(
        fixture.result,
      );
    },
  );

  test("keeps golden-master fixtures independent from daily data refreshes", async () => {
    const fixture = await readJson<{
      context: DecisionContext;
      result: DecisionResult;
    }>("docs/handoffs/fixtures/m1/competitive-brand.json");
    const modelConfig = await readJson<DecisionModelConfig>(
      "docs/handoffs/fixtures/m4/model-config.json",
    );
    const snapshot = await readJson<M1DecisionDataSnapshot>(
      "docs/handoffs/fixtures/m1/decision-data-snapshot.json",
    );
    const frozenData = fixtureData(snapshot, fixture.context);
    const refreshedData = structuredClone(frozenData);
    const firstOffer = refreshedData.augments.find(
      (augment) => augment.slug === fixture.context.offeredAugmentSlugs[0],
    );
    if (!firstOffer) throw new Error("Fixture offer missing from M1 snapshot");

    firstOffer.win_rate = 0;

    expect(runLocalInference(fixture.context, frozenData, modelConfig)).toEqual(
      fixture.result,
    );
    expect(
      runLocalInference(fixture.context, refreshedData, modelConfig),
    ).not.toEqual(fixture.result);
  });

  test("uses the frozen web grade colors and warns only on weak", () => {
    expect(GRADE_TOKENS).toEqual({
      hot: { color: "#fbbf24", warning: false },
      strong: { color: "#34d399", warning: false },
      steady: { color: "#38bdf8", warning: false },
      average: { color: "#94a3b8", warning: false },
      weak: { color: "#fb7185", warning: true },
    });
  });

  test("hides recommendations unless collector consent and entitlement are active", () => {
    expect(memberRecommendationsVisible(true, { enabled: true })).toBe(true);
    expect(memberRecommendationsVisible(false, { enabled: true })).toBe(false);
    expect(memberRecommendationsVisible(true, { enabled: false })).toBe(false);
  });

  test("requires online verification for each new game hash", () => {
    expect(shouldVerifyGameStart(null, "game-a")).toBe(true);
    expect(shouldVerifyGameStart("game-a", "game-a")).toBe(false);
    expect(shouldVerifyGameStart("game-a", "game-b")).toBe(true);
  });

  test("localizes grades and adds only explicit confirmed picks", () => {
    expect(localizedGrade("weak", "zh-TW")).toBe("警示");
    expect(localizedGrade("hot", "en-US")).toBe("Hot");
    expect(confirmPickedAugment([], ["first", "second", "third"], 1)).toEqual([
      "second",
    ]);
    expect(confirmPickedAugment(["second"], ["first", "second", "third"], 1)).toEqual([
      "second",
    ]);
    expect(confirmPickedAugment([], ["first", "second", "third"], 5)).toEqual([]);
  });
});
