import { describe, expect, test } from "vitest";
import augmentsData from "../../../data/internal/augments.json";
import combosData from "../../../data/internal/combos.json";
import { buildComboTierLookup, normalizeLookupKey } from "../data/combo-lookup";

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
