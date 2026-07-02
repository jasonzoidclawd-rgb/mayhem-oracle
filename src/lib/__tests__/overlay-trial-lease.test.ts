import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../entitlements/server", () => ({
  createServiceClient: () => ({
    rpc: mocks.rpc,
  }),
  requireActiveEntitlement: vi.fn(),
}));

vi.mock("../supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createOverlayDeps } from "../api/deps";

describe("overlay trial credit leases", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  test("reserveTrialCredit delegates to the atomic trial reservation RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        game_hash: "game-hash-1",
        reserved_at: "2026-07-02T00:00:00.000Z",
      },
      error: null,
    });

    await expect(
      createOverlayDeps().reserveTrialCredit("user-1", "game-hash-1"),
    ).resolves.toEqual({
      gameHash: "game-hash-1",
      expiresAt: "2026-07-02T00:40:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("reserve_trial_credit", {
      p_user_id: "user-1",
      p_game_hash: "game-hash-1",
    });
  });

  test("reserveTrialCredit returns null when the RPC reports exhausted trial credits", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(
      createOverlayDeps().reserveTrialCredit("user-1", "game-hash-2"),
    ).resolves.toBeNull();
  });
});
