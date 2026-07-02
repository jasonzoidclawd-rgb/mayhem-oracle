import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  serviceFrom: vi.fn(),
}));

vi.mock("../entitlements/server", () => ({
  createServiceClient: () => ({
    rpc: mocks.rpc,
    from: mocks.serviceFrom,
  }),
  requireActiveEntitlement: vi.fn(),
}));

vi.mock("../supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { createOverlayDeps } from "../api/deps";

describe("overlay trial credit leases", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.rpc.mockReset();
    mocks.serviceFrom.mockReset();
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

  test("getActiveRelease reads the gated model manifest with the service client", async () => {
    const release = {
      model_version: "decision-v1",
      engine_version: "engine-v1",
      data_version: "26.13",
      config_sha256: "sha256",
      signature: "ed25519:sig",
      package_url: "https://r2.example/model.json",
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: release });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    mocks.serviceFrom.mockReturnValue({ select });
    mocks.createClient.mockImplementation(() => {
      throw new Error("route client must not read model_releases");
    });

    await expect(createOverlayDeps().getActiveRelease()).resolves.toEqual(release);
    expect(mocks.serviceFrom).toHaveBeenCalledWith("model_releases");
    expect(select).toHaveBeenCalledWith("model_version,engine_version,data_version,config_sha256,signature,package_url");
    expect(eq).toHaveBeenCalledWith("status", "active");
  });
});
