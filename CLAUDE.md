# Mayhem Oracle — Project Context

ARAM Mayhem decision engine: Next.js 16 PWA (App Router, TypeScript, Tailwind
v4, next-intl) + optional Tauri overlay in `overlay/`. $0 architecture: static
JSON in `public/data/`, daily GitHub Actions scrape, Vercel deploy-on-push.

## Live State

Maintained by `scripts/update-state.sh` (post-commit hook via
`scripts/install-hooks.sh`); do not hand-edit this block.

<!-- STATE:START -->
- Patch: `26.12`
- Augments: `255`
- Tests passing: `142`
- Cross-parity budget: `0` divergent champions
- Last tag: `26.12-phase3-complete`
<!-- STATE:END -->

## Operating Principles

- First principles: inspect current data/behavior before choosing a fix; the
  repo is the source of truth — don't restate what it can tell you.
- Spend tokens on uncertainty and verification, not derivable facts.
- Smallest change that meets an observable success criterion; red test first.
- Compound: leave tags, tests, fresh state, and a one-line handoff behind.

## Contracts

- Locales en / zh-TW / zh-CN / ja / ko: every user-facing string lives in all
  five `messages/*.json` (key parity is test-enforced). Internal locale-routed
  links use `@/i18n/navigation`, not `next/link`.
- 26.12 removed augment sets/traits. Historical `set` labels never affect
  scoring. Augment classes: `type` = ability / quest / standalone.
- Web ↔ overlay scoring parity: the cross-parity suite at budget 0 IS the
  contract (`src/lib/__tests__/cross-parity.test.ts`). Scoring twins in
  `src/lib/scoring/` and `overlay/src/scoring/` differ only by their types
  import path — edit both sides together.
- `public/data/` is generated — never hand-edit. `scripts/update-data.sh`
  owns the snapshot/restore of curated fields.
- Overlay work is compliance-sensitive: no game automation, hidden-information
  access, or client injection without explicit review.

## Verification

```bash
npm test
npx eslint src scripts
npm run build
(cd overlay && npm run build)
```

(Bare `npm run lint` also crawls `.worktrees/*/.next` noise — scope it.)
Rust changes additionally need a release build plus a binary timestamp check;
`cargo check` alone is insufficient:

```bash
cd overlay && npx tauri build 2>&1 | tail -5
stat -f "%Sm %N" src-tauri/target/release/mayhem-oracle-overlay
```

rtk caveat: when command output is verification evidence, use absolute tool
paths (`/usr/bin/diff`, `/usr/bin/grep`, `/usr/bin/wc`) — the rtk shell hook
has returned wrong results for bare `diff` / `ls` / `find`.

## Data Pipeline

`npm run update-data` (daily cron 22:00 UTC): snapshot curated fields → scrape
arammayhem + CDragon + DDragon + wiki → restore → classify (deterministic
fallback keeps no-key CI reproducible; optional Groq/LiteLLM enrichment uses
`CLASSIFIER_URL` / `CLASSIFIER_MODEL`) → breaker validation gate → generate
pool rules. Ownership: `flags.lifecycle` is
scraper-owned (live NEW/DELETED badges), `kit_tags` classifier-owned,
system breakers a curated list enforced in three places (classifier,
update-data step gate, data-integrity test).

## Pointers

- `AGENTS.md` — agent operating rules · `CO_WORKFLOW.md` — Claude/Codex handoffs
- `GAME_MECHANICS.md` — selection mechanics, 26.12 changes, live-gate checklist
- 26.12 rebuild ledger: phase tags `26.12-phase<N>-complete`, prompt at
  `docs/plans/patch-26.12-scoring-engine-rebuild-plan-prompt.md`
