import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAramggRaws } from "./aramggSource";
import { fetchChampionAugmentsText, fetchLocalArtifact } from "./championDataset";

/**
 * Network evidence for live acceptance.
 *
 * The 2026-08-30 acceptance log could not answer "did gameplay hit ARAMGG?"
 * because nothing observed the fetch seams — 37 MB with zero request records.
 * These lock a DEV-only `[aramgg-fetch]` trace at each seam so the next run can
 * prove, from the log alone:
 *
 *   gameplay champion-stat ARAMGG external requests = 0
 *   gameplay local-artifact loads                   > 0
 *   mount-time identity requests                     reported separately
 *
 * Bounded enums and static paths only — never response bodies, headers or
 * cookies.
 */

type InfoSpy = { mock: { calls: unknown[][] } };

function traceRecords(spy: InfoSpy): Record<string, unknown>[] {
  return spy.mock.calls
    .filter((call: unknown[]) => call[0] === "[aramgg-fetch]")
    .map((call: unknown[]) => JSON.parse(String(call[1])) as Record<string, unknown>);
}

function spyOnDiagnostics(): InfoSpy {
  return vi.spyOn(console, "info").mockImplementation(() => {}) as unknown as InfoSpy;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("[aramgg-fetch] network evidence", () => {
  it("marks the gameplay champion-stat load as a same-origin local artifact", async () => {
    const spy = spyOnDiagnostics();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ payload: {} }), { status: 200 }),
    ) as unknown as typeof fetch;

    await fetchLocalArtifact(fetchImpl);

    const records = traceRecords(spy);
    expect(records.map((record) => record.outcome)).toEqual(["start", "success"]);
    for (const record of records) {
      expect(record.source).toBe("local-artifact");
      expect(record.phase).toBe("champion-dataset");
      expect(record.endpointKind).toBe("local-artifact-file");
      expect(record.path).toBe("/local-aramgg-artifact.json");
    }
  });

  it("reports a failed local-artifact load without a response body", async () => {
    const spy = spyOnDiagnostics();
    const fetchImpl = vi.fn(async () =>
      new Response("upstream detail that must never be logged", { status: 503 }),
    ) as unknown as typeof fetch;

    await expect(fetchLocalArtifact(fetchImpl)).rejects.toThrow();

    const records = traceRecords(spy);
    expect(records.map((record) => record.outcome)).toEqual(["start", "failure"]);
    expect(records[1].status).toBe(503);
    expect(JSON.stringify(records)).not.toContain("must never be logged");
  });

  it("marks the external champion-stat path as an /aramgg-dev request", async () => {
    const spy = spyOnDiagnostics();
    const fetchImpl = vi.fn(async () =>
      new Response("[]", { status: 200 }),
    ) as unknown as typeof fetch;

    await fetchChampionAugmentsText(fetchImpl, "126");

    const records = traceRecords(spy);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.source).toBe("aramgg-dev");
      expect(record.phase).toBe("champion-dataset");
      expect(record.endpointKind).toBe("champion-augments-file");
      expect(record.championId).toBe("126");
    }
  });

  it("marks the identity/changelog load as mount-time, separately from gameplay", async () => {
    const spy = spyOnDiagnostics();
    const fetchImpl = vi.fn(async () =>
      new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;

    await fetchAramggRaws(fetchImpl);

    const records = traceRecords(spy);
    expect(records.every((record) => record.source === "aramgg-dev")).toBe(true);
    expect(records.every((record) => record.phase === "mount")).toBe(true);
    // Mount-time identity work must never be countable as a gameplay stat load.
    expect(records.some((record) => record.phase === "champion-dataset")).toBe(false);
    expect(new Set(records.map((record) => record.endpointKind))).toEqual(
      new Set(["aramgg-stats", "aramgg-catalog", "aramgg-catalog-zh-tw", "aramgg-changelog"]),
    );
    expect(records.filter((record) => record.outcome === "success")).toHaveLength(4);
  });

  it("never logs a response body, cookie or auth header", async () => {
    const spy = spyOnDiagnostics();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ secret: "token-abc", payload: {} }), {
        status: 200,
        headers: { "set-cookie": "session=abc", authorization: "Bearer xyz" },
      }),
    ) as unknown as typeof fetch;

    await fetchLocalArtifact(fetchImpl);

    const serialized = JSON.stringify(traceRecords(spy));
    expect(serialized).not.toContain("token-abc");
    expect(serialized).not.toContain("session=abc");
    expect(serialized).not.toContain("Bearer");
  });
});
