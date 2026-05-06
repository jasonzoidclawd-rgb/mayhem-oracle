# AGENTS.md — Mayhem Oracle

Project operating rules for AI agents working in this repository.

## Project Context

This is a Next.js 15 PWA for League of Legends ARAM Mayhem.

Stack:
- Next.js App Router
- TypeScript
- React 19
- Tailwind CSS v4
- next-intl
- Static JSON data under `public/data/`
- Optional Tauri overlay under `overlay/`

Primary product direction:
- ARAM Mayhem decision support.
- Champion, augment, item, patch, and scoring workflows.
- PWA-first; overlay/OCR work requires extra care and compliance review.

## Karpathy Guidelines

Use the Karpathy Guidelines for all coding work.

### 1. Think Before Coding

Do not assume. Do not hide confusion. Surface tradeoffs.

Before implementing:
- State assumptions explicitly when they matter.
- If multiple interpretations exist, present them; do not silently pick.
- If a simpler approach exists, say so.
- If something is unclear and changes implementation, ask before editing.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond the task.
- No abstractions for single-use code.
- No unrequested configurability.
- No broad rewrites to solve narrow issues.
- If 200 lines could be 50, simplify.

### 3. Surgical Changes

Touch only what the task requires. Clean up only your own mess.

- Do not refactor unrelated code.
- Do not reformat unrelated files.
- Match existing style.
- Mention unrelated dead code; do not delete it unless asked.
- Remove only unused imports/variables/functions caused by your changes.

Every changed line should trace directly to the task.

### 4. Goal-Driven Execution

Define success criteria and verify them.

For multi-step work, state:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

For bugs, write or identify a reproduction first when practical.
For scoring changes, add or update tests.
For UI changes, verify lint/build and inspect affected routes/components.

## Required Commands

Run the narrowest command that verifies your change. Before final handoff for code changes, normally run:

```bash
npm test
npm run lint
npm run build
```

For overlay-only changes:

```bash
cd overlay
npm run build
```

If a command is skipped, explain why.

## Important Project Rules

- Use `@/i18n/navigation` for internal locale-routed links. Avoid `next/link` unless intentionally bypassing locale handling.
- Preserve locale support for `en`, `zh-TW`, `zh-CN`, `ja`, and `ko`.
- New user-facing strings should go through `messages/*.json` unless the task explicitly permits hardcoded copy.
- Keep the web app TypeScript boundary scoped to the Next app. `tsconfig.json` excludes `overlay/`, `packages/`, and `scripts/` intentionally.
- Web scoring logic and overlay scoring logic may drift. If changing shared scoring concepts, explicitly inspect both sides and either mirror, dedupe, or document the divergence.
- Static scraped data lives in `public/data/`. Do not hand-edit generated data unless the task explicitly calls for a curated patch.
- arammayhem.com uses React Server Components wire format, not normal HTML tables or `__NEXT_DATA__`.
- Riot has not made ARAM Mayhem data available through their public API.
- Overlay/OCR/live-client work is compliance-sensitive. Do not add game automation, hidden-information access, or client-injection behavior without explicit review.

## Dirty Worktree Safety

This repository may contain pre-existing uncommitted changes. Before editing:

```bash
git status --short --branch
```

Rules:
- Do not revert or overwrite unrelated user changes.
- If a file is already modified and your task requires touching it, inspect it first.
- Prefer small targeted patches over broad rewrites.
- Call out conflicts or suspicious pre-existing deletions.

## Multi-Agent Workflow

The main agent acts as orchestrator. Subagents do focused work.

Default roles:

1. Product Agent
   - PRDs, UX flows, acceptance criteria, competitive positioning.

2. Frontend Agent
   - Next.js routes, React components, Tailwind UI, responsive behavior.

3. Data/Scoring Agent
   - `src/lib/scoring`, `public/data`, schemas, recommendation logic, tests.

4. i18n Agent
   - `messages/*.json`, localized routing, hardcoded-string detection.

5. QA/Review Agent
   - spec compliance, code quality, tests, lint, build, regression risk.

6. Compliance Agent
   - Riot disclaimer, overlay policy risk, game-client interaction risk.

Use fresh subagents for focused tasks. Give each subagent exact context, paths, constraints, and expected output. Do not make subagents guess the plan.

## Claude Code and Codex Advisory

For meaningful design or implementation work, consult both Claude Code and Codex as advisors when available, but keep advisory bounded. Do not turn every small task into process drag.

Advisory means:
- Ask for critique, alternatives, edge cases, or test strategy.
- Prefer read-only advisory prompts unless the agent is explicitly assigned implementation authority.
- Treat advisory output as input, not truth. The Hermes orchestrator decides what to apply.
- Record which advisor ran, what it recommended, and what the orchestrator accepted or rejected.

Run advisory from the orchestrator shell or from a clearly assigned reviewer agent. Avoid recursive agent nesting where a Claude Code session launches another Claude Code session.

Use advisory at key decision points:
- before scoring/data API design
- before UI route architecture
- before final review of a non-trivial implementation

Claude Code read-only advisory example:

```bash
claude -p "Review this plan for Mayhem Oracle. Focus on scope control, testability, and hidden risks. Do not modify files. Return: strengths, risks, recommended changes." \
  --allowedTools "Read" \
  --max-turns 5
```

Codex read-only advisory example:

```bash
codex exec "Review this plan for Mayhem Oracle. Focus on architecture, test coverage, and likely implementation pitfalls. Do not modify files. Return: strengths, risks, recommended changes."
```

If either CLI is unavailable or unauthenticated, continue without it and note the skipped advisory.

Use `CO_WORKFLOW.md` for Claude/Codex handoff packets when two independent coding agents coordinate on the same feature.

## RALPH Loop

Use the RALPH loop for non-trivial tasks:

1. Recon
   - Inspect relevant files, current git status, existing patterns, and commands.
   - Identify constraints before editing.

2. Ask / Assumptions
   - Ask only when ambiguity materially changes the implementation.
   - Otherwise state assumptions and proceed with the obvious default.

3. List
   - List the smallest verifiable tasks.
   - Assign each task to one role or subagent.
   - Avoid parallel edits to the same files unless using separate worktrees.

4. Produce
   - Implement the smallest slice that satisfies the current task.
   - Follow TDD where practical.
   - Keep changes surgical.

5. Harden
   - Run verification commands.
   - Dispatch spec review, then quality review.
   - Fix critical issues before moving on.
   - Summarize changed files, verification, and remaining risks.

## Review Gates

Every implementation task should pass these gates:

1. Spec Gate
   - Does it implement exactly the requested behavior?
   - Any missing requirement?
   - Any scope creep?

2. Quality Gate
   - Is the code simple, maintainable, and consistent with project style?
   - Are tests adequate?
   - Are i18n, data freshness, and scoring implications handled?

3. Integration Gate
   - Do tests/lint/build pass?
   - Does the change work with existing routes and data?
   - Are web/overlay/shared-scoring boundaries respected?

Do not proceed after a failed gate without fixing or explicitly documenting why it is deferred.

## First Recommended Milestone

Build the MVP 3-card augment picker as the first multi-agent milestone:

- New advisor/draft route.
- Select champion.
- Select owned augments.
- Select three offered augments.
- Rank the offered augments using existing scoring logic.
- Show concise explanations and set-progress callouts.
- No OCR, overlay, database, account system, or advanced reroll EV in the first slice.
