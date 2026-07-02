import { describe, expect, test } from "vitest";
import championsData from "../../../public/data/champions.json";
import augmentsData from "../../../public/data/augments.json";
import { routing, type Locale } from "@/i18n/routing";
import { localizedDescription, localizedName } from "@/lib/i18n/localized-name";
import { loadChampionDetailData } from "@/lib/champions/detail-data";

type LocalizedRecord = Record<string, unknown> & {
  slug: string;
  name: string;
  description?: string;
  wikiDescription?: string;
};

const localeSuffix: Record<Exclude<Locale, "en">, string> = {
  "zh-TW": "zh_TW",
  "zh-CN": "zh_CN",
  ja: "ja",
  ko: "ko",
};

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function coverage(records: LocalizedRecord[], field: string): number {
  return records.filter((record) => hasText(record[field])).length / records.length;
}

describe("locale coverage", () => {
  const champions = championsData.champions as LocalizedRecord[];
  const augments = augmentsData.augments as LocalizedRecord[];

  test("public catalogs keep localized name and augment description coverage above fallback thresholds", () => {
    for (const locale of routing.locales) {
      if (locale === "en") continue;
      const suffix = localeSuffix[locale];

      expect(coverage(champions, `name_${suffix}`), `${locale} champion name coverage`).toBeGreaterThanOrEqual(0.9);
      expect(coverage(augments, `name_${suffix}`), `${locale} augment name coverage`).toBeGreaterThanOrEqual(0.8);
      expect(coverage(augments, `description_${suffix}`), `${locale} augment description coverage`).toBeGreaterThanOrEqual(0.8);
    }
  });

  test("localizedName uses English only when the exact localized field is absent", () => {
    const record = {
      name: "English Name",
      name_zh_TW: "繁中名稱",
      name_zh_CN: "简中名称",
      name_ja: "日本語名",
      name_ko: "한국어 이름",
    };

    expect(localizedName(record, "zh-TW")).toBe(record.name_zh_TW);
    expect(localizedName(record, "zh-CN")).toBe(record.name_zh_CN);
    expect(localizedName(record, "ja")).toBe(record.name_ja);
    expect(localizedName(record, "ko")).toBe(record.name_ko);
    expect(localizedName(record, "en")).toBe(record.name);

    expect(localizedName({ name: record.name, name_zh_CN: record.name_zh_CN }, "zh-TW")).toBe(record.name);
  });

  test("zh-TW champion-page data resolves known champion names and augment descriptions away from English", async () => {
    const data = await loadChampionDetailData("public");
    const championSlugs = ["brand", "vayne", "sett", "ahri", "lux"];
    const augmentSlugs = [
      "tank-engine",
      "heavy-hitter",
      "quest-steel-your-heart",
      "dropkick",
      "phenomenal-evil",
    ];

    for (const slug of championSlugs) {
      const champion = data.champions.find((entry) => entry.slug === slug) as LocalizedRecord | undefined;
      expect(champion, slug).toBeDefined();
      expect(localizedName(champion!, "zh-TW"), slug).not.toBe(champion!.name);
    }

    for (const slug of augmentSlugs) {
      const augment = data.augments.find((entry) => entry.slug === slug) as LocalizedRecord | undefined;
      expect(augment, slug).toBeDefined();
      const englishDescription = augment!.description ?? augment!.wikiDescription ?? "";

      expect(localizedName(augment!, "zh-TW"), slug).not.toBe(augment!.name);
      expect(localizedDescription(augment!, "zh-TW"), slug).not.toBe("");
      expect(localizedDescription(augment!, "zh-TW"), slug).not.toBe(englishDescription);
    }
  });
});
