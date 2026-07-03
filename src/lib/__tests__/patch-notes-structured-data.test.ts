import { describe, expect, test } from "vitest";
import {
  buildPatchNotesJsonLd,
  resolvePatchNotesLastModified,
} from "@/lib/patch-notes/seo";
import type { PatchNotesData } from "@/lib/types";

const fixture: PatchNotesData = {
  patch: "26.13",
  source: "Riot Games",
  sourceKind: "official-riot-patch-notes",
  sourceUrl: "https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-13-notes/",
  scraped_at: "2026-06-23T18:00:00.000Z",
  patches: [
    {
      version: "26.13",
      title: "League of Legends Patch 26.13 Notes",
      released: "2026-06-25",
      publishedAt: "2026-06-25T12:00:00Z",
      authors: ["Riot Locke"],
      intro: "Welcome to the official notes.",
      summary: {
        totalChanges: 2,
        byKind: { added: 1, fixed: 1 },
        byEntityType: { augment: 1, system: 1 },
        byLabel: {},
        damageRelevant: 1,
      },
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
          ],
        },
      ],
    },
    {
      version: "26.12",
      title: "League of Legends Patch 26.12 Notes",
      released: "2026-06-11",
      publishedAt: "2026-06-11T12:00:00Z",
      sections: [],
    },
  ],
};

describe("patch-notes structured data", () => {
  test("uses the stable public patch-note scrape time as lastmod", () => {
    expect(resolvePatchNotesLastModified(fixture)?.toISOString()).toBe(
      "2026-06-23T18:00:00.000Z",
    );
  });

  test("builds JSON-LD from public patch-note metadata", () => {
    const jsonLd = buildPatchNotesJsonLd(fixture, "zh-TW", {
      url: "https://wasfun.lol/zh-TW/patch-notes",
      title: "版本更新",
      description: "Riot 官方更新公告，連結 Mayhem Oracle 公開資料。",
      breadcrumbLabel: "版本更新",
      patchLabel: (patch) => `版本 ${patch}`,
    });

    const graph = jsonLd["@graph"] as Record<string, unknown>[];

    expect(graph.map((node) => node["@type"])).toEqual([
      "CollectionPage",
      "BreadcrumbList",
      "ItemList",
      "Article",
    ]);
    expect(graph[0]).toMatchObject({
      name: "版本更新",
      inLanguage: "zh-TW",
      dateModified: "2026-06-23T18:00:00.000Z",
    });
    expect(graph[2]).toMatchObject({
      numberOfItems: 2,
    });
    expect(graph[3]).toMatchObject({
      headline: "League of Legends Patch 26.13 Notes",
      datePublished: "2026-06-25T12:00:00.000Z",
      dateModified: "2026-06-23T18:00:00.000Z",
    });
    expect(JSON.stringify(jsonLd)).not.toContain("oracleScore");
  });
});
