import { describe, expect, test } from "vitest";
import {
  buildPatchDetailStaticParams,
  findPatchByVersion,
  patchDetailRoute,
} from "@/lib/patch-notes/routes";
import { routing } from "@/i18n/routing";
import type { PatchNotesData } from "@/lib/types";
import patchNotesData from "../../../public/data/patch-notes.json";

const fixture: PatchNotesData = {
  patch: "26.13",
  source: "Riot Games",
  patches: [
    {
      version: "26.13",
      title: "League of Legends Patch 26.13 Notes",
      released: "2026-06-25",
      sections: [],
    },
    {
      version: "26.12",
      title: "League of Legends Patch 26.12 Notes",
      released: "2026-06-11",
      sections: [],
    },
  ],
};

describe("patch-note detail routes", () => {
  test("builds stable localized static params from fixture patches", () => {
    expect(buildPatchDetailStaticParams(fixture, ["en", "zh-TW"])).toEqual([
      { locale: "en", patch: "26.13" },
      { locale: "en", patch: "26.12" },
      { locale: "zh-TW", patch: "26.13" },
      { locale: "zh-TW", patch: "26.12" },
    ]);
  });

  test("builds every public patch and locale static param", () => {
    const params = buildPatchDetailStaticParams(patchNotesData, routing.locales);
    const expected = routing.locales.flatMap((locale) =>
      patchNotesData.patches.map((patch) => ({
        locale,
        patch: patch.version,
      })),
    );

    expect(params).toEqual(expected);
    expect(params).toHaveLength(
      patchNotesData.patches.length * routing.locales.length,
    );
  });

  test("route count follows fixture patch count changes", () => {
    const expandedFixture: PatchNotesData = {
      ...fixture,
      patches: [
        ...fixture.patches,
        {
          version: "26.11",
          title: "League of Legends Patch 26.11 Notes",
          released: "2026-05-28",
          sections: [],
        },
      ],
    };

    expect(buildPatchDetailStaticParams(fixture, ["en", "zh-TW"])).toHaveLength(4);
    expect(
      buildPatchDetailStaticParams(expandedFixture, ["en", "zh-TW"]),
    ).toHaveLength(6);
  });

  test("resolves patch records and canonical detail routes", () => {
    expect(findPatchByVersion(fixture, "26.12")?.title).toBe(
      "League of Legends Patch 26.12 Notes",
    );
    expect(findPatchByVersion(fixture, "26.11")).toBeNull();
    expect(patchDetailRoute("26.13")).toBe("/patch-notes/26.13");
  });
});
