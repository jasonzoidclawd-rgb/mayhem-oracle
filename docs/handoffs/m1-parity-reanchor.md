# M1 Parity Fixture Re-Anchor

## Problem

`src/lib/__tests__/overlay-decision-parity.test.ts` compared four M1 frozen
decision results against the current `data/internal` snapshot. That made the
test fail after normal data refreshes even when web and overlay inference still
agreed, because champion pools, augment stats, and lifecycle flags are expected
to change over time.

The failures after the 26.12 refresh were data drift, not scoring drift. The
budget-0 `cross-parity.test.ts` remained the live web/overlay invariant.

## Decision

Use Option B from the Codex goal: pin the M1 decision-engine data used by the
golden masters.

The pinned snapshot lives at:

`docs/handoffs/fixtures/m1/decision-data-snapshot.json`

It was generated from commit
`997ebf749266bba1054f8ed5d6f920da8ceac3f9`, the commit that introduced the M1
fixtures. The snapshot includes only the two fixture champions (`brand`,
`garen`) but keeps the complete M1 augment catalog and pool rules those
champions ranked against. That preserves the frozen pool sizes, percentiles,
probabilities, and combo tiers without deriving a second pruned-pool contract.

## Why Not Auto-Regenerate

Auto-regenerating the expected `result` values during `update-data.sh` would
make CI self-heal, but it would stop being a golden master: every data refresh
would rewrite the expected answer. The test would then mostly prove that the
latest web result was copied into the fixture.

Pinning the data snapshot keeps the test stable across daily data updates while
still catching scoring or presentation drift in `runLocalInference`.

## Verification

- Red step: unskipping the four fixtures against live data failed 4/8, proving
  the old test was coupled to the current refresh.
- Snapshot proof: the pinned M1 data reproduces all four frozen fixture results
  under current inference code.
- Refresh-proof guard: the parity test mutates a cloned augment stat and proves
  the golden-master result still comes from the pinned snapshot, not refreshed
  live data.
- Targeted check: `npx vitest run src/lib/__tests__/overlay-decision-parity.test.ts`
  passes with 9/9 tests and no skipped fixture cases.

REANCHOR COMPLETE
