# AGENTS.md — Mayhem Oracle

Operating rules for AI agents in this repository. Project context, contracts,
and the data pipeline live in `CLAUDE.md` — read it first; don't duplicate it.

## Working Rules

1. **Think before coding.** State assumptions that matter; present competing
   interpretations instead of silently picking one; say so when a simpler
   approach exists; ask only when ambiguity materially changes implementation.
2. **Simplicity first.** Minimum code that solves the task. No speculative
   features, abstractions for single-use code, or unrequested configurability.
3. **Surgical changes.** Touch only what the task requires; match existing
   style; mention unrelated dead code, don't delete it. Remove only orphans
   your own change created. Every changed line traces to the task.
4. **Goal-driven execution.** Define success criteria and verify them. For
   bugs, reproduce first. For scoring changes, write the red test first and
   mirror web + overlay together (the cross-parity suite enforces this).

## Verification Floor

Run the narrowest check that proves your change, then before handoff:

```bash
npm test
npx eslint src scripts
npm run build
(cd overlay && npm run build)   # overlay-touching changes
```

Report every skipped or blocked gate. Rust changes: release build + binary
timestamp (see CLAUDE.md). Verification evidence: use `/usr/bin/diff`,
`/usr/bin/grep`, `/usr/bin/wc` (rtk hook caveat).

## Repository Safety

- Check `git status --short --branch` before editing; preserve unrelated
  changes; call out suspicious pre-existing modifications.
- Never hand-edit `public/data/` (generated; curated fields are pipeline-owned).
- New user-facing copy goes through all five `messages/*.json` in one commit.
- Tag before risky overlay work; the overlay's working state is sacred.
- The daily data cron commits to `main` at 22:00 UTC — rebase before pushing;
  resolve data-file conflicts by regenerating, never by hand-merging JSON.

## Multi-Agent Workflow

The orchestrator decomposes; subagents do focused work with exact context,
paths, constraints, and expected output. Avoid parallel edits to the same
files outside separate worktrees. Use `CO_WORKFLOW.md` packets for bounded
Claude/Codex handoffs; advisory output is input, not truth — the orchestrator
decides and records what was accepted or rejected. Keep advisory bounded to
real decision points (scoring/data API design, route architecture, final
review of non-trivial work); read-only prompts unless implementation authority
is explicitly assigned. Avoid recursive agent nesting.

## Review Gates

1. **Spec** — exactly the requested behavior; nothing missing, no scope creep.
2. **Quality** — simple, consistent, adequately tested; i18n, data freshness,
   and web/overlay parity handled.
3. **Integration** — tests/lint/build green; works with existing routes and
   data; scoring-twin boundary respected.

Do not proceed past a failed gate without fixing it or explicitly documenting
the deferral.
