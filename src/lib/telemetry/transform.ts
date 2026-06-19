import type { SafeMatchExport } from "../contracts/telemetry";

// Pure projection of validated safe matches into the frozen BigQuery row shapes
// (scripts/telemetry/bigquery-schema.sql), applying the quarantine rules from
// plan Task 3B.2. No I/O here so the rules are unit-testable.

export interface BqMatchRow {
  game_hash: string;
  schema_version: number;
  patch: string;
  queue_id: number;
  duration_seconds: number;
  source: string;
  collected_at: string;
  ingested_at: string;
}

export interface BqParticipantRow {
  game_hash: string;
  slot: string;
  team: number;
  champion_slug: string;
  augment_slugs: string[];
  item_ids: string[];
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  damage_to_champions: number;
  patch: string;
  ingested_at: string;
}

export interface BqRoundRow {
  game_hash: string;
  round: number;
  offered_augment_slugs: string[];
  selected_augment_slug: string | null;
  ocr_confidence: number;
  patch: string;
  ingested_at: string;
}

export interface BqQuarantineRow {
  game_hash: string;
  reason: "short_match" | "invalid_patch" | "invalid_schema" | "ambiguous_ocr";
  detail: string;
  raw_ref: string;
  quarantined_at: string;
}

export interface TransformOptions {
  currentPatch: string;
  rawRef: string;
  ingestedAt?: string;
  minDurationSeconds?: number;
  minOcrConfidence?: number;
}

export interface TransformResult {
  matches: BqMatchRow[];
  participants: BqParticipantRow[];
  rounds: BqRoundRow[];
  quarantine: BqQuarantineRow[];
}

const MIN_DURATION = 480; // eight minutes
const MIN_OCR = 0.6;

export function transformBatch(
  matches: SafeMatchExport[],
  options: TransformOptions,
): TransformResult {
  const ingestedAt = options.ingestedAt ?? new Date().toISOString();
  const minDuration = options.minDurationSeconds ?? MIN_DURATION;
  const minOcr = options.minOcrConfidence ?? MIN_OCR;

  const result: TransformResult = { matches: [], participants: [], rounds: [], quarantine: [] };

  for (const match of matches) {
    if (match.schemaVersion !== 1) {
      result.quarantine.push(quarantine(match, "invalid_schema", `schema ${match.schemaVersion}`, options.rawRef, ingestedAt));
      continue;
    }
    if (match.patch !== options.currentPatch) {
      result.quarantine.push(quarantine(match, "invalid_patch", `patch ${match.patch} != ${options.currentPatch}`, options.rawRef, ingestedAt));
      continue;
    }
    if (match.durationSeconds < minDuration) {
      result.quarantine.push(quarantine(match, "short_match", `${match.durationSeconds}s`, options.rawRef, ingestedAt));
      continue;
    }

    result.matches.push({
      game_hash: match.gameHash,
      schema_version: 1,
      patch: match.patch,
      queue_id: match.queueId,
      duration_seconds: match.durationSeconds,
      source: match.source,
      collected_at: match.collectedAt,
      ingested_at: ingestedAt,
    });

    for (const participant of match.participants) {
      result.participants.push({
        game_hash: match.gameHash,
        slot: participant.slot,
        team: participant.team,
        champion_slug: participant.championSlug,
        augment_slugs: participant.augmentSlugs,
        item_ids: participant.itemIds,
        won: participant.won,
        kills: participant.stats.kills,
        deaths: participant.stats.deaths,
        assists: participant.stats.assists,
        damage_to_champions: participant.stats.damageToChampions,
        patch: match.patch,
        ingested_at: ingestedAt,
      });
    }

    for (const round of match.contributorRounds ?? []) {
      // A confident, matched selection is the high-value round-order signal;
      // anything ambiguous goes to quarantine rather than poisoning calibration.
      if (round.selectedAugmentSlug === undefined || round.ocrConfidence < minOcr) {
        result.quarantine.push({
          game_hash: match.gameHash,
          reason: "ambiguous_ocr",
          detail: `round ${round.round} conf ${round.ocrConfidence}`,
          raw_ref: options.rawRef,
          quarantined_at: ingestedAt,
        });
        continue;
      }
      result.rounds.push({
        game_hash: match.gameHash,
        round: round.round,
        offered_augment_slugs: round.offeredAugmentSlugs,
        selected_augment_slug: round.selectedAugmentSlug,
        ocr_confidence: round.ocrConfidence,
        patch: match.patch,
        ingested_at: ingestedAt,
      });
    }
  }

  return result;
}

function quarantine(
  match: SafeMatchExport,
  reason: BqQuarantineRow["reason"],
  detail: string,
  rawRef: string,
  at: string,
): BqQuarantineRow {
  return { game_hash: match.gameHash, reason, detail, raw_ref: rawRef, quarantined_at: at };
}
