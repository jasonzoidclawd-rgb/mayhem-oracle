# Codex dispatch — current assignment: Milestone 3A (LCU collector and safe export)

You are Codex, co-implementing the Mayhem Oracle membership platform.
Contract: `docs/superpowers/plans/2026-06-13-claude-codex-split-implementation.md`.
Working agreement: `docs/superpowers/plans/2026-06-13-claude-codex-split-strategy.md`.
Status: M0 and **M1 are COMPLETE** (see `docs/handoffs/platform-baseline.md` and
`docs/handoffs/m1-codex.md`; frozen contracts incl. `SafeMatchExport` live in
`src/lib/contracts/telemetry.ts`; all branches carry the M1 commits; 127 tests).

FIRST, before any work:
- If `docs/handoffs/m3a-codex.md` exists here and its last line is
  `M3A COMPLETE`, print "M3A already complete" and exit with no changes.
- You are in the worktree `.worktrees/lcu-collector` on branch
  `codex/lcu-collector`. Verify with `git status`. Never switch branches,
  never commit to main, never touch the main checkout or other worktrees.
- `node_modules` are pre-installed (root and overlay/). Cargo deps may need
  network your sandbox lacks: prefer std-lib and already-cached crates; if a
  new crate is essential, record it in the handoff log and continue with what
  compiles — Claude prefetches on its next wake.

Hard boundaries (Claude Code owns these — do not edit): `supabase/**`,
`src/lib/entitlements/**`, `src/app/api/**`, `src/components/**` (web),
`messages/*.json`, root `package.json`/`package-lock.json`. Do not edit
`src/lib/decision/**` or `src/lib/contracts/**` either — they are frozen M1
output; contract changes need a written both-agent note per coordination
rules. Never hand-edit `public/data/**`; never touch
`public/data/patch-notes.json`.

TASK: Execute Milestone 3A exactly per the plan — Task 3A.1 (red sanitization
tests: identity-field stripping, per-match random slots, non-2400 rejection,
100/day cap, active-game pause), Task 3A.2 (collector: blocking first-run
consent, gameflow-aware snowball from owned matches, sanitize-before-queue,
full LCU responses in memory only, OCR round capture with unambiguous-match
rule, pause/resume/progress UI, compressed batches with backoff), Task 3A.3
(verification). Red tests first. One commit per task with `[M3A]` markers.
Tick the plan checkboxes in this worktree as you go.

Platform note: this machine is macOS — verify the macOS path for real
(`cargo test`, `cargo check`, overlay build). For Windows, keep the existing
lockfile-path handling working, gate platform-specific code behind cfg, and
record what remains Windows-unverified in the handoff (Claude/user runs the
Windows pass later); do not claim Windows verification you cannot perform.

RESUME PROTOCOL: this prompt re-runs on a schedule. Each run: inspect
`git log --oneline -10` and the plan checkboxes, continue from the first
unchecked M3A task, append one session line to `docs/handoffs/m3a-codex.md`
(create on first run). Commit directly in this worktree — the shared git dir
is writable for you now; if git still fails, fall back to a temp clone under
/private/tmp (clone this worktree, commit there) and say so in the log. If
`git push` is blocked by the sandbox, just record "push pending" — Claude
pushes on its wakes. If a usage limit interrupts, stop; the next run resumes.

DEFINITION OF DONE: Tasks 3A.1–3A.3 checkboxes ticked; in this worktree:
`(cd overlay/src-tauri && cargo test)` green, `(cd overlay/src-tauri && cargo
check)` green, `(cd overlay && npm run build)` green, `npm test` still green
(127+), sanitizer test evidence + a sample compressed batch fixture written to
`docs/handoffs/fixtures/m3a/`; full handoff in `docs/handoffs/m3a-codex.md`
per strategy §3 (commit, fixtures, upload headers, schema version, retry
semantics); everything committed. End the file with the literal last line:

M3A COMPLETE
