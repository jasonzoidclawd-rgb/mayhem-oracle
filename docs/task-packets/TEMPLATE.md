# Task Packet — TEMPLATE

A task packet is the durable unit of delegation. It is a superset of the
`CO_WORKFLOW.md` handoff packet, adding the fields an agent needs to work in an
isolated worktree with **no conversation history**. Copy this file to
`docs/task-packets/<slice>.md`, fill every section, and validate:

    node harness/route.mjs validate-packet docs/task-packets/<slice>.md

Send the packet, not a transcript. If a fact is not in the packet or in the
repository at `BASE_SHA`, the agent is expected to retrieve it, not to assume it.

## TASK

One sentence. The observable outcome, not the method.

## TASK_CLASS

T1

<!-- T0 retrieval/mechanical · T1 bounded coding · T2 difficult debugging ·
     T3 concurrency/architecture/contradictory evidence · T4 disputed or
     release-critical. Routing and verification both derive from this:
     node harness/route.mjs route T1 -->

## BASE_SHA

4eb271b79826877e5fce0cfa7ad4e24b01cb6d71

<!-- Fixed for the life of the packet. Re-baselining means a new packet. -->

## WORKTREE

/Users/jason/Desktop/mayhem-oracle-worktrees/<slice>

<!-- git worktree add -b <branch> <path> <BASE_SHA>. One packet, one worktree. -->

## ROLE

executor

<!-- executor | verifier | scout. A verifier is read-only and is never given
     the executor's worktree. -->

## SPEC

The authoritative statement of required behavior, or a path to it. Prefer a
path — `docs/specs/overlay-v1-product-contract.md` outranks any restatement.

## RELEVANT PATHS

- `path/to/file`
- `path/to/other`

<!-- The narrowest set that can produce a correct change. Not the repository. -->

## INVARIANTS

- Rules this change must not break, with the file that enforces each.

## KNOWN FACTS

- Established facts with their evidence grade: OBSERVED / SOURCE-PROVEN /
  TEST-PROVEN / INFERRED / HYPOTHESIS / UNVERIFIED. Ungraded claims are not facts.

## OPEN QUESTIONS

- What is genuinely unresolved, and who resolves it.

## ACCEPTANCE TESTS

    bash harness/verify-task.sh <profile>

Plus the specific red test that must go green, by path and name.

## DO NOT TOUCH

- Paths owned by another in-flight task.
- Anything outside RELEVANT PATHS without saying why.

## RETURN FORMAT

- What changed, by path.
- Gate output, verbatim, including the profile.
- Completion level: IMPLEMENTED / OFFLINE-PROVEN / LIVE-PROVEN. Never "done".
- What was not done, and why.
