---
name: mayhem-task
description: Execute one Mayhem Oracle task packet in an isolated worktree. Use when handed a docs/task-packets/*.md file, or when told to work a slice at a fixed base SHA. Covers scope discipline, the deterministic gate, and the required return format.
allowed-tools: [read, bash, edit, write]
---

# Executing a task packet

You have one packet. It is the whole brief. Conversation history is not
available and is not needed — the packet plus the repository it points at is the
durable state.

## Before you change anything

1. Validate the packet: `node harness/route.mjs validate-packet <packet>`.
2. Confirm you are in the packet's `WORKTREE`. Anywhere else is not the
   workspace that was planned: stop and say so.
3. Know which workspace you were given. `WORKSPACE_ACTION` says which, and the
   two are not the same brief:
   - `create` — a fresh workspace, cut from `RESOLVED_BASE_SHA`. Its head is
     that base, and a candidate is a commit you make after it.
   - `resume` — a workspace an earlier attempt left behind, whose head may be
     ahead of `RESOLVED_BASE_SHA` and may already be this issue's candidate.
     A resumed head ahead of the base is the expected state, not an obstacle
     and not a reason to stop.
     Inspect what is there — read the diff from the pinned base — before you
     decide whether anything more is owed.
   The packet's workspace section is the authority on what `git rev-parse HEAD`
   should be. Where it asks you to confirm the head, confirm it; where it tells
   you the head may already be ahead of `STARTING_HEAD` — a resumed workspace,
   or a try an earlier executor of this attempt already worked in — inspect what
   is there instead of stopping. Never rebase, reset, or re-baseline to make a
   head and a base agree.
4. Re-verify every claim under `KNOWN FACTS` that your change depends on. A
   claim graded HYPOTHESIS or UNVERIFIED is not a fact — treat it as an
   experiment to run, not a premise to build on.
5. Read `SPEC`. Where the packet and the spec disagree, the spec wins and you
   report the conflict.

## While you work

- Stay inside `RELEVANT PATHS`. Touching anything in `DO NOT TOUCH` is a stop,
  not a judgement call.
- Reproduce before repairing. For a bug, the red test comes first; for a
  scoring change, mirror web and overlay together.
- The base is fixed provenance. If the work genuinely needs a different one,
  stop and return — re-baselining means a new packet, never a silent rebase.
- On a resumed workspace whose head is already the candidate, report that sha.
  A no-op commit or an empty amend made only to move it is a worse record of
  what happened, not a better one. Where the candidate came from is measured by
  the controller against the pinned base; it is not yours to assert or to
  manufacture.
- Do not push. Do not tag. Do not merge. Candidate commits stay on the
  packet's branch; the orchestrator selects what integrates.
- Escalate reasoning effort on evidence — a failed hypothesis, a deterministic
  contradiction, a concurrency ambiguity — never because the task feels
  important. Importance raises verification rigor, not effort.

## Before you return

Run the gate named in `ACCEPTANCE TESTS`:

    bash harness/verify-task.sh <profile>

A failing gate cannot be overruled by any model, effort level, or vote. Fix it
or report it failing — never describe a red gate as a caveat.

Then answer in the packet's `RETURN FORMAT`, and state a completion level
rather than "done":

    IMPLEMENTED     the source contains the intended mechanism
    OFFLINE-PROVEN  a deterministic regression demonstrates it
    LIVE-PROVEN     controlled live acceptance demonstrates it

Say plainly what you did not do, and why. An honest partial beats a confident
whole.
