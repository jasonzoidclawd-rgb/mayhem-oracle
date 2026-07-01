import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportCollectorCalibrationRowsLocal } from "./local-collector-calibration-export";
import type { CollectorCalibrationEvent } from "./collector-calibration";

const liveGate = { liveCaptureAllowed: true, phase: "InProgress" };
const nonLiveGate = { liveCaptureAllowed: false, phase: "Lobby" };

const offerEvent: CollectorCalibrationEvent = {
  type: "augment_offer",
  localMatchNonce: "local-match-abc",
  localSessionNonce: "session-xyz",
  patch: "26.13",
  gameVersion: "16.13.1",
  queueId: 2400,
  gameMode: "CHERRY",
  mapId: 30,
  championSlug: "brand",
  championId: 63,
  round: 1,
  augmentLevel: 3,
  cards: [
    { slug: "left-card", id: 101, regionIndex: 0, confidence: 0.94 },
    { slug: "middle-card", id: 102, regionIndex: 1, confidence: 0.9 },
    { slug: "right-card", id: 103, regionIndex: 2, confidence: 0.92 },
  ],
  selectedAugmentSlug: "middle-card",
  selectedAugmentId: 102,
  clientTimestamp: "2026-07-02T01:23:45.000Z",
};

const roundEvent: CollectorCalibrationEvent = {
  type: "round_event",
  localMatchNonce: "local-match-abc",
  patch: "26.13",
  championSlug: "brand",
  championId: 63,
  round: 1,
  augmentLevel: 3,
  selectedAugmentSlugs: ["middle-card"],
  selectedAugmentIds: [102],
  itemIds: ["6653"],
  summonerSpellIds: [4, 32],
  clientTimestamp: "2026-07-02T01:24:45.000Z",
};

const contextEvent: CollectorCalibrationEvent = {
  type: "local_match_context",
  localMatchNonce: "local-match-abc",
  patch: "26.13",
  gameVersion: "16.13.1",
  queueId: 2400,
  gameMode: "CHERRY",
  mapId: 30,
  region: "americas",
  platform: "NA1",
  clientTimestamp: "2026-07-02T01:25:45.000Z",
};

async function tempExportDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mayhem-local-calibration-"));
}

describe("local collector calibration export surface", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("requires explicit local export opt-in", async () => {
    const outDir = await tempExportDir();
    tempDirs.push(outDir);

    await expect(
      exportCollectorCalibrationRowsLocal({
        events: [offerEvent],
        gate: liveGate,
        outDir,
      }),
    ).rejects.toThrow(/explicitly enabled/i);
  });

  it("writes five sanitized NDJSON files when local export is enabled", async () => {
    const outDir = await tempExportDir();
    tempDirs.push(outDir);

    const summary = await exportCollectorCalibrationRowsLocal({
      enabled: true,
      events: [offerEvent, roundEvent, contextEvent],
      gate: liveGate,
      outDir,
    });

    expect(summary).toEqual({
      mode: "local-only",
      outDir,
      files: [
        "collector_raw.augment_offers.ndjson",
        "collector_raw.local_match_context.ndjson",
        "collector_raw.round_events.ndjson",
        "riot_derived.participant_augments.ndjson",
        "riot_raw.match_summaries.ndjson",
      ],
      rows: {
        collectorOffers: 1,
        collectorRoundEvents: 1,
        collectorLocalMatchContexts: 1,
        riotMatchSummaries: 0,
        riotParticipantAugments: 0,
      },
    });

    expect(await readFile(join(outDir, "collector_raw.augment_offers.ndjson"), "utf-8")).toContain(
      "\"offered_augment_slugs\":[\"left-card\",\"middle-card\",\"right-card\"]",
    );
    expect(await readFile(join(outDir, "collector_raw.round_events.ndjson"), "utf-8")).toContain(
      "\"selected_augment_slugs\":[\"middle-card\"]",
    );
    expect(await readFile(join(outDir, "collector_raw.local_match_context.ndjson"), "utf-8")).toContain(
      "\"local_match_nonce\":\"local-match-abc\"",
    );
    expect(await readFile(join(outDir, "riot_raw.match_summaries.ndjson"), "utf-8")).toBe("");
    expect(await readFile(join(outDir, "riot_derived.participant_augments.ndjson"), "utf-8")).toBe("");
  });

  it("skips incomplete OCR offers", async () => {
    const outDir = await tempExportDir();
    tempDirs.push(outDir);

    const summary = await exportCollectorCalibrationRowsLocal({
      enabled: true,
      events: [{ ...offerEvent, cards: offerEvent.cards.slice(0, 2) }],
      gate: liveGate,
      outDir,
    });

    expect(summary.rows.collectorOffers).toBe(0);
    expect(await readFile(join(outDir, "collector_raw.augment_offers.ndjson"), "utf-8")).toBe("");
  });

  it("skips all collector events when live capture is not allowed", async () => {
    const outDir = await tempExportDir();
    tempDirs.push(outDir);

    const summary = await exportCollectorCalibrationRowsLocal({
      enabled: true,
      events: [offerEvent, roundEvent, contextEvent],
      gate: nonLiveGate,
      outDir,
    });

    expect(summary.rows).toMatchObject({
      collectorOffers: 0,
      collectorRoundEvents: 0,
      collectorLocalMatchContexts: 0,
    });
    expect(await readFile(join(outDir, "collector_raw.round_events.ndjson"), "utf-8")).toBe("");
  });

  it("rejects forbidden raw, identity, API key, and credential fields", async () => {
    const outDir = await tempExportDir();
    tempDirs.push(outDir);

    for (const forbiddenKey of [
      "rawOcrText",
      "rawLcu",
      "screenshot",
      "puuid",
      "riotId",
      "summonerName",
      "gameName",
      "tagLine",
      "chat",
      "RIOT_API_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "private_key",
      "client_email",
    ]) {
      await expect(
        exportCollectorCalibrationRowsLocal({
          enabled: true,
          events: [{ ...offerEvent, [forbiddenKey]: "secret" } as CollectorCalibrationEvent],
          gate: liveGate,
          outDir,
        }),
        forbiddenKey,
      ).rejects.toThrow(/forbidden/i);
    }
  });

  it("does not contact BigQuery or network during local export", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const outDir = await tempExportDir();
    tempDirs.push(outDir);

    await exportCollectorCalibrationRowsLocal({
      enabled: true,
      events: [offerEvent],
      gate: liveGate,
      outDir,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
