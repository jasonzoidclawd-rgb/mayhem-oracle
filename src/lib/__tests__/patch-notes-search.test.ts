import { describe, expect, test } from "vitest";
import { buildPatchNoteSearchItems } from "@/lib/patch-notes/search";
import type { PatchNotesData } from "@/lib/types";

const fixture: PatchNotesData = {
  patch: "26.13",
  source: "Riot Games",
  scraped_at: "2026-06-23T18:00:00.000Z",
  patches: [
    {
      version: "26.13",
      title: "League of Legends Patch 26.13 Notes",
      released: "2026-06-25",
      sections: [
        {
          id: "augments",
          title: "Augments",
          changes: [
            {
              subject: { en: "Atma's Reckoning", "zh-tw": "阿塔瑪的清算" },
              text: {
                en: "Added a new item-scaling augment.",
                "zh-tw": "新增一個會依裝備成長的增幅。",
              },
              kind: "added",
            },
            {
              subject: { en: "Champion Balance", "zh-tw": "英雄平衡" },
              text: {
                en: "Fixed a tooltip mismatch.",
                "zh-tw": "修正提示文字不一致。",
              },
              kind: "fixed",
            },
          ],
        },
      ],
    },
    {
      version: "26.12",
      title: "League of Legends Patch 26.12 Notes",
      released: "2026-06-11",
      sections: [],
    },
  ],
};

describe("patch-notes search entries", () => {
  test("builds localized patch-note entries with change kind tokens", () => {
    const items = buildPatchNoteSearchItems(fixture, "zh-TW", {
      patchLabel: (patch) => `版本 ${patch}`,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "patch-note",
      patch: "26.13",
      href: "/patch-notes#patch-26-13-augments",
      name: "版本 26.13 · Augments",
      snippet: "阿塔瑪的清算: 新增一個會依裝備成長的增幅。 英雄平衡: 修正提示文字不一致。",
    });
    expect(items[0].searchText).toContain("added fixed");
    expect(items[0].searchText).toContain("新增一個會依裝備成長的增幅");
  });
});
