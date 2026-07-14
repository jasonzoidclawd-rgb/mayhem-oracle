import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  requestChampionMemberView,
  type ChampionMemberViewState,
} from "@/lib/champions/member-view-client";

const payload = {
  championSlug: "ahri",
  version: { patch: "26.13", dataVersion: "snapshot-1" },
  profile: { resource: "mana", attackType: "ranged", damageType: "magic", kitTags: [] },
  pool: { total: 0, totalAugments: 0, layers: [], raritySummary: [], highlights: [] },
  matrixAugmentNames: {},
  rankings: [],
  interactions: { synergies: [], traps: [] },
};

async function stateFor(status: number, body: unknown = { error: "failed" }) {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  return requestChampionMemberView("ahri", "en", "26.13", fetcher);
}

describe("ChampionMemberIsland request states", () => {
  it.each([
    [401, "anonymous"],
    [403, "non-member"],
    [404, "not-found"],
  ] as const)("handles HTTP %s as %s", async (status, kind) => {
    await expect(stateFor(status)).resolves.toMatchObject({ kind });
  });

  it("fails safely when the endpoint is unavailable", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      requestChampionMemberView("ahri", "en", "26.13", fetcher),
    ).resolves.toEqual({ kind: "error" });
  });

  it("does not accept a member payload from a different patch", async () => {
    const result = await stateFor(200, {
      ...payload,
      version: { patch: "26.14", dataVersion: "snapshot-2" },
    });

    expect(result).toEqual({
      kind: "patch-mismatch",
      publicPatch: "26.13",
      memberPatch: "26.14",
    } satisfies ChampionMemberViewState);
  });

  it("accepts a versioned payload for the current static patch", async () => {
    await expect(stateFor(200, payload)).resolves.toMatchObject({
      kind: "member",
      payload: {
        championSlug: "ahri",
        version: { patch: "26.13", dataVersion: "snapshot-1" },
      },
    });
  });

  it("renders explicit safe states instead of silently using mismatched data", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/champions/ChampionMemberIsland.tsx"),
      "utf8",
    );
    expect(source).toContain('state.kind === "patch-mismatch"');
    expect(source).toContain('t("memberPatchMismatch"');
    expect(source).toContain('state.kind === "error"');
    expect(source).toContain('t("memberUnavailable")');
    expect(source).toContain("<LockedContent");
  });
});
