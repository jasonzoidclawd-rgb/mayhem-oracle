import { findRiotFieldPaths } from "../riot/transform";

type JsonRecord = Record<string, unknown>;

const FORBIDDEN_COLLECTOR_KEY_PATTERNS = [
  /^puuid$/i,
  /riotid/i,
  /^summonername$/i,
  /^gamename$/i,
  /^tagline$/i,
  /^chat$/i,
  /screenshot/i,
  /^rawlcu$/i,
  /apikey/i,
  /^riotapikey$/i,
  /^googleapplicationcredentials$/i,
  /^privatekey$/i,
  /^clientemail$/i,
  /^bigquery/i,
];

const SELECTED_AUGMENT_FIELD_PATTERN =
  /^(playerAugment\d*|selectedAugment\d*|selectedAugments|augment\d+)$/i;

export interface CollectorAugmentOfferRow {
  schema_version: 1;
  local_match_nonce: string;
  local_session_nonce?: string;
  patch?: string;
  game_version?: string;
  queue_id?: number;
  game_mode?: string;
  map_id?: number;
  champion_slug?: string;
  champion_id?: number;
  round?: number;
  augment_level?: number;
  offered_augment_slugs: string[];
  offered_augment_ids?: number[];
  selected_augment_slug?: string;
  selected_augment_id?: number;
  ocr_confidence?: number;
  fixture_provenance?: string;
  client_timestamp_bucket: string;
}

export interface CollectorRoundEventRow {
  schema_version: 1;
  local_match_nonce: string;
  patch?: string;
  champion_slug?: string;
  champion_id?: number;
  round?: number;
  augment_level?: number;
  selected_augment_slugs: string[];
  selected_augment_ids?: number[];
  item_ids?: string[];
  summoner_spell_ids?: number[];
  client_timestamp_bucket: string;
}

export interface CollectorLocalMatchContextRow {
  schema_version: 1;
  local_match_nonce: string;
  patch?: string;
  game_version?: string;
  queue_id?: number;
  game_mode?: string;
  map_id?: number;
  region?: string;
  platform?: string;
  client_timestamp_bucket: string;
}

export interface RiotMatchSummaryRow {
  schema_version: 1;
  match_id?: string;
  patch?: string;
  game_version?: string;
  queue_id?: number;
  map_id?: number;
  game_mode?: string;
  game_type?: string;
  participant_count: number;
  selected_augment_field_paths_present: boolean;
  selected_augments_present: boolean;
  offered_augments_present: boolean;
  selected_augment_field_paths: string[];
  offered_augment_field_paths: string[];
}

export interface RiotParticipantAugmentRow {
  schema_version: 1;
  match_id?: string;
  participant_id?: number;
  participant_index: number;
  champion_id?: number;
  champion_name?: string;
  selected_augment_field_paths_present: boolean;
  selected_augments_present: boolean;
  offered_augments_present: boolean;
  selected_augment_values: string[];
}

export interface PrivateRiotMatchInput {
  match: unknown;
  timeline?: unknown;
}

export interface PrivateCalibrationInput {
  collectorOffers?: unknown[];
  collectorRoundEvents?: unknown[];
  collectorLocalMatchContexts?: unknown[];
  riotMatches?: PrivateRiotMatchInput[];
}

export interface PrivateCalibrationExport {
  collector_raw: {
    augment_offers: CollectorAugmentOfferRow[];
    round_events: CollectorRoundEventRow[];
    local_match_context: CollectorLocalMatchContextRow[];
  };
  riot_raw: {
    match_summaries: RiotMatchSummaryRow[];
  };
  riot_derived: {
    participant_augments: RiotParticipantAugmentRow[];
  };
}

export interface BigQueryUploadEnv {
  projectId: string;
  dataset: string;
  credentialsPath: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(record: JsonRecord, camelName: string, snakeName: string = toSnake(camelName)): unknown {
  return record[camelName] ?? record[snakeName];
}

function toSnake(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function normalizedKey(key: string): string {
  return key.replace(/[-_\s]/g, "").toLowerCase();
}

function assertNoForbiddenCollectorFields(value: unknown, path = ""): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenCollectorFields(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (FORBIDDEN_COLLECTOR_KEY_PATTERNS.some((pattern) => pattern.test(normalized))) {
      throw new Error(`forbidden private calibration field: ${path ? `${path}.` : ""}${key}`);
    }
    assertNoForbiddenCollectorFields(child, path ? `${path}.${key}` : key);
  }
}

function requiredRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) throw new Error("private calibration row must be an object");
  return value;
}

function requiredString(record: JsonRecord, key: string): string {
  const value = field(record, key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`private calibration row missing ${key}`);
  }
  return value;
}

function optionalString(record: JsonRecord, key: string): string | undefined {
  const value = field(record, key);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalNumber(record: JsonRecord, key: string): number | undefined {
  const value = field(record, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(record: JsonRecord, key: string): string[] {
  const value = field(record, key);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function numberArray(record: JsonRecord, key: string): number[] | undefined {
  const value = field(record, key);
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  return numbers.length > 0 ? numbers : undefined;
}

function bucketTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("private calibration row missing clientTimestamp");
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("private calibration row has invalid clientTimestamp");
  }
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function attachOptional<T extends object, K extends keyof T>(
  row: T,
  key: K,
  value: T[K] | undefined,
): T {
  if (value !== undefined) {
    row[key] = value;
  }
  return row;
}

export function sanitizeCollectorOfferEvent(raw: unknown): CollectorAugmentOfferRow {
  assertNoForbiddenCollectorFields(raw);
  const record = requiredRecord(raw);
  const row: CollectorAugmentOfferRow = {
    schema_version: 1,
    local_match_nonce: requiredString(record, "localMatchNonce"),
    offered_augment_slugs: stringArray(record, "offeredAugmentSlugs"),
    client_timestamp_bucket: bucketTimestamp(
      field(record, "clientTimestamp") ?? field(record, "clientTimestampBucket"),
    ),
  };

  attachOptional(row, "local_session_nonce", optionalString(record, "localSessionNonce"));
  attachOptional(row, "patch", optionalString(record, "patch"));
  attachOptional(row, "game_version", optionalString(record, "gameVersion"));
  attachOptional(row, "queue_id", optionalNumber(record, "queueId"));
  attachOptional(row, "game_mode", optionalString(record, "gameMode"));
  attachOptional(row, "map_id", optionalNumber(record, "mapId"));
  attachOptional(row, "champion_slug", optionalString(record, "championSlug"));
  attachOptional(row, "champion_id", optionalNumber(record, "championId"));
  attachOptional(row, "round", optionalNumber(record, "round"));
  attachOptional(row, "augment_level", optionalNumber(record, "augmentLevel"));
  attachOptional(row, "offered_augment_ids", numberArray(record, "offeredAugmentIds"));
  attachOptional(row, "selected_augment_slug", optionalString(record, "selectedAugmentSlug"));
  attachOptional(row, "selected_augment_id", optionalNumber(record, "selectedAugmentId"));
  attachOptional(row, "ocr_confidence", optionalNumber(record, "ocrConfidence"));
  attachOptional(row, "fixture_provenance", optionalString(record, "fixtureProvenance"));
  return row;
}

export function sanitizeCollectorRoundEvent(raw: unknown): CollectorRoundEventRow {
  assertNoForbiddenCollectorFields(raw);
  const record = requiredRecord(raw);
  const row: CollectorRoundEventRow = {
    schema_version: 1,
    local_match_nonce: requiredString(record, "localMatchNonce"),
    selected_augment_slugs: stringArray(record, "selectedAugmentSlugs"),
    client_timestamp_bucket: bucketTimestamp(
      field(record, "clientTimestamp") ?? field(record, "clientTimestampBucket"),
    ),
  };

  attachOptional(row, "patch", optionalString(record, "patch"));
  attachOptional(row, "champion_slug", optionalString(record, "championSlug"));
  attachOptional(row, "champion_id", optionalNumber(record, "championId"));
  attachOptional(row, "round", optionalNumber(record, "round"));
  attachOptional(row, "augment_level", optionalNumber(record, "augmentLevel"));
  attachOptional(row, "selected_augment_ids", numberArray(record, "selectedAugmentIds"));
  const itemIds = stringArray(record, "itemIds");
  attachOptional(row, "item_ids", itemIds.length > 0 ? itemIds : undefined);
  attachOptional(row, "summoner_spell_ids", numberArray(record, "summonerSpellIds"));
  return row;
}

export function sanitizeCollectorLocalMatchContext(raw: unknown): CollectorLocalMatchContextRow {
  assertNoForbiddenCollectorFields(raw);
  const record = requiredRecord(raw);
  const row: CollectorLocalMatchContextRow = {
    schema_version: 1,
    local_match_nonce: requiredString(record, "localMatchNonce"),
    client_timestamp_bucket: bucketTimestamp(
      field(record, "clientTimestamp") ?? field(record, "clientTimestampBucket"),
    ),
  };

  attachOptional(row, "patch", optionalString(record, "patch"));
  attachOptional(row, "game_version", optionalString(record, "gameVersion"));
  attachOptional(row, "queue_id", optionalNumber(record, "queueId"));
  attachOptional(row, "game_mode", optionalString(record, "gameMode"));
  attachOptional(row, "map_id", optionalNumber(record, "mapId"));
  attachOptional(row, "region", optionalString(record, "region"));
  attachOptional(row, "platform", optionalString(record, "platform"));
  return row;
}

function rootInfo(match: unknown): JsonRecord {
  const root = isRecord(match) ? match : {};
  return isRecord(root.info) ? root.info : {};
}

function rootMetadata(match: unknown): JsonRecord {
  const root = isRecord(match) ? match : {};
  return isRecord(root.metadata) ? root.metadata : {};
}

function participantRecords(match: unknown): JsonRecord[] {
  const info = rootInfo(match);
  return Array.isArray(info.participants) ? info.participants.filter(isRecord) : [];
}

function selectedAugmentFieldPaths(match: unknown): string[] {
  const paths: string[] = [];
  participantRecords(match).forEach((participant, index) => {
    for (const key of Object.keys(participant)) {
      if (SELECTED_AUGMENT_FIELD_PATTERN.test(key)) {
        paths.push(`info.participants[${index}].${key}`);
      }
    }
  });
  return Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right));
}

function presentAugmentValue(value: unknown): value is string | number | boolean {
  if (value === undefined || value === null || value === false || value === 0) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function selectedAugmentValues(participant: JsonRecord): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(participant)) {
    if (!SELECTED_AUGMENT_FIELD_PATTERN.test(key)) continue;
    if (presentAugmentValue(value)) {
      values.push(String(value));
    } else if (Array.isArray(value)) {
      values.push(...value.filter(presentAugmentValue).map(String));
    }
  }
  return values;
}

function offeredAugmentFieldPaths(match: unknown, timeline?: unknown): string[] {
  return findRiotFieldPaths({ match, timeline }, ["offer", "offered", "choice", "choices", "option", "options"])
    .filter((entry) => /(augment|cherry|mayhem)/i.test(`${entry.key} ${entry.path}`))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
}

function stringField(record: JsonRecord, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function numberField(record: JsonRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function patchFromVersion(gameVersion: string | undefined): string | undefined {
  const match = gameVersion?.match(/^(\d+\.\d+)/);
  return match?.[1];
}

export function summarizePrivateRiotMatch(
  match: unknown,
  timeline?: unknown,
): {
  matchSummary: RiotMatchSummaryRow;
  participantAugments: RiotParticipantAugmentRow[];
} {
  const metadata = rootMetadata(match);
  const info = rootInfo(match);
  const participants = participantRecords(match);
  const matchId = stringField(metadata, "matchId");
  const gameVersion = stringField(info, "gameVersion");
  const selectedPaths = selectedAugmentFieldPaths(match);
  const offeredPaths = offeredAugmentFieldPaths(match, timeline);
  const participantRows: RiotParticipantAugmentRow[] = participants.map((participant, index) => {
    const values = selectedAugmentValues(participant);
    return {
      schema_version: 1,
      match_id: matchId,
      participant_id: numberField(participant, "participantId"),
      participant_index: numberField(participant, "participantIndex") ?? index,
      champion_id: numberField(participant, "championId"),
      champion_name: stringField(participant, "championName"),
      selected_augment_field_paths_present: selectedPaths.some((path) =>
        path.startsWith(`info.participants[${index}].`),
      ),
      selected_augments_present: values.length > 0,
      offered_augments_present: offeredPaths.length > 0,
      selected_augment_values: values,
    };
  });
  const selectedValuesPresent = participantRows.some((row) => row.selected_augments_present);

  return {
    matchSummary: {
      schema_version: 1,
      match_id: matchId,
      patch: patchFromVersion(gameVersion),
      game_version: gameVersion,
      queue_id: numberField(info, "queueId"),
      map_id: numberField(info, "mapId"),
      game_mode: stringField(info, "gameMode"),
      game_type: stringField(info, "gameType"),
      participant_count: participants.length,
      selected_augment_field_paths_present: selectedPaths.length > 0,
      selected_augments_present: selectedValuesPresent,
      offered_augments_present: offeredPaths.length > 0,
      selected_augment_field_paths: selectedPaths,
      offered_augment_field_paths: offeredPaths,
    },
    participantAugments: participantRows,
  };
}

export function buildPrivateCalibrationExport(
  input: PrivateCalibrationInput,
): PrivateCalibrationExport {
  const riotSummaries = (input.riotMatches ?? []).map(({ match, timeline }) =>
    summarizePrivateRiotMatch(match, timeline),
  );
  return {
    collector_raw: {
      augment_offers: (input.collectorOffers ?? []).map(sanitizeCollectorOfferEvent),
      round_events: (input.collectorRoundEvents ?? []).map(sanitizeCollectorRoundEvent),
      local_match_context: (input.collectorLocalMatchContexts ?? []).map(
        sanitizeCollectorLocalMatchContext,
      ),
    },
    riot_raw: {
      match_summaries: riotSummaries.map((summary) => summary.matchSummary),
    },
    riot_derived: {
      participant_augments: riotSummaries.flatMap((summary) => summary.participantAugments),
    },
  };
}

function toNdjson(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
}

export function calibrationExportToNdjsonFiles(
  output: PrivateCalibrationExport,
): Record<string, string> {
  return {
    "collector_raw.augment_offers.ndjson": toNdjson(output.collector_raw.augment_offers),
    "collector_raw.round_events.ndjson": toNdjson(output.collector_raw.round_events),
    "collector_raw.local_match_context.ndjson": toNdjson(output.collector_raw.local_match_context),
    "riot_raw.match_summaries.ndjson": toNdjson(output.riot_raw.match_summaries),
    "riot_derived.participant_augments.ndjson": toNdjson(
      output.riot_derived.participant_augments,
    ),
  };
}

export function assertBigQueryUploadEnv(
  env: Record<string, string | undefined> = process.env,
): BigQueryUploadEnv {
  const missing = ["BIGQUERY_PROJECT_ID", "BIGQUERY_DATASET", "GOOGLE_APPLICATION_CREDENTIALS"]
    .filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`missing BigQuery env: ${missing.join(", ")}`);
  }
  return {
    projectId: env.BIGQUERY_PROJECT_ID!,
    dataset: env.BIGQUERY_DATASET!,
    credentialsPath: env.GOOGLE_APPLICATION_CREDENTIALS!,
  };
}
