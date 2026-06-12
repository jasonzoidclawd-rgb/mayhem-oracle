# Handoff: M0 Baseline — executed by Claude Code (2026-06-13, overnight)

Ownership note: the plan assigns M0 to Codex; the user instructed Claude Code
to execute it overnight ("merge feat/26.12-scoring-rebuild to main and start
milestone 0"). Codex should re-verify this baseline at the start of M1 and
flag discrepancies here rather than re-running setup.

## Verified base

- Branch: `main`
- Base commit for all workstream branches: the commit introducing this file
  (parent: `e5f2c97` docs commit; merge commit `eb42e43` brought in the 26.12
  rebuild, pushed to origin)
- `feat/26.12-scoring-rebuild` is fully merged into main as of `eb42e43`
  (20 commits, no conflicts — main had not moved since the last rebase).
- Dirty files (intentional, MUST be preserved, never committed/overwritten by
  agents): `public/data/patch-notes.json` — user-protected local regeneration.
  Note: a local scheduled job on this machine rewrites that file daily at
  14:00 UTC (22:00 Asia/Taipei); a changing mtime/diff there is expected noise.
- Untracked: none relevant (planning docs committed in `e5f2c97`).

## Verification results (all run on main at e5f2c97)

| Check | Command | Result |
| --- | --- | --- |
| Unit tests | `npm test` | **110 passed / 110** (28 files), 0 failures |
| Lint | `./node_modules/.bin/eslint src scripts` | clean, exit 0 |
| Web build | `npm run build` | success (Next.js static+SSG+dynamic routes render) |
| Overlay build | `(cd overlay && npm run build)` | success — dist JS 214.16 kB (gzip 68.38 kB) |
| Classifier harness | `python3 scripts/test_classify_augments.py` | 10/10 OK |
| State harness | `bash scripts/test-state.sh` | pass, including failed-run refusal path |
| Whitespace | `git diff --check` | clean |

Pre-existing issues (not introduced tonight, do not "fix" casually):

1. Bare `npm run lint` crawls `.worktrees/*/.next` and reports ~888 unrelated
   errors — always scope: `./node_modules/.bin/eslint src scripts`. (`npx
   eslint` can be mangled by the user's rtk shell hook; use the
   `./node_modules/.bin/` path.)
2. When command output is verification evidence, use absolute tool paths
   (`/usr/bin/git`, `/usr/bin/diff`, `/usr/bin/grep`) — rtk hook caveat,
   documented in repo CLAUDE.md.
3. Cross-parity suite is the contract: budget 0, `src/lib/scoring/` ↔
   `overlay/src/scoring/` differ only by types import path.

## Branches created from this commit

- `codex/decision-engine-foundation` — Codex worktree at
  `.worktrees/decision-engine-foundation` (created; run `npm install` and
  `(cd overlay && npm install)` there on first use)
- `claude/web-membership-platform` — Claude works in the main checkout
- `codex/lcu-collector` — worktree to be created by Codex when M3A starts

All three pushed to origin.

## Ratified defaults (strategy doc §6 — no veto recorded at kickoff)

1. Baseline = main (this merge). 2. Shrinkage clamps the PRIOR, not observed
WR. 3. Free builds must not embed `data/internal/`. 4. Scraper resilience
(search-index.json ingestion + aramgg cross-check) belongs to Codex Task 1.3.
5. AdSense hosting decision due before Task 3B.3 (Claude runs the spike).

## Session log

- 2026-06-13 ~07:40 +08: M0 executed by Claude Code; merge + docs + baseline
  committed and pushed; overnight automation armed (Codex cron via crontab →
  `codex exec` in its worktree; Claude via harness cron). Next: Codex M1.
