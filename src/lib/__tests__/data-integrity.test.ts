import { describe, expect, test } from "vitest";
import augmentsData from "../../../public/data/augments.json";
import championsData from "../../../public/data/champions.json";
import combosData from "../../../public/data/combos.json";
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
