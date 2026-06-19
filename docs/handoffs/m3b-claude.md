# Handoff: M3B Telemetry — Claude Code (in progress)

This file also carries the unblock signal Codex's M4 dispatch waits on.

## Frozen BigQuery schema (Codex M4 calibration may now start)

- Schema: `scripts/telemetry/bigquery-schema.sql`, dataset `mayhem_telemetry`.
- Contract test: `src/lib/__tests__/telemetry-schema.test.ts` pins the four
  tables and proves they are a 1:1 projection of `SafeMatchExport`
  (`src/lib/contracts/telemetry.ts`) with no identity fields.
- Tables for calibration:
  - `matches` (game_hash dedupe key, patch, queue_id=2400, duration, source, timestamps)
  - `participants` (10/match; champion_slug, augment_slugs[], item_ids[], won, KDA, damage; slot is random-per-match, no cross-match identity)
  - `contributor_round_choices` (round 1-4, offered_augment_slugs[], selected_augment_slug nullable on ambiguous OCR, ocr_confidence) — the ONLY round-ordered signal
  - `quality_quarantine` (short_match / invalid_patch / invalid_schema / ambiguous_ocr; never feeds calibration)
- Calibration rules Codex must honor (from plan Task 4): contributor round
  choices calibrate round effects; snowball final-state only calibrates final
  augment/item/champion associations + outcomes; exclude quarantine and
  sub-eight-minute matches.

## Session log

- 2026-06-13T12:40:00+08:00 — froze the BigQuery schema + contract test ahead
  of the rest of M3B (strategy Rule B: schemas freeze early) so Codex's M4
  calibration half unblocks. Cherry-picked onto `codex/model-overlay`.

BQ SCHEMAS FROZEN

## M6 integration notes (env fragility, non-blocking)
- M4 model scripts use modern syntax (`dict | None`, PEP 604) → need Python 3.10+. Pass under cron/CI (homebrew 3.14, GH Actions 3.11+); FAIL on macOS system python 3.9. CI must pin python>=3.11.
- sign_model resolves OpenSSL 3 explicitly (Codex fixed 742dc74) — macOS default LibreSSL lacks Ed25519.

## M3B COMPLETE (2026-06-13)
- Commit tip: claude/web-membership-platform @ 522ef7c (M2 + M3B).
- 3B.1 device link + ingestion: device_codes/telemetry_batches/ingested_games tables + finalize_trial_credit; parseBatch server-side allowlist re-validation (rejects identity fields anywhere); device/code+link+telemetry/upload routes (DI, Bearer token, 5MB cap, dedup, 422 on leak); R2 via aws4fetch.
- 3B.2 BigQuery: transformBatch (quarantine short/wrong-patch/ambiguous-OCR); load_bigquery.ts (CI-only) streams R2→BQ idempotently + finalizes trial credits + expires >24h reservations; ingest-telemetry.yml nightly, no-ops without secrets.
- 3B.3 ads: consent-gated AdSense (NEXT_PUBLIC_ADS_ENABLED off by default); ConsentManager + AdSlot via useSyncExternalStore; privacy page; one AdSlot on public patch-notes only.
- Verification: 226 vitest tests, tsc + eslint + web build all clean.
- New deps: aws4fetch (runtime, R2, server-only), google-auth-library (devDep, BQ loader CI-only).
- DEPLOY-TIME items the USER must provision (none block code/M6): Supabase service-role key, R2 bucket+keys, GCP BigQuery project+SA, AdSense client id, and the HOSTING DECISION (hosting-spike.md — Vercel Hobby forbids ads; recommend Cloudflare Pages when ads worth enabling).
- Contract deltas since freeze: NONE (telemetry tables are the frozen BQ schema; SafeMatchExport unchanged).

M3B COMPLETE
