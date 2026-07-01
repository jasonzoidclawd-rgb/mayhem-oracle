# Riot API And BigQuery Discovery Roadmap

This is a planning note for future data-platform work. It is not an
implementation plan for the current docs-only update.

## Goal

Discover which Riot API fields can safely enrich Mayhem Oracle's private model
validation and patch-drift workflows, and decide what belongs in BigQuery
without weakening privacy, compliance, or the public-data boundary.

## Discovery Targets

Match-V5 is the correct first discovery target for match context and maybe
final selected augments if Riot's payload exposes them.

Riot API is likely useful for:

- `match_id`.
- Patch/version.
- `queueId`.
- `mapId`.
- `gameMode`.
- Participants.
- Champion.
- Items.
- Spells.
- Stats.
- Timelines.

The collector remains needed for:

- Offered-but-not-picked augments.
- Round-by-round offer sets.
- Offer timing.
- OCR/confidence.

## First APIs To Probe

Probe in this order:

1. `account-v1`
2. `summoner-v4`
3. `match-v5`
4. Data Dragon
5. Game constants
6. `lol-status-v4`

Postpone:

- `spectator-v5`.
- `league-v4` and `league-exp-v4`, except optional rank context.
- Mastery/challenges personalization.
- RSO.

## BigQuery Direction

Use BigQuery for private aggregate analysis, not public raw-player display.

Candidate datasets:

- Sanitized collector round/match facts.
- Riot match context keyed by internal match id.
- Patch-drift snapshots.
- Model validation aggregates.
- Data-quality/quarantine tables.

Keep request-time app paths out of BigQuery. Admin/report pages should read
compact snapshots or already-materialized summaries rather than querying
BigQuery live.

## Privacy And Compliance

Do not store or emit:

- PUUIDs in public data.
- Player names or Riot IDs in collector exports.
- Chat.
- Screenshots.
- Public augment win-rate pages.

Avoid hidden-information guidance. Private analytics can validate and calibrate
the model, but user-facing overlay guidance must stay explainable and limited
to what the player can normally know: public patch data, player champion kit,
visible augment offers, items, and explicit multiple-choice recommendations.

## Non-Goals For First Discovery

- No gameplay automation.
- No client injection.
- No public win-rate product surface.
- No replacement for collector OCR/round facts until Riot payloads are proven
  to contain equivalent fields.
- No secrets, raw Riot payloads, or API keys committed to the repo.

## Suggested First Handoff

**Goal**
- Produce a small evidence report showing exactly which Match-V5 fields are
  present for ARAM Mayhem match samples and whether selected augments are
  exposed.

**Files In Scope**
- A temporary local script or scratch note outside committed source.
- A durable docs report only if the task explicitly asks for one.

**Verification**
- Record endpoint names, response-shape snippets, field presence/absence, and
  any API errors.
- Do not commit credentials or raw personally identifying payloads.

**Stop Conditions**
- Missing or expired Riot API key.
- Network/DNS block to Riot hosts.
- Payloads do not contain the needed source fields and would require guessing.
