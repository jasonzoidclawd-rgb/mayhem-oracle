---
name: mayhem-task
description: Execute one Mayhem Oracle task packet in an isolated worktree. Use when handed a docs/task-packets/*.md file, or when told to work a slice at a fixed base SHA. Covers scope discipline, the deterministic gate, and the required return format.
allowed-tools: [read, bash, edit, write]
---

# Executing a task packet

You have one packet. It is the whole brief. Conversation history is not
available and is not needed — the packet plus the repository at `BASE_SHA` is
the durable state.

## Before you change anything

1. Validate the packet: `node harness/route.mjs validate-packet <packet>`.
2. Confirm you are in the packet's `WORKTREE` and at its `BASE_SHA`
   (`git rev-parse HEAD`). If you are anywhere else, stop and say so.
3. Re-verify every claim under `KNOWN FACTS` that your change depends on. A
   claim graded HYPOTHESIS or UNVERIFIED is not a fact — treat it as an
   experiment to run, not a premise to build on.
4. Read `SPEC`. Where the packet and the spec disagree, the spec wins and you
   report the conflict.

## While you work

- Stay inside `RELEVANT PATHS`. Touching anything in `DO NOT TOUCH` is a stop,
  not a judgement call.
- Reproduce before repairing. For a bug, the red test comes first; for a
  scoring change, mirror web and overlay together.
- `BASE_SHA` is fixed. If the work genuinely needs a different base, stop and
  return — re-baselining means a new packet, never a silent rebase.
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
