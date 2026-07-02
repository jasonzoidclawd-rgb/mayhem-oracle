# Item-Build & Real-Damage Moat (Owner decision Q3)

Decision (2026-07-02): start gathering champion × augment × item outcome data
and compute real damage multipliers. Note on scope: the Riot API does not
serve build recommendations — it serves raw match/timeline facts. The
recommendations are derived on our backend from those facts, and that
derivation (observed outcomes fused with our damage engine) is exactly the
moat. Compliance boundaries: `docs/plans/riot-api-bigquery-discovery.md`.

## What already exists (build on, don't duplicate)

- Collector telemetry already captures `itemIds`, `augmentSlugs`,
  `championSlug`, `won`, damage stats per participant
  (`src/lib/contracts/telemetry.ts`, allowlist-validated) → R2 → BigQuery
  (`ingest-telemetry.yml`), with `ingested_games` dedupe.
- Riot API scaffold: `scripts/riot/discover_matches.ts`,
  `inspect_match_schema.ts`, routing/client in `src/lib/riot/`.
- Damage engine: `src/lib/data/damage-calculations.ts` + damage-sim page
  (per-ability ratios, item modifiers) — the "theory" half of the fusion.

## Pipeline design

1. **M1 Discovery (Claude/Codex, ~small).** Confirm the ARAM Mayhem queue id
   in Match-V5; sample 20 matches; document item slots/augment fields; size
   the crawl (personal key ≈ 100 req/2min → ~2–3k matches/day: enough for
   per-champion builds at ~1–2 week half-life). Record findings in
   `docs/handoffs/riot-api-discovery-report.md`.
2. **M2 Ingestion (Codex).** Nightly workflow (pattern: `ingest-telemetry`):
   seed-crawl match ids (leaderboard/known puuids frontier), fetch Match-V5,
   sanitize to the same SafeMatchExport shape (drop puuid/riot-id — crawl
   frontier kept only as an ephemeral, never-committed working set), dedupe
   via `ingested_games`, load BigQuery. Patch stamped from `meta.json` (rule
   from the 26.12 hardcode incident).
3. **M3 Aggregation (Codex).** BigQuery job → `data/internal/item-builds.json`
   per patch: `{championSlug: {builds: [{itemIds[], games, wins, wr,
   avgDamageShare}], byAugmentClass: {...}}}` with minimum-sample gates
   (publish nothing under n=40; carry `sampleSize` always — AGENTS.md
   freshness/confidence rule). Runs as a separate cron that commits like the
   data cron; update-data step gate validates shape + sample floors.
4. **M4 Damage fusion (Claude — scoring-adjacent, parity rules apply).**
   Extend the damage engine to score an item set against a champion kit
   (AP/AD/on-hit/HP scaling from ability stats) → theoretical multiplier.
   Recommendation score = f(observed wr, sample confidence, theory score);
   surface divergence ("wins more than the math says — likely playstyle
   effect") as the editorial "why this works" input. Red tests first; if the
   overlay ever consumes it, mirror scoring twins.
5. **M5 Serving (Codex).** Member API `/api/decision/build-recommendations`
   (entitlement-gated, rate-limited like evaluate); champion-page member
   drilldown (builds + reasoning + confidence) and a public teaser (top build
   item names only — no win rates, no multipliers; extend
   `export_public_catalog.py` + boundary test in the same change).

## Ladder placement

Raw per-build win rates, multipliers, and reasoning: member. Aggregated
"popular build" names: public teaser. Raw match rows and crawl state:
internal (BigQuery only). This is the champion-page "builds" section the
2026-07-02 review deferred — it lands as member-first content.

Sequencing: M1 may start any time; M2+ after the round-2 merge. GPT-5.5
review checkpoint after M3 (data boundary + compliance) and M4 (scoring).
