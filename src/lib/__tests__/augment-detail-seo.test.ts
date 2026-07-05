import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { localizedUrl } from "@/lib/site";
import { buildAugmentDetailJsonLd } from "@/lib/seo/augment-detail";

const fixtureAugment = {
  slug: "tank-engine",
  name: "Tank Engine",
  name_zh_TW: "坦克引擎",
  rarity: "gold",
  type: "ability",
  wikiDescription: "Gain movement speed based on bonus health.",
  kit_tags: ["health", "movement"],
  oracleScore: 99,
  modelWeights: { health: 1 },
  scoreBreakdown: [{ reason: "private" }],
};

describe("augment detail structured data", () => {
  test("builds bounded public JSON-LD for localized augment detail pages", () => {
    const url = localizedUrl("/augments/tank-engine", "zh-TW");
    const jsonLd = buildAugmentDetailJsonLd(fixtureAugment, "zh-TW", {
      url,
      homeUrl: localizedUrl("/", "zh-TW"),
      name: "坦克引擎",
      description: "Gain movement speed based on bonus health.",
      augmentsUrl: localizedUrl("/augments", "zh-TW"),
      augmentsLabel: "增幅",
      rarityLabel: "Gold",
    });
    const graph = jsonLd["@graph"] as Record<string, unknown>[];
    const breadcrumb = graph.find((node) => node["@type"] === "BreadcrumbList");
    const term = graph.find((node) => node["@type"] === "DefinedTerm");

    expect(graph.map((node) => node["@type"])).toEqual([
      "WebPage",
      "BreadcrumbList",
      "DefinedTerm",
    ]);
    expect(graph[0]).toMatchObject({
      name: "坦克引擎",
      url,
      inLanguage: "zh-TW",
    });
    expect((breadcrumb?.itemListElement as Record<string, unknown>[]).map((item) => item.name)).toEqual([
      "Mayhem Oracle",
      "增幅",
      "坦克引擎",
    ]);
    expect(term).toMatchObject({
      name: "坦克引擎",
      termCode: "tank-engine",
      description: "Gain movement speed based on bonus health.",
    });
    expect(JSON.stringify(jsonLd)).not.toMatch(
      /oracleScore|modelWeights|scoreBreakdown|computedPool|signals|provenance|data\/internal|prompt/i,
    );
  });

  test("augment detail page renders JSON-LD through the shared SEO helper", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/augments/[slug]/page.tsx"),
      "utf8",
    );

    expect(source).toContain('import { JsonLd } from "@/components/seo/JsonLd"');
    expect(source).toContain('import { buildAugmentDetailJsonLd } from "@/lib/seo/augment-detail"');
    expect(source).toContain("<JsonLd data={augmentJsonLd} />");
    expect(source).toContain("rarity: rarityLabel[augment.rarity]");
  });
});
