import { describe, expect, test } from "vitest";
import { projectVisibleItemCatalog } from "@/lib/items/catalog";

describe("public item catalog projection", () => {
  test("collapses base and mode variants to one deterministic display row", () => {
    const projected = projectVisibleItemCatalog({
      mayhemExclusive: [{ id: 4403, name: "The Golden Spatula", slug: "the-golden-spatula", cost: 0, description: "", icon: "" }],
      items: [
        { id: 3031, name: "Infinity Edge", cost: 3400, description: "", icon: "" },
        { id: 223031, name: "Infinity Edge", cost: 2500, description: "", icon: "" },
        { id: 4403, name: "The Golden Spatula", cost: 2500, description: "", icon: "" },
        { id: 1001, name: "Boots", cost: 300, description: "", icon: "" },
      ],
    });

    expect(projected.items.map((item) => item.id)).toEqual([223031, 1001]);
    expect(projected.mayhemExclusive.map((item) => item.id)).toEqual([4403]);
    expect(projected.items.filter((item) => item.name === "Infinity Edge")).toHaveLength(1);
  });

  test("keeps the result byte-deterministic for repeated input", () => {
    const input = {
      mayhemExclusive: [],
      items: [
        { id: 1001, name: "Boots", cost: 300, description: "", icon: "" },
        { id: 223031, name: "Infinity Edge", cost: 2500, description: "", icon: "" },
        { id: 3031, name: "Infinity Edge", cost: 3400, description: "", icon: "" },
      ],
    };
    expect(projectVisibleItemCatalog(input)).toEqual(projectVisibleItemCatalog(input));
  });
});
