import { afterEach, describe, expect, it, vi } from "vitest";

import {
  championDatasetSourceKind,
  resolveActiveChampionDataset,
  traceChampionDatasetState,
} from "./championDatasetTrace";
import type { ChampionAugmentDataset } from "./championStats";

/**
 * Evidence for the champion-dataset load/publish seam.
 *
 * The 2026-08-30 acceptance run rendered zero percentages: every slot stayed
 * `champion-loading` for a whole game while the local artifact demonstrably
 * held all 19 published augment ids at the matching patch. Nothing observed
 * the seam, so "loader resolved but was discarded" and "loader never resolved"
 * were indistinguishable from the log.
 *
 * These lock the two answers the next run must produce:
 *   loader resolved?  YES / NO
 *   if YES, why wasn't the dataset published?  one bounded reason
 */

type InfoSpy = { mock: { calls: unknown[][] } };

function traceRecords(spy: InfoSpy): Record<string, unknown>[] {
  return spy.mock.calls
    .filter((call: unknown[]) => call[0] === "[champion-dataset-state]")
    .map((call: unknown[]) => JSON.parse(String(call[1])) as Record<string, unknown>);
}

function spyOnDiagnostics(): InfoSpy {
  return vi.spyOn(console, "info").mockImplementation(() => {}) as unknown as InfoSpy;
}

function dataset(overrides: Partial<ChampionAugmentDataset> = {}): ChampionAugmentDataset {
  return {
    championId: "104",
    patch: "16.17",
    source: "/local-aramgg-artifact.json#104",
    completeness: "complete",
    loadedCount: 111,
    statsByAugmentId: new Map(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("[champion-dataset-state] trace", () => {
  it("records a bounded publish with ready, loadedCount and the real source", () => {
    const spy = spyOnDiagnostics();
    const ds = dataset();

    traceChampionDatasetState({
      event: "published",
      championId: ds.championId,
      requestId: 6,
      currentRequestId: 6,
      requestedPatch: "16.17",
      datasetPatch: ds.patch,
      patchesMatch: true,
      completeness: ds.completeness,
      loadedCount: ds.loadedCount,
      sourceKind: championDatasetSourceKind(ds.source),
      status: "ready",
    });

    const [record] = traceRecords(spy);
    expect(record.event).toBe("published");
    expect(record.status).toBe("ready");
    expect(record.loadedCount).toBe(111);
    expect(record.completeness).toBe("complete");
    expect(record.sourceKind).toBe("local-artifact");
    expect(record.patchesMatch).toBe(true);
  });

  it("never carries dataset rows or objects into the log", () => {
    const spy = spyOnDiagnostics();
    const ds = dataset({
      statsByAugmentId: new Map([["2100", { winRate: 0.4449 } as never]]),
    });

    traceChampionDatasetState({
      event: "loader-resolved",
      championId: ds.championId,
      loadedCount: ds.loadedCount,
      sourceKind: championDatasetSourceKind(ds.source),
    });

    const serialized = JSON.stringify(traceRecords(spy));
    expect(serialized).not.toContain("statsByAugmentId");
    expect(serialized).not.toContain("0.4449");
    // Every value is a bounded scalar or null.
    for (const value of Object.values(traceRecords(spy)[0])) {
      expect(["string", "number", "boolean", "object"]).toContain(typeof value);
      if (typeof value === "object") expect(value).toBeNull();
    }
  });

  it("makes a stale request-id discard observable with its reason", () => {
    const spy = spyOnDiagnostics();

    traceChampionDatasetState({
      event: "discarded-stale",
      championId: "104",
      requestId: 6,
      currentRequestId: 9,
      loadedCount: 111,
      reason: "superseded-request",
    });

    const [record] = traceRecords(spy);
    expect(record.event).toBe("discarded-stale");
    expect(record.requestId).toBe(6);
    expect(record.currentRequestId).toBe(9);
    expect(record.reason).toBe("superseded-request");
  });

  it("distinguishes a resolved loader from one that never resolved", () => {
    const spy = spyOnDiagnostics();

    traceChampionDatasetState({ event: "request-start", championId: "104", requestId: 6 });
    traceChampionDatasetState({ event: "loader-resolved", championId: "104", requestId: 6 });

    const events = traceRecords(spy).map((record) => record.event);
    // The next log answers "loader resolved?" by the presence of this pair.
    expect(events).toEqual(["request-start", "loader-resolved"]);
  });

  it("records status transitions so idle → loading → ready is readable", () => {
    const spy = spyOnDiagnostics();

    for (const status of ["loading", "ready"] as const) {
      traceChampionDatasetState({ event: "status-changed", championId: "104", status });
    }

    expect(traceRecords(spy).map((record) => record.status)).toEqual(["loading", "ready"]);
  });
});

describe("championDatasetSourceKind", () => {
  it("reports the local artifact for Path B, not the external endpoint", () => {
    expect(championDatasetSourceKind("/local-aramgg-artifact.json#104")).toBe("local-artifact");
  });

  it("reports the external path only when it was actually the source", () => {
    expect(
      championDatasetSourceKind("https://aramgg.com/data/champion-augments/104.json"),
    ).toBe("aramgg-dev");
  });

  it("reports null when no dataset is active", () => {
    // The old diagnostic hardcoded `champion-augments-file` here, naming an
    // endpoint the session never requested.
    expect(championDatasetSourceKind(null)).toBeNull();
    expect(championDatasetSourceKind(undefined)).toBeNull();
  });
});

describe("resolveActiveChampionDataset", () => {
  it("publishes a ready, current, patch-matched dataset", () => {
    const ds = dataset();
    const gate = resolveActiveChampionDataset({
      status: "ready",
      dataset: ds,
      championKey: "104",
      sourcePatch: "16.17",
    });

    expect(gate.dataset).toBe(ds);
    expect(gate.reason).toBeNull();
  });

  it("names the reason when the status is not ready", () => {
    const gate = resolveActiveChampionDataset({
      status: "loading",
      dataset: dataset(),
      championKey: "104",
      sourcePatch: "16.17",
    });

    expect(gate.dataset).toBeNull();
    expect(gate.reason).toBe("status-not-ready");
  });

  it("names a champion change as the discard reason", () => {
    const gate = resolveActiveChampionDataset({
      status: "ready",
      dataset: dataset({ championId: "13" }),
      championKey: "104",
      sourcePatch: "16.17",
    });

    expect(gate.dataset).toBeNull();
    expect(gate.reason).toBe("champion-changed");
  });

  it("names a patch mismatch as the rejection reason", () => {
    const gate = resolveActiveChampionDataset({
      status: "ready",
      dataset: dataset({ patch: "16.16" }),
      championKey: "104",
      sourcePatch: "16.17",
    });

    expect(gate.dataset).toBeNull();
    expect(gate.reason).toBe("patch-mismatch");
  });

  it("fails closed on a null patch rather than publishing", () => {
    const gate = resolveActiveChampionDataset({
      status: "ready",
      dataset: dataset({ patch: null }),
      championKey: "104",
      sourcePatch: null,
    });

    expect(gate.dataset).toBeNull();
    expect(gate.reason).toBe("patch-mismatch");
  });

  it("names the absent dataset and the absent champion separately", () => {
    expect(
      resolveActiveChampionDataset({
        status: "ready",
        dataset: null,
        championKey: "104",
        sourcePatch: "16.17",
      }).reason,
    ).toBe("no-dataset");

    expect(
      resolveActiveChampionDataset({
        status: "ready",
        dataset: dataset(),
        championKey: null,
        sourcePatch: "16.17",
      }).reason,
    ).toBe("no-champion");
  });
});
