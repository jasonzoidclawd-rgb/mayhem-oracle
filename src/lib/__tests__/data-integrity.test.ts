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
});
