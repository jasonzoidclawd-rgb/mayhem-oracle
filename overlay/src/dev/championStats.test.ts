/**
 * Champion-FIRST augment dataset model (PR #46 corrected requirement).
 *
 * Source-backed fixtures: the exact rows ARAMGG embeds in the server-rendered
 * champion page flight payload at https://aramgg.com/en/champion-stats/{id}
 * (captured 2026-07-20, patch 16.14 / site "26.14"). Each `augments` entry is
 * keyed by the canonical numeric ARAMGG augment ID — the same join key the
 * catalog and global stats already use — and carries THAT champion's own tier,
 * win rate, pick rate and rank. This is NOT the sparse `top_champions` list; it
 * is the champion's complete published augment table.
 */
import { describe, expect, it } from "vitest";
import {
  extractChampionFlightObject,
  lookupChampionAugmentStat,
  parseChampionAugmentDataset,
  resolvedStatToAramggStat,
  selectAugmentStat,
  type ChampionAugmentDataset,
} from "./championStats";
import type { AramggStat } from "./aramggSource";

// ─── Real ARAMGG rows, verbatim from /en/champion-stats/56 (Nocturne) ───
// Verified against the rendered page: e.g. augment 1006 shows tier 1, 48.0096%.
const NOCTURNE_RAW = {
  championId: "56",
  tier: "4",
  win_rate: "0.464797",
  num_win_games: "18782",
  num_games: "40409",
  pick_rate: "0.002942",
  augments: {
    "1006": { tier: "1", rank: "26", num_win_games: "1809", win_rate: "0.480096", total: "136", num_games: "3768", pick_rate: "0.093247" },
    "1038": { tier: "2", rank: "15", num_win_games: "326", win_rate: "0.501538", total: "136", num_games: "650", pick_rate: "0.016086" },
    "1041": { tier: "1", rank: "5", num_win_games: "201", win_rate: "0.537433", total: "136", num_games: "374", pick_rate: "0.009255" },
    "1062": { tier: "1", rank: "4", num_win_games: "352", win_rate: "0.541538", total: "136", num_games: "650", pick_rate: "0.016086" },
  },
} as const;

// ─── Real ARAMGG rows, verbatim from /en/champion-stats/103 (Ahri) ───
const AHRI_RAW = {
  championId: "103",
  tier: "2",
  win_rate: "0.520904",
  num_win_games: "58771",
  num_games: "112825",
  pick_rate: "0.008215",
  augments: {
    "1006": { tier: "3", rank: "53", num_win_games: "2300", win_rate: "0.516854", total: "148", num_games: "4450", pick_rate: "0.02" },
    "1038": { tier: "2", rank: "8", num_win_games: "500", win_rate: "0.557659", total: "148", num_games: "897", pick_rate: "0.01" },
    "1041": { tier: "3", rank: "81", num_win_games: "300", win_rate: "0.5", total: "148", num_games: "600", pick_rate: "0.01" },
  },
} as const;

function nocturne(): ChampionAugmentDataset {
  return parseChampionAugmentDataset(NOCTURNE_RAW, {
    championId: "56",
    patch: "16.14",
    source: "https://aramgg.com/en/champion-stats/56",
  });
}
function ahri(): ChampionAugmentDataset {
  return parseChampionAugmentDataset(AHRI_RAW, {
    championId: "103",
    patch: "16.14",
    source: "https://aramgg.com/en/champion-stats/103",
  });
}

describe("parseChampionAugmentDataset — champion-first table", () => {
  it("keys by championId 56 and exposes Nocturne's own augment rows", () => {
    const ds = nocturne();
    expect(ds.championId).toBe("56");
    expect(ds.patch).toBe("16.14");
    expect(ds.source).toContain("/champion-stats/56");
    expect([...ds.statsByAugmentId.keys()].sort()).toEqual(["1006", "1038", "1041", "1062"]);
  });

  it("reproduces the exact tier, win rate, pick rate and rank from the source", () => {
    const stat = lookupChampionAugmentStat(nocturne(), "1006");
    expect(stat).not.toBeNull();
    expect(stat!.championId).toBe("56");
    expect(stat!.augmentId).toBe("1006");
    expect(stat!.tier).toBe(1);
    expect(stat!.tierLetter).toBe("S+");
    expect(stat!.rawWinRate).toBe("0.480096");
    expect(stat!.winRatePercent).toBe("48.0096"); // exact decimal shift, no float
    expect(stat!.rawPickRate).toBe("0.093247");
    expect(stat!.pickRatePercent).toBe("9.3247");
    expect(stat!.rank).toBe(26);
    expect(stat!.numGames).toBe("3768");
    expect(stat!.patch).toBe("16.14");
  });
});

describe("same augment id, different champion → different champion-specific value", () => {
  it("returns Nocturne's row from Nocturne, Ahri's row from Ahri", () => {
    const fromNocturne = lookupChampionAugmentStat(nocturne(), "1006")!;
    const fromAhri = lookupChampionAugmentStat(ahri(), "1006")!;
    // Same canonical augment id...
    expect(fromNocturne.augmentId).toBe(fromAhri.augmentId);
    // ...but genuinely different champion-specific statistics.
    expect(fromNocturne.tier).toBe(1);
    expect(fromNocturne.winRatePercent).toBe("48.0096");
    expect(fromAhri.tier).toBe(3);
    expect(fromAhri.winRatePercent).toBe("51.6854");
    expect(fromNocturne.championId).toBe("56");
    expect(fromAhri.championId).toBe("103");
  });
});

describe("lookup + provenance (CHAMP / GLOBAL / NO CHAMP DATA)", () => {
  const globalStat: AramggStat = {
    augmentId: "1006",
    rawWinRate: "0.500000",
    winRatePercent: "50.0000",
    numGames: "999999",
    pickRate: "0.05",
    tier: 3,
    tierLetter: "A",
    grade: "steady",
    provenance: "global",
    championId: null,
    championRank: null,
    topChampionsById: new Map(),
  };

  it("CHAMP comes from the champion dataset row, never the global value", () => {
    const sel = selectAugmentStat(nocturne(), "1006", globalStat, { allowGlobalFallback: true });
    expect(sel.kind).toBe("resolved");
    if (sel.kind !== "resolved") throw new Error("unreachable");
    expect(sel.stat.label).toBe("CHAMP");
    expect(sel.stat.championId).toBe("56");
    // The CHAMP value is Nocturne's own row (48.0096%), NOT the global 50.0000%.
    expect(sel.stat.winRatePercent).toBe("48.0096");
    expect(sel.stat.tier).toBe(1);
  });

  it("labels an explicit global fallback GLOBAL when the champion row is absent", () => {
    const sel = selectAugmentStat(nocturne(), "9999", globalStat, { allowGlobalFallback: true });
    expect(sel.kind).toBe("resolved");
    if (sel.kind !== "resolved") throw new Error("unreachable");
    expect(sel.stat.label).toBe("GLOBAL");
    expect(sel.stat.winRatePercent).toBe("50.0000");
    expect(sel.stat.championId).toBeNull();
  });

  it("returns NO CHAMP DATA (never a global value labeled CHAMP) when fallback is disallowed", () => {
    const sel = selectAugmentStat(nocturne(), "9999", globalStat, { allowGlobalFallback: false });
    expect(sel.kind).toBe("no-champ-data");
  });

  it("returns NO CHAMP DATA when the row is absent and no global stat exists", () => {
    const sel = selectAugmentStat(nocturne(), "9999", null, { allowGlobalFallback: true });
    expect(sel.kind).toBe("no-champ-data");
  });
});

describe("CHAMP never comes from top_champions (the reversed model)", () => {
  it("selects the champion-dataset row, not a global top_champions row", () => {
    // A global stat carrying a sparse top_champions entry for champ 56 — exactly
    // the reversed model. selectAugmentStat must IGNORE it and return Nocturne's
    // own /champion-stats/56 row.
    const globalWithTopChamp: AramggStat = {
      augmentId: "1006",
      rawWinRate: "0.500000",
      winRatePercent: "50.0000",
      numGames: "999999",
      pickRate: "0.05",
      tier: 3,
      tierLetter: "A",
      grade: "steady",
      provenance: "global",
      championId: null,
      championRank: null,
      topChampionsById: new Map([
        [
          "56",
          {
            augmentId: "1006",
            rawWinRate: "0.999999", // a bogus top_champions value we must NOT use
            winRatePercent: "99.9999",
            numGames: "10",
            pickRate: "0.9",
            tier: 1,
            tierLetter: "S+",
            grade: "hot",
            provenance: "champion",
            championId: "56",
            championRank: "1",
            topChampionsById: new Map(),
          },
        ],
      ]),
    };
    const sel = selectAugmentStat(nocturne(), "1006", globalWithTopChamp, { allowGlobalFallback: true });
    expect(sel.kind).toBe("resolved");
    if (sel.kind !== "resolved") throw new Error("unreachable");
    expect(sel.stat.label).toBe("CHAMP");
    // Nocturne's real champion-stats value, NOT the top_champions 99.9999%.
    expect(sel.stat.winRatePercent).toBe("48.0096");
  });
});

describe("resolvedStatToAramggStat — provenance mapping for the render path", () => {
  it("maps a CHAMP selection to provenance 'champion' with championId", () => {
    const sel = selectAugmentStat(nocturne(), "1006", null, { allowGlobalFallback: false });
    if (sel.kind !== "resolved") throw new Error("unreachable");
    const stat = resolvedStatToAramggStat(sel.stat);
    expect(stat.provenance).toBe("champion");
    expect(stat.championId).toBe("56");
    expect(stat.tierLetter).toBe("S+");
    expect(stat.grade).toBe("hot");
    expect(stat.rawWinRate).toBe("0.480096");
  });

  it("maps a GLOBAL selection to provenance 'global' with no championId", () => {
    const globalStat: AramggStat = {
      augmentId: "1006", rawWinRate: "0.500000", winRatePercent: "50.0000",
      numGames: "999999", pickRate: "0.05", tier: 3, tierLetter: "A", grade: "steady",
      provenance: "global", championId: null, championRank: null, topChampionsById: new Map(),
    };
    const sel = selectAugmentStat(nocturne(), "9999", globalStat, { allowGlobalFallback: true });
    if (sel.kind !== "resolved") throw new Error("unreachable");
    const stat = resolvedStatToAramggStat(sel.stat);
    expect(stat.provenance).toBe("global");
    expect(stat.championId).toBeNull();
  });
});

describe("extractChampionFlightObject — parse the embedded flight payload", () => {
  it("extracts the augments object from an escaped Next.js flight string", () => {
    // Representative escaped push, as it appears inside the server-rendered HTML.
    const html =
      'self.__next_f.push([1,"31:T660c,{\\"augments\\":{\\"1006\\":{\\"tier\\":\\"1\\",\\"rank\\":\\"26\\",\\"win_rate\\":\\"0.480096\\",\\"num_games\\":\\"3768\\",\\"pick_rate\\":\\"0.093247\\"}},\\"tier\\":\\"4\\",\\"win_rate\\":\\"0.464797\\"}"])';
    const obj = extractChampionFlightObject(html) as { augments: Record<string, unknown> };
    expect(obj.augments["1006"]).toMatchObject({ tier: "1", win_rate: "0.480096" });
  });

  it("extracts from a raw (unescaped) RSC flight stream too", () => {
    const rsc = '31:T660c,{"augments":{"1006":{"tier":"1","rank":"26","win_rate":"0.480096"}},"tier":"4"}\n';
    const obj = extractChampionFlightObject(rsc) as { augments: Record<string, unknown> };
    expect(obj.augments["1006"]).toMatchObject({ tier: "1", win_rate: "0.480096" });
  });

  it("returns null when there is no augments block", () => {
    expect(extractChampionFlightObject("no flight data here")).toBeNull();
  });
});
