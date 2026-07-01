# Private Calibration BigQuery Scripts

This directory contains private calibration scaffolding only. It is not a
public stats product and must not create public augment win-rate surfaces.

## Dry Run

```bash
npm run export:private-calibration:dry-run -- --input /path/to/sanitized-input.json --out-dir /tmp/mayhem-calibration
```

Input shape:

```json
{
  "collectorOffers": [],
  "collectorRoundEvents": [],
  "collectorLocalMatchContexts": [],
  "riotMatches": [{ "match": {}, "timeline": {} }]
}
```

The command writes local `.ndjson` files and does not contact BigQuery.

## Collector Event Export

Collector-event export is local-only and opt-in:

```bash
npm run export:collector-calibration:local -- \
  --enable-local-export \
  --input /path/to/safe-collector-events.json \
  --out-dir /tmp/mayhem-collector-calibration
```

Input shape:

```json
{
  "gate": { "liveCaptureAllowed": true, "phase": "InProgress" },
  "events": []
}
```

The command requires `--enable-local-export`, writes the same five NDJSON files
as the private calibration dry-run, skips incomplete OCR offers, skips all rows
when `liveCaptureAllowed` is false, and has no upload mode.

## Upload Gate

Upload is implemented but disabled by default. The default command remains
local dry-run and does not construct a BigQuery uploader or make a network
request.

## Schema Validation And Provisioning

Before any operator upload, validate the private dataset and five table schemas:

```bash
BIGQUERY_PROJECT_ID=your-project \
BIGQUERY_DATASET=your_private_dataset \
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json \
npm run bigquery:calibration:schema -- --validate
```

The command reports missing dataset, missing tables, schema mismatches, and
valid tables. It reads `scripts/bigquery/private-calibration-schema.json` as
the source of truth.

Provisioning is opt-in and creates only missing tables:

```bash
BIGQUERY_PROJECT_ID=your-project \
BIGQUERY_DATASET=your_private_dataset \
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json \
npm run bigquery:calibration:schema -- --create-missing
```

`--create-missing` does not delete tables, drop fields, loosen required fields,
or modify mismatched existing tables. Run `--validate` again after provisioning
and resolve mismatches manually before enabling upload.

Use upload mode only from an operator environment with all required secrets:

```bash
BIGQUERY_PROJECT_ID=your-project \
BIGQUERY_DATASET=your_private_dataset \
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json \
npm run export:private-calibration -- --upload --input /path/to/sanitized-input.json
```

`--upload` requires all of:

- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_DATASET`
- `GOOGLE_APPLICATION_CREDENTIALS`

Missing credentials fail closed before any network call is attempted. The
uploader accepts only already-sanitized private calibration exports and routes
rows to:

- `collector_raw.augment_offers`
- `collector_raw.round_events`
- `collector_raw.local_match_context`
- `riot_raw.match_summaries`
- `riot_derived.participant_augments`

Empty tables are skipped. Collector-event export remains local-only and has no
BigQuery upload mode.

## Privacy Boundary

Do not place raw Riot payloads, raw LCU payloads, screenshots, Riot IDs,
PUUIDs, names, chat, API keys, `.env` files, or Google service accounts in this
directory.
