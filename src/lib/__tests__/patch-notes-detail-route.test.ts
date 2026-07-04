import { describe, expect, test } from "vitest";
import {
  buildPatchDetailStaticParams,
  findPatchByVersion,
  patchDetailRoute,
} from "@/lib/patch-notes/routes";
import type { PatchNotesData } from "@/lib/types";

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
  test("builds stable localized static params for every public patch", () => {
    expect(buildPatchDetailStaticParams(fixture, ["en", "zh-TW"])).toEqual([
      { locale: "en", patch: "26.13" },
      { locale: "en", patch: "26.12" },
      { locale: "zh-TW", patch: "26.13" },
      { locale: "zh-TW", patch: "26.12" },
    ]);
  });

  test("resolves patch records and canonical detail routes", () => {
    expect(findPatchByVersion(fixture, "26.12")?.title).toBe(
      "League of Legends Patch 26.12 Notes",
    );
    expect(findPatchByVersion(fixture, "26.11")).toBeNull();
    expect(patchDetailRoute("26.13")).toBe("/patch-notes/26.13");
  });
});
