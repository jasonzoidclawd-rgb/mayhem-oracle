import { describe, expect, it } from "vitest";
import { buildChampionMemberView } from "@/lib/champions/member-view";

describe("canonical champion member view", () => {
  it("derives a narrow versioned member payload from internal patch data", async () => {
    const payload = await buildChampionMemberView("ahri", "en");

    expect(payload.championSlug).toBe("ahri");
    expect(payload.version.patch).toBe("26.13");
    expect(payload.version.dataVersion).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.pool.total).toBeGreaterThan(0);
    expect(payload.pool.totalAugments).toBeGreaterThan(payload.pool.total);
    expect(payload.rankings.length).toBeGreaterThan(0);
    expect(payload.rankings[0].augment).toEqual(expect.objectContaining({
      slug: expect.any(String),
      name: expect.any(String),
      icon: expect.any(String),
    }));
    expect(Object.keys(payload.matrixAugmentNames).length).toBe(
      payload.pool.totalAugments,
    );
  });
});
