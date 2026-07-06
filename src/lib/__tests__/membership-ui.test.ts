import { describe, expect, test, vi } from "vitest";
import type { DecisionContext, DecisionResult } from "../contracts/decision";
import {
  requestChampionMatrix,
  requestDecision,
} from "../membership/decision-client";
import {
  GRADES_IN_ORDER,
  GRADE_TOKENS,
  gradeToken,
} from "../membership/grade-tokens";
import { redeemFailureMessage } from "@/components/membership/AccountClient";

const CONTEXT: DecisionContext = {
  championSlug: "brand",
  round: 2,
  screenRarity: "gold",
  mode: "competitive",
  ownedAugmentSlugs: [],
  currentItemIds: [],
  plannedItemIds: [],
  rerollsRemaining: 1,
  goldenRerollAvailable: false,
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("grade tokens", () => {
  test("cover all five grades in descending strength", () => {
    expect(GRADES_IN_ORDER).toEqual(["hot", "strong", "steady", "average", "weak"]);
  });

  test("only weak is a hard-avoid warning color", () => {
    const warnings = GRADES_IN_ORDER.filter((grade) => GRADE_TOKENS[grade].isWarning);
    expect(warnings).toEqual(["weak"]);
  });

  test("intensity decreases monotonically from hot to weak", () => {
    const intensities = GRADES_IN_ORDER.map((grade) => gradeToken(grade).intensity);
    const sorted = [...intensities].sort((a, b) => b - a);
    expect(intensities).toEqual(sorted);
    expect(new Set(intensities).size).toBe(5);
  });

  test("every token carries a chip class and a hex accent", () => {
    for (const grade of GRADES_IN_ORDER) {
      const token = gradeToken(grade);
      expect(token.className.length).toBeGreaterThan(0);
      expect(token.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("redeemFailureMessage", () => {
  const copy = {
    redeemTitle: "Redeem",
    redeemPlaceholder: "MAYHEM-XXXX-XXXX",
    redeemButton: "Redeem",
    redeemSuccess: "Code redeemed.",
    redeemError: "Could not redeem that code.",
    redeemInvalidExpired: "Invalid or expired code.",
  };

  test("maps invalid expired exhausted and duplicate codes to localized copy", () => {
    for (const error of [
      "invalid invite code",
      "invite code expired",
      "invite code exhausted",
      "invite code revoked",
      "invite already redeemed",
    ]) {
      expect(redeemFailureMessage(error, copy), error).toBe(copy.redeemInvalidExpired);
    }
  });

  test("falls back to generic localized copy for unknown failures", () => {
    expect(redeemFailureMessage("redemption failed", copy)).toBe(copy.redeemError);
    expect(redeemFailureMessage(undefined, copy)).toBe(copy.redeemError);
  });
});

describe("requestDecision", () => {
  const result: DecisionResult = {
    modelVersion: "decision-v1",
    context: CONTEXT,
    poolSize: 12,
    candidates: [],
    reroll: { stance: "keep", reasons: [] },
  };

  test("posts the context to the protected endpoint and returns the result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(result));
    const response = await requestDecision(CONTEXT, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/decision/evaluate",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const sentBody = JSON.parse(init[1].body as string);
    expect(sentBody.championSlug).toBe("brand");
    expect(response).toEqual({ ok: true, result });
  });

  test("surfaces 401 as a typed error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "unauthenticated" }, { status: 401 }));
    const response = await requestDecision(CONTEXT, { fetchImpl });
    expect(response).toEqual({ ok: false, status: 401, error: "unauthenticated" });
  });

  test("403 entitlement denial is reported with its reason", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "none" }, { status: 403 }));
    const response = await requestDecision(CONTEXT, { fetchImpl });
    expect(response).toMatchObject({ ok: false, status: 403, error: "none" });
  });

  test("429 carries retryAfterSeconds from the header", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "rate-limited" }, { status: 429, headers: { "Retry-After": "42" } }),
    );
    const response = await requestDecision(CONTEXT, { fetchImpl });
    expect(response).toEqual({
      ok: false,
      status: 429,
      error: "rate-limited",
      retryAfterSeconds: 42,
    });
  });

  test("network failures fail soft with status 0", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const response = await requestDecision(CONTEXT, { fetchImpl });
    expect(response).toEqual({ ok: false, status: 0, error: "network-error" });
  });
});

describe("requestChampionMatrix", () => {
  test("returns the matrix on success", async () => {
    const matrix = {
      championSlug: "brand",
      mode: "competitive",
      modelVersion: "decision-v1",
      rounds: [],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(matrix));
    const response = await requestChampionMatrix("brand", "competitive", { fetchImpl });
    expect(response).toEqual({ ok: true, matrix });
  });

  test("propagates entitlement denial", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "expired" }, { status: 403 }));
    const response = await requestChampionMatrix("brand", "competitive", { fetchImpl });
    expect(response).toEqual({ ok: false, status: 403, error: "expired" });
  });
});
