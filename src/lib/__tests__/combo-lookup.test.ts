import { describe, expect, test } from "vitest";
import augmentsData from "../../../data/internal/augments.json";
import combosData from "../../../data/internal/combos.json";
import {
  buildComboTierLookup,
  normalizeLookupKey,
  resolveAugmentChampions,
} from "../data/combo-lookup";

describe("normalizeLookupKey", () => {
  test("normalizes punctuation, spaces, and ampersands", () => {
    expect(normalizeLookupKey("Quest: Wooglet's Witchcap")).toBe(
      "questwoogletswitchcap",
    );
    expect(normalizeLookupKey("Nunu &#38; Willump")).toBe("nunuandwillump");
    expect(normalizeLookupKey("Dr. Mundo")).toBe("drmundo");
  });
});

describe("buildComboTierLookup", () => {
  test("resolves generated combos through their stored augment slug", () => {
    const lookup = buildComboTierLookup(
      "brand",
      [
        {
          champion: "brand",
          augment: "external display name can drift",
          augmentSlug: "quest-wooglets-witchcap",
          tier: "S",
        },
      ],
      augmentsData.augments,
    );

    expect(lookup.get("quest-wooglets-witchcap")).toBe("S");
  });

  test("keeps the legacy champion and augment name normalization fallback", () => {
    const lookup = buildComboTierLookup(
      "aurelion-sol",
      [
        {
          champion: "Aurelion Sol",
          augment: "Quest: Wooglet's Witchcap",
          tier: "A",
        },
      ],
      augmentsData.augments,
    );

    expect(lookup.get("quest-wooglets-witchcap")).toBe("A");
  });

  test("resolves current generated data for champion detail consumers", () => {
    const generated = combosData.combos.find(
      (combo) => combo.champion === "brand" && combo.tier === "S",
    );
    expect(generated?.augmentSlug).toBeTruthy();
    const lookup = buildComboTierLookup(
      "brand",
      combosData.combos,
      augmentsData.augments,
    );

    expect(lookup.get(generated!.augmentSlug)).toBe(generated!.tier);
  });
});

describe("resolveAugmentChampions", () => {
  const augments = [{ slug: "double-defense", name: "Double Defense" }];

  test("lists champions for an augment, de-duplicated, S/A/B/C only", () => {
    const result = resolveAugmentChampions(
      "double-defense",
      [
        { champion: "aatrox", augment: "Double Defense", tier: "S" },
        { champion: "aatrox", augment: "Double Defense", tier: "A" },
        { champion: "garen", augment: "Double Defense", tier: "B" },
        { champion: "teemo", augment: "Double Defense", tier: "D" },
        { champion: "ashe", augment: "Other Augment", tier: "S" },
      ],
      augments,
    );

    expect(result).toEqual([
      { champion: "aatrox", tier: "S" },
      { champion: "garen", tier: "B" },
    ]);
  });
});
