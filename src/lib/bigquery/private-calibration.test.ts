import { describe, expect, it } from "vitest";
import {
  assertBigQueryUploadEnv,
  buildPrivateCalibrationExport,
  calibrationExportToNdjsonFiles,
  sanitizeCollectorLocalMatchContext,
  sanitizeCollectorOfferEvent,
  sanitizeCollectorRoundEvent,
  summarizePrivateRiotMatch,
} from "./private-calibration";

const baseOffer = {
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
  offeredAugmentSlugs: ["first-aid-kit", "mind-to-matter", "quest-urfs-champion"],
  offeredAugmentIds: [101, 102, 103],
  selectedAugmentSlug: "mind-to-matter",
  selectedAugmentId: 102,
  ocrConfidence: 0.91,
  fixtureProvenance: "sanitized-fixture:three-card-order",
  clientTimestamp: "2026-07-02T01:23:45.000Z",
};

describe("private BigQuery calibration transforms", () => {
  it("sanitizes a collector offer event into the augment offers table shape", () => {
    const row = sanitizeCollectorOfferEvent({
      ...baseOffer,
      extraDebugText: "ignored",
      ocr: { rawText: "ignored local-only OCR text" },
    });

    expect(row).toEqual({
      schema_version: 1,
      local_match_nonce: "local-match-abc",
      local_session_nonce: "session-xyz",
      patch: "26.13",
      game_version: "16.13.1",
      queue_id: 2400,
      game_mode: "CHERRY",
      map_id: 30,
      champion_slug: "brand",
      champion_id: 63,
      round: 1,
      augment_level: 3,
      offered_augment_slugs: ["first-aid-kit", "mind-to-matter", "quest-urfs-champion"],
      offered_augment_ids: [101, 102, 103],
      selected_augment_slug: "mind-to-matter",
      selected_augment_id: 102,
      ocr_confidence: 0.91,
      fixture_provenance: "sanitized-fixture:three-card-order",
      client_timestamp_bucket: "2026-07-02T01:00:00.000Z",
    });
    expect(JSON.stringify(row)).not.toContain("rawText");
  });

  it("sanitizes a collector round event without retaining raw LCU or identity fields", () => {
    const row = sanitizeCollectorRoundEvent({
      localMatchNonce: "local-match-abc",
      patch: "26.13",
      championSlug: "brand",
      round: 2,
      augmentLevel: 7,
      selectedAugmentSlugs: ["mind-to-matter", "phenomenal-evil"],
      itemIds: ["6653", "3020"],
      summonerSpellIds: [4, 32],
      clientTimestamp: "2026-07-02T02:51:00.000Z",
      lcuSessionSummary: { ignored: true },
    });

    expect(row).toMatchObject({
      schema_version: 1,
      local_match_nonce: "local-match-abc",
      patch: "26.13",
      champion_slug: "brand",
      round: 2,
      augment_level: 7,
      selected_augment_slugs: ["mind-to-matter", "phenomenal-evil"],
      item_ids: ["6653", "3020"],
      summoner_spell_ids: [4, 32],
      client_timestamp_bucket: "2026-07-02T02:00:00.000Z",
    });
    expect(JSON.stringify(row)).not.toContain("lcuSessionSummary");
  });

  it("rejects forbidden identifier, raw payload, screenshot, API key, and credential fields", () => {
    for (const forbiddenKey of [
      "puuid",
      "riotId",
      "summonerName",
      "gameName",
      "tagLine",
      "chat",
      "screenshot",
      "rawLcu",
      "RIOT_API_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "private_key",
      "client_email",
      "BIGQUERY_PROJECT_ID",
    ]) {
      expect(
        () => sanitizeCollectorOfferEvent({ ...baseOffer, [forbiddenKey]: "secret" }),
        forbiddenKey,
      ).toThrow(/forbidden/i);
    }
  });

  it("distinguishes Riot selected field paths from nonzero selected values and offered values", () => {
    const matchWithZeroAugments = {
      metadata: { matchId: "TW2_404846583", participants: ["secret-puuid"] },
      info: {
        queueId: 450,
        gameMode: "ARAM",
        gameType: "MATCHED_GAME",
        mapId: 12,
        gameVersion: "16.7.760.9485",
        gameName: "do-not-store",
        participants: [
          {
            puuid: "secret-puuid",
            riotIdGameName: "Do Not Persist",
            riotIdTagline: "SEA",
            summonerName: "Do Not Persist",
            participantId: 1,
            championId: 222,
            championName: "Jinx",
            playerAugment1: 0,
            playerAugment2: 0,
            playerAugment3: 0,
            missionScore: 99,
          },
        ],
      },
    };
    const zeroSummary = summarizePrivateRiotMatch(matchWithZeroAugments);

    expect(zeroSummary.matchSummary).toMatchObject({
      match_id: "TW2_404846583",
      selected_augment_field_paths_present: true,
      selected_augments_present: false,
      offered_augments_present: false,
    });
    expect(zeroSummary.participantAugments[0]).toMatchObject({
      selected_augment_field_paths_present: true,
      selected_augments_present: false,
      offered_augments_present: false,
      selected_augment_values: [],
    });
    expect(zeroSummary.matchSummary.selected_augment_field_paths).not.toContain(
      "info.participants[0].missionScore",
    );
    expect(JSON.stringify(zeroSummary)).not.toContain("secret-puuid");
    expect(JSON.stringify(zeroSummary)).not.toContain("Do Not Persist");

    const nonzeroSummary = summarizePrivateRiotMatch({
      ...matchWithZeroAugments,
      info: {
        ...matchWithZeroAugments.info,
        participants: [
          {
            ...matchWithZeroAugments.info.participants[0],
            playerAugment1: 12345,
          },
        ],
      },
    });

    expect(nonzeroSummary.matchSummary.selected_augments_present).toBe(true);
    expect(nonzeroSummary.participantAugments[0].selected_augment_values).toEqual(["12345"]);

    const offeredSummary = summarizePrivateRiotMatch(matchWithZeroAugments, {
      info: {
        frames: [
          {
            events: [
              {
                augmentOptions: [111, 222, 333],
              },
            ],
          },
        ],
      },
    });
    expect(offeredSummary.matchSummary.offered_augments_present).toBe(true);
  });

  it("builds local NDJSON export files without forbidden fields", () => {
    const localContext = sanitizeCollectorLocalMatchContext({
      localMatchNonce: "local-match-abc",
      patch: "26.13",
      gameVersion: "16.13.1",
      queueId: 2400,
      gameMode: "CHERRY",
      mapId: 30,
      region: "americas",
      platform: "NA1",
      clientTimestamp: "2026-07-02T01:23:45.000Z",
    });
    const exportBundle = buildPrivateCalibrationExport({
      collectorOffers: [baseOffer],
      collectorRoundEvents: [
        {
          localMatchNonce: "local-match-abc",
          patch: "26.13",
          championSlug: "brand",
          round: 1,
          augmentLevel: 3,
          selectedAugmentSlugs: ["mind-to-matter"],
          clientTimestamp: "2026-07-02T01:23:45.000Z",
        },
      ],
      collectorLocalMatchContexts: [localContext],
      riotMatches: [],
    });

    const files = calibrationExportToNdjsonFiles(exportBundle);

    expect(Object.keys(files).sort()).toEqual([
      "collector_raw.augment_offers.ndjson",
      "collector_raw.local_match_context.ndjson",
      "collector_raw.round_events.ndjson",
      "riot_derived.participant_augments.ndjson",
      "riot_raw.match_summaries.ndjson",
    ]);
    expect(files["collector_raw.augment_offers.ndjson"].trim()).toContain(
      "\"local_match_nonce\":\"local-match-abc\"",
    );
    expect(JSON.stringify(files)).not.toMatch(
      /puuid|riotId|summonerName|gameName|tagLine|chat|screenshot|rawLcu|RGAPI|private_key|client_email/i,
    );
  });

  it("fails closed for future BigQuery upload when credentials are missing", () => {
    expect(() => assertBigQueryUploadEnv({})).toThrow(/missing BigQuery env/i);
    expect(() =>
      assertBigQueryUploadEnv({
        BIGQUERY_PROJECT_ID: "project",
        BIGQUERY_DATASET: "dataset",
      }),
    ).toThrow(/GOOGLE_APPLICATION_CREDENTIALS/);

    expect(
      assertBigQueryUploadEnv({
        BIGQUERY_PROJECT_ID: "project",
        BIGQUERY_DATASET: "dataset",
        GOOGLE_APPLICATION_CREDENTIALS: "/tmp/local-only.json",
      }),
    ).toEqual({
      projectId: "project",
      dataset: "dataset",
      credentialsPath: "/tmp/local-only.json",
    });
  });
});
