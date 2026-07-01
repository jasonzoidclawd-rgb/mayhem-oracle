# Riot API + BigQuery Discovery Report

Date: 2026-07-01
Branch: `codex/riot-api-bigquery-discovery`

## Scope

This is discovery/scaffold work only. It does not change overlay runtime behavior,
SP1/SP2 freshness logic, generated public data, or public stats pages.

The scaffold supports:

- Account-V1 Riot ID to PUUID lookup when a consenting test account is supplied.
- Match-V5 match id discovery by PUUID.
- Match-V5 match detail inspection.
- Optional Match-V5 timeline inspection.
- Sanitized schema summaries for fields containing `augment`, `playerAugment`,
  `perk`, `cherry`, `mayhem`, or `mission`.

Raw Riot payloads can contain PUUID/name data and must stay local. The repository
now ignores local Riot discovery scratch payload patterns.

## Endpoints

Implemented endpoint helpers:

- `riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}`
- `lol/match/v5/matches/by-puuid/{puuid}/ids`
- `lol/match/v5/matches/{matchId}`
- `lol/match/v5/matches/{matchId}/timeline`
- `lol/status/v4/platform-data`

## Match-V5 Augment Answer

Current repository scaffold can prove selected-augment presence when supplied an
ARAM Mayhem Match-V5 detail payload. It records candidate field paths separately
from normal rune/perk paths and removes identity-bearing participant fields from
derived output.

Live Match-V5 conclusion for this run:

- Live endpoint check: `lol/status/v4/platform-data` succeeded for `tw2`, proving
  the exported key was present and accepted for at least the status endpoint.
- Match-V5 live probe: `TW2_427286604` returned `403 Forbidden` on the `sea`
  regional route.
- Regional fallback probe: the same match id returned `404 Not Found` on `asia`,
  `americas`, and `europe`, which indicates `sea` is the only plausible regional
  route for this match id.
- Selected augments: not proven from live Match-V5 because match detail access was
  forbidden.
- Exact selected-augment field paths: not observed in a live ARAM Mayhem match in
  this run.
- Offered-but-not-picked augments: not observed in this run and should remain
  collector-owned unless Match-V5/timeline evidence proves otherwise.
- Observed `queueId`/`gameMode`/`mapId`: not available because Match-V5 detail
  returned `403 Forbidden`.

The safe product conclusion is unchanged until live match evidence is captured:
Riot API may feed private match context and, if fields exist, final selected
augment picks. It cannot replace the collector for offered-but-not-picked
augment sets without explicit Match-V5/timeline evidence.

## BigQuery Plan

Private calibration/model-validation tables:

- `riot_raw.matches`: restricted raw Match-V5 payload storage for consenting or
  policy-approved ingestion only.
- `riot_raw.timelines`: restricted raw Match-V5 timeline storage when needed.
- `riot_derived.participants`: sanitized participant-level match context,
  excluding PUUIDs, names, and account identifiers.
- `riot_derived.participant_augments`: create only if Match-V5 proves final
  selected augment fields exist.
- `collector_raw.augment_offers`: remains collector-owned for offered-but-not-
  picked augment sets, offer timing, OCR confidence, and round-by-round evidence.

Environment variables reserved for later ingestion wiring:

- `RIOT_API_KEY`
- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_DATASET`
- `GOOGLE_APPLICATION_CREDENTIALS`

## Compliance Notes

- Private calibration and model validation only.
- No public augment win-rate pages.
- No hidden-information guidance.
- No decision-dictation product language.
- Do not commit Riot keys, raw Riot payloads with PUUID/name data, local raw JSON
  samples, or BigQuery credentials.
