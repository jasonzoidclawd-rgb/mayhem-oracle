# Collector BigQuery Private Calibration Plan

Date: 2026-07-02
Branch: `codex/collector-bigquery-private-calibration`

## Goal

Create a private calibration scaffold that can transform collector and
Riot-derived facts into local NDJSON files for future BigQuery ingestion,
without creating public augment win-rate pages or weakening collector privacy.

## Responsibilities

Collector owns:

- Offered-but-not-picked augment sets.
- Round-by-round offer evidence.
- OCR confidence and sanitized fixture provenance.
- Anonymous local match/session nonces.
- Local match context needed for calibration.

Riot Match-V5 owns:

- Match metadata.
- Queue/map/mode/version.
- Participant champion/items/spells/stats when sanitized.
- Final selected augment values only if real ARAM Mayhem samples prove nonzero
  fields exist.

Riot Match-V5 does not currently replace the collector for offered
augment sets. Existing discovery has not observed offered-but-not-picked
augments in Match-V5 or timeline payloads.

## Scaffold Files

- `src/lib/bigquery/private-calibration.ts`
- `src/lib/bigquery/private-calibration.test.ts`
- `scripts/bigquery/export-private-calibration.ts`
- `scripts/bigquery/private-calibration-schema.json`
- `scripts/bigquery/README.md`
- `docs/handoffs/bigquery-private-calibration-schema.md`

## Local Dry Run

```bash
npm run export:private-calibration:dry-run -- --input /path/to/sanitized-input.json --out-dir /tmp/mayhem-calibration
```

The command writes NDJSON locally and does not contact BigQuery by default.

## Collector Event Wiring Boundary

The local collector calibration adapter lives in:

- `src/lib/bigquery/collector-calibration.ts`

It models the safe event shape already produced by the overlay collector/OCR
flow:

- complete three-card visible augment offers;
- round-level selected augment state;
- anonymous local match context.

The adapter is root-library code, not overlay runtime upload code. It reuses the
private calibration sanitizers, skips incomplete OCR offers, skips every event
when `liveCaptureAllowed` is false, and writes only local NDJSON through the
existing dry-run export shape. Local callers can use
`buildPrivateCalibrationInputFromCollectorEvents` to turn a gated event batch
into the PR #29 `PrivateCalibrationInput` shape. The overlay remains
responsible for PR #21 window focus behavior and PR #27 live OCR capture gating;
this scaffold does not add a BigQuery client, network upload, public page, or
public endpoint.

## Local Operator Export

For development/operator validation, safe collector calibration events can be
exported locally with:

```bash
npm run export:collector-calibration:local -- \
  --enable-local-export \
  --input /path/to/safe-collector-events.json \
  --out-dir /tmp/mayhem-collector-calibration
```

The command consumes:

```json
{
  "gate": { "liveCaptureAllowed": true, "phase": "InProgress" },
  "events": []
}
```

It is disabled unless `--enable-local-export` is present, writes only local
NDJSON, and has no BigQuery or network upload mode. The input must already use
safe collector event shapes; raw OCR text, screenshots, raw LCU payloads,
identity fields, API keys, and credential fields are rejected by the adapter.

## Future Upload Gate

Future upload work must stay behind explicit credentials:

- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_DATASET`
- `GOOGLE_APPLICATION_CREDENTIALS`

If credentials are missing, upload mode must fail closed before any network
request.

## Non-Goals

- No public augment win-rate endpoint.
- No public augment win-rate page.
- No raw Riot payload persistence.
- No raw LCU payload persistence.
- No screenshots.
- No PUUIDs, Riot IDs, summoner names, chat, or account identifiers.

## Verification

- Unit tests cover collector offer/round sanitization, forbidden field
  rejection, Riot selected-field-path vs selected-value semantics, and local
  NDJSON export shape.
- Full repo verification remains `npm test`, scoped eslint, and `npm run build`.
