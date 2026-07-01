import { describe, expect, it } from "vitest";
import {
  createBigQueryRestUploader,
  uploadPrivateCalibrationExport,
  uploadPrivateCalibrationInput,
  type BigQueryCalibrationUploader,
} from "./bigquery-upload";
import { buildPrivateCalibrationExport, type PrivateCalibrationInput } from "./private-calibration";

const baseCollectorOffer = {
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
  offeredAugmentSlugs: ["left-card", "middle-card", "right-card"],
  offeredAugmentIds: [101, 102, 103],
  selectedAugmentSlug: "middle-card",
  selectedAugmentId: 102,
  ocrConfidence: 0.92,
  clientTimestamp: "2026-07-02T01:23:45.000Z",
};

const calibrationInput: PrivateCalibrationInput = {
  collectorOffers: [baseCollectorOffer],
  collectorRoundEvents: [
    {
      localMatchNonce: "local-match-abc",
      patch: "26.13",
      championSlug: "brand",
      selectedAugmentSlugs: ["middle-card"],
      clientTimestamp: "2026-07-02T01:24:45.000Z",
    },
  ],
  collectorLocalMatchContexts: [
    {
      localMatchNonce: "local-match-abc",
      patch: "26.13",
      gameVersion: "16.13.1",
      queueId: 2400,
      gameMode: "CHERRY",
      mapId: 30,
      region: "americas",
      platform: "NA1",
      clientTimestamp: "2026-07-02T01:25:45.000Z",
    },
  ],
  riotMatches: [
    {
      match: {
        metadata: { matchId: "TW2_MAYHEM_SAMPLE" },
        info: {
          queueId: 2400,
          gameMode: "CHERRY",
          gameType: "MATCHED_GAME",
          mapId: 30,
          gameVersion: "16.13.760.9485",
          participants: [
            {
              participantId: 1,
              championId: 63,
              championName: "Brand",
              playerAugment1: 12345,
            },
          ],
        },
      },
    },
  ],
};

function mockUploader() {
  const calls: Array<{ table: string; rows: unknown[] }> = [];
  const uploader: BigQueryCalibrationUploader = {
    insertRows: async (table, rows) => {
      calls.push({ table, rows });
    },
  };
  return { calls, uploader };
}

describe("private calibration BigQuery upload", () => {
  it("fails closed before constructing a REST uploader when env vars are missing", () => {
    expect(() => createBigQueryRestUploader({})).toThrow(/missing BigQuery env/i);
    expect(() =>
      createBigQueryRestUploader({
        BIGQUERY_PROJECT_ID: "project",
        BIGQUERY_DATASET: "dataset",
      }),
    ).toThrow(/GOOGLE_APPLICATION_CREDENTIALS/);
  });

  it("routes sanitized private calibration rows to the five approved tables", async () => {
    const { calls, uploader } = mockUploader();

    const summary = await uploadPrivateCalibrationInput(calibrationInput, uploader);

    expect(calls.map((call) => call.table)).toEqual([
      "collector_raw.augment_offers",
      "collector_raw.round_events",
      "collector_raw.local_match_context",
      "riot_raw.match_summaries",
      "riot_derived.participant_augments",
    ]);
    expect(calls.every((call) => call.rows.length === 1)).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(
      /puuid|riotId|summonerName|gameName|tagLine|chat|screenshot|rawLcu|RGAPI|private_key|client_email/i,
    );
    expect(summary.rowsUploaded).toBe(5);
  });

  it("skips empty tables without contacting the uploader", async () => {
    const { calls, uploader } = mockUploader();
    const emptyExport = buildPrivateCalibrationExport({});

    const summary = await uploadPrivateCalibrationExport(emptyExport, uploader);

    expect(calls).toEqual([]);
    expect(summary.rowsUploaded).toBe(0);
    expect(summary.tables.every((table) => table.skipped)).toBe(true);
  });

  it("rejects forbidden collector fields before upload", async () => {
    const { calls, uploader } = mockUploader();

    await expect(
      uploadPrivateCalibrationInput(
        {
          collectorOffers: [{ ...baseCollectorOffer, puuid: "secret-puuid" }],
        },
        uploader,
      ),
    ).rejects.toThrow(/forbidden/i);
    expect(calls).toEqual([]);
  });
});
