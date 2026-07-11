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
