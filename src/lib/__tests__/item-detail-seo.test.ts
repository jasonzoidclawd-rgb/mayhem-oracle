import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildItemDetailJsonLd } from "@/lib/seo/item-detail";
import { localizedUrl } from "@/lib/site";
import type { Item } from "@/lib/types";

const ROOT = process.cwd();

const forbiddenJsonLdTerms = [
  "oracleScore",
  "modelWeights",
  "scoreBreakdown",
  "computedPool",
  "signals",
  "provenance",
  "data/internal",
  "prompt",
  "openai",
  "anthropic",
  "llm",
];

const itemFixture = {
  slug: "atmas-reckoning",
  id: 200_223,
  name: "Atma's Reckoning",
  cost: 2900,
  description: "A public item description for ARAM Mayhem.",
  icon: "/items/atmas-reckoning.png",
  categories: ["Health", "CriticalStrike"],
  stats: "700 Health, 20% Critical Strike Chance",
  recipe: ["Ruby Crystal", "Cloak of Agility"],
  tier: "legendary",
  mayhemTag: "exclusive",
  wikiPassives: [{ label: "Unique", text: "Gain public bonus stats." }],
  wikiNotes: ["Public gameplay note."],
  oracleScore: 99,
  modelWeights: { private: true },
  scoreBreakdown: [{ reason: "private" }],
  computedPool: ["private"],
  signals: ["private"],
  provenance: "data/internal/items.json",
} satisfies Item & Record<string, unknown>;

function graphOf(data: Record<string, unknown>) {
  return data["@graph"] as Array<Record<string, unknown>>;
}

function graphNode(data: Record<string, unknown>, type: string) {
  return graphOf(data).find((node) => node["@type"] === type);
}

describe("item detail structured data", () => {
  test("emits localized WebPage, BreadcrumbList, and Thing JSON-LD from public item fields", () => {
    const url = localizedUrl("/items/atmas-reckoning", "zh-TW");
    const data = buildItemDetailJsonLd(itemFixture, "zh-TW", {
      url,
      homeUrl: localizedUrl("/", "zh-TW"),
      itemsUrl: localizedUrl("/items", "zh-TW"),
      itemsLabel: "Items",
      name: "Atma's Reckoning",
      description: "See Atma's Reckoning item stats and effects.",
      identifier: "atmas-reckoning",
      tierLabel: "Legendary",
      tagLabel: "Exclusive",
      categoryLabels: ["Health", "Critical Strike"],
    });

    expect(data["@context"]).toBe("https://schema.org");
    expect(graphOf(data).map((node) => node["@type"])).toEqual([
      "WebPage",
      "BreadcrumbList",
      "Thing",
    ]);

    expect(graphNode(data, "WebPage")).toMatchObject({
      "@id": `${url}#webpage`,
      url,
      name: "Atma's Reckoning",
      inLanguage: "zh-TW",
    });

    const breadcrumbs = graphNode(data, "BreadcrumbList");
    const items = breadcrumbs?.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.name)).toEqual([
      "Mayhem Oracle",
      "Items",
      "Atma's Reckoning",
    ]);
    expect(items[0]).toMatchObject({ position: 1, item: localizedUrl("/", "zh-TW") });
    expect(items[1]).toMatchObject({ position: 2, item: localizedUrl("/items", "zh-TW") });
    expect(items[2]).toMatchObject({ position: 3, item: url });

    expect(graphNode(data, "Thing")).toMatchObject({
      "@id": `${url}#item`,
      name: "Atma's Reckoning",
      identifier: "atmas-reckoning",
      inLanguage: "zh-TW",
    });
    expect(JSON.stringify(data)).toContain("Gold cost");
    expect(JSON.stringify(data)).toContain("Public categories");
  });

  test("does not include private scoring or prompt-related fields in item JSON-LD", () => {
    const data = buildItemDetailJsonLd(itemFixture, "en", {
      url: localizedUrl("/items/atmas-reckoning", "en"),
      itemsUrl: localizedUrl("/items", "en"),
      itemsLabel: "Items",
      name: "Atma's Reckoning",
      identifier: "atmas-reckoning",
    });

    const serialized = JSON.stringify(data).toLowerCase();
    for (const term of forbiddenJsonLdTerms) {
      expect(serialized).not.toContain(term.toLowerCase());
    }
  });

  test("item detail page wires JsonLd and buildItemDetailJsonLd into the route", () => {
    const source = readFileSync(
      path.join(ROOT, "src/app/[locale]/items/[identifier]/page.tsx"),
      "utf-8",
    );

    expect(source).toContain('import { JsonLd } from "@/components/seo/JsonLd";');
    expect(source).toContain('import { buildItemDetailJsonLd } from "@/lib/seo/item-detail";');
    expect(source).toContain("const itemJsonLd = buildItemDetailJsonLd(");
    expect(source).toContain("<JsonLd data={itemJsonLd} />");
  });
});
