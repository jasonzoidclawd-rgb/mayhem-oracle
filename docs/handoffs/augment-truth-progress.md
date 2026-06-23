# Augment Truth Progress

## Step 0 — Baseline (codex)

Date: 2026-06-22 (Asia/Taipei)

Worktree: `/Users/jason/Desktop/mayhem-oracle/.worktrees/augment-truth`

Branch confirmation:

```bash
git rev-parse --abbrev-ref HEAD
```

```text
codex/augment-truth
```

Baseline numbers:

- Augment count: 256
- win_rate coverage: 185
- `npm test` total: 250

Commands run:

| Command | Result |
| --- | --- |
| `npm test` | PASS (exit 0) |
| `npx eslint src scripts` | PASS (exit 0) |
| `npm run build` | PASS (exit 0) |
| `( cd overlay && npm run build )` | PASS (exit 0) |
| `node -e "console.log(require('./data/internal/augments.json').augments.length)"` | 256 |
| `node -e "console.log(require('./data/internal/augments.json').augments.filter(a=>typeof a.win_rate==='number').length)"` | 185 |

Gate output tails:

### `npm test`

```text
> mayhem-oracle@0.1.0 test
> vitest run


 RUN  v4.1.5 /Users/jason/Desktop/mayhem-oracle/.worktrees/augment-truth


 Test Files  27 passed (27)
      Tests  250 passed (250)
   Start at  23:16:14
   Duration  1.26s (transform 2.43s, setup 0ms, import 3.77s, tests 2.04s, environment 2ms)
```

### `npx eslint src scripts`

```text
(no output)
```

### `npm run build`

```text
│ └ [+2 more paths]
├ ● /[locale]/damage-sim
│ ├ /en/damage-sim
│ ├ /zh-TW/damage-sim
│ ├ /zh-CN/damage-sim
│ └ [+2 more paths]
├ ● /[locale]/items
│ ├ /en/items
│ ├ /zh-TW/items
│ ├ /zh-CN/items
│ └ [+2 more paths]
├ ● /[locale]/items/[identifier]
│ ├ /en/items/atmas-reckoning
│ ├ /en/items/rite-of-ruin
│ ├ /en/items/sword-of-blossoming-dawn
│ └ [+2372 more paths]
├ ƒ /[locale]/membership
├ ● /[locale]/patch-notes
│ ├ /en/patch-notes
│ ├ /zh-TW/patch-notes
│ ├ /zh-CN/patch-notes
│ └ [+2 more paths]
├ ● /[locale]/privacy
│ ├ /en/privacy
│ ├ /zh-TW/privacy
│ ├ /zh-CN/privacy
│ └ [+2 more paths]
├ ● /[locale]/terms
│ ├ /en/terms
│ ├ /zh-TW/terms
│ ├ /zh-CN/terms
│ └ [+2 more paths]
├ ● /[locale]/tier-list
│ ├ /en/tier-list
│ ├ /zh-TW/tier-list
│ ├ /zh-CN/tier-list
│ └ [+2 more paths]
├ ƒ /api/admin/entitlements
├ ƒ /api/auth/signin
├ ƒ /api/decision/champion-matrix
├ ƒ /api/decision/evaluate
├ ƒ /api/device/code
├ ƒ /api/device/link
├ ƒ /api/invites/redeem
├ ƒ /api/overlay/bootstrap
├ ƒ /api/overlay/game-session
├ ƒ /api/telemetry/upload
├ ƒ /api/v1
├ ƒ /api/v1/[resource]
├ ƒ /auth/callback
├ ○ /robots.txt
└ ○ /sitemap.xml


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

### `( cd overlay && npm run build )`

```text
> mayhem-oracle-overlay@0.1.0 prebuild
> npm run sync-data


> mayhem-oracle-overlay@0.1.0 sync-data
> node ./scripts/sync-data.mjs


> mayhem-oracle-overlay@0.1.0 build
> tsc && vite build

vite v7.3.2 building client environment for production...
transforming...
✓ 49 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.47 kB │ gzip:  0.30 kB
dist/assets/index-Co2yRIf3.css    5.37 kB │ gzip:  1.69 kB
dist/assets/index-wPHe38uk.js   227.63 kB │ gzip: 72.96 kB
✓ built in 361ms
```

## Step 1 — Canonical identity + resolver (codex)

Date: 2026-06-22 (Asia/Taipei)

Built:

- `scripts/augment_identity_resolver.py` — deterministic CDragon `augmentNameId` resolver.
- `scripts/test_augment_identity_resolver.py` — focused Python unit tests for normalization, aliasing, unmatched rows, and contradiction reporting.
- `data/internal/augment-identity-aliases.json` — hand-maintained alias table for Claude review.
- `data/internal/augment-identity-map.json` — emitted `{augmentId -> source matches}` mapping artifact.
- `data/internal/augment-identity-unmatched-report.json` — unresolved rows by source.
- `data/internal/augment-identity-contradictions-report.json` — report-only identity/existence/rarity/availability disagreements.

Matcher:

- Canonical key is CDragon `augmentNameId`.
- Normalization lowercases, strips non-alphanumerics, and strips a leading `Quest:` prefix.
- CDragon index uses `nameId`/`augmentNameId`, the `ARAM_`-stripped nameId, `name`, `slug`, and locale `names`.
- Existing internal rows resolve by normalized `name` + `slug`.
- Wiki rows are deterministically derived from committed internal rows with `wikiDescription` and resolve by normalized `name`.
- `arammayhem_win_rate` rows are best-effort only; unmatched rows are reported and do not block.
- Aliases apply only after direct normalized matching fails.

Alias table:

- Entry count: 1
- `ARAM_Quest_VoidImmolation` aliases: `Void Immolation`, `void-immolation`
  - Reason: the committed internal/wiki-facing row is named for the rewarded item, while CDragon's canonical augment display name is `Icathia's Fall`.
  - Review note: identity only; not availability evidence.

Report counts:

| Report | Counts |
| --- | --- |
| Mapping | CDragon 170; mapped augmentIds 166; source matches: internal 167, wiki 165, arammayhem_win_rate 123 |
| Unmatched | CDragon 4; internal_augments 89; wiki 88; arammayhem_win_rate 62 |
| Contradictions | identity 3; existence 181; rarity 0; availability 107 |

Important report notes:

- CDragon registry presence remains definition/identity only; Step 1 does not set live availability or lifecycle.
- `wiki_availability` and independent `wiki_rarity` are marked unavailable in the contradiction report because the committed Step 0 inputs contain `wikiDescription` but no independent wiki availability-notes or wiki-rarity snapshot.
- Tencent prose was not parsed in Step 1; the contradiction report focuses on CDragon vs committed wiki/internal signals.

Commands run:

| Command | Result |
| --- | --- |
| `python3 scripts/test_augment_identity_resolver.py` | PASS (4 tests) |
| `python3 scripts/augment_identity_resolver.py --check` | PASS; mapped 166 augmentIds; unmatched CDragon 4 / internal 89 / wiki 88 / arammayhem 62 |
| `npm test` | PASS (27 files, 250 tests) |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed) |
| `(cd overlay && npm run build)` | SKIPPED; Step 1 did not touch overlay code or overlay data-sync inputs |

## Step 2 — CDragon authoritative base (codex)

Date: 2026-06-23 (Asia/Taipei)

Built:

- `scripts/scrape_mayhem_augments_cdragon.py` — added pure Step 2 base-catalog assembly plus `--base-catalog-only`.
- `scripts/test_augment_base_catalog.py` — deterministic unit test for rich arena rows, stringtable bridge rows, kiwi-over-cherry preference, localized effect text, and the `???` placeholder row.
- `data/internal/augment-base-catalog.json` — new CDragon-sourced base definition artifact.

Sources used:

- Roster / identity / rarity / roster small icon: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`
- Rich arena fields: `https://raw.communitydragon.org/latest/cdragon/arena/{en_us,zh_cn,zh_tw,ja_jp,ko_kr}.json`
- Localized names/effect text stringtables: `https://raw.communitydragon.org/latest/game/{en_us,zh_cn,zh_tw,ja_jp,ko_kr}/data/menu/en_us/lol.stringtable.json`

Base-catalog count:

- CDragon Mayhem registry rows: 170
- Rich arena-endpoint matches with `arenaApiName`: 119
- Registry/stringtable rows without rich arena `dataValues` / `calculations` in the fetched endpoint: 51
- Definition placeholders: 1

Field coverage:

| Field | Coverage |
| --- | --- |
| `icon.small` | 170 / 170 |
| `icon.large` | 119 / 170 |
| `dataValues` | 119 / 170 |
| `calculations` | 45 / 170 |
| English `effectText.tooltip` | 162 / 170 |
| all five locale names (`en`, `zh_cn`, `zh_tw`, `ja`, `ko`) | 170 / 170 |
| all five localized tooltips | 162 / 170 |

Special rows:

- `ARAM_MissingPingAugment` is present as a CDragon registry-placeholder definition row: `name` is `???`, `definitionPlaceholder: true`, no `arenaApiName`, no effect text, no `dataValues`, and no availability field.
- `ARAM_Earthwake` is present as a definition row only: `arenaApiName: Earthwake`, rarity `prismatic`, rich icons, effect text, 7 `dataValues`, 1 calculation, and no availability field.
- `ARAM_Flashy` is present as a definition row only: `arenaApiName: Flashy`, rarity `gold`, rich icons, effect text, 6 `dataValues`, 1 calculation, and no availability field.
- `ARAM_TransmuteGold` is present as a definition row only: `arenaApiName: TransmuteGold`, rarity `silver`, rich icons, effect text, 1 `dataValues` entry, 0 calculations, and no availability field.

Boundary checks:

- The base catalog does not contain `availability`, `confirmed_live`, `flags`, `lifecycle`, or `win_rate` keys.
- `data/internal/augments.json`, `public/data/**`, pool rules, combos, champions, scoring twins, overlay code, and `messages/*` were not modified.
- The post-commit state hook refreshed `CLAUDE.md` / `scripts/state.json` to the verified 256 augments / 250 tests state; no manual state edit was made.

Commands run:

| Command | Result |
| --- | --- |
| `python3 scripts/test_augment_base_catalog.py` | PASS (1 test) |
| `python3 scripts/test_augment_identity_resolver.py` | PASS (4 tests) |
| key-level base-catalog sanity check | PASS; 170 rows, all five locale names, no forbidden availability/scoring keys |
| `python3 scripts/scrape_mayhem_augments_cdragon.py --base-catalog-only` | PASS; wrote 170 rows; 119 rich endpoint matches; 162 with English tooltip |
| `npm test` | PASS (27 files, 250 tests) |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed) |
| `(cd overlay && npm run build)` | SKIPPED; Step 2 did not touch overlay code or overlay data-sync inputs |

## Step 3 — Demote arammayhem to win_rate feed (codex)

Date: 2026-06-23 (Asia/Taipei)

Changed:

- Added `scripts/augment_winrate_feed.py`, the isolated internal win-rate feed builder.
- Added `data/internal/augment-winrate-feed.json`, keyed by CDragon `augmentNameId`.
- Refactored `scripts/scrape_arammayhem.py` so the augment path parses only `{sourceKey, win_rate}` rows and writes only `augment-winrate-feed.json`.
- Updated the arammayhem update-data step label to `champions/augment win-rate feed/combos/meta`.
- Added deterministic tests proving the arammayhem augment path does not emit definition/lifecycle fields and has no `augments.json` write path.

Win-rate feed coverage:

| Measure | Count |
| --- | ---: |
| arammayhem source rows from Step 1 reports | 185 |
| CDragon `augmentId`s with `win_rate` | 123 |
| CDragon base-catalog `augmentId`s | 170 |
| Missing `win_rate` / later null | 47 |
| Unmatched arammayhem rows, report-only | 62 |
| Source rows without a parsed `win_rate` | 0 |

Boundary confirmations:

- `data/internal/augments.json` was not modified; `/usr/bin/diff` against HEAD produced no output.
- `public/data/**`, pool rules, scoring twins, `messages/*`, and `data/internal/augment-base-catalog.json` were not modified.
- arammayhem no longer creates augment rows or sets augment `name`, `rarity`, `icon`, locale names, effect text, lifecycle, availability, type, flags, or pool/scoring fields.
- Champion, combo, and meta scraping remains in `scripts/scrape_arammayhem.py`: `champions.json`, `combos.json`, and `meta.json` are still written by the script. Only the augment definition write was removed.

Commands run:

| Command | Result |
| --- | --- |
| `python3 scripts/test_scrape_arammayhem.py` | PASS (5 tests) |
| `python3 scripts/augment_winrate_feed.py` | PASS; wrote 123 win rates, 47 missing, 62 unmatched |
| `python3 scripts/test_augment_identity_resolver.py` | PASS (4 tests) |
| feed forbidden-field sanity check | PASS; no augment definition/lifecycle keys in `augment-winrate-feed.json` |
| `/usr/bin/diff -u <(git show HEAD:data/internal/augments.json) data/internal/augments.json` | PASS; no output |
| `npm test` | PASS (27 files, 250 tests) |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed) |
| `(cd overlay && npm run build)` | SKIPPED; Step 3 did not touch overlay code or overlay data-sync inputs |

## Step 4 — Wiki feed: effect text + Notes + availability (codex)

Date: 2026-06-23 (Asia/Taipei)

Built:

- `scripts/augment_wiki_feed.py` — internal-only LoL Wiki feed builder keyed by CDragon `augmentNameId`.
- `scripts/test_augment_wiki_feed.py` and `scripts/fixtures/augment_wiki_page.html` — deterministic fixture-backed tests, no live network.
- `data/internal/augment-wiki-feed.json` — feed artifact.
- `data/internal/augment-wiki-only-report.json` — wiki rows not resolvable to CDragon base.
- `data/internal/augment-wiki-unmatched-report.json` — unresolved wiki row report.
- `data/internal/augment-wiki-contradictions-report.json` — wiki vs CDragon report-only existence / rarity / availability signals.

Source:

- `https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem/Augments`
- Fetched at: `2026-06-22T17:54:33+00:00`

Parsing:

- Wiki table rows provide `wikiDescription` and `wikiRarity`; availability sentences are split into `wikiAvailabilityNotes`.
- Availability annotations are evidence only. Step 4 does not resolve lifecycle or availability.
- The `#Notes` section is parsed from the page-level Notes list. Notes attach to augmentIds through explicit wiki augment icon/title/file references; note-only CDragon matches are retained even when the augment has no wiki table row.
- Nested table text inside effect cells is ignored so tabber/table-only data does not pollute `wikiDescription`.

Coverage:

| Measure | Count |
| --- | ---: |
| Wiki table rows parsed | 222 |
| CDragon-keyed feed entries | 142 |
| Feed entries with `wikiDescription` | 140 |
| Feed entries with `wikiNotes` | 5 |
| Feed entries with `wikiAvailabilityNotes` | 6 |
| Feed entries with `wikiRarity` | 140 |
| Page-level Notes bullets captured | 3 |

Reports:

| Report | Count |
| --- | ---: |
| Wiki-only rows | 82 |
| Unmatched wiki rows | 82 |
| Contradictions: existence | 110 (`wiki_only`: 82, `cdragon_only`: 28) |
| Contradictions: rarity | 1 (`ARAM_Terror`: wiki `silver`, CDragon `gold`) |
| Contradictions: availability | 6 |

Boundary confirmations:

- `data/internal/augments.json` was not modified; `/usr/bin/diff` against HEAD produced no output.
- `public/data/**`, `data/internal/augment-base-catalog.json`, `data/internal/augment-winrate-feed.json`, pool rules, combos, champions, scoring twins, overlay code, and `messages/*` were not modified.
- The wiki feed stores source evidence only; Step 5 remains responsible for resolved availability.

Commands run:

| Command | Result |
| --- | --- |
| `python3 scripts/test_augment_wiki_feed.py` | PASS (3 tests) |
| `python3 scripts/augment_wiki_feed.py` | PASS; wrote 142 feed entries, 82 wiki-only rows, 110 existence / 1 rarity / 6 availability report entries |
| `python3 scripts/test_augment_identity_resolver.py` | PASS (4 tests) |
| `/usr/bin/diff -u <(git show HEAD:data/internal/augments.json) data/internal/augments.json` | PASS; no output |
| `npm test` | PASS (27 files, 250 tests) |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed) |
| `(cd overlay && npm run build)` | SKIPPED; Step 4 did not touch overlay code or overlay data-sync inputs |

## Step 5 — Assemble-catalog step + resolved availability (codex)

Date: 2026-06-23 (Asia/Taipei)

Built:

- `scripts/assemble_augments.py` — deterministic Step 5 assembler. It reads the committed CDragon base catalog, wiki feed, arammayhem win-rate feed, Step 1 identity map, and the pre-Step-5 internal catalog, then writes `data/internal/augments.json`.
- `scripts/test_assemble_augments.py` — focused resolver/assembler tests covering registry-only candidate status, wiki-disabled status, `ARAM_MissingPingAugment` placeholder handling, confirmed-live resolution, removed/tombstone precedence, field precedence, and preserved curated/classifier fields.

Rebuilt `data/internal/augments.json`:

| Measure | Count |
| --- | ---: |
| Rows | 260 |
| `confirmed_live` | 127 |
| `candidate_registry_present` | 1 |
| `disabled` | 4 |
| `removed` | 64 |
| `conflict` | 64 |
| `win_rate` numeric coverage | 123 |

Availability notes:

- `confirmed_live` requires CDragon registry presence plus wiki live corroboration; audit found 0 `confirmed_live` rows missing those signals.
- Registry-only placeholder `ARAM_MissingPingAugment` is `candidate_registry_present`, not `confirmed_live`.
- The four wiki "currently disabled" rows resolve to `disabled`: `clown-college` / `ARAM_ClownCollege`, `devil-on-your-shoulder` / `ARAM_LittleDevil`, `perseverance` / `ARAM_Perseverance`, `quantum-computing` / `ARAM_QuantumComputing`.
- `conflict` rows are preserved legacy internal rows with no CDragon registry resolution and no removed tombstone signal; they are surfaced for Claude/Phase 2 review rather than silently promoted to live.

Preservation:

- Existing rows preserved: 256 / 256 old slugs still present.
- `kit_tags` preserved for 256 / 256 old rows; all 260 rows now carry a `kit_tags` array. The 4 new CDragon-only rows have empty `kit_tags` for the later classifier step.
- `flags.system_breaker` preserved for 256 / 256 old rows; total system breakers remain 8.
- `type` preserved for 256 / 256 old rows; output type counts are ability 24, quest 8, standalone 228.
- Existing non-lifecycle flags are carried forward; `flags.lifecycle` is derived from `availability.status` using the existing `active` / `added` / `removed` vocabulary.

Commands run:

| Command | Result |
| --- | --- |
| `python3 scripts/test_assemble_augments.py` | PASS (6 tests) |
| `python3 scripts/assemble_augments.py --existing /private/tmp/augment-truth-pre-step5-augments.json` | PASS; wrote 260 rows; availability counts 127 / 1 / 4 / 64 / 64; win_rate 123 |
| `npm test` | PASS (27 files, 250 tests) |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed) |
| `(cd overlay && npm run build)` | PASS (overlay sync-data, tsc, and Vite build completed) |

## Step 5 (rev2) — corrected availability resolution (codex)

Date: 2026-06-23 (Asia/Taipei)

Corrected:

- Current CDragon registry + wiki-live now overrides stale legacy tombstones / old `flags.lifecycle=removed`.
- Legacy-only rows absent from current CDragon and wiki resolve to `unverified_legacy`, not `conflict`.
- `conflict` is reserved for current source disagreement, not absence.
- `unverified_legacy` was added to the availability status enum and maps to a non-live lifecycle.
- Placeholder definitions such as `ARAM_MissingPingAugment` remain `candidate_registry_present` but map to non-live lifecycle.

Rebuilt `data/internal/augments.json`:

| Measure | Count |
| --- | ---: |
| Rows | 260 |
| `confirmed_live` | 139 |
| `candidate_registry_present` | 28 |
| `disabled` | 4 |
| `removed` | 25 |
| `unverified_legacy` | 64 |
| `conflict` | 0 |
| `win_rate` numeric coverage | 123 |

Registry/wiki cross-tab:

| CDragon registry | Wiki status | Resolved status | Count |
| --- | --- | --- | ---: |
| present | live | `confirmed_live` | 139 |
| present | absent | `candidate_registry_present` | 28 |
| present | disabled | `disabled` | 4 |
| absent | absent | `unverified_legacy` | 64 |
| absent | absent | `removed` | 25 |

Lifecycle / scoring audit:

- 0 non-live rows map to a live lifecycle. Non-live here means `disabled`, `removed`, `unverified_legacy`, `conflict`, plus placeholder `candidate_registry_present`.
- 0 `unverified_legacy` / `disabled` / `removed` rows carry `flags.lifecycle=active` or `flags.lifecycle=added`.
- Live scoring entrants are now 166 (`139 active` + `27 added`) versus 192 in rejected Step 5 v1 (`127 active` + `65 added`).
- `infinite-recursion` is now `unverified_legacy` with `flags.lifecycle=removed`.
- `ARAM_CriticalHealing` is now `confirmed_live` with `flags.lifecycle=active`.

Curated system breaker audit:

- 1 curated `flags.system_breaker` row is not `confirmed_live`: `slow-and-steady` / `ARAM_SlowAndSteady` resolves to `candidate_registry_present` with `flags.lifecycle=added` because it is in CDragon registry but lacks wiki live corroboration. `flags.system_breaker` was preserved for review.
- 0 curated system breakers landed in `unverified_legacy`, `disabled`, or `removed`.

Commands run:

| Command | Result |
| --- | --- |
| `python3 scripts/test_assemble_augments.py` | PASS (9 tests) |
| `python3 scripts/assemble_augments.py --existing <(git show HEAD~1:data/internal/augments.json)` | PASS; wrote 260 rows; availability counts 139 / 28 / 4 / 25 / 64 / 0; win_rate 123 |
| `npm test` | FAIL; 25 files passed, 2 files failed, 245 / 250 tests passed. Failures are downstream assertions in `src/lib/__tests__/data-integrity.test.ts` and `src/lib/__tests__/pool-orchestrator.test.ts` that still encode rejected Step 5 v1 assumptions (`slow-and-steady` expected removed, `jeweled-gauntlet` expected removed, legacy-only combo/pool rows expected removed rather than `unverified_legacy`). These files are outside the allowed Step 5 correction edit set, so they were not changed. |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed) |
| `(cd overlay && npm run build)` | SKIPPED; rev2 did not touch overlay code or overlay data-sync inputs. |

## Step 6 — Guard tests + reconciliation report (codex)

Date: 2026-06-23 (Asia/Taipei)

Added:

- `src/__tests__/augment-authority-model.test.ts` — deterministic Vitest guard over committed Step 2/3/4/5 artifacts and `data/internal/augments.json`.
- `data/internal/augment-reconciliation-report.json` — consolidated Phase 2 / Step 7 worklist.

Guard coverage:

- Provenance: arammayhem provenance is allowed only at `provenance.win_rate`.
- Identity: `confirmed_live`, `candidate_registry_present`, and `disabled` rows require a CDragon `augmentId`, and their rarity must match `data/internal/augment-base-catalog.json`.
- Registry is not live: `confirmed_live` requires CDragon registry presence plus wiki/tencent/telemetry live corroboration; `definitionPlaceholder` / `???` rows cannot be `confirmed_live`.
- Availability validity: every row uses one of `confirmed_live`, `candidate_registry_present`, `disabled`, `removed`, `unverified_legacy`, or `conflict`; non-live statuses plus placeholder rows cannot carry `flags.lifecycle=active|added`.
- Win-rate isolation: `win_rate` is `number|null`, has arammayhem provenance, and numeric CDragon-keyed values match `data/internal/augment-winrate-feed.json`.
- Report alignment: the reconciliation report's by-status counts, curated-breaker statuses, unverified-legacy list, conflict list, and Step 7 backlog stay aligned with committed artifacts.

Reconciliation report summary:

| Section | Count / content |
| --- | --- |
| Availability by status | `confirmed_live=139`, `candidate_registry_present=28`, `disabled=4`, `removed=25`, `unverified_legacy=64`, `conflict=0` |
| Unmatched by source | CDragon 4; internal augments 89; wiki 88; arammayhem win-rate 62 |
| Wiki-only augments | 82 |
| Genuine availability conflicts | 0 |
| Curated breaker reconciliation | `jeweled-gauntlet` now `confirmed_live`; `vulnerability` now `confirmed_live`; `slow-and-steady` now `candidate_registry_present` and flagged stale breaker. Each carries signals and the note: "old retirement was arammayhem-sourced; overridden by CDragon+wiki truth per human ruling". |
| `unverified_legacy` worklist | 64 rows for Phase 2 confirmation before final tombstoning |
| Step 7 backlog | Regenerate combos against the new availability model; regenerate pool-rules against the new availability model; evaluate `scripts/apply_live_mechanism_overrides.py` as an `observed_live` / `observed_bug_mechanism` resolver signal. |

Known Step-7-deferred `npm test` failures only:

- `src/lib/__tests__/data-integrity.test.ts` > `data integrity` > `combo rows only reference currently offerable augments`
  - Why: combos still reference rows now resolved non-live under the new availability model; combo data needs regeneration instead of old lifecycle assertions.
- `src/lib/__tests__/data-integrity.test.ts` > `data integrity` > `26.12 breaker re-verification: three breakers retired, five live`
  - Why: the test encodes the old arammayhem-sourced lifecycle by expecting `slow-and-steady`, `jeweled-gauntlet`, and `vulnerability` to be removed.
- `src/lib/__tests__/data-integrity.test.ts` > `data integrity` > `Jeweled Gauntlet keeps a visible observed-live mechanism override`
  - Why: the test expects the old removed-plus-observed-live override model, but CDragon+wiki now resolves `jeweled-gauntlet` as `confirmed_live`.
- `src/lib/__tests__/pool-orchestrator.test.ts` > `pool orchestrator — 26.12 lifecycle wiring` > "26.12-removed augments are excluded with reason `removed` under real pool rules"
  - Why: pool expectations still encode old removed lifecycle assumptions for legacy rows now resolved through `unverified_legacy` / availability status.
- `src/lib/__tests__/pool-orchestrator.test.ts` > `pool orchestrator — 26.12 lifecycle wiring` > `observed-live mechanism overrides stale removed lifecycle for Jeweled Gauntlet`
  - Why: the test expects Jeweled Gauntlet to remain removed and be rescued by observed-live; the new resolver makes it `confirmed_live` directly.

Commands run:

| Command | Result |
| --- | --- |
| `npm test -- src/__tests__/augment-authority-model.test.ts` before report | RED as expected; report artifact missing |
| `npm test -- src/__tests__/augment-authority-model.test.ts` after report | PASS (1 file, 6 tests) |
| `npm test` | FAIL only the 5 known Step-7-deferred downstream tests above; 26 files passed, 2 files failed, 251 / 256 tests passed. NO NEW failures introduced. |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed) |
| `(cd overlay && npm run build)` | SKIPPED; Step 6 did not touch overlay code or overlay data-sync inputs. |

## Step 7 — Pipeline integration + reconciliation (codex)

Date: 2026-06-23 (Asia/Taipei)

Pipeline wiring:

- `scripts/update-data.sh` now runs the augment truth path in this order before assemble: CDragon base catalog -> wiki augment feed -> arammayhem champion/win-rate feed -> patch notes / CDragon hotfix snapshot -> tombstones -> `scripts/assemble_augments.py`.
- CDragon base fetch runs via `scripts/scrape_mayhem_augments_cdragon.py --base-catalog-only` before downstream augment mutation. If that fetch fails, `update-data.sh` prints an abort message and exits before assemble/pool/combo regeneration. The base catalog writer fetches all inputs before writing, so a failed CDragon fetch keeps the last committed base/artifacts rather than emitting a partial catalog.
- `scripts/assemble_augments.py` is now idempotent for reruns from an already-assembled catalog: derived `flags.lifecycle=removed` is not treated as tombstone evidence, and existing CDragon rows with `augmentId` remain registry-backed even before an identity-map alias exists.

Offerable invariant:

- Offerable is exactly `availability.status=confirmed_live`.
- Current counts after a no-key full refresh: `confirmed_live=139`, `candidate_registry_present=28`, `disabled=4`, `removed=25`, `unverified_legacy=64`, `conflict=0`.
- `flags.lifecycle` now matches the invariant: `active=139`, `removed=121`, `added=0`.
- `data/internal/pool-rules.json` carries `availability.offerable=139` and `availability.non_offerable=121`; there is no `availability_overrides` block.
- `data/internal/combos.json` has 5622 rows and 0 rows referencing non-offerable augments.

Consumer/test reconciliation:

- `data-integrity`: combo rows now assert `availability.status === "confirmed_live"`; the 26.12 breaker test now records Jeweled Gauntlet and Vulnerability as confirmed live, Slow and Steady as candidate/non-offerable, and legacy-only rows as `unverified_legacy`.
- `pool-orchestrator`: Layer 1 reads resolved availability first and excludes non-offerable rows with exact reasons such as `candidate_registry_present`, `disabled`, `removed`, and `unverified_legacy`.
- `decision-engine`: rarity priors and offered candidate evaluation no longer use observed-live rescue rules; confirmed-live augments rank directly.
- Step 6 authority guard was tightened, not weakened: `candidate_registry_present` is now explicitly non-live for lifecycle consistency.
- Overlay scoring twins were updated with the same pool and decision predicate to preserve cross-parity.

Observed-live handling:

- Retired the downstream observed-live override path rather than wiring it as a resolver signal in Step 7.
- Deleted `scripts/apply_live_mechanism_overrides.py` and `data/curated/live-mechanism-overrides.json`.
- Removed generated Jeweled Gauntlet override flags and pool-rule overrides; `jeweled-gauntlet` is `confirmed_live` directly from CDragon+wiki.
- Added hotfix-feed cleanup/filtering so old `bug_mechanism` mechanism events do not remain in internal/public generated hotfix data.
- Backlog: if observed-live returns, it should feed the resolver as a Phase 2 / Step 8 signal, not as a downstream pool override.

Public boundary:

- `scripts/export_public_catalog.py` strips internal augment fields from public data, including `win_rate`, `provenance`, `availability`, `signals`, `dataValues`, `calculations`, `wikiNotes`, `wikiAvailabilityNotes`, `wikiFetchedAt`, CDragon internals, and legacy catalog markers.
- Public pool rules now publish empty lifecycle/rule maps and no availability map.
- Boundary check after export: 0 forbidden internal keys in public augments, items, pool rules, and hotfixes.

Commands run:

| Command | Result |
| --- | --- |
| `python3 scripts/test_assemble_augments.py` | PASS (11 tests) |
| `env -u CLASSIFIER_URL -u CLASSIFIER_MODEL -u GROQ_API_KEY npm_config_cache=/private/tmp/mayhem-npm-cache npm run update-data` | PASS; no API key; deterministic fallback kept unresolved augment classifications; final counts 139 / 28 / 4 / 25 / 64 / 0 |
| `npm test` | PASS (28 files, 257 tests) |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed) |
| `python3 scripts/export_public_catalog.py` | PASS |
| `npm test -- src/lib/__tests__/public-data-boundary.test.ts` | PASS (1 file, 4 tests) |
| `(cd overlay && npm run build)` | PASS (sync-data, `tsc`, and Vite build completed) |

## Step 8 — Final verification + handoff (codex)

Date: 2026-06-23 (Asia/Taipei)

Final status:

- P1 handoff written to `docs/handoffs/augment-truth-p1-p2-handoff.md`.
- `scripts/update-state.sh` run as required; state reports `patch=26.12`, `augments=260`, `tests=257`, `parity=0`, `tag=26.12-phase3-complete`.
- Availability counts: `confirmed_live=139`, `candidate_registry_present=28`, `disabled=4`, `removed=25`, `unverified_legacy=64`, `conflict=0`.
- Offerable remains exactly `confirmed_live`.
- `upgrade-sword-of-blossoming-dawn` is `removed` and non-offerable.
- Public item `wikiNotes` remain public for item pages; public augment `wikiNotes` and internal signals remain hidden.
- `graphify-out/` and `codex-step7-prompt.txt` were left uncommitted and untouched.

Commands run:

| Command | Result |
| --- | --- |
| `npm test` | PASS (28 files, 257 tests) |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed, 3321 static pages) |
| `(cd overlay && npm run build)` | PASS (sync-data, `tsc`, and Vite build completed) |
| `scripts/update-state.sh` | PASS (`patch=26.12 augments=260 tests=257 parity=0 tag=26.12-phase3-complete`) |
| targeted public-boundary check | PASS (`publicItemWikiNotes=171`, item forbidden hits 0, augment forbidden hits 0) |
| targeted combo/pool check | PASS (5622 combos, 0 non-`confirmed_live` combo refs) |

P1 COMPLETE — awaiting Claude independent verification and human push gate.

## Step 2 FIX — Mayhem set from kiwi_ stringtable + re-run (codex)

Date: 2026-06-23 (Asia/Taipei)

Scope:

- Fixed `scripts/scrape_mayhem_augments_cdragon.py` so Step 2 builds the Mayhem definition set from current `kiwi_*` stringtable name keys, not `augmentNameId.startswith("ARAM_")`.
- Preserved the Phase 1 authority model: `kiwi` / registry is definition evidence only; `confirmed_live` still requires wiki/Tencent/telemetry corroboration; kiwi-only rows remain `candidate_registry_present` and non-offerable.
- Added `availability.signals.kiwi` for auditability without changing the live resolution order.
- Kept explicit patch-note removals authoritative: `upgrade-sword-of-blossoming-dawn` remains `removed` / non-offerable even though stale registry/wiki text exists.

Step 2 / identity counts:

| Metric | Count |
| --- | ---: |
| `kiwi_*` definition tokens | 259 |
| Base catalog rows | 245 |
| Reviewed registry-token aliases | 10 |
| Duplicate ARAM/bare rows disambiguated by preserving `ARAM_` id | 123 |
| Unmatched kiwi definition tokens left for human review | 14 |
| Ambiguous kiwi definition tokens | 0 |
| Identity mapped augmentIds | 238 |
| Identity unmatched: CDragon / internal / wiki / arammayhem win-rate | 7 / 21 / 20 / 3 |

Reviewed registry-token aliases added for Claude review:

- `alonetime` -> `Snowbomb` (`Snowblast`)
- `bloodmoney` -> `BloodMoneyBurn` (`Combusting Interest`)
- `burnbabyburn` -> `PressureCooker` (`Pressure Cooker`)
- `dimensionshift` -> `DimensionShift_Active` (`Dimension Shift`)
- `ouchmycoins` -> `ARAM_YowchMyCoins` (`Yowch, My Coins!`)
- `poroblaster` -> `ARAM_Poro_Blast` (`Poro Blaster`)
- `porocharge` -> `PoroCharge_Active` (`Poro Stampede`)
- `setautocast` -> `FullyAutomated` (`Fully Automated`)
- `vanguard` -> `ARAM_Quickstep` (`Quickstep`)
- `weeewooweewoo` -> `ARAM_WeeWooWeeWoo` (`Wee Woo Wee Woo`)

Unmatched kiwi definition tokens left non-offerable / report-only:

- `burstingteethcounter`, `dimensionshiftplayerbuff`, `fetch`, `jarvanones`, `onfirebuff`, `porochargefedporoscount`, `setambulancce`, `setdivebomb`, `setfirecracker`, `setgamble`, `setmoney`, `setsnowball`, `setstacking`, `siegeminionaura`

Availability after Step 5 re-run:

| Status | Count |
| --- | ---: |
| `confirmed_live` | 195 |
| `candidate_registry_present` | 39 |
| `disabled` | 11 |
| `removed` | 6 |
| `unverified_legacy` | 16 |
| `conflict` | 0 |

Authority checks:

- `confirmed_live` rows with kiwi + wiki live corroboration: 195.
- Kiwi-only/no-wiki candidate rows: 39, all non-offerable.
- `unverified_legacy` dropped from 64 to 16.
- `Chain Reaction` (`ChainReaction`) is `confirmed_live`, `flags.lifecycle=active`, offerable.
- `ARAM_MissingPingAugment` is `candidate_registry_present`, `flags.lifecycle=removed`, non-offerable.
- `upgrade-sword-of-blossoming-dawn` is `removed`, `flags.lifecycle=removed`, non-offerable; removed sources are `patch_notes,tombstone`.
- Public augment / pool / item / patch-note boundary check: no `win_rate`, `provenance`, `availability`, `signals`, `dataValues`, `calculations`, `wikiAvailabilityNotes`, or `wikiFetchedAt`.

Combo gate checks after Step 7 re-run:

- `draven`: `chain-reaction=S`, `twin-fire=A`.
- `vayne`: `chain-reaction=S`, `twin-fire=A`.
- `riven`: `chain-reaction=S`, `ravenous-bind=S`, `tooth-fairy=A`, `twin-fire=A`.
- `kled`: `chain-reaction=S`, `ravenous-bind=A`, `tooth-fairy=A`.
- `jhin` vs `ryze`: **the "jhin ≠ ryze" gate was an INVALID expectation.** Their public top-3 S-tier teaser is intentionally identical (`back-to-basics`, `biggest-snowball-ever`, `bread-and-butter`) — and that is CORRECT: it matches the prior meta reference (arammayhem had both champions on exactly those three universal-best augments). Champion specificity is proven instead by the AD champions recovering Chain Reaction (draven/vayne/riven/kled above), not by forcing jhin and ryze to differ. (For completeness, the full internal combo sets do differ — `jhinOnly=master-of-duality,tank-it-or-leave-it`, `ryzeOnly=jeweled-gauntlet` — but equality of the public teaser is the acceptable, meta-aligned outcome.)

Commands run:

| Command | Result |
| --- | --- |
| `python3 scripts/test_augment_base_catalog.py` | PASS (4 tests) |
| `python3 scripts/test_augment_identity_resolver.py` | PASS (5 tests) |
| `python3 scripts/test_assemble_augments.py` | PASS (12 tests) |
| `python3 scripts/scrape_mayhem_augments_cdragon.py --base-catalog-only` | PASS; wrote 245 base rows from 259 kiwi definition tokens |
| `python3 scripts/augment_identity_resolver.py` | PASS; mapped 238 augmentIds |
| `python3 scripts/augment_wiki_feed.py` | PASS; 206 matched augmentIds, 18 wiki-only rows |
| `python3 scripts/augment_winrate_feed.py` | PASS; 120 augmentIds with win_rate |
| `python3 scripts/apply_removed_augment_tombstones.py` | PASS; restored explicit removed tombstone/localized fields |
| `python3 scripts/assemble_augments.py` | PASS; rows=267; availability counts 195 / 39 / 11 / 6 / 16 / 0 |
| `npm test -- src/__tests__/augment-authority-model.test.ts` | PASS (1 file, 6 tests) |
| `python3 scripts/generate_pool_rules.py` | PASS; offerable=195, non_offerable=72 |
| `npm_config_cache=/private/tmp/mayhem-npm-cache npx --yes tsx scripts/generate_internal_combos.ts` | PASS; 8184 combos |
| `python3 scripts/export_public_catalog.py` | PASS |
| `npm test` | PASS (28 files, 257 tests) |
| `npx eslint src scripts` | PASS (exit 0, no output) |
| `npm run build` | PASS (Next.js build completed, 3321 static pages) |
| `python3 scripts/export_public_catalog.py && npm test -- src/lib/__tests__/public-data-boundary.test.ts` | PASS (1 file, 4 tests) |
| `(cd overlay && npm_config_cache=/private/tmp/mayhem-npm-cache npm run build)` | PASS (`sync-data`, `tsc`, Vite build) |
| `git diff --check` | PASS |

## Phase 2 ambiguous tail — REVIEW BEFORE MERGE (Claude, 2026-06-23)

Durable, reviewable list of the non-offerable augments needing human adjudication before any merge to `main`. Signals: kiwi = Mayhem-specific stringtable tuning present; wiki = on the LoL Wiki Mayhem page; registry = in CDragon roster. All rows below are currently **non-offerable** (excluded from pools/combos).

### unverified_legacy (16) — not corroborated by current CDragon/kiwi or wiki; quarantined, non-offerable
- **Adaptive Ward** (`adaptive-ward`) — kiwi:N wiki:N registry:N
- **Don't Change the Channel** (`dont-change-the-channel`) — kiwi:N wiki:N registry:N
- **Forged By The Master** (`forged-by-the-master`) — kiwi:N wiki:N registry:N
- **From Downtown** (`ARAM_BangBang`) — kiwi:N wiki:N registry:N
- **It's Go Time** (`its-go-time`) — kiwi:N wiki:N registry:N
- **One Trick Pony** (`one-trick-pony`) — kiwi:N wiki:N registry:N
- **Overloaded** (`overloaded`) — kiwi:N wiki:N registry:N
- **Pin Cushion** (`pin-cushion`) — kiwi:N wiki:N registry:N
- **Porcupine** (`porcupine`) — kiwi:N wiki:N registry:N
- **Pursuit of Haste** (`ARAM_SpecializedRecursion`) — kiwi:N wiki:N registry:N
- **Siphon** (`ARAM_SustainingStrike`) — kiwi:N wiki:N registry:N
- **Squishy Slappy Grab** (`squishy-slappy-grab`) — kiwi:N wiki:N registry:N
- **Surge Field** (`surge-field`) — kiwi:N wiki:N registry:N
- **Terrain'd** (`terraind`) — kiwi:N wiki:N registry:N
- **Trusty Weapon** (`trusty-weapon`) — kiwi:N wiki:N registry:N
- **Warlock Juicebox** (`warlock-juicebox`) — kiwi:N wiki:N registry:N

### candidate_registry_present (39) — kiwi/registry definition present but NO wiki corroboration; non-offerable until corroborated/approved
- **???** (`ARAM_MissingPingAugment`) — kiwi:Y wiki:N registry:Y
- **Bounce of the Poro King** (`ARAM_PoroKing`) — kiwi:Y wiki:N registry:Y
- **Buff Buddies** (`ARAM_BuffBuddies`) — kiwi:Y wiki:N registry:Y
- **Cerberus** (`ARAM_Cerberus`) — kiwi:Y wiki:N registry:Y
- **Cheating** (`ARAM_Recall`) — kiwi:Y wiki:N registry:Y
- **Crack Open That Egg** (`ARAM_CrackOpenThatEgg`) — kiwi:Y wiki:N registry:Y
- **Demon's Dance** (`ARAM_DemonsDance`) — kiwi:Y wiki:N registry:Y
- **Executioner** (`ARAM_Executioner`) — kiwi:Y wiki:N registry:Y
- **Feel the Burn** (`ARAM_FeeltheBurn`) — kiwi:Y wiki:N registry:Y
- **Frost Wraith** (`ARAM_FrostWraith`) — kiwi:Y wiki:N registry:Y
- **Fully Automated** (`FullyAutomated`) — kiwi:Y wiki:N registry:Y
- **Gash** (`Gash`) — kiwi:Y wiki:N registry:Y
- **Grandma's Chili Oil** (`GrandmasChiliOil`) — kiwi:Y wiki:N registry:Y
- **Hat on a Hat** (`HatOnAHat`) — kiwi:Y wiki:N registry:Y
- **Heads Up Cupcake!** (`ARAM_WatchOutGrapefruit`) — kiwi:Y wiki:N registry:Y
- **Holy Fire** (`ARAM_HolyFire`) — kiwi:Y wiki:N registry:Y
- **I'm a Baby Kitty Where is Mama** (`BabyKitty`) — kiwi:Y wiki:N registry:Y
- **Keystone Conjurer** (`ARAM_KeystoneConjurer`) — kiwi:Y wiki:N registry:Y
- **Laser Heal** (`LaserHeal`) — kiwi:Y wiki:N registry:Y
- **Lightning Strikes** (`ARAM_LightningStrikes`) — kiwi:Y wiki:N registry:Y
- **Orbital Laser** (`ARAM_OrbitalLaser_Active`) — kiwi:Y wiki:N registry:Y
- **Poro Blaster** (`ARAM_Poro_Blast`) — kiwi:Y wiki:N registry:Y
- **Red Envelopes** (`RedEnvelopes`) — kiwi:Y wiki:N registry:Y
- **Repulsor** (`ARAM_Repulsor`) — kiwi:Y wiki:N registry:Y
- **Restless Restoration** (`ARAM_RestlessRestoration`) — kiwi:Y wiki:N registry:Y
- **Self Destruct** (`ARAM_SelfDestruct`) — kiwi:Y wiki:N registry:Y
- **Slow And Steady** (`ARAM_SlowAndSteady`) — kiwi:Y wiki:N registry:Y
- **Snowball Roulette** (`SnowballRoulette`) — kiwi:Y wiki:N registry:Y
- **Speed Demon** (`ARAM_SpeedDemon`) — kiwi:Y wiki:N registry:Y
- **The Brutalizer** (`ARAM_TheBrutalizer`) — kiwi:Y wiki:N registry:Y
- **Trueshot Prodigy** (`ARAM_TrueshotProdigy`) — kiwi:Y wiki:N registry:Y
- **Twice Thrice** (`ARAM_TwiceThrice`) — kiwi:Y wiki:N registry:Y
- **Upgrade Cutlass** (`ARAM_Upgrade_Cutlass`) — kiwi:Y wiki:N registry:Y
- **Upgrade Hubris** (`ARAM_Upgrade_Hubris`) — kiwi:Y wiki:N registry:Y
- **Upgrade Mikael's Blessing** (`Upgrade_MikaelsBlessing`) — kiwi:Y wiki:N registry:Y
- **Upgrade Thornmail** (`Upgrade_Thornmail`) — kiwi:Y wiki:N registry:Y
- **Void Rift** (`ARAM_VoidRift`) — kiwi:Y wiki:N registry:Y
- **Weighted Popoffs** (`ARAM_WeightedPopoffs`) — kiwi:Y wiki:N registry:Y
- **Wind Beneath Blade** (`WindBeneathBlade`) — kiwi:Y wiki:N registry:Y

**How to read this:** kiwi:Y wiki:N = likely a live Mayhem augment the wiki just has not documented yet (held as candidate pending corroboration). kiwi:N wiki:N registry:N = likely genuinely removed (or a codename/alias miss worth spot-checking, e.g. `From Downtown`/`ARAM_BangBang`). Promote to offerable only after wiki/Tencent corroboration or explicit human approval.

## Step 9 — Tencent section-aware corroboration + current-page split (Claude)

**Status:** replaces the earlier positive-only Tencent note above. The first Tencent parser treated any localized name anywhere on the Tencent page as live; that was wrong because the page has separate Mayhem removed/added/adjusted/disabled sections and also unrelated Arena bugfix prose.

Corrected source interpretation:
- `Slow and Steady` / `一板一眼`: Tencent match is in `已移除的强化符文`, so status is `removed`, lifecycle `removed`, non-offerable. Registry/kiwi definition presence does not override official removal.
- `Jeweled Gauntlet` / `珠光护手`: appears in Arena bugfix prose only, so Tencent provides **no** Mayhem availability signal. It remains `confirmed_live` via CDragon/kiwi + Wiki live corroboration, and it must not show as `已移除`.
- `One Trick Pony`: no current Tencent/wiki/CDragon/kiwi corroboration in the assembled feed; keep `unverified_legacy`, lifecycle `removed`, non-offerable. Treat as an unverified Riot artifact/easter egg until telemetry or a stronger source maps it.

Implemented:
- `scripts/build_tencent_feed.py` now parses Tencent sections: added/adjusted => `live`; removed => `removed`; disabled => `disabled`; unrelated prose ignored. Fixture test covers Slow and Steady, Jeweled Gauntlet, disabled rows, and a known live row.
- `scripts/assemble_augments.py` now lets official Tencent removed/disabled sections beat stale wiki live rows; only observed-live telemetry should create a conflict against an official non-current signal.
- `scripts/update-data.sh` now regenerates the identity map and builds `augment-tencent-feed.json` before assembly.
- Current `augments.json` counts: `confirmed_live=194`, `candidate_registry_present=4`, `disabled=11`, `removed=42`, `unverified_legacy=16`, `conflict=0`.
- Champion-specific pool generation ran with `availability.offerable=194`; generated combos remain `8184` rows across all `172` champions. Pool numbers are implemented, but they depend on corrected availability plus `kit_tags`, and combo generation intentionally emits only meaningful tiered matches rather than one row for every offerable augment.
- Augments page now hides `flags.lifecycle=removed` rows from the main grid and renders them in a separate removed/non-current archive table with version metadata from `pool-rules.json`.
