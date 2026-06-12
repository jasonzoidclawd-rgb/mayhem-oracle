# Codex dispatch — current assignment: Milestone 1

You are Codex, co-implementing the Mayhem Oracle membership platform.
Contract: `docs/superpowers/plans/2026-06-13-claude-codex-split-implementation.md`.
Working agreement: `docs/superpowers/plans/2026-06-13-claude-codex-split-strategy.md`.
Baseline: `docs/handoffs/platform-baseline.md` (M0 done; 110 tests green on main).

FIRST, before any work:
- If `docs/handoffs/m1-codex.md` exists and its last line is `M1 COMPLETE`,
  print "M1 already complete" and exit with no changes.
- You are in the worktree `.worktrees/decision-engine-foundation` on branch
  `codex/decision-engine-foundation`. Verify with `git status`. Never switch
  branches, never push or commit to main, never touch the main checkout's
  working tree.
- If `node_modules` is missing here, run `npm install` and
  `(cd overlay && npm install)` first.

Hard boundaries (Claude Code owns these — do not edit): `supabase/**`,
`src/lib/entitlements/**`, `src/app/api/**`, web components under
`src/components/**` except files you create, `messages/*.json`, root
`package.json`/`package-lock.json`. Never hand-edit generated files under
`public/data/` (regenerate via scripts). Do not modify
`public/data/patch-notes.json` anywhere.

TASK: Execute Milestone 1 exactly per the plan — Tasks 1.1 (red contract and
grade tests), 1.2 (v1 decision model), 1.3 (internal/public data split), 1.4
(web/overlay parity). Red tests first. One commit per task with `[M1]` in the
message. Tick the plan checkboxes in your branch as you complete them.

Ratified defaults you must apply (strategy §6): clamp the shrinkage PRIOR to
42–62 (not the observed win rate); the free overlay build must not embed
`data/internal/` (assert it in the public-boundary guardrail test); fold
scraper resilience into Task 1.3 (ingest `https://arammayhem.com/search-index.json`
for champion tier/WR + combos; keep aramgg.com as a manual cross-check note).

RESUME PROTOCOL: this prompt re-runs on a schedule (cron). On every run,
inspect `git log --oneline -10` and the plan checkboxes in this worktree and
continue from the first unchecked task. Append one line per session to
`docs/handoffs/m1-codex.md` (create it on the first run): timestamp, task
reached, state. If a usage/session limit interrupts you, just stop — the next
scheduled run resumes.

DEFINITION OF DONE: all Task 1.1–1.4 checkboxes ticked; verification green in
this worktree: `npm test` (all passing, count recorded),
`./node_modules/.bin/eslint src scripts`, `npm run build`,
`(cd overlay && npm run build)`, cross-parity suite at budget 0. Then write
the full M1 handoff into `docs/handoffs/m1-codex.md` per the strategy §3
template (commit hash, fixture paths — include sample DecisionContext/
DecisionResult JSON pairs under `docs/handoffs/fixtures/m1/`, verification
output, contract deltas), commit everything on your branch, push
`codex/decision-engine-foundation` to origin, and end the file with the
literal last line:

M1 COMPLETE
