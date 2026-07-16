import { describe, expect, test } from "vitest";
import { formatPbeChange, formatPbeValue } from "@/lib/patch-notes/pbe";

describe("PBE change presentation", () => {
  test("strips CDragon markup while marking unresolved template values neutrally", () => {
    expect(
      formatPbeValue("<mainText><stats> 25</stats><br><br>@TooltipValue@ %i:cooldown%</mainText>"),
    ).toBe("25 — —");
  });

  test("keeps numeric arrays deterministic", () => {
    expect(formatPbeValue([8, 7, 6])).toBe("[8,7,6]");
  });

  test("preserves ordinary percentage values", () => {
    expect(formatPbeValue("35% Attack Speed and 25% Move Speed")).toBe(
      "35% Attack Speed and 25% Move Speed",
    );
  });

  test("compacts repeated prose around the changed segment", () => {
    const result = formatPbeChange(
      "45 Move Speed 4 Omnivamp on Champion takedown, stacking up to 10 times. Now and Forever While above half Health, deal 5 increased healing, shielding, and regeneration.",
      "45 Move Speed 4 Omnivamp on Champion takedown, stacking up to 10 times. Now and Forever While above half Health, deal 4 increased healing, shielding, and regeneration.",
    );

    expect(result.before).toContain("deal 5 increased");
    expect(result.after).toContain("deal 4 increased");
    expect(result.before.length).toBeLessThan(180);
    expect(result.after.length).toBeLessThan(180);
  });
});
