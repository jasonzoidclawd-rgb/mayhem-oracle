/**
 * Path B (Step 5): the champion-first dataset is built from the locally
 * generated Step-4 artifact (`data/internal/aramgg-champion-augments.artifact.json`,
 * served same-origin by the dev-server middleware) — never from `/aramgg-dev`.
 *
 * These lock the reconstruction contract: a champion's own rows become its
 * COMPLETE dataset with the exact ARAMGG decimal strings; a row ARAMGG
 * published with no win rate resolves to NO CHAMP DATA (never a stand-in); a
 * rostered champion ARAMGG serves no current file for (Ashe / key 22) throws so
 * the slot shows DATA ERROR and no percentage; and the dataset is stamped with
 * the artifact's OWN serving patch so a moved changelog fails the ownership
 * guard instead of relabelling stale numbers.
 */
import { describe, expect, it, vi } from "vitest";
import {
  championDatasetFromArtifact,
  fetchLocalArtifact,
  loadChampionAugmentDatasetLocal,
  LOCAL_ARTIFACT_URL,
} from "./championDataset";
import { selectChampionSlotStat } from "./championStats";

function artifact() {
  return {
    schemaVersion: 1,
    checksum: { algorithm: "sha256", encoding: "hex", covers: "payload", value: "x" },
    payload: {
      sourcePatch: { serving: { rawValue: "16.17" }, target: { rawValue: "16.17" } },
      champions: [
        {
          championKey: "1",
          slug: "annie",
          servingPatchRaw: "16.17",
          rows: [
            {
              aramggAugmentId: "1006",
              tier: "1",
              rank: "26",
              winRateRaw: "0.480096",
              numGames: "3768",
              pickRateRaw: "0.093247",
            },
            // ARAMGG published this row below its minimum sample size: a real
            // row, but with no win rate. It must not become a fake value.
            {
              aramggAugmentId: "1004",
              tier: "4",
              rank: "103",
              winRateRaw: null,
              numGames: null,
              pickRateRaw: "0.003",
            },
          ],
        },
      ],
      championsWithoutCurrentSource: [
        { championKey: "22", slug: "ashe", httpStatus: 404 },
      ],
    },
  };
}

describe("championDatasetFromArtifact — reconstruct one champion's table", () => {
  it("builds a COMPLETE dataset from the champion's own rows, exact decimals", () => {
    const ds = championDatasetFromArtifact(artifact(), "1", "16.17");
    expect(ds.championId).toBe("1");
    expect(ds.completeness).toBe("complete");
    expect(ds.source).toContain(LOCAL_ARTIFACT_URL);
    expect(ds.statsByAugmentId.get("1006")!.rawWinRate).toBe("0.480096");
    expect(ds.statsByAugmentId.get("1006")!.winRatePercent).toBe("48.0096");
  });

  it("drops a null-win-rate row → NO CHAMP DATA, never a stand-in value", () => {
    const ds = championDatasetFromArtifact(artifact(), "1", "16.17");
    expect(ds.statsByAugmentId.has("1004")).toBe(false);
    expect(selectChampionSlotStat("ready", ds, "1004").status).toBe("no-champ-data");
  });

  it("stamps the artifact's own serving patch, not the caller's", () => {
    const ds = championDatasetFromArtifact(artifact(), "1", "16.99");
    expect(ds.patch).toBe("16.17");
  });

  it("throws for a champion ARAMGG serves no current file for (Ashe / 22)", () => {
    expect(() => championDatasetFromArtifact(artifact(), "22", "16.17")).toThrow(/current-source/i);
  });

  it("throws for a champion absent from the artifact roster entirely", () => {
    expect(() => championDatasetFromArtifact(artifact(), "999", "16.17")).toThrow(/roster/i);
  });
});

describe("fetchLocalArtifact / loadChampionAugmentDatasetLocal — same-origin only", () => {
  it("fetches the local artifact URL and no /aramgg-dev path", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(artifact()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const ds = await loadChampionAugmentDatasetLocal(fetchImpl, "1", "16.17");
    expect(ds.statsByAugmentId.get("1006")!.winRatePercent).toBe("48.0096");
    expect(seen).toEqual([LOCAL_ARTIFACT_URL]);
    expect(seen.some((u) => u.includes("/aramgg-dev"))).toBe(false);
  });

  it("propagates an HTTP failure instead of a silent empty dataset", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    await expect(loadChampionAugmentDatasetLocal(fetchImpl, "1", "16.17")).rejects.toThrow();
  });
});
