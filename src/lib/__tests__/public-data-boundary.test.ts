import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = process.cwd();

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf-8"));
}

function collectForbiddenKeys(
  value: unknown,
  forbidden: ReadonlySet<string>,
  currentPath = "$",
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectForbiddenKeys(entry, forbidden, `${currentPath}[${index}]`),
    );
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, entry]) => [
    ...(forbidden.has(key) ? [`${currentPath}.${key}`] : []),
    ...collectForbiddenKeys(entry, forbidden, `${currentPath}.${key}`),
  ]);
}

describe("public data boundary", () => {
  test("keeps full decision telemetry internal and strips it from public catalogs", () => {
    const internalAugments = readJson("data/internal/augments.json") as {
      augments: Array<Record<string, unknown>>;
    };
    const publicAugments = readJson("public/data/augments.json") as {
      augments: Array<Record<string, unknown>>;
    };

    expect(internalAugments.augments.some((augment) => "win_rate" in augment)).toBe(true);
    expect(publicAugments.augments.every((augment) => !("win_rate" in augment))).toBe(true);
  });

  test("does not publish decision-only combos, rules, weights, pools, or item telemetry", () => {
    const publicCombos = readJson("public/data/combos.json") as { combos: unknown[] };
    const publicPoolRules = readJson("public/data/pool-rules.json") as {
      disabled: unknown[];
      mutually_exclusive: unknown[];
      item_exclusions: unknown[];
      ally_exclusions: unknown[];
    };
    const publicItems = readJson("public/data/items.json");
    const publicAugments = readJson("public/data/augments.json");
    const forbiddenKeys = new Set([
      "win_rate",
      "winRate",
      "oracleScore",
      "modelWeights",
      "scoreBreakdown",
      "computedPool",
      "championPools",
    ]);

    expect(publicCombos.combos).toEqual([]);
    expect(publicPoolRules.disabled).toEqual([]);
    expect(publicPoolRules.mutually_exclusive).toEqual([]);
    expect(publicPoolRules.item_exclusions).toEqual([]);
    expect(publicPoolRules.ally_exclusions).toEqual([]);
    expect(collectForbiddenKeys(publicItems, forbiddenKeys)).toEqual([]);
    expect(collectForbiddenKeys(publicAugments, forbiddenKeys)).toEqual([]);
  });

  test("keeps champion rank, win rate, and pick rate public", () => {
    const publicChampions = readJson("public/data/champions.json") as {
      champions: Array<Record<string, unknown>>;
    };

    expect(publicChampions.champions.length).toBeGreaterThan(100);
    for (const champion of publicChampions.champions) {
      expect(champion).toHaveProperty("rank");
      expect(champion).toHaveProperty("win_rate");
      expect(champion).toHaveProperty("pick_rate");
    }
  });

  test("free overlay sync never reads or embeds data/internal", () => {
    const syncSource = readFileSync(
      path.join(ROOT, "overlay/scripts/sync-data.mjs"),
      "utf-8",
    );

    expect(syncSource).not.toContain("data/internal");
    expect(syncSource).not.toContain('"internal"');
    expect(syncSource).not.toContain("win_rate: augment.win_rate");
  });
});
