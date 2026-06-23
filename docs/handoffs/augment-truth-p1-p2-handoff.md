# Augment Truth Resourcing P1 -> P2 Handoff

Date: 2026-06-23 (Asia/Taipei)
Branch: `codex/augment-truth`
Status: P1 complete, awaiting Claude independent verification and human push gate.

## P1 Result

Phase 1 moved augment identity and definition authority off arammayhem:

- CDragon is canonical for augment identity, rarity, icons, locale names, tooltip/effect text, and available structured values.
- Wiki is the readable effect text plus Notes and availability-note feed.
- arammayhem is isolated to `win_rate` only and cannot create augments or set definition fields.
- Availability is resolved from source signals. Registry presence alone is not live.
- Offerable is exactly `availability.status === "confirmed_live"`.
- Public data strips internal augment fields while preserving public item `wikiNotes` used by item pages.

## Current Availability Counts

Source: `data/internal/augments.json`

| status | count | scoring / pool behavior |
| --- | ---: | --- |
| `confirmed_live` | 139 | offerable, enters combos and champion augment pools |
| `candidate_registry_present` | 28 | non-offerable until corroborated |
| `disabled` | 4 | non-offerable |
| `removed` | 25 | non-offerable tombstone/history |
| `unverified_legacy` | 64 | non-offerable quarantine for P2 review |
| `conflict` | 0 | no current unresolved source conflicts |

Notable resolved decisions:

- `jeweled-gauntlet` and `vulnerability` are `confirmed_live` because current CDragon + wiki truth overrides the stale arammayhem-sourced retirement.
- `slow-and-steady` is `candidate_registry_present`, therefore non-offerable.
- `upgrade-sword-of-blossoming-dawn` is `removed`, therefore non-offerable and absent from combos/pools.
- `ARAM_MissingPingAugment` remains registry-present placeholder data and is not confirmed live.

## P2 Worklist

1. Verify the 64 `unverified_legacy` rows against live-game evidence, official notes, wiki history, and/or telemetry. They are quarantined, not deleted.
2. Review the 28 `candidate_registry_present` rows. Promote only with corroboration such as wiki, official patch notes, or future observed-live telemetry.
3. Keep the 4 `disabled` wiki-noted rows non-offerable unless a later source confirms re-enable:
   `clown-college`, `devil-on-your-shoulder`, `perseverance`, `quantum-computing`.
4. Decide the future observed-live mechanism:
   it should become an availability resolver signal (`observed_live` / `observed_bug_mechanism`), not a downstream pool override.
5. Build the separate item-build-order / augment-to-item recommendation milestone. P1 preserved item rich data and public item notes, but the engine still does not recommend item build order.
6. Continue enriching structured numeric values for Mayhem-only augments where CDragon lacks `dataValues`; Tencent/wiki are likely Phase 2/3 enrichment sources.

## Verification Evidence

Full gate:

- `npm test` -> 28 files passed, 257 tests passed.
- `npx eslint src scripts` -> exit 0.
- `npm run build` -> exit 0, 3321 static pages generated.
- `(cd overlay && npm run build)` -> exit 0.

Targeted invariants:

- `scripts/update-state.sh` -> `patch=26.12 augments=260 tests=257 parity=0 tag=26.12-phase3-complete`.
- Public item rows with `wikiNotes`: 171.
- Public item forbidden internal-field hits: 0.
- Public augment forbidden internal-field hits: 0.
- Internal combos: 5622 rows, 0 non-`confirmed_live` references.
- Internal pool-rules: non-offerable statuses stay out of active pools.

## Files To Review Closely

- `scripts/assemble_augments.py`
- `scripts/export_public_catalog.py`
- `scripts/update-data.sh`
- `src/lib/scoring/pool-orchestrator.ts`
- `overlay/src/scoring/pool-orchestrator.ts`
- `src/lib/decision/evaluate.ts`
- `overlay/src/decision/evaluate.ts`
- `src/__tests__/augment-authority-model.test.ts`
- `src/lib/__tests__/data-integrity.test.ts`
- `src/lib/__tests__/pool-orchestrator.test.ts`
- `data/internal/augment-reconciliation-report.json`

P1 COMPLETE
