import { describe, expect, it } from "vitest";
import {
  CollectorCalibrationEventBuffer,
  buildPrivateCalibrationInputFromCollectorEvents,
} from "./collector-calibration";

const liveGate = { liveCaptureAllowed: true, phase: "InProgress" };
const nonLiveGate = { liveCaptureAllowed: false, phase: "Lobby" };

const completeOfferEvent = {
  type: "augment_offer" as const,
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
  fixtureProvenance: "sanitized-fixture:three-card-order",
  clientTimestamp: "2026-07-02T01:23:45.000Z",
};

describe("collector private calibration event adapter", () => {
  it("maps a complete three-card OCR offer to a sanitized augment_offers row", () => {
    const buffer = new CollectorCalibrationEventBuffer();

    expect(buffer.record(completeOfferEvent, liveGate)).toBe(true);

    const rows = buffer.toPrivateCalibrationExport().collector_raw.augment_offers;
    expect(rows).toEqual([
      {
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
        offered_augment_slugs: ["left-card", "middle-card", "right-card"],
        offered_augment_ids: [101, 102, 103],
        selected_augment_slug: "middle-card",
        selected_augment_id: 102,
        ocr_confidence: 0.92,
        fixture_provenance: "sanitized-fixture:three-card-order",
        client_timestamp_bucket: "2026-07-02T01:00:00.000Z",
      },
    ]);
  });

  it("skips incomplete OCR offers instead of exporting partial rows", () => {
    const buffer = new CollectorCalibrationEventBuffer();

    expect(
      buffer.record(
        {
          ...completeOfferEvent,
          cards: completeOfferEvent.cards.slice(0, 2),
        },
        liveGate,
      ),
    ).toBe(false);

    expect(buffer.toPrivateCalibrationExport().collector_raw.augment_offers).toEqual([]);
  });

  it("does not export collector calibration rows when live capture is not allowed", () => {
    const buffer = new CollectorCalibrationEventBuffer();

    expect(buffer.record(completeOfferEvent, nonLiveGate)).toBe(false);
    expect(
      buffer.record(
        {
          type: "round_event",
          localMatchNonce: "local-match-abc",
          championSlug: "brand",
          round: 1,
          augmentLevel: 3,
          selectedAugmentSlugs: ["middle-card"],
          clientTimestamp: "2026-07-02T01:23:45.000Z",
        },
        nonLiveGate,
      ),
    ).toBe(false);

    const output = buffer.toPrivateCalibrationExport();
    expect(output.collector_raw.augment_offers).toEqual([]);
    expect(output.collector_raw.round_events).toEqual([]);
    expect(output.collector_raw.local_match_context).toEqual([]);
  });

  it("rejects raw OCR, LCU, screenshot, identity, API key, and credential fields", () => {
    const buffer = new CollectorCalibrationEventBuffer();

    for (const forbiddenKey of [
      "ocrText",
      "rawText",
      "rawOcrText",
      "lcuSession",
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
      expect(
        () => buffer.record({ ...completeOfferEvent, [forbiddenKey]: "secret" }, liveGate),
        forbiddenKey,
      ).toThrow(/forbidden/i);
    }
  });

  it("exports local NDJSON files with only sanitized collector calibration rows", () => {
    const buffer = new CollectorCalibrationEventBuffer();
    buffer.record(completeOfferEvent, liveGate);
    buffer.record(
      {
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
      },
      liveGate,
    );
    buffer.record(
      {
        type: "local_match_context",
        localMatchNonce: "local-match-abc",
        patch: "26.13",
        gameVersion: "16.13.1",
        queueId: 2400,
        gameMode: "CHERRY",
        mapId: 30,
        platform: "NA1",
        region: "americas",
        clientTimestamp: "2026-07-02T01:25:45.000Z",
      },
      liveGate,
    );

    const files = buffer.toNdjsonFiles();

    expect(files["collector_raw.augment_offers.ndjson"]).toContain(
      "\"offered_augment_slugs\":[\"left-card\",\"middle-card\",\"right-card\"]",
    );
    expect(files["collector_raw.round_events.ndjson"]).toContain(
      "\"selected_augment_slugs\":[\"middle-card\"]",
    );
    expect(files["collector_raw.local_match_context.ndjson"]).toContain(
      "\"local_match_nonce\":\"local-match-abc\"",
    );
    expect(JSON.stringify(files)).not.toMatch(
      /puuid|riotId|summonerName|gameName|tagLine|chat|screenshot|rawLcu|RGAPI|RIOT_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|private_key|client_email|ocrText|rawText|lcuSession/i,
    );
  });

  it("builds private calibration input from a local collector event batch", () => {
    const input = buildPrivateCalibrationInputFromCollectorEvents(
      [
        completeOfferEvent,
        {
          type: "local_match_context",
          localMatchNonce: "local-match-abc",
          patch: "26.13",
          gameVersion: "16.13.1",
          queueId: 2400,
          gameMode: "CHERRY",
          mapId: 30,
          clientTimestamp: "2026-07-02T01:25:45.000Z",
        },
      ],
      liveGate,
    );

    expect(input.collectorOffers).toHaveLength(1);
    expect(input.collectorLocalMatchContexts).toHaveLength(1);
    expect(input.collectorRoundEvents).toEqual([]);
    expect(JSON.stringify(input)).not.toMatch(/ocrText|rawText|lcuSession|puuid/i);
  });
});
