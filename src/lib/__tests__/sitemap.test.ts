import { describe, expect, test } from "vitest";
import sitemap from "@/app/sitemap";

describe("sitemap freshness", () => {
  test("uses stable public patch-note timestamps for localized patch-note routes", async () => {
    const entries = await sitemap();
    const patchEntries = entries.filter((entry) =>
      entry.url.endsWith("/patch-notes"),
    );

    expect(patchEntries).toHaveLength(5);
    expect(
      new Set(
        patchEntries.map((entry) =>
          entry.lastModified instanceof Date
            ? entry.lastModified.toISOString()
            : String(entry.lastModified),
        ),
      ),
    ).toEqual(new Set(["2026-06-23T18:00:00.000Z"]));
  });
});
