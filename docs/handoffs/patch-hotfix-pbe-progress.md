# Patch / Hotfix / PBE Pipeline Rebuild Progress

## Step 0 — baseline (2026-07-11)

- Work is isolated from the dirty root checkout in a detached worktree at the
  draft PR head `d2cbb98`. The PR branch itself is concurrently locked by its
  spec-authoring worktree, so commits will be pushed explicitly to
  `worktree-patch-hotfix-pbe-pipeline` after final verification.
- Baseline: `npm test` passed (60 files, 445 tests), `npx eslint src scripts`
  passed, `npm run build` passed, `public-data-boundary.test.ts` passed, and
  `python3 scripts/test_augment_base_catalog.py` passed.
- Existing hotfix fixture: the committed 246-row
  `data/internal/cdragon-mayhem-augments.json` self-diffs to exactly
  `{"added":[],"changed":[],"removed":[]}` under the current detector.
  Snapshot SHA-256: `5ac4eac43bf4d0390e2cac4cca354d5ffc4c90e68cf3802d76acf5c0b720b7d2`.
- The root checkout's initial build failed only because the isolated worktree
  had no local dependencies and Turbopack inferred the parent checkout as its
  root. `npm ci --offline --ignore-scripts` installed the locked dependencies
  in the worktree; the same build then passed without repository changes.

## Execution note

The approved spec calls for a Claude approval stop after each commit. This
execution environment has no callable Claude review gate, while the caller
explicitly directed continuous implementation through verification, push, and
draft-PR update. Each step's evidence is recorded here and local tests remain
the gate; no architecture or disclosure-boundary requirement is being waived.

## Steps 1–2 — shared engine and entity adapters (2026-07-11)

- Added `cdragon_snapshot_diff.py`: stable normalized snapshots, canonical-ID
  comparisons, deterministic event ordering, duplicate/schema/coverage/version
  rejection, PBE lifecycle reconciliation, bounded public PBE projection, and
  journaled rollback-safe multi-file promotion.
- Added explicit adapters for augments, champions, and items. Champion ability
  effect and coefficient arrays must have a named `mDataValues` mapping; an
  unknown positional shape is rejected rather than emitted as a noisy diff.
- Refactored `scrape_mayhem_augments_cdragon.py::diff_augments` to project from
  the shared comparator while retaining its existing `added`/`removed`/
  `changed` delta shape. The Step 0 committed snapshot self-diff remains
  exactly `{"added":[],"changed":[],"removed":[]}`.
- Evidence: `python3 scripts/test_cdragon_snapshot_diff.py` (13 tests),
  `python3 scripts/test_augment_base_catalog.py` (4 tests), and Python syntax
  compilation all pass.

## Step 3 — live and PBE lineages (2026-07-11)

- Added `cdragon_patch_pipeline.py`, which acquires all three entity sources
  for one branch before building an in-memory transaction. It writes the three
  lineage snapshots plus the matching event archive together through the
  journaled rollback path.
- `latest` and `pbe` have separate canonical files:
  `cdragon-{augment,champion,item}-{latest,pbe}.json`. Source version,
  branch/lane, patch label, observed timestamp, comparison base/target, and
  canonical ID persist with every event.
- A PBE version regression starts a new PBE lineage and ages the old upcoming
  entries rather than manufacturing removal events. Missing/malformed source
  payloads raise actionable diagnostics before any promotion; they never fall
  back to the other lane.
- Live source check: latest is
  `16.13.7915903+branch.releases-16-13.content.release`; PBE is
  `16.14.7942794+branch.releases-16-14.content.release` (one patch ahead).
  The real initial promotion created 246 augment, 173 champion, and 705 item
  rows per lane; 11 active PBE preview events were detected, while the live
  lane correctly established a zero-event baseline.
- Evidence: `python3 scripts/test_cdragon_patch_pipeline.py` (6 tests),
  `python3 scripts/test_cdragon_snapshot_diff.py` (13 tests),
  `python3 scripts/test_augment_base_catalog.py` (4 tests), and source
  reachability HTTP 200 all pass.

## Steps 4–6 — lifecycle, projection, UI, and cadence (2026-07-11)

- PBE lifecycle reconciliation is source-value based: the same canonical ID,
  change class, and target value must appear in latest before a preview is
  marked landed. Repeated polls do not duplicate it; PBE resets age it out.
- The prose scraper is now 148 lines and writes `patch-metadata.json` only.
  The 1,183-line entity parser, old `data/internal/patch-notes.json`, old
  augment-only hotfix snapshots/feed, their public export, and their UI
  consumer were removed. Tombstones and augment lifecycle now read
  `patch-events.json`.
- `export_public_catalog.py` is the single projection boundary. It publishes
  the current live event cycle to the existing patch-card contract and only
  active PBE events to `public/data/pbe-preview.json`; raw snapshots,
  comparison provenance, lifecycle archive, and scoring fields stay internal.
  The boundary suite now checks that PBE is absent from scoring-facing catalogs,
  the public API, and client loader.
- `/patch-notes` now has a server-rendered `Coming in PBE` lane with canonical
  links only for live entities, fresh/stale/unavailable states, day-level
  detected-at indicators, live-hotfix badges, and source-reconciled
  `Landed from PBE` badges. PBE remains display-only.
- Added a six-hour `update-pbe-preview.yml` workflow and a shared workflow
  concurrency group to prevent races with the daily full refresh.
- Documentation: `docs/operations/cdragon-patch-pipeline.md` covers authority,
  storage, rollover, recovery, public boundary, and operator commands.
- Evidence: `npm test` passed (61 files, 448 tests); scoped ESLint passed;
  `npm run build` passed with the existing five patch-detail locale routes;
  public-boundary, scraper, projection, snapshot, lifecycle, augment-assembly,
  and patch-publish fixture tests all passed. Browser automation was unavailable
  in this session (no connected in-app browser backend), so no visual claim is
  made beyond the successful production static build.

## Independent review and hardening (2026-07-12)

- Reviewed the GitHub PR from base `7ed1c1b` against head `39d5633`; current
  `main` had advanced to `70069cc` and GitHub reported the PR conflicting.
  Integrated current `main` with the sole legacy-snapshot delete conflict
  resolved in favor of the intentional removal.
- Fixed and red-tested current-cycle preview projection, canonical-ID landing,
  version-regression ordering, stale live-baseline handling, PBE publish-file
  inclusion, promotion locking, bounded source reads, and malformed item rows.
- Localized PBE event text and live/PBE freshness states across all five
  message files. Sanitized CDragon markup/template tokens before rendering.
- Production-equivalent QA used headed system Chrome through the local server
  at `http://localhost:3104`: desktop `1440x900`, mobile `390x844`, and all
  five locales. Each route returned 200, rendered 11 PBE events, had one h1,
  no horizontal overflow, canonical entity links, keyboard Tab focus, no page
  errors, and no requests for `data/internal` or server-only PBE loaders.
  Full-page screenshots were captured outside the repository at
  `/private/tmp/patch-notes-en-desktop-full.png` and
  `/private/tmp/patch-notes-en-mobile-full.png`.
- The in-app Browser backend and managed agent-browser CLI were unavailable;
  the CLI registry fallback failed with `ENOTFOUND`. Headed system Chrome was
  used as the supported local fallback. Chrome emitted only existing external
  icon-preload warnings; no application errors or page errors occurred.

## Merge and entity-presentation follow-up (2026-07-13)

- Product-owner approval was recorded for merging PR #38 only at its reviewed
  conflict-resolution head `9b6571d7974110bc54b4ceeb85e29b5fb2f88931`.
  The PR was merged into `main` as `bf605c4dab3357846bce436b51c88149fc599b25`
  ([PR #38](https://github.com/jasonzoidclawd-rgb/wasfun.lol/pull/38)). CI,
  the Windows overlay workflow, and the Vercel checks were green at merge;
  the post-merge CI and overlay runs also completed successfully.
- The product owner accepted the documented transition limitation: the new
  live lane starts at a clean baseline and historical backfill remains
  deferred. No additional historical content was restored or exposed.
- `followup/entity-presentation` was rebased onto the merged `origin/main`.
  The rebased feature commits are `2c6624f` (presentation surfaces) and
  `0927009` (verification state); route-contract hardening and generated
  projections are pending in the follow-up draft PR.
- The follow-up changes make `route_identifier` and `known` projection-owned
  fields. Regular items use numeric IDs, Mayhem-exclusive items use the exact
  existing slug route, and CDragon-only Locke remains unlinked until a real
  generated champion page exists. Forged By The Master (ID 2127) has a
  regression fixture proving stale removal tombstones clear when latest
  promotes the entity.
- Production smoke after the merge returned 200 for the English and
  Traditional Chinese patch notes, patch 26.13, and Forged By The Master
  routes. Live SEO verification passed 31/31 and JSON-LD verification passed
  15/15. Follow-up browser-equivalent navigation followed every emitted link
  in the English and Traditional Chinese index/card surfaces with zero 404s;
  the in-app Browser backend was unavailable, so the supported Playwright
  fallback was used and screenshots remain outside the repository under
  `/private/tmp/entity-qa/`.
