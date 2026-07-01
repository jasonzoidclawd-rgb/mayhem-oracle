# BigQuery Private Calibration Schema

Date: 2026-07-02
Scope: first private collector/Riot calibration scaffold.

This handoff defines private BigQuery table boundaries. It does not introduce a
public augment win-rate product, public endpoint, or public page.

## Purpose

The private calibration pipeline prepares privacy-bounded collector and Riot
Match-V5 facts for:

- Model validation.
- Patch drift checks.
- Data quality review.
- Offline calibration of Mayhem Oracle recommendations.

The output must stay internal. Public product surfaces must continue to use
public patch data and explainable visible-offer recommendations, not private
collector aggregates.

## Forbidden Data

Never store, upload, or commit:

- Riot IDs.
- PUUIDs.
- Summoner names.
- `gameName` or `tagLine`.
- Chat.
- Screenshots.
- Raw LCU payloads.
- Riot API keys.
- Google service accounts or BigQuery credentials.
- `.env` files.

Collector transforms fail closed when forbidden keys appear in collector input.
Riot transforms allowlist Match-V5 fields into sanitized summaries and drop
participant identity fields.

## Collector-Owned Tables

### `collector_raw.augment_offers`

Visible offer evidence from consenting users.

Contains:

- Anonymous local match/session nonce.
- Patch/game version.
- Queue/mode/map when known.
- Champion slug/id when known.
- Round or augment level.
- Offered augment slugs/ids.
- Selected augment slug/id if known.
- OCR confidence and sanitized fixture provenance.
- Client timestamp bucket rounded to the hour.

Does not contain:

- Raw OCR text.
- Screenshots.
- Raw LCU payloads.
- Player identifiers.

### `collector_raw.round_events`

Round-level collector context.

Contains:

- Anonymous local match nonce.
- Round or augment level.
- Champion slug/id.
- Selected augment ids/slugs.
- Items/spells only when already sanitized and available.
- Client timestamp bucket.

Does not contain raw LCU blobs.

### `collector_raw.local_match_context`

Anonymous local context for calibration joins.

Contains:

- Anonymous local match nonce.
- Patch/game version.
- Queue/mode/map.
- Region/platform only when privacy-safe and useful.
- Client timestamp bucket.

Does not contain any player identifier.

## Riot-Derived Tables

### `riot_raw.match_summaries`

Sanitized Match-V5 metadata summaries for private calibration only.

Contains:

- Match id, documented as Riot-derived.
- Patch/game version.
- Queue/map/mode/type.
- Participant count.
- Booleans distinguishing selected field paths, nonzero selected values, and
  offered evidence.
- Sanitized field path lists.

Match ids must not be linked to collector user identity tables.

### `riot_derived.participant_augments`

Derived only after a real ARAM Mayhem sample proves nonzero selected augment
values.

Contains:

- Match id.
- Participant index/id.
- Champion id/name.
- `selected_augment_field_paths_present`.
- `selected_augments_present`.
- `offered_augments_present`.
- Selected augment values normalized to strings for BigQuery compatibility.

Offered-but-not-picked augment sets remain collector-owned unless Riot
Match-V5 or timeline evidence proves equivalent fields exist.

## Machine-Readable Schema

The machine-readable scaffold is:

- `scripts/bigquery/private-calibration-schema.json`

The local NDJSON exporter is:

- `scripts/bigquery/export-private-calibration.ts`

Default export mode is dry-run and local-only. Upload mode exists only behind
an explicit `--upload` flag plus the `BIGQUERY_PROJECT_ID`, `BIGQUERY_DATASET`,
and `GOOGLE_APPLICATION_CREDENTIALS` environment gate. Tests use mocked
uploaders only; no default path contacts BigQuery.

## Collector Adapter Boundary

The collector event adapter is:

- `src/lib/bigquery/collector-calibration.ts`

It is a local-only buffer/export adapter for safe collector-produced event
shapes. It accepts complete visible three-card offer events, round events, and
anonymous local match context only when the normalized gameflow gate reports
`liveCaptureAllowed: true`. Partial OCR offers and non-live events do not
produce export rows. Raw OCR text, raw LCU fields, screenshots, identity fields,
API keys, and credential fields are rejected before sanitizer/export.

The opt-in local command is:

```bash
npm run export:collector-calibration:local -- \
  --enable-local-export \
  --input /path/to/safe-collector-events.json \
  --out-dir /tmp/mayhem-collector-calibration
```

It writes sanitized NDJSON files locally only. It does not contact BigQuery,
does not upload over the network, and must remain separate from public routes.

## Upload Boundary

The env-gated uploader is:

- `src/lib/bigquery/bigquery-upload.ts`

Approved upload targets are limited to:

- `collector_raw.augment_offers`
- `collector_raw.round_events`
- `collector_raw.local_match_context`
- `riot_raw.match_summaries`
- `riot_derived.participant_augments`

Upload mode consumes the same sanitized `PrivateCalibrationInput` /
`PrivateCalibrationExport` shapes as local dry-run. Missing environment values
fail closed before BigQuery is constructed. Empty tables are skipped. The
collector local export command remains local-only and does not construct the
BigQuery uploader.

## Schema Validation Boundary

The schema validation/provisioning tool is:

- `src/lib/bigquery/calibration-schema.ts`
- `scripts/bigquery/calibration-schema.ts`

It uses `scripts/bigquery/private-calibration-schema.json` as the source of
truth. Default CLI behavior prints usage/fails closed and does not construct a
BigQuery client. BigQuery-backed validation or provisioning requires one of:

- `--validate`
- `--create-missing`

Both modes require `BIGQUERY_PROJECT_ID`, `BIGQUERY_DATASET`, and
`GOOGLE_APPLICATION_CREDENTIALS`. Validation reports missing dataset, missing
tables, mismatched schemas, and valid tables. Provisioning creates only missing
tables; it does not delete, loosen, or rewrite existing mismatched tables.

## Retention And Minimization

- Keep raw collector input out of BigQuery; export only allowlisted rows.
- Keep raw Riot payloads out of committed fixtures and out of collector-linked
  tables.
- Bucket client timestamps to reduce identifying timeline precision.
- Prefer aggregate/materialized analysis outputs for reports.
- Delete or quarantine malformed, identity-bearing, or raw-payload records.

## Current Riot Evidence

Current Riot discovery has not proven nonzero selected augment values in a real
ARAM Mayhem Match-V5 sample. A regular ARAM sample showed player augment field
paths but did not prove selected values. Offered-but-not-picked augments were
not observed. The collector remains required for offer sets.
