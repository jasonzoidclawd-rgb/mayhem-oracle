import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("structured entity stat authority", () => {
  test("damage simulation does not parse balancing numbers from item prose", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "app", "[locale]", "damage-sim", "page.tsx"),
      "utf8",
    );
    expect(source).not.toContain("descriptionStatLines");
    expect(source).not.toContain("parseItemStats");
    expect(source).toContain("itemStructuredStats");
    expect(source).toContain("readEntityPresentationFile");
  });
});
