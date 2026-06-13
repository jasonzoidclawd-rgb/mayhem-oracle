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
  test("resolves curated combos despite punctuation drift", () => {
    const lookup = buildComboTierLookup(
      "shaco",
      combosData.combos,
      augmentsData.augments,
    );

    expect(lookup.get("dont-blink")).toBe("A");
  });

  test("resolves champion and augment name normalization together", () => {
    const lookup = buildComboTierLookup(
      "aurelionsol",
      combosData.combos,
      augmentsData.augments,
    );

    expect(lookup.get("ice-cold")).toBe("S");
  });

  test("recovers more combos than the old naive join", () => {
    const naiveCount = combosData.combos.filter((combo) =>
      augmentsData.augments.some(
        (augment) =>
          combo.champion === "shaco" &&
          augment.slug === combo.augment.replace(/ /g, "-"),
      ),
    ).length;

    const lookup = buildComboTierLookup(
      "shaco",
      combosData.combos,
      augmentsData.augments,
    );

    expect(lookup.size).toBeGreaterThan(naiveCount);
  });
});
