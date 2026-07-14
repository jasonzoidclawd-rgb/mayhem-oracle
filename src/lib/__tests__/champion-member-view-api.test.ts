import { describe, expect, it, vi } from "vitest";
import { handleChampionMemberView } from "@/lib/api/champion-member-view";
import type { ChampionMemberViewPayload } from "@/lib/champions/member-view-contract";

const payload: ChampionMemberViewPayload = {
  championSlug: "ahri",
  version: { patch: "26.13", dataVersion: "2026-07-12T22:39:39.095225+00:00" },
  profile: { resource: "mana", attackType: "ranged", damageType: "magic", kitTags: [] },
  pool: { total: 1, totalAugments: 1, layers: [], raritySummary: [], highlights: [] },
  matrixAugmentNames: {},
  rankings: [],
  interactions: { synergies: [], traps: [] },
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    championExists: vi.fn().mockResolvedValue(true),
    requireEntitlement: vi.fn().mockResolvedValue({
      ok: true,
      user: { id: "user-1" },
      entitlement: { kind: "member" },
    }),
    loadMemberView: vi.fn().mockResolvedValue(payload),
    ...overrides,
  };
}

describe("champion member-view endpoint", () => {
  it("returns 404 before touching entitlement for an invalid champion", async () => {
    const testDeps = deps({ championExists: vi.fn().mockResolvedValue(false) });
    const response = await handleChampionMemberView(
      new Request("https://wasfun.lol/api/champions/not-real/member-view?locale=en"),
      "not-real",
      testDeps,
    );

    expect(response.status).toBe(404);
    expect(testDeps.requireEntitlement).not.toHaveBeenCalled();
    expect(testDeps.loadMemberView).not.toHaveBeenCalled();
  });

  it("returns 401 without a valid session", async () => {
    const testDeps = deps({
      requireEntitlement: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        reason: "unauthenticated",
      }),
    });
    const response = await handleChampionMemberView(
      new Request("https://wasfun.lol/api/champions/ahri/member-view?locale=en"),
      "ahri",
      testDeps,
    );

    expect(response.status).toBe(401);
    expect(testDeps.loadMemberView).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in user without an active entitlement", async () => {
    const testDeps = deps({
      requireEntitlement: vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        reason: "inactive",
      }),
    });
    const response = await handleChampionMemberView(
      new Request("https://wasfun.lol/api/champions/ahri/member-view?locale=en"),
      "ahri",
      testDeps,
    );

    expect(response.status).toBe(403);
    expect(testDeps.loadMemberView).not.toHaveBeenCalled();
  });

  it("fails closed when entitlement lookup throws", async () => {
    const testDeps = deps({
      requireEntitlement: vi.fn().mockRejectedValue(new Error("unavailable")),
    });
    const response = await handleChampionMemberView(
      new Request("https://wasfun.lol/api/champions/ahri/member-view?locale=en"),
      "ahri",
      testDeps,
    );

    expect(response.status).toBe(403);
    expect(testDeps.loadMemberView).not.toHaveBeenCalled();
  });

  it("returns the entitled payload with patch and data versions", async () => {
    const testDeps = deps();
    const response = await handleChampionMemberView(
      new Request("https://wasfun.lol/api/champions/ahri/member-view?locale=zh-TW"),
      "ahri",
      testDeps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      championSlug: "ahri",
      version: {
        patch: "26.13",
        dataVersion: "2026-07-12T22:39:39.095225+00:00",
      },
    });
    expect(testDeps.loadMemberView).toHaveBeenCalledWith("ahri", "zh-TW");
  });
});
