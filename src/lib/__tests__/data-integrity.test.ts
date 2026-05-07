import { describe, expect, test } from "vitest";
import augmentsData from "../../../public/data/augments.json";
import championsData from "../../../public/data/champions.json";
import combosData from "../../../public/data/combos.json";
import { VALID_AUGMENT_SET_LABELS } from "../data/augment-set";
import { buildComboTierLookup } from "../data/combo-lookup";

describe("data integrity", () => {
  test("champion and augment slugs are unique", () => {
    const championSlugs = championsData.champions.map((champion) => champion.slug);
    const augmentSlugs = augmentsData.augments.map((augment) => augment.slug);

    expect(new Set(championSlugs).size).toBe(championSlugs.length);
    expect(new Set(augmentSlugs).size).toBe(augmentSlugs.length);
  });

  test("combo tiers stay within the supported set", () => {
    const validTiers = new Set(["S", "A", "B", "C"]);

    for (const combo of combosData.combos) {
      expect(validTiers.has(combo.tier)).toBe(true);
    }
  });

  test("wiki set labels are known augment set names", () => {
    for (const augment of augmentsData.augments) {
      if ("wikiSet" in augment && augment.wikiSet) {
        expect(VALID_AUGMENT_SET_LABELS.has(augment.wikiSet)).toBe(true);
      }
    }
  });

  test("known system breaker augments are flagged in generated data", () => {
    const systemBreakers = new Set([
      "draw-your-sword",
      "jeweled-gauntlet",
      "master-of-duality",
      "mystic-punch",
      "tap-dancer",
      "marksmage",
      "slow-and-steady",
      "vulnerability",
    ]);

    for (const slug of systemBreakers) {
      const augment = augmentsData.augments.find((candidate) => candidate.slug === slug);
      expect(augment?.flags?.system_breaker).toBe(true);
    }
  });

  test("normalized combo resolution covers most curated combos", () => {
    let resolved = 0;

    for (const champion of championsData.champions) {
      resolved += buildComboTierLookup(
        champion.slug,
        combosData.combos,
        augmentsData.augments,
      ).size;
    }

    expect(resolved).toBeGreaterThanOrEqual(
      Math.floor(combosData.combos.length * 0.9),
    );
  });

  // ── kit_tags coverage (added after classify_champions.py + classify_augments.py) ──

  test("all champions have at least one kit_tag", () => {
    for (const champion of championsData.champions) {
      const tags = (champion as unknown as { kit_tags?: string[] }).kit_tags;
      expect(Array.isArray(tags) && tags.length >= 1, `${champion.slug} has no kit_tags`).toBe(true);
    }
  });

  test("all augments have kit_tags array defined (null means unclassified)", () => {
    for (const augment of augmentsData.augments) {
      const tags = (augment as unknown as { kit_tags?: string[] | null }).kit_tags;
      expect(Array.isArray(tags), `${augment.slug} kit_tags is not an array`).toBe(true);
    }
  });

  test("no champion has mana or manaless kit_tags (resource gating lives in Layer 2)", () => {
    // classify_champions.py intentionally never emits resource tags.
    // pool-orchestrator.ts Layer 3 strips them from augments; this asserts the champion side
    // of that contract — if this breaks, mana-only augments will be wrongly excluded again.
    for (const champion of championsData.champions) {
      const tags = (champion as unknown as { kit_tags?: string[] }).kit_tags ?? [];
      expect(tags).not.toContain("mana");
      expect(tags).not.toContain("manaless");
    }
  });

  test("champion exemplar tags match observed classifier output", () => {
    const find = (slug: string) => championsData.champions.find((c) => c.slug === slug) as unknown as { kit_tags: string[] };

    const brand = find("brand");
    expect(brand.kit_tags).toEqual(expect.arrayContaining(["ability", "dot"]));

    const yasuo = find("yasuo");
    expect(yasuo.kit_tags).toEqual(expect.arrayContaining(["attack", "crit"]));

    const garen = find("garen");
    expect(garen.kit_tags).toEqual(expect.arrayContaining(["attack", "tank"]));
    expect(garen.kit_tags).not.toContain("mana");
    expect(garen.kit_tags).not.toContain("manaless");
  });

  test("augment exemplar tags and flags match observed classifier output", () => {
    type ClassifiedAugment = { slug: string; kit_tags: string[]; flags?: { system_breaker?: boolean } };
    const find = (slug: string) => augmentsData.augments.find((a) => a.slug === slug) as unknown as ClassifiedAugment;

    const overflow = find("overflow");
    expect(overflow.kit_tags).toEqual(expect.arrayContaining(["ability", "mana"]));

    const jg = find("jeweled-gauntlet");
    expect(jg.kit_tags).toEqual(expect.arrayContaining(["ability", "crit"]));
    expect(jg.flags?.system_breaker).toBe(true);
  });
});
