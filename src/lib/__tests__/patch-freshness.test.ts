import { describe, expect, test } from "vitest";
import { describeFreshness } from "@/lib/patch-notes/freshness";

describe("patch freshness", () => {
  test("describes day-by-day current observations without false precision", () => {
    const now = new Date("2026-07-11T18:00:00Z");

    expect(describeFreshness("fresh", "2026-07-11T01:00:00Z", now)).toEqual({
      state: "today",
      days: 0,
    });
    expect(describeFreshness("fresh", "2026-07-10T12:00:00Z", now)).toEqual({
      state: "days",
      days: 1,
    });
  });

  test("does not call missing, invalid, or old observations no changes", () => {
    const now = new Date("2026-07-11T18:00:00Z");

    expect(describeFreshness("unavailable", "", now)).toEqual({ state: "unavailable", days: null });
    expect(describeFreshness("fresh", "invalid", now)).toEqual({ state: "unavailable", days: null });
    expect(describeFreshness("fresh", "2026-07-09T00:00:00Z", now)).toEqual({
      state: "stale",
      days: 2,
    });
  });
});
