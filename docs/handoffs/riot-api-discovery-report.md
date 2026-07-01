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
- Split regional routing for Account-V1 and Match-V5 probes. Account-V1 defaults
  to `asia`; Match-V5 defaults to `sea` for `tw2`/`sg2`/`vn2` platform probes
  and `americas` otherwise. The legacy `--regional` flag remains a Match-V5
  alias.

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

- Account-V1 by Riot ID succeeds on `asia`, `americas`, and `europe`.
- Account-V1 by Riot ID returns `403 Forbidden` on `sea`.
- PUUID to Match-V5 match-id discovery succeeds on `sea`.
- Match-V5 sample `TW2_404846583` was fetched from `sea`.
- The sample is regular ARAM, not ARAM Mayhem: `queueId` `450`, `gameMode`
  `ARAM`, `mapId` `12`, `gameVersion` `16.7.760.9485`.
- `playerAugment1` through `playerAugment6` field paths exist on participant
  payloads.
- Nonzero selected augment values were not proven in this regular ARAM sample;
  sanitized participant `selectedAugmentCandidates` remained empty.
- Offered-but-not-picked augments were not observed.

The safe product conclusion is unchanged until an actual ARAM Mayhem match sample
is captured: Riot API can feed private match context and has stable
`playerAugment1` through `playerAugment6` field paths, but nonzero selected
augment values for ARAM Mayhem are not yet proven. It cannot replace the
collector for offered-but-not-picked augment sets without explicit Match-V5 or
timeline evidence.

## Transform Semantics

- `selectedAugmentFieldPaths` and `hasSelectedAugmentFieldPaths` mean candidate
  `playerAugment`/augment-like participant fields exist in the payload.
- `hasSelectedAugmentValues` means sanitized participants contain nonzero
  selected augment candidate values.
- CLI `selectedAugmentsPresent` follows `hasSelectedAugmentValues`, not field
  existence.
- CLI `selectedAugmentFieldPathsPresent` exposes field existence separately.
- Mission fields are mode-specific evidence, not selected augment evidence.
- `offeredAugmentsPresent` remains based on offer/choice/option evidence.

## BigQuery Plan

Private calibration/model-validation tables:

- `riot_raw.matches`: restricted raw Match-V5 payload storage for consenting or
  policy-approved ingestion only.
- `riot_raw.timelines`: restricted raw Match-V5 timeline storage when needed.
- `riot_derived.participants`: sanitized participant-level match context,
  excluding PUUIDs, names, and account identifiers.
- `riot_derived.participant_augments`: create only if a real ARAM Mayhem
  Match-V5 sample proves nonzero selected augment values in the participant
  fields.
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
