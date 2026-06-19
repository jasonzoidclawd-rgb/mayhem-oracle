-- Mayhem Oracle — long-term de-identified telemetry schema (BigQuery, M3B).
-- FROZEN CONTRACT: derived 1:1 from SafeMatchExport
-- (src/lib/contracts/telemetry.ts). Codex's M4 calibration scripts read these
-- tables; do not reshape without a both-agent handoff note. Dataset:
-- `mayhem_telemetry`. No Riot IDs / PUUIDs / names ever land here — participant
-- `slot` is a per-match random label and cannot join across matches.

-- One row per ingested safe match export. game_hash is the irreversible dedupe
-- key (hash of the LCU gameId); upserts are idempotent on it.
CREATE TABLE IF NOT EXISTS `mayhem_telemetry.matches` (
  game_hash        STRING NOT NULL,
  schema_version   INT64 NOT NULL,
  patch            STRING NOT NULL,
  queue_id         INT64 NOT NULL,           -- always 2400 (ARAM: Mayhem)
  duration_seconds INT64 NOT NULL,
  source           STRING NOT NULL,          -- 'owned-history' | 'snowball'
  collected_at     TIMESTAMP NOT NULL,
  ingested_at      TIMESTAMP NOT NULL
)
PARTITION BY DATE(ingested_at)
CLUSTER BY patch;

-- Ten rows per match. Slot is random-per-match (no cross-match identity).
CREATE TABLE IF NOT EXISTS `mayhem_telemetry.participants` (
  game_hash           STRING NOT NULL,
  slot                STRING NOT NULL,
  team                INT64 NOT NULL,        -- 100 | 200
  champion_slug       STRING NOT NULL,
  augment_slugs       ARRAY<STRING>,         -- final augments (no round order)
  item_ids            ARRAY<STRING>,
  won                 BOOL NOT NULL,
  kills               INT64,
  deaths              INT64,
  assists             INT64,
  damage_to_champions INT64,
  patch               STRING NOT NULL,       -- denormalized for calibration joins
  ingested_at         TIMESTAMP NOT NULL
)
PARTITION BY DATE(ingested_at)
CLUSTER BY champion_slug, patch;

-- Contributor-only: the single high-quality signal carrying round order. Only
-- present for the uploader's own games (OCR offers + matched final pick).
CREATE TABLE IF NOT EXISTS `mayhem_telemetry.contributor_round_choices` (
  game_hash             STRING NOT NULL,
  round                 INT64 NOT NULL,       -- 1..4
  offered_augment_slugs ARRAY<STRING>,
  selected_augment_slug STRING,               -- nullable: omitted on ambiguous OCR
  ocr_confidence        FLOAT64,
  patch                 STRING NOT NULL,
  ingested_at           TIMESTAMP NOT NULL
)
PARTITION BY DATE(ingested_at)
CLUSTER BY patch;

-- Rejected/held records: never feeds calibration. Reasons:
--   'short_match'   match under eight minutes
--   'invalid_patch' patch mismatch vs current
--   'invalid_schema' schema_version != 1 or allowlist violation
--   'ambiguous_ocr' contributor round selection could not be matched
CREATE TABLE IF NOT EXISTS `mayhem_telemetry.quality_quarantine` (
  game_hash      STRING,
  reason         STRING NOT NULL,
  detail         STRING,
  raw_ref        STRING,                       -- R2 object key of the safe export
  quarantined_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(quarantined_at)
CLUSTER BY reason;
