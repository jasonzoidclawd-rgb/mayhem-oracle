# Codex + Claude Cowork Workflow

Use this when two agents are working in the same repo.

## Principles

Derived from the Karpathy-style `CLAUDE.md` rules:

- Think before coding: state assumptions, scope, and success criteria first.
- Simplicity first: prefer the minimum change that solves the task.
- Surgical changes: touch only the files needed for the request.
- Goal-driven execution: end every handoff with concrete verification steps.

## Default Split

- Use Claude for exploration, problem framing, research, and broad code reading.
- Use Codex for surgical implementation, patching, lint/test/build loops, and final verification.
- If one agent owns a file, the other should avoid editing that file until handoff is complete.

## Shared Rules

- Sync through diffs, not memory.
- Do not make adjacent “cleanup” changes unless the task requires them.
- If you notice unrelated issues, note them separately instead of folding them into the patch.
- Keep handoffs small: one task, one owner, one validation target.

## Handoff Packet

Every handoff should include:

1. Goal
2. Files in scope
3. Assumptions
4. Exact change requested
5. Verification command(s)
6. Done criteria
7. Open questions or risks

## Copy/Paste Template

```md
## Handoff

**Goal**
- [one concrete outcome]

**Files In Scope**
- `path/to/file`
- `path/to/file`

**Assumptions**
- [assumption]
- [assumption]

**Requested Change**
- [specific code/doc/test change]

**Verification**
- `npm test`
- `npm run lint`

**Done Criteria**
- [observable condition]
- [observable condition]

**Open Questions / Risks**
- [question or risk]
```

## Recommended Loop

1. Explorer agent reads and frames the task.
2. Implementer agent edits only the agreed files.
3. Implementer runs the narrowest useful validation first, then broader validation.
4. Reviewer agent checks the diff against the original goal.
5. If scope expanded, stop and rewrite the handoff before continuing.

## Repo-Specific Notes

- `CLAUDE.md` is the standing repo context and should stay stable.
- `CO_WORKFLOW.md` is the reusable handoff contract between agents.
- For this repo, validate web changes with `npm run lint`, `npm test`, and `npm run build`.
- For overlay changes, also validate with `npm --workspace overlay run build`.
