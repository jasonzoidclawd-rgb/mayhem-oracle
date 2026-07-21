/**
 * Source-backed regression for the 2026-07-21 12:13:43 controlled Zoe offer.
 *
 * The controlled test flagged the middle badge (`基本功夫` → `A · 58/46/48`) as a
 * suspected badge-to-augment MISMATCH. Independent verification against the live
 * ARAMGG source (captured 2026-07-21, patch 16.14 / site "26.14") shows every
 * badge is CORRECT — the middle only *looks* wrong because 基本功夫 (augmentId
 * 1004) is a strong augment GLOBALLY (tier 2 / 54.8983%) yet weak FOR ZOE
 * specifically (tier 3 / 45.9799%). Champion-first selection is doing exactly
 * its job. This test pins that behavior end-to-end so a regression that reverted
 * to the global value — or swapped/aliased a slot — would fail.
 *
 * Verified numbers (fetched live, reproduced by the pipeline below):
 *
 *   slot   visible title  canonical id  source   raw tier  raw win rate  badge
 *   left   等命飛踢(drift) 2006          GLOBAL   2 (S)     0.579583      S · 58.0%
 *   middle 基本功夫       1004          CHAMP    3 (A)     0.459799      A · 46.0%
 *   right  劍舞之心       1006          GLOBAL   5 (C)     0.481211      C · 48.1%
 *
 * Zoe (championId 142) has a champion-stats row for 1004 only; 2006 and 1006 are
 * absent from her table and correctly fall back to the GLOBAL value. `等命飛踢`
 * is a one-character OCR drift of `奪命飛踢`(2006), recovered by the unambiguous
 * zh-TW fuzzy path. Catalog display names / global + champion rows below are
 * verbatim from the live source; full-catalog resolution was confirmed to reach
 * the identical ids (1004 exact, 1006 exact, 2006 sole fuzzy) before trimming to
 * this minimal fixture. Provenance: https://aramgg.com/en/champion-stats/142.
 */
import { describe, expect, it } from "vitest";
import {
  buildRiotTitleIndex,
  resolveOcrTitle,
  type AramggStat,
  type RiotTitleResolution,
} from "./aramggSource";
import {
  parseChampionAugmentDataset,
  resolvedStatToAramggStat,
  selectAugmentStat,
  type ChampionAugmentDataset,
} from "./championStats";
import { compactWinRateFromFraction } from "../winRateFormat";

// ─── Minimal source-backed catalog (verbatim display names) ───
const ZH_TW_CATALOG = {
  "1004": { displayName: "基本功夫", name: "ARAM_BacktoBasics" },
  "1006": { displayName: "劍舞之心", name: "ARAM_BladeWaltz" },
  "2006": { displayName: "奪命飛踢", name: "ARAM_Dropkick" },
} as const;
const ZH_CN_CATALOG = {
  "1004": { displayName: "回归基本功", name: "ARAM_BacktoBasics" },
  "1006": { displayName: "利刃华尔兹", name: "ARAM_BladeWaltz" },
  "2006": { displayName: "飞身踢", name: "ARAM_Dropkick" },
} as const;

// ─── Zoe's own champion-stats augment table (only 1004 is present) ───
const ZOE_RAW = {
  championId: "142",
  tier: "5",
  win_rate: "0.450172",
  augments: {
    "1004": { tier: "3", rank: "42", win_rate: "0.459799", num_games: "398" },
  },
} as const;

// ─── Live GLOBAL rows for each offered augment (verbatim) ───
function globalStat(
  augmentId: string,
  tier: number,
  tierLetter: AramggStat["tierLetter"],
  rawWinRate: string,
): AramggStat {
  return {
    augmentId,
    rawWinRate,
    winRatePercent: "", // unused on this path; the badge formats from rawWinRate
    numGames: "0",
    pickRate: "",
    tier,
    tierLetter,
    grade: "steady",
    provenance: "global",
    championId: null,
    championRank: null,
    topChampionsById: new Map(),
  };
}
const GLOBAL_BY_ID: Record<string, AramggStat> = {
  "1004": globalStat("1004", 2, "S", "0.548983"), // strong globally — must NOT win for Zoe
  "1006": globalStat("1006", 5, "C", "0.481211"),
  "2006": globalStat("2006", 2, "S", "0.579583"),
};

function zoeDataset(): ChampionAugmentDataset {
  return parseChampionAugmentDataset(ZOE_RAW, {
    championId: "142",
    patch: "16.14",
    source: "https://aramgg.com/en/champion-stats/142",
  });
}

/** The exact live wiring: OCR title → canonical id → champion-first selection →
 * render stat → badge percent. Returns the auditable publication record. */
function publishSlot(ocrTitle: string) {
  const index = buildRiotTitleIndex(ZH_TW_CATALOG, ZH_CN_CATALOG);
  const riot = resolveOcrTitle(ocrTitle, index);
  if (riot.augmentId === null) {
    throw new Error(`title "${ocrTitle}" did not resolve: ${riot.reason}`);
  }
  const canonicalAugmentId = riot.augmentId;
  const sel = selectAugmentStat(zoeDataset(), canonicalAugmentId, GLOBAL_BY_ID[canonicalAugmentId] ?? null, {
    allowGlobalFallback: true,
  });
  if (sel.kind !== "resolved") throw new Error(`no stat for ${canonicalAugmentId}`);
  const stat = resolvedStatToAramggStat(sel.stat);
  return {
    canonicalAugmentId,
    statisticsAugmentId: stat.augmentId,
    source: sel.stat.label,
    tier: stat.tierLetter,
    badge: `${stat.tierLetter} · ${compactWinRateFromFraction(stat.rawWinRate)}`,
    riot: riot as RiotTitleResolution,
  };
}

describe("12:13:43 Zoe offer — every badge matches its augment (source-backed)", () => {
  it("middle 基本功夫 → Zoe's champion-first 1004: A · 46.0% (NOT the global S · 54.9%)", () => {
    const p = publishSlot("基本功夫");
    expect(p.canonicalAugmentId).toBe("1004");
    expect(p.riot.method).toBe("riot-zh-tw-exact");
    expect(p.source).toBe("CHAMP");
    expect(p.tier).toBe("A");
    expect(p.badge).toBe("A · 46.0%");
    // The suspicious-looking value is genuinely Zoe's, not the strong global one.
    expect(p.badge).not.toBe("S · 54.9%");
  });

  it("left 等命飛踢 → OCR-drift fuzzy to 2006, global fallback: S · 58.0%", () => {
    const p = publishSlot("等命飛踢");
    expect(p.canonicalAugmentId).toBe("2006");
    expect(p.riot.method).toBe("riot-zh-tw-fuzzy");
    expect(p.source).toBe("GLOBAL");
    expect(p.badge).toBe("S · 58.0%");
  });

  it("right 劍舞之心 → 1006, global fallback: C · 48.1%", () => {
    const p = publishSlot("劍舞之心");
    expect(p.canonicalAugmentId).toBe("1006");
    expect(p.riot.method).toBe("riot-zh-tw-exact");
    expect(p.source).toBe("GLOBAL");
    expect(p.badge).toBe("C · 48.1%");
  });

  it("invariant: the badge's statistics id equals the resolved canonical id for every slot", () => {
    for (const title of ["等命飛踢", "基本功夫", "劍舞之心"]) {
      const p = publishSlot(title);
      expect(p.statisticsAugmentId).toBe(p.canonicalAugmentId);
    }
  });

  it("slot order is stable and the three records never collide", () => {
    const badges = ["等命飛踢", "基本功夫", "劍舞之心"].map((t) => publishSlot(t).badge);
    expect(badges).toEqual(["S · 58.0%", "A · 46.0%", "C · 48.1%"]);
    expect(new Set(badges).size).toBe(3);
  });

  it("a present champion row is preferred over the global value for the SAME id", () => {
    // Directly contrast the two sources for 1004: champion-first must win.
    const champ = publishSlot("基本功夫");
    const globalOnly = compactWinRateFromFraction(GLOBAL_BY_ID["1004"].rawWinRate);
    expect(champ.badge).toBe("A · 46.0%");
    expect(`S · ${globalOnly}`).toBe("S · 54.9%"); // what a champion-first regression would wrongly show
  });
});
