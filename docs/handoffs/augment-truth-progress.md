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
