import { beforeEach, describe, expect, test } from "vitest";
import { handleChampionMatrix, handleEvaluate, type DecisionApiDeps } from "../api/decision";
import { handleRedeemInvite, type InviteApiDeps } from "../api/invites";
import {
  handleGameSession,
  handleOverlayBootstrap,
  type ModelReleaseRow,
  type OverlayApiDeps,
} from "../api/overlay";
import { resetRateLimits } from "../api/rate-limit";
import { loadInternalDecisionData } from "../data/internal-loader";
import { generateInviteCode, requireAdmin } from "../entitlements/admin";
import { hashInviteCode } from "../entitlements/core";
import type { RequireEntitlementResult } from "../entitlements/server";

const VALID_CONTEXT = {
  championSlug: "brand",
  round: 2,
  screenRarity: "gold",
  mode: "competitive",
  ownedAugmentSlugs: [],
  currentItemIds: [],
  plannedItemIds: [],
  rerollsRemaining: 1,
  goldenRerollAvailable: false,
  offeredAugmentSlugs: ["from-downtown", "transmute-prismatic", "magic-missile"],
};

function post(body: unknown): Request {
  return new Request("http://test.local/api", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function memberGate(userId = "user-1"): Promise<RequireEntitlementResult> {
  return Promise.resolve({
    ok: true,
    user: { id: userId },
    entitlement: { kind: "member" },
  });
}

function deniedGate(status: 401 | 403, reason: string): Promise<RequireEntitlementResult> {
  return Promise.resolve({ ok: false, status, reason });
}

function decisionDeps(overrides: Partial<DecisionApiDeps> = {}): DecisionApiDeps {
  return {
    requireEntitlement: () => memberGate(),
    loadData: (slug) => loadInternalDecisionData(slug),
    ...overrides,
  };
}

beforeEach(() => {
  resetRateLimits();
});

describe("handleEvaluate", () => {
  test("unauthenticated requests get 401 and no engine output", async () => {
    const response = await handleEvaluate(post(VALID_CONTEXT), decisionDeps({
      requireEntitlement: () => deniedGate(401, "unauthenticated"),
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  test("free users get 403 with the entitlement reason", async () => {
    const response = await handleEvaluate(post(VALID_CONTEXT), decisionDeps({
      requireEntitlement: () => deniedGate(403, "none"),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "none" });
  });

  test("invalid contexts are rejected with 400", async () => {
    const bad = { ...VALID_CONTEXT, round: 7 };
    const response = await handleEvaluate(post(bad), decisionDeps());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/round/);
  });

  test("malformed JSON is a 400, not a crash", async () => {
    const request = new Request("http://test.local/api", { method: "POST", body: "{nope" });
    const response = await handleEvaluate(request, decisionDeps());
    expect(response.status).toBe(400);
  });

  test("unknown champions are a 404", async () => {
    const response = await handleEvaluate(
      post({ ...VALID_CONTEXT, championSlug: "not-a-champion" }),
      decisionDeps(),
    );
    expect(response.status).toBe(404);
  });

  test("members receive a full DecisionResult and the session is recorded", async () => {
    const recorded: unknown[] = [];
    const response = await handleEvaluate(post(VALID_CONTEXT), decisionDeps({
      recordSession: async (record) => {
        recorded.push(record);
      },
    }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.modelVersion).toBeTruthy();
    expect(result.poolSize).toBeGreaterThan(0);
    expect(result.candidates).toHaveLength(3);
    for (const candidate of result.candidates) {
      expect(["hot", "strong", "steady", "average", "weak"]).toContain(candidate.grade);
      expect(candidate.probability.initialThree).toBeGreaterThanOrEqual(0);
    }
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ userId: "user-1", championSlug: "brand", round: 2 });
  });

  test("history failures never block the decision", async () => {
    const response = await handleEvaluate(post(VALID_CONTEXT), decisionDeps({
      recordSession: async () => {
        throw new Error("db down");
      },
    }));
    expect(response.status).toBe(200);
  });

  test("rate limiting returns 429 with Retry-After", async () => {
    let now = 1_000_000;
    const deps = decisionDeps({
      requireEntitlement: () => memberGate("rate-user"),
      now: () => now,
    });
    for (let i = 0; i < 30; i += 1) {
      const ok = await handleEvaluate(post(VALID_CONTEXT), deps);
      expect(ok.status).toBe(200);
    }
    const limited = await handleEvaluate(post(VALID_CONTEXT), deps);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);

    now += 61_000;
    const recovered = await handleEvaluate(post(VALID_CONTEXT), deps);
    expect(recovered.status).toBe(200);
  });
});

describe("handleChampionMatrix", () => {
  test("returns four rounds, each with three rarity cells", async () => {
    const response = await handleChampionMatrix(
      post({ championSlug: "brand", mode: "competitive" }),
      decisionDeps({ requireEntitlement: () => memberGate("matrix-user") }),
    );
    expect(response.status).toBe(200);
    const matrix = await response.json();
    expect(matrix.rounds).toHaveLength(4);
    for (const round of matrix.rounds) {
      expect(round.rarities.map((cell: { rarity: string }) => cell.rarity)).toEqual([
        "silver",
        "gold",
        "prismatic",
      ]);
      for (const cell of round.rarities) {
        expect(cell.poolSize).toBeGreaterThan(0);
        expect(cell.candidates.length).toBeGreaterThan(0);
      }
    }
  });

  test("rejects invalid modes", async () => {
    const response = await handleChampionMatrix(
      post({ championSlug: "brand", mode: "yolo" }),
      decisionDeps({ requireEntitlement: () => memberGate("matrix-user-2") }),
    );
    expect(response.status).toBe(400);
  });

  test("entitlement gate applies before any engine work", async () => {
    const response = await handleChampionMatrix(
      post({ championSlug: "brand", mode: "competitive" }),
      decisionDeps({ requireEntitlement: () => deniedGate(403, "expired") }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "expired" });
  });
});

describe("handleRedeemInvite", () => {
  function inviteDeps(overrides: Partial<InviteApiDeps> = {}): InviteApiDeps {
    return {
      getUserId: async () => "user-1",
      redeem: async () => ({ data: { kind: "member", expires_at: null }, error: null }),
      ...overrides,
    };
  }

  test("requires authentication", async () => {
    const response = await handleRedeemInvite(
      post({ code: "MAYHEM-AAAA-BBBB" }),
      inviteDeps({ getUserId: async () => null }),
    );
    expect(response.status).toBe(401);
  });

  test("hashes the code before redeeming — plaintext never reaches the deps", async () => {
    let seenHash = "";
    await handleRedeemInvite(
      post({ code: " MAYHEM-AAAA-BBBB " }),
      inviteDeps({
        redeem: async (codeHash) => {
          seenHash = codeHash;
          return { data: { kind: "member", expires_at: null }, error: null };
        },
      }),
    );
    expect(seenHash).toBe(hashInviteCode("MAYHEM-AAAA-BBBB"));
    expect(seenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("maps known redemption failures to 400 with the reason", async () => {
    const response = await handleRedeemInvite(
      post({ code: "MAYHEM-AAAA-BBBB" }),
      inviteDeps({
        redeem: async () => ({ data: null, error: { message: "P0001: invite code exhausted" } }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invite code exhausted" });
  });

  test("expired invite codes are rejected with a localized-safe reason", async () => {
    const response = await handleRedeemInvite(
      post({ code: "MAYHEM-TEST-69420" }),
      inviteDeps({
        redeem: async () => ({ data: null, error: { message: "P0001: invite code expired" } }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invite code expired" });
  });

  test("double redemption is a 409", async () => {
    const response = await handleRedeemInvite(
      post({ code: "MAYHEM-AAAA-BBBB" }),
      inviteDeps({
        redeem: async () => ({
          data: null,
          error: { message: 'duplicate key value violates unique constraint "invite_redemptions_invite_code_id_user_id_key"' },
        }),
      }),
    );
    expect(response.status).toBe(409);
  });

  test("successful member redemption returns kind and expiry", async () => {
    const response = await handleRedeemInvite(
      post({ code: "MAYHEM-AAAA-BBBB" }),
      inviteDeps({
        redeem: async () => ({ data: { kind: "member", expires_at: "2026-07-13T00:00:00Z" }, error: null }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "member", expiresAt: "2026-07-13T00:00:00Z" });
  });

  test("successful overlay tester redemption returns kind and three-day expiry", async () => {
    const response = await handleRedeemInvite(
      post({ code: "MAYHEM-TEST-69420" }),
      inviteDeps({
        redeem: async () => ({
          data: { kind: "overlay_tester", expires_at: "2026-07-09T12:00:00Z" },
          error: null,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "overlay_tester",
      expiresAt: "2026-07-09T12:00:00Z",
    });
  });
});

describe("requireAdmin and invite generation", () => {
  function authClient(user: { id: string; app_metadata?: Record<string, unknown> } | null) {
    return { auth: { getUser: async () => ({ data: { user } }) } };
  }

  test("unauthenticated admins are 401, non-admins 403", async () => {
    expect(await requireAdmin({ client: authClient(null) })).toMatchObject({ ok: false, status: 401 });
    expect(
      await requireAdmin({ client: authClient({ id: "u1", app_metadata: {} }) }),
    ).toMatchObject({ ok: false, status: 403, reason: "admin-only" });
  });

  test("app_metadata.role admin passes", async () => {
    expect(
      await requireAdmin({ client: authClient({ id: "u1", app_metadata: { role: "admin" } }) }),
    ).toEqual({ ok: true, user: { id: "u1" } });
  });

  test("generated invite codes are well-formed and hash-consistent", () => {
    const { code, codeHash } = generateInviteCode();
    expect(code).toMatch(/^MAYHEM-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
    expect(codeHash).toBe(hashInviteCode(code));
    expect(generateInviteCode().code).not.toBe(code);
  });
});

describe("overlay bootstrap and game sessions", () => {
  const release: ModelReleaseRow = {
    model_version: "decision-v1",
    engine_version: "1.0.0",
    data_version: "26.12",
    config_sha256: "abc123",
    signature: "ed25519:sig",
    package_url: "https://example.com/model.tar.gz",
  };

  function overlayDeps(overrides: Partial<OverlayApiDeps> = {}): OverlayApiDeps {
    return {
      requireEntitlement: () => memberGate(),
      getUserId: async () => "user-1",
      getActiveRelease: async () => release,
      findActiveLease: async () => null,
      reserveTrialCredit: async () => null,
      ...overrides,
    };
  }

  test("bootstrap requires sign-in", async () => {
    const response = await handleOverlayBootstrap(
      new Request("http://test.local"),
      overlayDeps({ requireEntitlement: () => deniedGate(401, "unauthenticated") }),
    );
    expect(response.status).toBe(401);
  });

  test("free users without a lease cannot bootstrap", async () => {
    const response = await handleOverlayBootstrap(
      new Request("http://test.local"),
      overlayDeps({ requireEntitlement: () => deniedGate(403, "none") }),
    );
    expect(response.status).toBe(403);
  });

  test("trial users with an active game lease can bootstrap", async () => {
    const response = await handleOverlayBootstrap(
      new Request("http://test.local"),
      overlayDeps({
        requireEntitlement: () => deniedGate(403, "none"),
        findActiveLease: async () => ({ gameHash: "g1", expiresAt: "2026-06-13T12:40:00Z" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.access.kind).toBe("trial-lease");
    expect(body.manifest.signature).toBe("ed25519:sig");
  });

  test("members without an active model release get 404", async () => {
    const response = await handleOverlayBootstrap(
      new Request("http://test.local"),
      overlayDeps({ getActiveRelease: async () => null }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "no-active-model" });
  });

  test("members receive the signed manifest", async () => {
    const response = await handleOverlayBootstrap(new Request("http://test.local"), overlayDeps());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.manifest.modelVersion).toBe("decision-v1");
    expect(body.packageUrl).toBe(release.package_url);
    expect(body.access).toEqual({ kind: "member" });
  });

  test("members get a game lease without consuming credits", async () => {
    let reserved = 0;
    const response = await handleGameSession(
      post({ gameHash: "abcdef1234" }),
      overlayDeps({
        reserveTrialCredit: async () => {
          reserved += 1;
          return null;
        },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).lease.kind).toBe("member");
    expect(reserved).toBe(0);
  });

  test("trial users reserve a credit for the game", async () => {
    const response = await handleGameSession(
      post({ gameHash: "abcdef1234" }),
      overlayDeps({
        requireEntitlement: () => deniedGate(403, "none"),
        reserveTrialCredit: async (_userId, gameHash) => ({
          gameHash,
          expiresAt: "2026-06-13T12:40:00Z",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lease).toEqual({
      kind: "trial",
      gameHash: "abcdef1234",
      expiresAt: "2026-06-13T12:40:00Z",
    });
  });

  test("trial users without credits are refused", async () => {
    const response = await handleGameSession(
      post({ gameHash: "abcdef1234" }),
      overlayDeps({ requireEntitlement: () => deniedGate(403, "none") }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "no-trial-credits" });
  });

  test("game sessions validate the gameHash", async () => {
    const response = await handleGameSession(post({ gameHash: "x" }), overlayDeps());
    expect(response.status).toBe(400);
  });

  function postWithBearer(body: unknown, token: string): Request {
    return new Request("http://test.local/api", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  test("bootstrap authenticates a desktop request via Authorization: Bearer, no cookies", async () => {
    let seenBearer: string | null | undefined;
    const response = await handleOverlayBootstrap(
      new Request("http://test.local", { headers: { authorization: "Bearer device-token-1" } }),
      overlayDeps({
        requireEntitlement: (bearerToken) => {
          seenBearer = bearerToken;
          return memberGate("device-user-1");
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(seenBearer).toBe("device-token-1");
  });

  test("an invalid or revoked bearer token surfaces device-token-invalid, not a bare 401", async () => {
    const response = await handleOverlayBootstrap(
      new Request("http://test.local", { headers: { authorization: "Bearer revoked" } }),
      overlayDeps({
        requireEntitlement: () => deniedGate(401, "device-token-invalid"),
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "device-token-invalid" });
  });

  test("game session rejects an invalid bearer token before ever parsing the body", async () => {
    const response = await handleGameSession(
      postWithBearer({ gameHash: "abcdef1234" }, "revoked"),
      overlayDeps({ requireEntitlement: () => deniedGate(401, "device-token-invalid") }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "device-token-invalid" });
  });

  test("a bearer-authenticated trial user still reserves a credit via getUserId(bearerToken)", async () => {
    let seenBearer: string | null | undefined;
    const response = await handleGameSession(
      postWithBearer({ gameHash: "abcdef1234" }, "device-token-1"),
      overlayDeps({
        requireEntitlement: () => deniedGate(403, "none"),
        getUserId: async (bearerToken) => {
          seenBearer = bearerToken;
          return "device-user-1";
        },
        reserveTrialCredit: async (userId, gameHash) => ({ gameHash, expiresAt: "2026-06-13T12:40:00Z" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(seenBearer).toBe("device-token-1");
  });
});
