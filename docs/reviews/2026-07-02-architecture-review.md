# Full-Repo Architecture Review — 2026-07-02

Scope: agent-instruction hardening (AGENTS.md / CLAUDE.md / CO_WORKFLOW.md)
followed by an across-the-board review: data ladder, anti-scraping,
entitlement, localization, update pipeline, overlay/collector, telemetry,
champion-page UX, SEO, CI/release. Repo (`wasfun.lol`, private) verified at
`dde5db1` on `main`, working tree clean. Product domain: wasfun.lol.

Risk snapshot: instructions before patch MEDIUM → hardened; architecture
MEDIUM; product moat LOW-MEDIUM; localization/data HIGH; update pipeline
MEDIUM; release CONDITIONAL.

## What is verified good (this session)

- `npm test`: 38 files / 309 tests green, including `public-data-boundary`,
  `cross-parity`, `entitlements`, `overlay-packaged-data`, `i18n-messages`,
  `telemetry-*`, `ads-consent`.
- Entitlement gate fails closed (`requireActiveEntitlement`); decision +
  overlay APIs server-gated and rate-limited; trial access is a 40-min lease.
- Champion page gates member content server-side (scores/pool/matrix never
  render for non-members) — not UI-hidden.
- Public exports sanitized by `scripts/export_public_catalog.py` (forbidden
  keys, S-tier-only combo teaser ≤3/champion, emptied pool rules) and
  test-enforced.
- Supabase RLS enabled on all membership/telemetry tables; telemetry upload is
  allowlist re-validated server-side (PUUID/name/chat rejected).
- Freshness detection explicit and tested (`check_data_freshness.py`,
  `meta.json` patch + `scraped_at`), dual cron, staleness auto-issue +
  auto-retrigger.

## Blocking findings

### B1 — Daily data publish bypasses the entire test suite
`update-data.yml` commits `data/internal` + `public/data` with the default
`GITHUB_TOKEN`; such pushes do not trigger `ci.yml`, and the update job runs no
vitest/build itself. `data-integrity`, `public-data-boundary`, and parity
suites therefore never gate the daily deploy — a malformed-but-committable
scrape or a boundary regression ships straight to Vercel.
Fix (Codex): in `update-data.yml`, run `npm test` (minimum: data-integrity +
public-data-boundary + overlay-packaged-data) and `npm run build` after
regeneration and **before** the commit/push step; on failure, skip publish
(existing failure path already opens an issue).
Verify: workflow-dispatch run; confirm a seeded forbidden key aborts publish.

### B2 — Every content page canonicalizes to the locale homepage
Only `layout.tsx` + 4 static pages export `generateMetadata`.
`champions/[slug]`, champions index, augments (+`[slug]`), items, tier-list,
patch-notes, advisor inherit the layout's `alternates.canonical =
localizedUrl("/", locale)` → duplicate-content signal / deindex risk, no
localized titles. Kills the SEO/content moat.
Fix (Codex): per-page `generateMetadata` with page canonical,
`languageAlternates(path)`, localized title/description; add `/tier-list` and
`/augments/[slug]` to `sitemap.ts`.
Verify: build + inspect rendered `<link rel="canonical">` per page.

### B3 — Telemetry patch stamp hardcoded
`ingest-telemetry.yml` sets `CURRENT_PATCH: "26.12"` while live is 26.13 —
calibration rows mislabeled, freshness/sample claims corrupted downstream.
Fix (Codex): read patch from `public/data/meta.json` in the workflow or in
`scripts/telemetry/load_bigquery.ts`; fail loudly if absent.
Verify: dry-run ingest logs correct patch.

### B4 — English persistence: data-architecture root causes
1. Localized augment effect text exists internally
   (`effectTextByLocale`, CDragon-sourced, assembled by
   `assemble_augments.py`) but `export_public_catalog.py` strips it and no UI
   reads it → augment descriptions are English in all locales (public and
   member).
2. Champion page bypasses existing localized fields: `AugmentRow`/combo chips
   render `aug.name` raw; `ChampionMatrixClient` gets `augmentNames` from
   `a.name`; JSON-LD/subtitle use `champ.name`
   (`src/app/[locale]/champions/[slug]/page.tsx`).
3. `wikiDescription` (English-only source) is the preferred tooltip text
   everywhere.
4. Hardcoded English UI strings: `MECHANIC_LABEL`, ability stat pill labels,
   interaction `reason` strings from `augment-interactions.ts`.
Fix (Codex, multilingual-launch blocking): publish a sanitized per-locale
description (derive `description_<locale>` from `effectTextByLocale` at export
with lifted forbidden-key status for the localized text only), route all
name/description renders through `localizedName`/`localizedDescription`, move
pill/mechanic labels into `messages/*.json`, add fallback-detection tests.

### B5 — Site origin still defaults to the pre-rename domain
`src/lib/site.ts` falls back to `https://mayhemoracle.com`; canonical, sitemap,
robots, OG, JSON-LD all derive from it. Verify `NEXT_PUBLIC_SITE_URL=`
`https://wasfun.lol` in Vercel (human), then flip the code fallback (Codex).

## Non-blocking findings

- N1: Python pipeline tests (`scripts/test_*.py`, `scripts/model/tests/`) are
  not wired into `ci.yml` — update-pipeline failure modes untested in CI.
- N2: Locale coverage is 5 hardcoded locales vs Riot/DDragon ~27
  (`/cdn/languages.json`); suffix-column schema (`name_zh_TW`…) scales poorly.
  Full coverage needs per-locale generated files keyed patch+locale — product
  decision first.
- N3: No per-locale completeness gate in the refresh (a silent
  `enrich_locale_names.py` no-op ships all-English CJK pages while green).
  Add localized-coverage counts to the step-16 style validation gate.
- N4: `enrich_locale_names.py` uses DDragon `versions.json[0]`, which can
  drift from the scraped patch.
- N5: No `x-default` hreflang; sitemap `lastModified: new Date()` churns.
- N6: Champion page vs editorial target — no builds section, no
  "why this works" prose, freshness is a tiny label not a badge, no
  sample-size/confidence indicator, no related champions block.
- N7: Overlay installers bundle full internal catalogs (augment win rates,
  full combos, pool rules) via `overlay/scripts/sync-data.mjs`; entitlement
  gates the model manifest only. Fine while repo/artifacts are private —
  becomes the member-data leak the moment installers are distributed.
  Decision: authenticated data fetch vs accepted disclosure.
- N8: `update-data.sh` mutates `data/internal/` in place; local partial states
  recover via git only (CI promotion is the commit, which is atomic).
- N9: `ingest-telemetry.yml` carries a stale "Claude-owned (M3B)" zone comment.
- N10: In-memory rate limiting is per-instance; fine today.
- N11: Freshness upstream is arammayhem.com only.

## Handoff prompts

The executable Codex prompt and the GPT-5.5 independent-review prompt for
these findings were delivered with the 2026-07-02 review response; regenerate
from the findings above if lost. Key Codex tasks: update-workflow test gate
(B1), per-page metadata/canonicals (B2), telemetry patch stamp (B3),
localization root-cause fixes (B4), site-origin flip (B5), CI wiring for
Python pipeline tests (N1), locale-coverage gate (N3).

## Addendum — reviewer reconciliation (2026-07-02, round 2)

Codex landed the 8 tasks on `codex/update-gate-seo-locale-hardening`
(`28f2977..f2f17ff`, 316 tests green). GPT-5.5 reviewed a bundle of that
branch and returned REQUEST CHANGES. Adjudication against the repo:

**Bundle artifact, not a real gap:** GPT's "instruction hardening absent /
review file missing" — the AGENTS.md/CLAUDE.md/CO_WORKFLOW.md edits and this
review doc were uncommitted in the working tree when the bundle was cut, so
the bundle genuinely lacked them. Committed now; include them in future
bundles.

**Confirmed by code inspection (round-2 fixes):**
- R1 (high): trial leases are renewable without consumption.
  `reserveTrialCredit` (`src/lib/api/deps.ts:97-110`) re-reserves when the
  prior reservation is stale or the gameHash matches; credits are consumed
  only by `finalize_trial_credit` (telemetry-driven, ≥480s). A trial user who
  never uploads telemetry keeps overlay access indefinitely. Fix: atomic
  reserve-and-consume RPC (or count distinct reserved hashes), refund on
  verified short game — strictness is a product call.
- R2 (high): `model_releases` "active releases are readable" policy
  (`supabase/migrations/20260613_membership_platform.sql:218-220`) has no
  `to authenticated` and Supabase default grants include `anon` — the public
  anon key can read the active row incl. `package_url` + `signature` via
  PostgREST, bypassing the entitlement-gated bootstrap. Fix: base table
  service-role only (switch `getActiveRelease` to the service client), expose
  a version-only view to authenticated users.
- R3 (med): per-page `generateMetadata` sets canonical/hreflang but no
  `openGraph`/`twitter` block → og:url/og:title still inherit the locale
  homepage from the layout.
- R4 (low): `update-data.yml` still Node 20 + `npm install` vs CI Node 22 +
  `npm ci` — the new publish gate isn't running the same toolchain as CI.
- R5 (med): `npm run build` depends on fetching Inter from Google Fonts
  (`next/font/google` in `[locale]/layout.tsx`) — a network flake can now
  fail the daily publish gate. Vendor via `next/font/local`.
- R6 (med): remaining English-pinned display surfaces:
  `AdvisorMemberClient`, `CompanionClient`, `DamageCalculator`,
  `damage-sim/page.tsx` render raw champion/item names.
- R7 (low): the refresh locale gate checks zh-TW only; extend to all four
  suffixes to match the vitest thresholds.

**Refuted / by-design (no action):**
- `TierListClient.tsx:77` / `ChampionsIndex.tsx` raw `.name` — bilingual
  search matching (`c.name || localizedName(...)`) is deliberate; only the
  English-collation sort is a polish item.
- Public champion win/pick rates and the S-tier teaser — deliberate ladder
  layer, boundary-test-enforced.
- `npm run build` "failure" — sandbox had no network; build passes locally,
  in Codex's run, and on GitHub runners (R5 still worth doing).
- `--allow-partial` classification — documented graceful degradation
  (untagged champion → universal pool beats frozen data); optional: surface
  counts in the run log.

**Deferred to product owner:** overlay installers bundling internal catalogs
(Q2 below) — GPT's fix #1 is the same issue; blocked on the distribution
decision, then implement authenticated post-install data fetch.

## Product-owner questions — ANSWERED 2026-07-02

1. Riot locale coverage → **all Data Dragon locales, auto-discovered.**
   Plan: `docs/plans/2026-07-02-full-riot-locale-coverage.md` (phases L1–L5,
   after round-2 merge).
2. Overlay data exposure → **fetch on the fly behind the entitlement gate.**
   Plan: `docs/plans/2026-07-02-overlay-member-datapack.md` (signed data pack
   via bootstrap; installers ship public-layer only).
3. Champion-page builds → **build the item/damage data moat now.**
   Plan: `docs/plans/2026-07-02-item-build-damage-moat.md` (Riot Match-V5 +
   collector telemetry → BigQuery aggregation → damage-engine fusion →
   member-gated recommendations, public teaser only).
4. Site origin → **done.** `NEXT_PUBLIC_SITE_URL=https://wasfun.lol` set in
   Vercel production (2026-07-02; takes effect next deploy; wasfun.lol +
   wasfun.gg attached to the team). Remaining: flip the `src/lib/site.ts`
   fallback at round-2 merge; `NEXT_PUBLIC_CONTACT_EMAIL` still placeholder —
   owner to choose a monitored inbox.
5. Update-gate cost → **full `npm test` + build in the daily publish
   accepted** (implemented in round 1).

GPT-5.5 round-1 verdict reconciliation accepted with conditions (see
addendum); merge sequence per its guidance: round 2 lands on top of round 1,
verify R1–R7 green, merge once, bundle with `--all` for re-review.
