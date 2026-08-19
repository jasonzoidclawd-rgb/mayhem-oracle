# Mayhem Oracle — Project Context

ARAM Mayhem decision engine: Next.js 16 PWA (App Router, TypeScript, Tailwind
v4, next-intl) + optional Tauri overlay in `overlay/`. $0 architecture: static
JSON in `public/data/`, daily GitHub Actions scrape, Vercel deploy-on-push.

## Loading Context

Read `AGENTS.md` first — operating rules, routing, the gate, task packets, and
review independence live there and are not repeated here. This file is the
Claude-specific loader plus the durable project context AGENTS.md points at.

Load, in this order, and only what the task needs:

1. `AGENTS.md`.
2. The task packet, if you were given one (`docs/task-packets/<slice>.md`).
3. The spec that governs the change — e.g.
   `docs/specs/overlay-v1-product-contract.md`. A spec outranks any
   restatement of it, including this file.
4. The skill for the work: `.agents/skills/mayhem-task` to execute,
   `.agents/skills/mayhem-review` to verify, `.claude/skills/slice-contract`
   for an operator-scoped bounded slice.
5. `docs/architecture/agent-harness.md` **only** when the task is about the
   harness itself.

Then inspect the repository rather than trusting conversation memory: recalled
state is what was true when it was written. `git status --short --branch`,
`git log --oneline -5`, and the gate are cheaper than being wrong.

## Current State

Do not record test counts, patch numbers, or tag names in this file — they go
stale between commits and cannot be acted on. Query them:

```bash
bash harness/verify-task.sh          # every suite, with exact counts
jq -r .patch public/data/meta.json
git describe --tags --abbrev=0
```

## Working Posture

- An executor stays inside the packet's paths; scope growth is a stop, not a
  judgement call.
- A reviewer is read-only and never sees the executor's reasoning transcript.
- Surface uncertainty rather than resolving it silently: say which claims are
  OBSERVED / SOURCE-PROVEN / TEST-PROVEN / INFERRED / HYPOTHESIS / UNVERIFIED,
  and never report "done" when you mean IMPLEMENTED.
- Do not push, tag, or merge unless explicitly asked.

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
- Disclosure ladder: public (`public/data/`, `/api/v1`) < member (server-gated
  via `requireActiveEntitlement`) < internal (`data/internal/`, calibration/
  model/telemetry). Enforced by `export_public_catalog.py` +
  `public-data-boundary.test.ts`; see AGENTS.md "Data Ladder & Anti-Scraping".
- Localization is data architecture: language-agnostic slugs/ids, per-locale
  display fields resolved through `src/lib/i18n/localized-name.ts`. Raw
  `.name`/`.description` renders and hardcoded `en_US` in shared paths are
  bugs (AGENTS.md "Localization Is Data Architecture").
- The update pipeline is product infrastructure: stale/partial/broken publishes
  are product outages, and freshness claims must trace to `meta.json`
  (AGENTS.md "Update Pipeline Is Product Infrastructure").
- Overlay work is compliance-sensitive: no game automation, hidden-information
  access, or client injection without explicit review.

### ARAM Mayhem augment cardinality invariant

Do not equate four augment offer rounds with four final owned augments.

- There are exactly four offer-round owners.
- One round may produce multiple final augment results.
- Final ownership representations must support at least five entries.
- Transformation chains remain within their originating round.
- Never derive round progression from final augment inventory length.

Canonical contract:
`docs/specs/overlay-v1-product-contract.md`

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
paths (`/usr/bin/diff`, `/usr/bin/grep`, `/usr/bin/wc`, `/usr/bin/git`) — the rtk shell hook
has returned wrong results for bare `diff` / `ls` / `find` / `git`.

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
- `harness/README.md` — the agent harness: gate profiles, routing, packets
- `.claude/skills/slice-contract/SKILL.md` — the bounded-slice contract:
  evidence pinning, phase reports, true-seam red tests, frozen tests, gate
  lists, terminal states. `scripts/checkpoint.sh` snapshots the worktree
  before risky work (`--help` documents the commit path).
- `GAME_MECHANICS.md` — selection mechanics, 26.12 changes, live-gate checklist
- `docs/handoffs/current-github-context.md` — recent PR/merge state to verify
  before assuming what is already on `main`.
- `docs/handoffs/overlay-current-state.md` — overlay consent/focus, collector,
  member coach, and device-auth findings.
- `docs/plans/riot-api-bigquery-discovery.md` — Riot API + BigQuery discovery
  roadmap and compliance boundaries.
- `docs/reviews/2026-07-02-architecture-review.md` — full-repo review:
  blocking findings (update-publish test gate, canonicals, telemetry patch
  stamp, English-persistence root causes) and product-owner questions.
- 26.12 rebuild ledger: phase tags `26.12-phase<N>-complete`, prompt at
  `docs/plans/patch-26.12-scoring-engine-rebuild-plan-prompt.md`
