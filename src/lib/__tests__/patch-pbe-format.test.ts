import { describe, expect, test } from "vitest";
import { formatPbeValue } from "@/lib/patch-notes/pbe";

describe("PBE change presentation", () => {
  test("strips CDragon markup and template placeholders from text values", () => {
    expect(
      formatPbeValue("<mainText><stats> 25</stats><br><br>@TooltipValue@ %i:cooldown%</mainText>"),
    ).toBe("25");
  });

  test("keeps numeric arrays deterministic", () => {
    expect(formatPbeValue([8, 7, 6])).toBe("[8,7,6]");
  });
});
