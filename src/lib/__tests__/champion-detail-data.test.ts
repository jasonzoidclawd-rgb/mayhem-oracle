import { describe, expect, test } from "vitest";
import { loadChampionDetailData } from "../champions/detail-data";

describe("champion detail data boundary", () => {
  test("keeps public champion detail data sanitized but loads member scoring data internally", async () => {
    const publicData = await loadChampionDetailData("public");
    const memberData = await loadChampionDetailData("member");

    expect(publicData.augments.every((augment) => augment.win_rate == null)).toBe(true);
    expect(memberData.augments.some((augment) => typeof augment.win_rate === "number")).toBe(true);

    expect(new Set(publicData.combos.map((combo) => combo.tier))).toEqual(new Set(["S"]));
    expect(new Set(memberData.combos.map((combo) => combo.tier))).toEqual(
      new Set(["S", "A", "B", "C"]),
    );
  });
});
