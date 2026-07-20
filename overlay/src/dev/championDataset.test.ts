/**
 * Live champion-page fetch adapter + champion-id/patch cache + ownership token
 * (PR #46 Sections 3–4). The dataset is fetched ONCE when the final champion
 * becomes known, cached by (championId, patch), and a stale response from a
 * superseded champion can never publish.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ChampionDatasetCache,
  championOwnershipCurrent,
  loadChampionAugmentDataset,
  type ChampionOwnershipToken,
} from "./championDataset";

// Minimal escaped-flight page, exactly the shape ARAMGG server-renders.
function pageFor(championId: string, winRate: string): string {
  return (
    `self.__next_f.push([1,"31:T660c,{\\"augments\\":{\\"1006\\":{\\"tier\\":\\"1\\",` +
    `\\"rank\\":\\"26\\",\\"win_rate\\":\\"${winRate}\\",\\"num_games\\":\\"3768\\",` +
    `\\"pick_rate\\":\\"0.093247\\"}},\\"tier\\":\\"4\\",\\"win_rate\\":\\"0.464797\\"}"])`
  );
}

function okFetch(body: string): typeof fetch {
  return vi.fn(async () =>
    new Response(body, { status: 200, headers: { "content-type": "text/html" } }),
  ) as unknown as typeof fetch;
}

describe("loadChampionAugmentDataset — fetch + parse one champion page", () => {
  it("resolves the champion's own augment table from the page flight", async () => {
    const fetchImpl = okFetch(pageFor("56", "0.480096"));
    const ds = await loadChampionAugmentDataset(fetchImpl, "56", "16.14");
    expect(ds.championId).toBe("56");
    expect(ds.source).toContain("/champion-stats/56");
    expect(ds.statsByAugmentId.get("1006")!.winRatePercent).toBe("48.0096");
  });

  it("throws explicitly when the page carries no augments block", async () => {
    const fetchImpl = okFetch("no flight data");
    await expect(loadChampionAugmentDataset(fetchImpl, "56", "16.14")).rejects.toThrow();
  });

  it("throws explicitly on an HTTP error (offline/failure is never silent)", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(loadChampionAugmentDataset(fetchImpl, "56", "16.14")).rejects.toThrow();
  });
});

describe("ChampionDatasetCache — one fetch per (championId, patch)", () => {
  it("does not re-fetch for the same champion and patch", async () => {
    const fetchImpl = okFetch(pageFor("56", "0.480096"));
    const cache = new ChampionDatasetCache(fetchImpl);
    const a = await cache.get("56", "16.14");
    const b = await cache.get("56", "16.14");
    expect(a).toBe(b); // same cached instance
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent in-flight requests for the same key", async () => {
    const fetchImpl = okFetch(pageFor("56", "0.480096"));
    const cache = new ChampionDatasetCache(fetchImpl);
    const [a, b] = await Promise.all([cache.get("56", "16.14"), cache.get("56", "16.14")]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fetches a new dataset when the champion changes", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      new Response(pageFor(url.includes("/103") ? "103" : "56", "0.480096"), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;
    const cache = new ChampionDatasetCache(fetchImpl);
    await cache.get("56", "16.14");
    await cache.get("103", "16.14");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fetches again when the patch changes for the same champion", async () => {
    const fetchImpl = okFetch(pageFor("56", "0.480096"));
    const cache = new ChampionDatasetCache(fetchImpl);
    await cache.get("56", "16.14");
    await cache.get("56", "16.15");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("championOwnershipCurrent — stale response cannot publish", () => {
  const base: ChampionOwnershipToken = {
    gameEpoch: 1,
    championGeneration: 4,
    championId: "56",
    requestId: 7,
    patch: "16.14",
  };

  it("permits a publish only when every ownership field still matches", () => {
    expect(championOwnershipCurrent(base, { ...base })).toBe(true);
  });

  it("rejects an old champion response after a champion change", () => {
    // Response captured for champion 56 generation 4; current is champion 103 gen 5.
    expect(
      championOwnershipCurrent(base, { ...base, championId: "103", championGeneration: 5 }),
    ).toBe(false);
  });

  it("rejects a response from a superseded request id", () => {
    expect(championOwnershipCurrent(base, { ...base, requestId: 8 })).toBe(false);
  });

  it("rejects a response after a foreground/game epoch change", () => {
    expect(championOwnershipCurrent(base, { ...base, gameEpoch: 2 })).toBe(false);
  });
});
