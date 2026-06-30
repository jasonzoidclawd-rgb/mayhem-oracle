# SP1 Pool-Add Hardening + 26.13 Ingest

## Files changed

- `scripts/assemble_augments.py` updates availability precedence so CDragon + kiwi is first-party live evidence, while current official removals/disables and real removed tombstones remain non-offerable.
- `scripts/check_data_freshness.py`, `scripts/test_check_data_freshness.py`, `.github/workflows/freshness-check.yml`, and `.github/workflows/update-data.yml` add upstream-vs-published patch drift checks and self-clearing `data-staleness` issue handling.
- `scripts/test_assemble_augments.py` adds resolver precedence, CDragon-primary, stale candidate tombstone, and patch-stamping coverage.
- `src/__tests__/augment-authority-model.test.ts` updates the guard so `confirmed_live` means first-party live; corroboration remains derived from `availability.signals`.
- `data/internal/*`, `public/data/*`, `scripts/state.json`, and `CLAUDE.md` were regenerated for patch `26.13`.

## Audited availability diff

Intentional availability flips:

- `fully-automated`: `candidate_registry_present` / `removed` -> `confirmed_live` / `active`
- `orbitallaser`: `candidate_registry_present` / `removed` -> `confirmed_live` / `active`
- `upgrade-mikaels-blessing`: `candidate_registry_present` / `removed` -> `confirmed_live` / `active`

26.13 addition:

- `dust-to-diamonds` (`DustToDiamonds`, Dust To Diamonds): added as `confirmed_live` / `active`, `win_rate: null`

No other availability/lifecycle status changes were present in the audit. `parityBudget` remains `0`.

## Verification

- `PYTHONPATH=scripts python3 -m unittest discover scripts`
- `npm test`
- `./scripts/update-state.sh`
- `npx eslint src scripts`
- `npm run build`
- `(cd overlay && npm run build)`

## Notes

- Public data still strips `win_rate`; all three flips and Dust To Diamonds are present in `public/data/augments.json` without a `win_rate` key.
- Stale contradictory tombstone bits from previously `candidate_registry_present` or `confirmed_live` rows are not carried forward as removal evidence. Rows that were truly `removed` or `disabled`, or have current official removal/disable signals, remain non-offerable.
