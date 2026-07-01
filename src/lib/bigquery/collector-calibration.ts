import {
  buildPrivateCalibrationExport,
  calibrationExportToNdjsonFiles,
  sanitizeCollectorLocalMatchContext,
  sanitizeCollectorOfferEvent,
  sanitizeCollectorRoundEvent,
  type CollectorAugmentOfferRow,
  type CollectorLocalMatchContextRow,
  type CollectorRoundEventRow,
  type PrivateCalibrationExport,
  type PrivateCalibrationInput,
} from "./private-calibration";

type JsonRecord = Record<string, unknown>;

const FORBIDDEN_COLLECTOR_EVENT_KEY_PATTERNS = [
  /^puuid$/i,
  /riotid/i,
  /^summonername$/i,
  /^gamename$/i,
  /^tagline$/i,
  /^chat$/i,
  /screenshot/i,
  /rawlcu/i,
  /lcu/i,
  /^ocrtext$/i,
  /^rawtext$/i,
  /rawocr/i,
  /apikey/i,
  /^riotapikey$/i,
  /^googleapplicationcredentials$/i,
  /^privatekey$/i,
  /^clientemail$/i,
  /^bigquery/i,
];

export interface CollectorCalibrationGate {
  liveCaptureAllowed: boolean;
  phase?: string;
}

interface CollectorCalibrationBaseEvent {
  localMatchNonce: string;
  localSessionNonce?: string;
  patch?: string;
  gameVersion?: string;
  queueId?: number;
  gameMode?: string;
  mapId?: number;
  championSlug?: string;
  championId?: number;
  round?: number;
  augmentLevel?: number;
  clientTimestamp: string;
}

export interface CollectorCalibrationCard {
  slug: string;
  id?: number;
  regionIndex: number;
  confidence?: number;
}

export interface CollectorCalibrationOfferEvent extends CollectorCalibrationBaseEvent {
  type: "augment_offer";
  cards: CollectorCalibrationCard[];
  selectedAugmentSlug?: string;
  selectedAugmentId?: number;
  ocrConfidence?: number;
  fixtureProvenance?: string;
}

export interface CollectorCalibrationRoundEvent extends CollectorCalibrationBaseEvent {
  type: "round_event";
  selectedAugmentSlugs: string[];
  selectedAugmentIds?: number[];
  itemIds?: string[];
  summonerSpellIds?: number[];
}

export interface CollectorCalibrationLocalMatchContextEvent extends CollectorCalibrationBaseEvent {
  type: "local_match_context";
  region?: string;
  platform?: string;
}

export type CollectorCalibrationEvent =
  | CollectorCalibrationOfferEvent
  | CollectorCalibrationRoundEvent
  | CollectorCalibrationLocalMatchContextEvent;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedKey(key: string): string {
  return key.replace(/[-_\s]/g, "").toLowerCase();
}

function assertNoForbiddenCollectorEventFields(value: unknown, path = ""): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoForbiddenCollectorEventFields(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (FORBIDDEN_COLLECTOR_EVENT_KEY_PATTERNS.some((pattern) => pattern.test(normalized))) {
      throw new Error(`forbidden collector calibration field: ${path ? `${path}.` : ""}${key}`);
    }
    assertNoForbiddenCollectorEventFields(child, path ? `${path}.${key}` : key);
  }
}

function completeOrderedCards(cards: CollectorCalibrationCard[]): CollectorCalibrationCard[] | null {
  if (cards.length !== 3) return null;
  const ordered = [...cards].sort((left, right) => left.regionIndex - right.regionIndex);
  const regions = new Set(ordered.map((card) => card.regionIndex));
  const slugs = new Set(ordered.map((card) => card.slug).filter(Boolean));
  if (
    regions.size !== 3 ||
    slugs.size !== 3 ||
    ![0, 1, 2].every((region) => regions.has(region))
  ) {
    return null;
  }
  return ordered;
}

function roundedConfidence(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function confidenceForOffer(event: CollectorCalibrationOfferEvent): number {
  if (Number.isFinite(event.ocrConfidence)) {
    return roundedConfidence(event.ocrConfidence as number);
  }
  const confidences = event.cards
    .map((card) => card.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (confidences.length > 0) {
    return roundedConfidence(
      confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
    );
  }
  return 1;
}

function sharedCollectorFields(event: CollectorCalibrationBaseEvent) {
  return {
    localMatchNonce: event.localMatchNonce,
    localSessionNonce: event.localSessionNonce,
    patch: event.patch,
    gameVersion: event.gameVersion,
    queueId: event.queueId,
    gameMode: event.gameMode,
    mapId: event.mapId,
    championSlug: event.championSlug,
    championId: event.championId,
    round: event.round,
    augmentLevel: event.augmentLevel,
    clientTimestamp: event.clientTimestamp,
  };
}

function toOfferRow(event: CollectorCalibrationOfferEvent): CollectorAugmentOfferRow | null {
  const cards = completeOrderedCards(event.cards);
  if (!cards) return null;
  return sanitizeCollectorOfferEvent({
    ...sharedCollectorFields(event),
    offeredAugmentSlugs: cards.map((card) => card.slug),
    offeredAugmentIds: cards
      .map((card) => card.id)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    selectedAugmentSlug: event.selectedAugmentSlug,
    selectedAugmentId: event.selectedAugmentId,
    ocrConfidence: confidenceForOffer(event),
    fixtureProvenance: event.fixtureProvenance,
  });
}

function toRoundRow(event: CollectorCalibrationRoundEvent): CollectorRoundEventRow {
  return sanitizeCollectorRoundEvent({
    ...sharedCollectorFields(event),
    selectedAugmentSlugs: event.selectedAugmentSlugs,
    selectedAugmentIds: event.selectedAugmentIds,
    itemIds: event.itemIds,
    summonerSpellIds: event.summonerSpellIds,
  });
}

function toLocalMatchContextRow(
  event: CollectorCalibrationLocalMatchContextEvent,
): CollectorLocalMatchContextRow {
  return sanitizeCollectorLocalMatchContext({
    ...sharedCollectorFields(event),
    region: event.region,
    platform: event.platform,
  });
}

export class CollectorCalibrationEventBuffer {
  private readonly collectorOffers: CollectorAugmentOfferRow[] = [];
  private readonly collectorRoundEvents: CollectorRoundEventRow[] = [];
  private readonly collectorLocalMatchContexts: CollectorLocalMatchContextRow[] = [];

  record(event: CollectorCalibrationEvent, gate: CollectorCalibrationGate): boolean {
    assertNoForbiddenCollectorEventFields(event);
    if (!gate.liveCaptureAllowed) return false;

    if (event.type === "augment_offer") {
      const row = toOfferRow(event);
      if (!row) return false;
      this.collectorOffers.push(row);
      return true;
    }
    if (event.type === "round_event") {
      this.collectorRoundEvents.push(toRoundRow(event));
      return true;
    }
    this.collectorLocalMatchContexts.push(toLocalMatchContextRow(event));
    return true;
  }

  toPrivateCalibrationInput(): PrivateCalibrationInput {
    return {
      collectorOffers: [...this.collectorOffers],
      collectorRoundEvents: [...this.collectorRoundEvents],
      collectorLocalMatchContexts: [...this.collectorLocalMatchContexts],
    };
  }

  toPrivateCalibrationExport(): PrivateCalibrationExport {
    return buildPrivateCalibrationExport(this.toPrivateCalibrationInput());
  }

  toNdjsonFiles(): Record<string, string> {
    return calibrationExportToNdjsonFiles(this.toPrivateCalibrationExport());
  }

  clear(): void {
    this.collectorOffers.length = 0;
    this.collectorRoundEvents.length = 0;
    this.collectorLocalMatchContexts.length = 0;
  }
}

export function buildPrivateCalibrationInputFromCollectorEvents(
  events: CollectorCalibrationEvent[],
  gate: CollectorCalibrationGate,
): PrivateCalibrationInput {
  const buffer = new CollectorCalibrationEventBuffer();
  for (const event of events) {
    buffer.record(event, gate);
  }
  return buffer.toPrivateCalibrationInput();
}
