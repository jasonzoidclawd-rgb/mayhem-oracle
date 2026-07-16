import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { localizedUrl } from "@/lib/site";
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
      { locale: "en", patch: "26-13" },
      { locale: "en", patch: "26.12" },
      { locale: "en", patch: "26-12" },
      { locale: "zh-TW", patch: "26.13" },
      { locale: "zh-TW", patch: "26-13" },
      { locale: "zh-TW", patch: "26.12" },
      { locale: "zh-TW", patch: "26-12" },
    ]);
  });

  test("builds every public patch and locale static param", () => {
    const params = buildPatchDetailStaticParams(patchNotesData, routing.locales);
    const expected = routing.locales.flatMap((locale) =>
      patchNotesData.patches.flatMap((patch) => [
        { locale, patch: patch.version },
        { locale, patch: patch.version.replace(".", "-") },
      ]),
    );

    expect(params).toEqual(expected);
    expect(params).toHaveLength(
      patchNotesData.patches.length * routing.locales.length * 2,
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

    expect(buildPatchDetailStaticParams(fixture, ["en", "zh-TW"])).toHaveLength(8);
    expect(
      buildPatchDetailStaticParams(expandedFixture, ["en", "zh-TW"]),
    ).toHaveLength(12);
  });

  test("resolves patch records and canonical detail routes", () => {
    expect(findPatchByVersion(fixture, "26.12")?.title).toBe(
      "League of Legends Patch 26.12 Notes",
    );
    expect(findPatchByVersion(fixture, "26.11")).toBeNull();
    expect(findPatchByVersion(fixture, "26-13")?.version).toBe("26.13");
    expect(patchDetailRoute("26.13")).toBe("/patch-notes/26.13");
  });

  test("default-locale dotted patch detail routes are generated and proxy-covered", () => {
    const route = patchDetailRoute("26.13");
    const params = buildPatchDetailStaticParams(fixture, routing.locales);
    const proxySource = readFileSync(
      path.join(process.cwd(), "src/proxy.ts"),
      "utf8",
    );

    expect(localizedUrl(route, routing.defaultLocale)).toBe(
      "https://wasfun.lol/en/patch-notes/26.13",
    );
    expect(params).toContainEqual({
      locale: routing.defaultLocale,
      patch: "26.13",
    });
    expect(proxySource).toContain('"/patch-notes/:path*"');
  });

  test("patch cards expose crawlable links to detail pages", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/patch-notes/PatchCard.tsx"),
      "utf8",
    );

    expect(source).toContain("patchDetailRoute(patch.version)");
    expect(source).toContain('href={patchDetailRoute(patch.version)}');
    expect(source).toContain("id={patchNoteSectionAnchor(patchVersion, section.id)}");
  });
});
