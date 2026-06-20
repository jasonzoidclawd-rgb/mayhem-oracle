import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseBatch } from "../telemetry/validate";
import {
  handleDeviceCode,
  handleDeviceLink,
  handleTelemetryUpload,
  type TelemetryDeps,
} from "../api/telemetry";

function validMatch(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    gameHash: "abc12345def",
    patch: "26.12",
    queueId: 2400,
    durationSeconds: 1180,
    collectedAt: "2026-06-13T12:00:00Z",
    source: "owned-history",
    participants: Array.from({ length: 10 }, (_, i) => ({
      slot: `s${i}`,
      team: i < 5 ? 100 : 200,
      championSlug: "brand",
      augmentSlugs: ["chain-reaction"],
      itemIds: ["3020"],
      won: i < 5,
      stats: { kills: 1, deaths: 2, assists: 3, damageToChampions: 1000 },
    })),
    ...overrides,
  };
}

describe("parseBatch (server-side allowlist re-validation)", () => {
  test("accepts a clean batch and returns typed matches", () => {
    const result = parseBatch([validMatch()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].queueId).toBe(2400);
      expect(result.matches[0].participants).toHaveLength(10);
    }
  });

  test("rejects a PUUID anywhere in the graph", () => {
    const dirty = validMatch();
    (dirty.participants[0] as Record<string, unknown>).puuid = "leaked-puuid";
    expect(parseBatch([dirty])).toEqual({ ok: false, error: "identity field present" });
  });

  test("rejects Riot ID / summoner name / chat keys", () => {
    for (const key of ["riotId", "summonerName", "chat", "displayName", "accountId"]) {
      const dirty = validMatch({ [key]: "x" });
      expect(parseBatch([dirty]).ok, key).toBe(false);
    }
  });

  test("rejects non-2400 queues", () => {
    expect(parseBatch([validMatch({ queueId: 450 })])).toMatchObject({ ok: false });
  });

  test("rejects the wrong schema version", () => {
    expect(parseBatch([validMatch({ schemaVersion: 2 })])).toMatchObject({ ok: false });
  });

  test("rejects malformed participants", () => {
    const bad = validMatch();
    (bad.participants[0] as Record<string, unknown>).team = 999;
    expect(parseBatch([bad])).toMatchObject({ ok: false });
  });

  test("strips unknown non-identity fields by rebuilding from the allowlist", () => {
    const result = parseBatch([validMatch({ extra: "ignored", debugNote: 42 })]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("extra" in result.matches[0]).toBe(false);
      expect("debugNote" in result.matches[0]).toBe(false);
    }
  });

  test("accepts contributor rounds and drops ambiguous selections", () => {
    const withRounds = validMatch({
      contributorRounds: [
        { round: 1, offeredAugmentSlugs: ["a", "b", "c"], selectedAugmentSlug: "b", ocrConfidence: 0.9 },
        { round: 2, offeredAugmentSlugs: ["d", "e", "f"], ocrConfidence: 0.4 },
      ],
    });
    const result = parseBatch([withRounds]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rounds = result.matches[0].contributorRounds!;
      expect(rounds[0].selectedAugmentSlug).toBe("b");
      expect(rounds[1].selectedAugmentSlug).toBeUndefined();
    }
  });

  test("rejects empty and oversized batches", () => {
    expect(parseBatch([])).toMatchObject({ ok: false, error: "empty batch" });
    expect(parseBatch(Array.from({ length: 101 }, () => validMatch()))).toMatchObject({
      ok: false,
      error: "batch exceeds 100 matches",
    });
  });
});

describe("telemetry upload handler", () => {
  function deps(overrides: Partial<TelemetryDeps> = {}): TelemetryDeps {
    const stored: string[] = [];
    return {
      resolveDeviceToken: async (token) => (token === "good-token" ? { deviceId: "d1", userId: "u1" } : null),
      knownGameHashes: async () => new Set<string>(),
      putBatch: async (key) => {
        stored.push(key);
      },
      recordBatch: async () => {},
      createDeviceCode: async () => ({ code: "WXYZ-1234", expiresInSeconds: 600 }),
      linkDevice: async () => ({ deviceToken: "issued-token" }),
      getUserId: async () => "u1",
      ...overrides,
    };
  }

  test("rejects uploads without a valid device token (401)", async () => {
    const request = new Request("http://test.local", {
      method: "POST",
      headers: { authorization: "Bearer bad" },
      body: JSON.stringify([validMatch()]),
    });
    const response = await handleTelemetryUpload(request, deps());
    expect(response.status).toBe(401);
  });

  test("accepts a clean batch from a linked device and stores it", async () => {
    const request = new Request("http://test.local", {
      method: "POST",
      headers: { authorization: "Bearer good-token", "x-mayhem-schema-version": "1" },
      body: JSON.stringify([validMatch()]),
    });
    const response = await handleTelemetryUpload(request, deps());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(1);
  });

  test("rejects an identity-leaking batch with 422", async () => {
    const dirty = validMatch();
    (dirty as Record<string, unknown>).summonerName = "someone";
    const request = new Request("http://test.local", {
      method: "POST",
      headers: { authorization: "Bearer good-token", "x-mayhem-schema-version": "1" },
      body: JSON.stringify([dirty]),
    });
    const response = await handleTelemetryUpload(request, deps());
    expect(response.status).toBe(422);
  });

  test("deduplicates already-seen game hashes idempotently", async () => {
    const request = new Request("http://test.local", {
      method: "POST",
      headers: { authorization: "Bearer good-token", "x-mayhem-schema-version": "1" },
      body: JSON.stringify([validMatch({ gameHash: "seen123456" })]),
    });
    const response = await handleTelemetryUpload(
      request,
      deps({ knownGameHashes: async () => new Set(["seen123456"]) }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(0);
    expect(body.duplicates).toBe(1);
  });

  test("rejects an oversized body (413)", async () => {
    const huge = "x".repeat(5_000_001);
    const request = new Request("http://test.local", {
      method: "POST",
      headers: { authorization: "Bearer good-token", "content-length": String(huge.length) },
      body: huge,
    });
    const response = await handleTelemetryUpload(request, deps());
    expect(response.status).toBe(413);
  });

  test("streams uploads through the byte cap instead of using unbounded request.text()", async () => {
    const payload = JSON.stringify([validMatch()]);
    const request = {
      headers: new Headers({ authorization: "Bearer good-token" }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      }),
      text: async () => {
        throw new Error("unbounded text read");
      },
    } as unknown as Request;

    const response = await handleTelemetryUpload(request, deps());
    expect(response.status).toBe(200);
  });
});

describe("device code + link handlers", () => {
  function deps(overrides: Partial<TelemetryDeps> = {}): TelemetryDeps {
    return {
      resolveDeviceToken: async () => null,
      knownGameHashes: async () => new Set(),
      putBatch: async () => {},
      recordBatch: async () => {},
      createDeviceCode: async () => ({ code: "WXYZ-1234", expiresInSeconds: 600 }),
      linkDevice: async (code) => (code === "WXYZ-1234" ? { deviceToken: "issued-token" } : null),
      getUserId: async () => "u1",
      ...overrides,
    };
  }

  test("device/code issues a short-lived code without auth", async () => {
    const request = new Request("http://test.local", {
      method: "POST",
      body: JSON.stringify({ platform: "macos" }),
    });
    const response = await handleDeviceCode(request, deps());
    expect(response.status).toBe(200);
    expect((await response.json()).code).toBe("WXYZ-1234");
  });

  test("device/link requires a signed-in user", async () => {
    const request = new Request("http://test.local", {
      method: "POST",
      body: JSON.stringify({ code: "WXYZ-1234" }),
    });
    const response = await handleDeviceLink(request, deps({ getUserId: async () => null }));
    expect(response.status).toBe(401);
  });

  test("device/link approves a valid code and returns a device token", async () => {
    const request = new Request("http://test.local", {
      method: "POST",
      body: JSON.stringify({ code: "WXYZ-1234" }),
    });
    const response = await handleDeviceLink(request, deps());
    expect(response.status).toBe(200);
    expect((await response.json()).deviceToken).toBe("issued-token");
  });

  test("device/link rejects an unknown code", async () => {
    const request = new Request("http://test.local", {
      method: "POST",
      body: JSON.stringify({ code: "NOPE-0000" }),
    });
    const response = await handleDeviceLink(request, deps());
    expect(response.status).toBe(400);
  });
});

describe("telemetry dependency wiring", () => {
  test("device code claims are conditional and clean up lost races", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/api/telemetry-deps.ts"),
      "utf-8",
    );

    expect(source).toMatch(
      /\.update\(\{ status: "claimed"[\s\S]*?\.eq\("id", codeRow\.id\)[\s\S]*?\.eq\("status", "pending"\)/,
    );
    expect(source).toMatch(
      /\.from\("devices"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("id", device\.id\)/,
    );
  });
});
