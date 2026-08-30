import { describe, expect, it } from "vitest";

import { parseStatsList } from "./aramggSource";

/**
 * Sample size is metadata, not the statistic.
 *
 * Live evidence (2026-08-31, `/tmp/mayhem-slice-a-live-3.log`): ARAMGG's
 * `augments-stats-raw.json` now sends `num_games: null` on every one of its 208
 * entries. Requiring it as a string skipped all 208, so the source parsed to
 * zero records and threw; the hook then fell back to a localStorage cache whose
 * patch was `16.14`, and that stale patch gated the FRESH local-artifact
 * dataset (`16.17`) out of existence — every slot rendered LOADING DATA for a
 * whole game.
 *
 * `win_rate` and `tier` stay mandatory: those ARE the statistic, and a missing
 * one must still be skipped rather than coerced.
 */

function entry(id: string, blob: Record<string, unknown>): [string, string] {
  return [id, JSON.stringify(blob)];
}

const LIVE_SHAPE = {
  top_champions: null,
  top_champion_ids: ["36", "223"],
  tier: "5",
  augment_stage_stats: null,
  num_win_games: null,
  win_rate: "0.4768",
  num_games: null,
};

describe("parseStatsList sample-size tolerance", () => {
  it("keeps a record whose num_games is null", () => {
    const { stats } = parseStatsList([entry("1001", LIVE_SHAPE)]);

    expect(stats.size).toBe(1);
    const stat = stats.get("1001");
    expect(stat?.rawWinRate).toBe("0.4768");
    expect(stat?.tierLetter).toBeTruthy();
    // Absent sample size is reported as empty, the same convention pick_rate
    // already uses — never invented, never a fake count.
    expect(stat?.numGames).toBe("");
  });

  it("keeps a record whose num_games is absent entirely", () => {
    const { win_rate, tier } = LIVE_SHAPE;
    const { stats } = parseStatsList([entry("1002", { win_rate, tier })]);

    expect(stats.size).toBe(1);
    expect(stats.get("1002")?.numGames).toBe("");
  });

  it("still keeps a real num_games string when one is sent", () => {
    const { stats } = parseStatsList([
      entry("1003", { ...LIVE_SHAPE, num_games: "48213" }),
    ]);

    expect(stats.get("1003")?.numGames).toBe("48213");
  });

  it("still skips a record with no win rate or no tier", () => {
    const { stats, skipped } = parseStatsList([
      entry("1004", { ...LIVE_SHAPE, win_rate: null }),
      entry("1005", { ...LIVE_SHAPE, tier: null }),
    ]);

    expect(stats.size).toBe(0);
    expect(skipped).toBe(2);
  });

  it("parses the live 208-entry shape to a non-empty source", () => {
    // The exact condition that threw "ARAMGG stats parsed to zero valid
    // records" and triggered the stale-cache fallback.
    const live = Array.from({ length: 208 }, (_, i) =>
      entry(String(1001 + i), LIVE_SHAPE),
    );

    expect(parseStatsList(live).stats.size).toBe(208);
  });
});
