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

`--upload` is intentionally not implemented in this scaffold. A future upload
path must require all of:

- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_DATASET`
- `GOOGLE_APPLICATION_CREDENTIALS`

Missing credentials fail closed before any network call is attempted.

## Privacy Boundary

Do not place raw Riot payloads, raw LCU payloads, screenshots, Riot IDs,
PUUIDs, names, chat, API keys, `.env` files, or Google service accounts in this
directory.
