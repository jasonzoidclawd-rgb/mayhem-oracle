import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildChampionDetailJsonLd } from "@/lib/seo/champion-detail";
import { localizedUrl } from "@/lib/site";
import type { ChampionDetailChampion } from "@/lib/champions/detail-data";

const ROOT = process.cwd();

const forbiddenJsonLdTerms = [
  "oracleScore",
  "modelWeights",
  "scoreBreakdown",
  "computedPool",
  "championPools",
  "poolRules",
  "signals",
  "provenance",
  "data/internal",
  "prompt",
  "openai",
  "anthropic",
  "llm",
  "supabase",
  "member",
  "session",
];

const championFixture = {
  slug: "brand",
  name: "Brand",
  title: "the Burning Vengeance",
  tier: "S+",
  rank: 1,
  win_rate: 55.7,
  pick_rate: 14.22,
  tags: ["mage", "support"],
  classes: ["mage"],
  kit_tags: ["ability", "cc", "dot", "haste"],
  icon: "https://example.com/brand.png",
  baseStats: {
    baseHP: 570,
    hpGrowth: 105,
    baseArmor: 24,
    armorGrowth: 4.2,
    baseMR: 30,
    mrGrowth: 1.3,
    baseAD: 57,
    adGrowth: 3,
    baseAS: 0.681,
    asGrowth: 2,
    attackRange: 550,
    moveSpeed: 340,
    baseMP: 469,
    mpGrowth: 21,
    baseHPRegen: 5.5,
    hpRegenGrowth: 0.55,
  },
  oracleScore: 99,
  modelWeights: { private: true },
  scoreBreakdown: [{ reason: "private" }],
  computedPool: ["private"],
  championPools: ["private"],
  poolRules: { private: true },
  signals: ["private"],
  provenance: "data/internal/champions.json",
} satisfies ChampionDetailChampion & Record<string, unknown>;

function graphOf(data: Record<string, unknown>) {
  return data["@graph"] as Array<Record<string, unknown>>;
}

function graphNode(data: Record<string, unknown>, type: string) {
  return graphOf(data).find((node) => node["@type"] === type);
}

describe("champion detail structured data", () => {
  test("emits localized WebPage, BreadcrumbList, and Person JSON-LD from public champion fields", () => {
    const url = localizedUrl("/champions/brand", "zh-TW");
    const data = buildChampionDetailJsonLd(championFixture, "zh-TW", {
      url,
      homeUrl: localizedUrl("/", "zh-TW"),
      championsUrl: localizedUrl("/champions", "zh-TW"),
      championsLabel: "Champions",
      name: "Brand",
      description: "Brand is Tier S+ in ARAM Mayhem patch 26.13.",
      patch: "26.13",
      tierLabel: "S+",
      tagLabels: ["mage", "support"],
      classLabels: ["mage"],
      kitTagLabels: ["ability", "cc", "dot", "haste"],
    });

    expect(data["@context"]).toBe("https://schema.org");
    expect(graphOf(data).map((node) => node["@type"])).toEqual([
      "WebPage",
      "BreadcrumbList",
      "Person",
    ]);

    expect(graphNode(data, "WebPage")).toMatchObject({
      "@id": `${url}#webpage`,
      url,
      name: "Brand",
      inLanguage: "zh-TW",
    });

    const breadcrumbs = graphNode(data, "BreadcrumbList");
    const items = breadcrumbs?.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.name)).toEqual([
      "Mayhem Oracle",
      "Champions",
      "Brand",
    ]);
    expect(items[0]).toMatchObject({ position: 1, item: localizedUrl("/", "zh-TW") });
    expect(items[1]).toMatchObject({ position: 2, item: localizedUrl("/champions", "zh-TW") });
    expect(items[2]).toMatchObject({ position: 3, item: url });

    expect(graphNode(data, "Person")).toMatchObject({
      "@id": `${url}#champion`,
      name: "Brand",
      identifier: "brand",
      image: "https://example.com/brand.png",
      inLanguage: "zh-TW",
    });
    expect(JSON.stringify(data)).toContain("Public tier");
    expect(JSON.stringify(data)).toContain("Public win rate");
    expect(JSON.stringify(data)).toContain("Public kit tags");
  });

  test("does not include private scoring, member, session, or prompt fields in champion JSON-LD", () => {
    const data = buildChampionDetailJsonLd(championFixture, "en", {
      url: localizedUrl("/champions/brand", "en"),
      championsUrl: localizedUrl("/champions", "en"),
      championsLabel: "Champions",
      name: "Brand",
      description: "Brand champion details.",
    });

    const serialized = JSON.stringify(data).toLowerCase();
    for (const term of forbiddenJsonLdTerms) {
      expect(serialized).not.toContain(term.toLowerCase());
    }
  });

  test("champion detail page wires JsonLd and buildChampionDetailJsonLd into the route", () => {
    const source = readFileSync(
      path.join(ROOT, "src/app/[locale]/champions/[slug]/page.tsx"),
      "utf-8",
    );

    expect(source).toContain('import { JsonLd } from "@/components/seo/JsonLd";');
    expect(source).toContain('import { buildChampionDetailJsonLd } from "@/lib/seo/champion-detail";');
    expect(source).toContain("const championJsonLd = buildChampionDetailJsonLd(");
    expect(source).toContain("<JsonLd data={championJsonLd} />");
  });
});
