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
