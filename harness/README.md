# Agent harness

The smallest control plane that improves delegation, context preservation,
model selection, quota usage, verification, worktree isolation, and
recoverability — and nothing more. Design rationale and the evidence behind the
routing policy: `docs/architecture/agent-harness.md`.

**It owns no mutable state.** Git owns worktrees, history, and diffs. This
directory owns a deterministic gate, a static routing table, a packet schema,
and the tests that keep them honest. Quota pressure and local auth are passed
in per call, never persisted here.

## The gate

```bash
bash harness/verify-task.sh            # profile: all (default)
bash harness/verify-task.sh harness    # policy tests only — fast
bash harness/verify-task.sh web        # + web unit + eslint
bash harness/verify-task.sh overlay    # + overlay unit + overlay types
bash harness/verify-task.sh skills     # + the .codex skill suite
bash harness/verify-task.sh rust       # + overlay/src-tauri cargo test
bash harness/verify-task.sh all --plan # what a profile would run, run nothing
```

Two files, one command layer:

| | Owns | Knows nothing about |
|---|---|---|
| `scripts/gate.sh` | the deterministic commands, one suite at a time (`--list` enumerates them) | profiles, providers, routing, effort, accounts |
| `harness/verify-task.sh` | which suites a profile requires, and the coverage it declares | how any suite is actually run |

`verify-task` spells out no test command of its own — a test enforces that, so a
profile cannot drift from what the gate actually executes. Exits nonzero on any
failure; prints what a profile does **not** cover rather than passing silently;
an unknown profile or suite exits 2 before anything runs.

`rust` is red on purpose today: `bounded_capture_timeout_must_survive_finite_async_worker_starvation`
reproduces an unfixed native liveness defect, so `rust` and `all` exit nonzero
until that defect is fixed. A deterministic gate reporting a real defect is the
gate working.

### Native Vision verification

`surface_probe::tests::silver_fixture_resolves_all_three_titles_and_records_ocr_latency`
(`overlay/src-tauri/src/surface_probe.rs`, `#[cfg(target_os = "macos")]`) reaches
the macOS Vision framework through `crate::ocr`. On one commit, with identical
gate commands, an independent verifier ran the `rust` profile both ways:

| Execution | `rust` profile |
|---|---|
| restricted agent sandbox | 113 passed, 2 failed — the intended red test **and** the Vision test |
| host / unrestricted | 114 passed, 1 failed — the intended red test only |

The Vision test failed 5/5 restricted with `OCR failed: unknown Vision error`
and passed 5/5 on the host. `scripts/gate.sh` and `harness/verify-task.sh` are
not the difference; sandboxed access to Vision is.

Policy, for macOS Vision-dependent Rust verification only:

- **Host/native execution is authoritative.** A `rust` result produced inside a
  restricted agent sandbox does not verify this suite.
- A Vision failure under such a sandbox is an **environment** failure, not
  automatically a repository failure.
- An agent reporting Rust results must state the execution capability it used.
- This is not licence to retry away or ignore arbitrary Rust failures. Every
  other failure is a repository failure until proven otherwise.
- The exception applies only where a failure is shown to be environment-specific
  by controlled comparison — same commit, same gate command, restricted vs host.

## Routing

```bash
node harness/route.mjs route T2
node harness/route.mjs route T3 --tag native-concurrency
node harness/route.mjs route T1 --exhausted GPT_A
node harness/route.mjs route T1 --available CLAUDE_A,CLAUDE_B,GPT_A,GPT_B
node harness/route.mjs route T4 --effort max --justify "release arbitration; high did not separate the candidates"
```

Policy is data: `config/routing.json` (accounts, capability tiers, task
classes, effort) and `config/verification-policy.json` (risk levels, criteria,
verifier constraints). Changing a model name or a tier mapping edits JSON only
— never `AGENTS.md`, never code. A test enforces that.

The router fails closed on an unknown task class, on an unjustified escalation
to the top two effort levels, and when no authorized subscription account is
available. It never emits a metered-API route.

Every route names the `execution` mechanism, the `runtime`, and the concrete
`runtimeAuth` context it authorizes, so dispatch is a lookup rather than a
choice. Subscription authentication alone does not qualify a mechanism:
`executionMechanisms` in `config/routing.json` declares, per mechanism, whether
execution consumes the plan's *included* usage, and the router refuses anything
else instead of substituting a paid route.

## Task packets

```bash
cp docs/task-packets/TEMPLATE.md docs/task-packets/<slice>.md
node harness/route.mjs validate-packet docs/task-packets/<slice>.md
node harness/route.mjs validate-packet docs/task-packets/*.md   # cross-packet checks too
```

## GitHub issue dispatch

```bash
./harness/dispatch-github-issue.sh <issue-number>            # dispatch it
./harness/dispatch-github-issue.sh <issue-number> --dry-run  # read-only: parse, route, refuse
```

One command, and the authority it borrows is unchanged:

| | Owns |
|---|---|
| GitHub issues | the durable bug ledger — issue state *is* the record |
| `route.mjs` | which slot executes, which reviews, at what tier and effort |
| `git worktree` | execution isolation, one worktree per issue |
| `verify-task.sh` | the deterministic gate, which outranks any reviewer |
| `verification-policy.json` | review authority |
| the executor | nothing. It is disposable and holds no authority at all |

The adapter (`harness/github/`) contains no account slot, no vendor name, and
no execution-mechanism id — a test enforces that. It reads the issue, asks
`route()`, and interprets the mechanism the router already named. Each
dispatchable mechanism declares its own `launch` argv per role in
`config/routing.json`, next to the billing claim it already declared, so the
dispatcher starts a runtime by lookup rather than by guessed syntax.

### Task, Attempt, and the one-way dependency

Execution is not GitHub's. `harness/run/` owns the lifecycle and `harness/github/`
adapts one source onto it, in that direction only:

```
GitHub issue → parse → Task → claim → runAttempt(task, plan, io) → Attempt
                                                                     ↓
                                          disposition → label, comment, hand-back
```

- **Task** — the authoritative requested work: identity, spec, base, gate
  profile, required context. Identity is `{ kind, id, slug }`; `kind` and `id`
  decide which workspace it owns, and `slug` is decoration from a title that may
  be edited at any moment. That split is why renaming an issue mid-run resumes
  the workspace its number already owns instead of orphaning it.
- **Attempt** — one execution of one Task, from one declared base, inside one
  isolated workspace. `runAttempt()` establishes the workspace, launches the
  executor, checks its commit against git, runs the gate, and — only on verified
  work — a reviewer, then concludes.
- **Disposition** — what the attempt established, in a vocabulary with no ledger
  in it: `accepted`, `needs-review`, `needs-human`, `needs-evidence`, `blocked`.
  `STATUS_FOR_DISPOSITION` in the GitHub adapter is the single place one becomes
  a `status:` label.

`harness/run/` never imports from `harness/github/`, never names `gh`, an issue,
or a label, and a test asserts all three against the source. A second test runs
the whole lifecycle on a Task that is not a GitHub issue, with an `io` that has
no `gh` at all.

### The issue contract

A dispatchable issue is ordinary human Markdown plus one machine block:

```markdown
Prose describing the defect, its evidence, and its acceptance contract.

<!-- mayhem-agent
schema: 1
fingerprint: geometry:response-delivery:async-transport
task_class: T3
base_ref: b9e12a98dcecd777e0abb425fb3f0cc24fce5286
gate_profile: overlay
-->
```

`schema`, `fingerprint`, `task_class`, and `base_ref` are required.
`gate_profile` is optional and defaults to `harness`; `context_paths` is an
optional comma-separated list. Every other condition is checked before anything
is launched, and each failure has its own refusal code:

`not-open` · `already-claimed` · `not-ready` · `no-machine-block` ·
`unsupported-schema` · `missing-fingerprint` · `invalid-fingerprint` ·
`unknown-task-class` · `unresolved-base-ref` · `unknown-gate-profile` ·
`duplicate-fingerprint` · `missing-label` · `unroutable` · `blocked` · `locked`

**The task class is never inferred.** An unparseable one is a refusal, not a
guess — the router's own table is the only authority on what a class means.

### Labels

Labels are state on the ledger, not a replacement for issue structure. They
must exist before the first dispatch; the run refuses with `missing-label`
otherwise:

```bash
for l in needs-evidence ready-for-agent agent-working needs-review \
         needs-human verified blocked; do
  gh label create "status:$l" --repo <owner>/<name>
done
```

Unrelated labels are tolerated and ignored.

### Dedupe, claiming, and the lock

Dedupe is **exact fingerprint equality over open issues** and nothing else — no
embeddings, no fuzzy matching, no model comparison. A near-miss is a different
defect until a human says otherwise. An issue whose fingerprint already belongs
to an older open issue is refused rather than worked twice.

Claiming re-reads the issue immediately before mutating it, then takes
`status:ready-for-agent` → `status:agent-working`. A second dispatcher that
arrives in between sees `already-claimed` and exits without launching anything.
A local lock directory under the repository's git common directory guards two
processes on one machine; it is a race guard, not distributed exactly-once.

### Worktrees, results, and state

Every issue gets its own worktree, derived from the main worktree's own
location rather than configured:

```
<repo-parent>/<repo>-worktrees/issues/<number>-<slug>   branch issue/<number>-<slug>
```

An existing worktree for the same issue is **resumed exactly as found** — the
resume path emits no git command at all, so uncommitted work cannot be
discarded. A path that exists but is not a worktree, a branch already checked
out elsewhere, or a worktree belonging to a different issue all fail closed.

Run state lives outside every worktree, in `<git-common-dir>/mayhem-dispatch/`:
the packet, the executor and reviewer reports, and `result.json`. The result
JSON is written **before** GitHub is told anything, and the issue comment is a
compact `KEY=VALUE` block — the ledger is not a log sink.

### When a claimed run fails

A claim is a promise: once an issue reads `status:agent-working`, something has
taken responsibility for it. Every step after the claim therefore runs inside a
single recovery boundary. A bounded failure anywhere in it — worktree, base
resolution, executor launch, executor report, gate, review, conclusion, result
write, GitHub report — hands the issue back rather than leaving it claimed:

- the run is recorded `INTERRUPTED` with the stage that failed, the error
  class, and a redacted, truncated message (never a stack trace, never an
  environment dump — token-shaped substrings are replaced before anything is
  written or posted),
- `result.json` is written first, so the durable evidence exists even if GitHub
  is unreachable,
- the label moves `status:agent-working` → `status:blocked`,
- a comment reports `RESULT=INTERRUPTED` and `FAILED_AT=<stage>`.

There is exactly one recovery state. The dispatcher does not guess whether a
failure was a human problem or a machine problem, does not retry, and does not
grow a state machine per failure mode: a human reads the stage and decides.

Recovery is armed **only after this process actually obtained the claim**. A
refused or lost claim — `already-claimed`, `not-ready`, a failed claiming
write — never enters it, because nothing is owed back.

If recovery itself cannot reach GitHub, the command does not pretend otherwise:
a label write that fails raises an error carrying both the original failure and
the recovery failure, states that the issue is still `status:agent-working`, and
exits nonzero. A comment that fails is reported as `FAILED` in the
`RECOVERY result=… labels=… comment=…` line and also exits nonzero, while the
label — the part that un-strands the issue — has already landed.

**Limitation, stated exactly.** This covers *bounded in-process failures*:
exceptions, nonzero commands, unreachable GitHub. It does **not** cover hard
process death — `SIGKILL`, a panic that skips unwinding, a crashed machine, or
power loss — because no in-process handler runs in those cases. Such a run
leaves the issue at `status:agent-working` and its lock directory in place, and
needs a human. There is no watchdog, no lease expiry, and no reconciliation
sweep; V1 deliberately does not claim exactly-once semantics.

### What counts as done

The result vocabulary is closed: `FIX_PROPOSED`, `NEEDS_EVIDENCE`, `BLOCKED`,
`INTERRUPTED`, `GATE_PASSED`, `VERIFIED`. Anything else is rejected.

- `FIX_PROPOSED` requires a **behavioral RED**: existing behavior violating the
  issue's acceptance contract. A missing module, an unwritten file, a
  scaffolding syntax error, or a missing fixture is not one, and is rejected as
  one. "Could not reproduce" never becomes a fix.

  It also requires **controller-observed commit evidence**, checked before the
  disposition is accepted rather than after. git must establish that the sha
  names a commit, that git's own canonical object id for it equals the claim,
  that it is the head the gate ran on, that it descends from the point it is a
  change to, that nothing the gate could reach is uncommitted, and that it
  changes a file. Any refusal
  makes the disposition invalid: the executor is added to the exhausted set, the
  workspace and everything committed on it are preserved, and the task reroutes.
  No reviewer is ever dispatched against a commit git could not establish.

  **"Clean" is a question about the gate, not about `git status`.** The
  invariant is that the gate tested the candidate commit plus the environment
  inputs it declares, and nothing else — so what matters is whether a path could
  reach the gate at all. Tracked modifications and staged changes could, always,
  and refuse the candidate. An untracked file could only if some suite
  discovers, imports, compiles or executes it, and that is a property of the
  gate rather than of a filename: `scripts/gate.sh --authority` declares a third
  kind, `evidence`, naming the roots no suite can reach, with the proof written
  beside them. Everything untracked outside those roots blocks, so the default
  stays fail-closed. The declaration is checked rather than trusted: a root that
  contains anything the gate says it reads is not honored at all, a file
  matching a declared gate input blocks wherever it sits, and a root every suite
  has not declared stops being honored until somebody examines it for that
  suite.

  The record says both things separately, because they are two facts:
  `worktree.cleanForCandidate` is whether the gate tested this commit, and
  `worktree.statusEmpty` is whether `git status` was empty. A workspace carrying
  sixteen attempts' worth of pinned traces is the first without being the
  second, and a record that printed only the first would invite a reader to
  believe the second. A refusal names the category and the paths —
  `trackedModified`, `stagedModified`, `untrackedBlocking`, beside
  `untrackedEvidence` — instead of the single word `dirty`, which named a
  condition and identified nothing. `worktree.delta` and `worktree.deltaThisTry`
  keep what the attempt found already here apart from what appeared since, per
  try, so a rerouted executor refused for its predecessor's leftovers is
  distinguishable from one refused for its own. The rule does not change with
  that answer: permitted evidence blocks nobody, and an untracked source, config
  or test file blocks whoever left it.

  **A candidate need not be a commit this attempt made.** A resumed workspace
  starts at the previous attempt's commit, and an executor sent to validate that
  candidate is supposed to report it; reading "the head I started from" as
  "nothing was committed" makes the only correct answer unreportable and pushes
  a truthful executor toward an empty amend. So the evidence records
  `candidateOrigin`: `produced-this-attempt` when the sha is ahead of the
  starting head, `inherited` when it is the starting head. Inheritance is
  proven, not asserted — against the pinned base, the one point in the history
  the attempt did not choose. An inherited candidate must descend from
  `resolvedBaseSha`, differ from it, and carry a non-empty diff against it, and
  with no pinned base recorded it fails closed as `base-unknown`. The workspace
  sitting on the untouched base is still `commit-is-starting-head`, which is the
  case that rule was always about. `attemptProducedCommitSha` and
  `inheritedCandidateSha` keep the two apart on the record, and the reviewer is
  handed the diff from whichever base the candidate is a change to — diffing an
  inherited candidate against the starting head would hand it nothing to review.

  **And the executor is told this rule, not a second one.** The packet carries
  `WORKSPACE_ACTION` and `STARTING_HEAD` beside `BASE_REF` and
  `RESOLVED_BASE_SHA`, and states the candidate rule for the workspace the
  controller actually planned: a fresh workspace's head is the pinned base and a
  candidate is a commit made after it; a resumed workspace's head may be ahead of
  that base, may already be this issue's candidate, and is to be inspected rather
  than stopped for. `.agents/skills/mayhem-task/SKILL.md` reads the same two
  fields. Attempt 16 is why: the controller had accepted inherited candidates
  since a9662dd while the skill still said to confirm HEAD was `BASE_SHA` and
  stop otherwise, so the executor did exactly what it was told and reported a
  base mismatch as a blocker. Rerouting was correct and useless — the next
  executor was handed the same brief. Neither document may state an
  unconditional HEAD-equals-base rule again; a test refuses one.

  Every canonical id comes from `git rev-parse`, never from the report. The
  record keeps `executorClaimedCommitSha` and `controllerObservedCommitSha`
  separate, `commitSha` holds only what git established (null otherwise), and a
  refused claim is printed on the ledger as `COMMIT_CLAIM_REFUSED` with the
  account that made it and the full sha it named.
- `NEEDS_EVIDENCE` requires an **evidence request**, because it is the only
  result that hands work back to a human: it moves the issue to
  `status:needs-evidence`, which says a person owes a fact. The request names
  the specific `missingFact`, says in `whyUnobtainable` (or
  `whyExecutorCannotAcquire`) why repository inspection, source and history, an
  offline test, deterministic experimentation and static or runtime analysis all
  miss it, describes the concrete `externalCondition` gating it and the
  `externalSource` holding it, and supplies a `protocol` (or
  `collectionProtocol`) for collecting it.

  The two axes are deliberately different kinds. `externalSource` is closed —
  `external-human`, `external-system`, `external-hardware` — because it is what
  makes "external" checkable rather than rhetorical. `externalCondition` is
  open: any description concrete enough to act on is accepted, so a real
  boundary is never refused merely because nobody anticipated its noun and no
  harness source change is needed to express one. Recognized shorthands
  (`live-game`, `user-only-reproduction`, `credentials`, `account-state`,
  `production-system`, `physical-hardware`) are accepted as-is and imply their
  own source.

  An unfinished investigation is not an evidence request — "root cause not
  identified", "more investigation required", "cannot construct a RED yet",
  "need to know which operation causes it" and a bare failed reproduction are
  all rejected, and the honest word for them is `BLOCKED`.
- `BLOCKED` requires a **blocker**, for the same reason and by the same shape.
  It claims a requested action became impossible, so it names the
  `blockedAction` — the engineering phase that stopped, from `investigate`,
  `reproduce`, `implement`, `test`, `commit` — the concrete
  `condition`, the `blockerSource` from a closed axis
  (`dependency-unavailable`, `authorization-denied`, `platform-unavailable`,
  `upstream-missing`, `infrastructure-failure`), `whyExecutorCannotProceed`,
  and the `recovery` that would clear it. An unidentified root cause or causal
  operation, an unbuilt RED, competing hypotheses, "more analysis is needed",
  "the change would be speculative" and running out of ideas are screened out:
  each is true of an unfinished run and none is an obstacle.
- **Verification blockers are not execution blockers.** Checking is deliberately
  absent from `blockedAction`, at every phase: a gate that will not run does not
  stop an executor investigating a defect, reproducing it, writing the repair,
  exercising it or committing it. A blocker that names a checking authority —
  gate, typecheck, lint, clippy, CI — in either its condition or its explanation
  is refused with `verificationBlockers` named as the place for it. (The generic
  word "test" is not screened, because `test` is a phase an obstacle can
  genuinely land in: a toolchain a targeted regression needs and cannot get is a
  missing dependency, not a red suite.)

  Those ride along with any result and decide nothing about the disposition.
  They cap **what depends on the surface they name**, and only that. The
  unqualified `OFFLINE-PROVEN` means every suite ran and nothing was left
  unchecked, so any blocker withholds it — but the scoped proof survives:
  `provenSurfaces` records the suites the controller ran less the ones a blocker
  names, so an unrunnable overlay checker does not erase a Rust suite this
  controller ran and watched pass. Only suites the gate actually ran can appear
  there, so coverage the controller did not produce still cannot be claimed.
- **Being interrupted is an observation, not a report.** `INTERRUPTED` is
  concluded by the controller, never reported: it is the only result that owes
  nobody an explanation, so leaving it reportable left one unguarded way to
  stop. A report that parsed is an execution that reached the point of
  answering, so an executor-written `INTERRUPTED` is refused and rerouted like
  any other unshowable claim.
- **One authoritative report source, and output is not it.** An executor's
  result is read from `report-executor.json` in that try's own handoff directory
  (`run/report.mjs`). Captured stdout and stderr are diagnostic — echoed for the
  operator, kept nowhere the lifecycle can reach — so no `result`,
  `behavioralRed`, `evidenceRequest`, `blocker`, `verificationBlockers`,
  `commitSha` or `tests` is ever derived from them. A JSON object printed to the
  console that looks exactly like a valid report is not one. A report file that
  will not parse is not one either, and falls through to nothing.
- **A missing report is two different facts.** Which one it is comes from how
  the runtime stopped, in the terms `run/process.mjs` already draws. A runtime
  that never reached its own exit — a launch that failed, a process the kernel
  killed, a nonzero abnormal termination — was interrupted, and the controller
  synthesizes its own `INTERRUPTED`; the run lands `needs-human` and is not
  rerouted, because nobody claimed anything. A runtime that ran to a clean exit
  and wrote nothing was interrupted by nothing: it was handed the report path in
  its packet and declined the protocol. That is `missing-required-report` — an
  invalid disposition, `accepted: false`, the account added to the exhausted
  set, the workspace and everything committed on it preserved, and the task
  rerouted. With no alternate left it fails closed as `INVALID_DISPOSITION`,
  fabricating neither `BLOCKED`, `NEEDS_EVIDENCE` nor `INTERRUPTED`.
- **How a process ended is the controller's to record.** Every executor try —
  every mechanism, Pi and Claude Code alike — leaves a controller-owned
  diagnostic beside that try's report: `process-executor.json` with
  `process-executor.stdout.log` and `process-executor.stderr.log`, under that
  try's own run id, so a rerouted executor never writes over its predecessor's.
  The record carries the account, the execution mechanism, the runtime, the
  model and effort, the cwd, start and end timestamps and duration, `didRun`,
  `exitStatus`, `signal`, a `termination` (`exit`, `signal`, `timeout`,
  `launch-failed`, `unknown`) that keeps a controller deadline apart from an
  ordinary kill and both apart from a program that never started, the report
  path relative to the run, and whether that report existed when the process
  stopped. It is written before anything is concluded from how the process
  ended, so a launch that never happened is as diagnosable as an exit 1, and a
  writer that fails never costs the run its work — the failure is recorded and
  the attempt continues.

  What may be written down is a real question, because a terminal is not a file.
  Environment values never reach the record — only the key names — and the exact
  values the controller injected are masked out of the captured streams along
  with anything token-shaped. The launch line is recorded as the shape the
  mechanism declared, so a rendered path or credential cannot arrive through a
  substitution. Logs keep their tail under a cap and say how much was dropped.

  None of it is authority. `INTERRUPTED` still comes from what the controller
  observed of the runtime, the report file is still the only place a claim can be
  made, and a perfectly-formed lifecycle result printed to stdout is now a string
  in a log file exactly as it was a string on a terminal. What changes is that
  "executor exited 1 without a report" names a file a person can open: the run
  and the ledger both carry `EXECUTOR_PROCESS` and the diagnostic's path.
- **The handoff is a path the executor may actually write.** The controller
  creates a directory for each try before that try is launched, empties it, and
  proves it writable then — when failing costs a file operation rather than a
  spent turn. It is deliberately outside the repository's `.git`: a runtime
  whose policy treats `.git` as sensitive will do the work, find nowhere to put
  the answer, and exit clean, which the lifecycle reads — correctly — as an
  executor that did not answer. The rule was right and the address was wrong.
  The path is named in the packet and granted to the runtime, and the controller
  copies the raw bytes back into `runs/` afterwards, parseable or not, because a
  file that is not a report is exactly the file a person debugging needs.
- **Declared is not observed.** `tests` is what the executor wrote down; the
  gate is what the controller watched. The comment labels them
  `TESTS(executor-declared)` and `GATE(controller-observed)`, adds
  `UNVERIFIED_CLAIM` when declared tests fall in suites the profile left
  uncovered, and never renders report prose at all — so a note claiming "117
  tests passed" reaches no ledger line and elevates nothing.
- A refused disposition is **rerouted, not billed to the operator**. An executor
  whose report the contract rejects has produced executor-incomplete work, so
  the router is asked for another eligible executor — excluding every account
  already tried — and it inherits the same worktree, branch and starting head.
  Executor and reviewers are re-planned together, because an alternate executor
  may be the account that was reviewing and a reviewer that is also the executor
  is not an independent check. Each try reports into its own handoff directory,
  emptied as it is created, so a rerouted executor that writes nothing is never
  judged on its predecessor's file. Only when no eligible, ready alternate remains does the run fail closed
  as `INVALID_DISPOSITION` — a concluded-only result, disposition `needs-human`
  — recording `autonomousExecution: exhausted` with the accounts tried, and
  explicitly claiming no evidence requirement. `status:needs-evidence` is never
  written without a valid external request behind it.
- `GATE_PASSED` and `VERIFIED` are **concluded**, never reported. An executor
  claiming either is rejected. They are deliberately different claims:
  `GATE_PASSED` says the requested deterministic profile passed on a
  git-verified commit — and says nothing about the suites that profile did not
  run, which the record lists under `gateCoverage.notCovered`. `VERIFIED`
  additionally says the risk level's verification policy was satisfied — by
  **every** reviewer it asks for, not merely by one of them. Risk 4 asks for
  two, and one `PASS` out of two concludes `needs-review`, never `VERIFIED`.
  A single `FAIL` from any reviewer ends it regardless of the others.
- A reviewer's verdict is read from what its own process printed, never from a
  file under `runs/`. A reviewer is launched read-only and writes nothing, so
  a `report-reviewer.json` on disk could only have been placed there by the
  executor — the one process with write access to that tree.
- Before result schema 2 every gate pass was recorded as `VERIFIED`, so a
  schema-1 record reading `VERIFIED` may mean either. Schema 2 onward it means
  only the second.
- The completion level stops where the evidence stops: `IMPLEMENTED` for a
  verified commit whose gate did not pass, and `OFFLINE-PROVEN` only when the
  gate that passed left **nothing** uncovered. The default `harness` profile
  runs one suite of five, so most runs conclude `IMPLEMENTED` even when they
  conclude `VERIFIED` — the reviewers agreed, and the offline proof is still
  partial. No gate profile establishes live behaviour, so the dispatcher never
  concludes `LIVE-PROVEN`.
- An independent defect found mid-slice is reported as `newBugs` with its
  **own** fingerprint. Re-using the current issue's fingerprint is rejected:
  that is scope expansion, not a wider bug.

### The commit sha is a claim until git says otherwise

A 40-hex string in a report is text a model wrote. Before it decides anything,
`harness/run/evidence.mjs` asks git, in the executor's workspace, whether the
object exists and is a commit, whether it descends from the head this attempt
started at, whether it *is* the workspace head that the gate then ran on,
whether the workspace is clean, and whether the commit changes any file. Any
check that cannot be run — a `git` that never launched included — is "not
established", never "established fine". A run whose commit is unverified can
conclude neither `GATE_PASSED` nor `VERIFIED`, however green the gate looked.

### The reviewer does not work in the workspace it reviews

Isolation is structural, not a sentence in the brief. The reviewer runs in its
own `git worktree add --detach` checkout of the verified commit, so its subject
is fixed and cannot move under it; its session and run directory live under a
separate state root rather than beside the executor's; and
`assertReviewerIsolation()` refuses the launch outright if the reviewer's cwd
or any argv token reaches the executor's worktree or run directory.

## Worktrees

No wrapper — git already does this well:

```bash
git worktree add -b <branch> ~/Desktop/mayhem-oracle-worktrees/<slice> <BASE_SHA>
```

Keep worktrees outside the repository tree so they do not appear as untracked
paths in every other agent's `git status`. Issue dispatch derives its own
worktree path by that same rule; see **GitHub issue dispatch** above.

## Pi

Pi is the intended runtime for dispatch. Installed with:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi -v
```

Skills in `.agents/skills/` are discovered automatically once the project is
trusted (`pi --approve`). The seams the harness relies on:

| Harness concept | Pi flag |
|---|---|
| capability tier → model | `--provider <p> --model <id>` |
| effort | `--thinking low\|medium\|high\|xhigh\|max` |
| read-only verifier | `--tools read` (hard) + `allowed-tools` in the skill (declared) |
| isolated session per packet | `--session-dir <worktree>/.pi-session` |
| account slot | `PI_CODING_AGENT_DIR=<slot.accountDir>` |
| readiness probe | `pi auth check --provider <mechanism.authProvider> --json` |

**Accounts.** Pi keeps one credential per provider in
`$PI_CODING_AGENT_DIR/auth.json`, so a second account of the same provider is a
second config directory — that is the whole multi-account mechanism:

```bash
PI_CODING_AGENT_DIR=~/.pi/accounts/claude_b pi   # then /login, pick Anthropic
PI_CODING_AGENT_DIR=~/.pi/accounts/gpt_b    pi   # then /login, pick OpenAI
```

`/login` is interactive and account-specific. It is the one step that cannot be
automated here.

**A logical account slot is not an auth context.** Selecting `GPT_A` only names
a slot; the runtime still authenticates as whatever account its environment
points at. Each slot on a directory-isolated runtime therefore declares its
concrete `accountDir` in `config/routing.json`, and every route resolves it into
the assignment's `runtimeAuth` — absolute `accountDir`, `authPath`, the `env`
that binds it, and the readiness command to prove it:

```json
"runtimeAuth": {
  "runtime": "pi",
  "provider": "openai-codex",
  "accountDir": "/Users/<you>/.pi/accounts/gpt_a",
  "authPath": "/Users/<you>/.pi/accounts/gpt_a/auth.json",
  "env": { "PI_CODING_AGENT_DIR": "/Users/<you>/.pi/accounts/gpt_a" },
  "readinessCommand": [
    "pi", "auth", "check", "--provider", "openai-codex", "--json"
  ]
}
```

`checkAccountAuth(assignment, { exists, probe })` proves that context before
dispatch and fails closed on a missing directory, a missing credential, a
not-ready probe, or a probe that answers for another provider. It never falls
back to `~/.pi/agent`, to another slot, or to an API key. A slot's `authStatus`
is an operator declaration; the probe is the proof. A route through a mechanism
that isolates accounts by directory but names no `accountDir` is undispatchable.

**ChatGPT/Codex subscription OAuth is provider `openai-codex`, not `openai`.**
That is the id the credential is filed under, so `pi auth check --provider
openai` reports `credentials_not_configured` for a GPT slot that is in fact
ready — the defect that made an authenticated `GPT_A` skip its reviewer. The
mechanism's `authProvider` is the only provider id that belongs in a Pi auth or
launch flag; an account's `provider` is the vendor axis (tier lookup and
cross-provider review independence) and is never a runtime flag.

**Pi's Anthropic provider is not an authorized mechanism.** Claude Pro/Max
credentials used through Pi are billed per token as Anthropic extra usage rather
than against plan limits — subscription authentication, metered execution. The
Claude slots therefore dispatch through the native Claude Code CLI, and a route
that could only run through Pi's Anthropic provider is undispatchable rather
than downgraded to another provider's paid path. Pi's OpenAI provider signs in
through the Codex ChatGPT Plus/Pro OAuth path, which consumes that plan's
included usage, and carries the GPT slots.

## Engineering skills

Default set, by policy: `diagnosing-bugs`, `tdd`, `code-review` from
`github.com/mattpocock/skills` (MIT). Architecture-oriented skills from the same
source stay off the default path and are loaded deliberately for architectural
tasks. Repo-specific rules override generic skill defaults — no automatic push,
no automatic merge, candidate commits stay isolated, deterministic evidence is
mandatory.

```bash
npx skills@latest add mattpocock/skills     # or: claude plugins install mattpocock-skills
```

Not installed by this change: adopting skills and doing the work they describe
in the same week is how tooling displaces shipping. Install them at the next
retrospective, when there is a shipped result to compare against.

## Tests

```bash
node --test harness/test/*.test.mjs
```

Pure policy tests — no provider calls, no network. Provider-integration tests
are deferred until a second account of each provider is authenticated.

## Deferred

- **Pi extension (`.pi/extensions/oracle-router.ts`)** — a dispatch-time hook
  that would call `route.mjs` and inject the packet automatically. Deferred
  until at least one provider is authenticated in Pi, because an untested
  extension is exactly the machinery this harness exists to avoid.
- **Issue-triggered GitHub Actions** — V1 is deliberately local-only. The
  follow-up shape is `status:ready-for-agent` → a trusted Action →
  `repository_dispatch` → a self-hosted Mac runner → **this same**
  `dispatch-github-issue.sh`. No runner is installed, and none is needed: the
  local command is the acceptance criterion. See
  `docs/architecture/agent-harness.md`.
- **Stranded-claim reconciliation** — nothing reclaims an issue whose
  dispatcher was killed outright (see "When a claimed run fails"). A lease
  stamp plus a sweep that hands back claims with no live process would close
  it; V1 has neither, and says so rather than implying exactly-once delivery.
- **Quota ledger** — no provider exposes per-request token counts under
  subscription authentication. Record proxies (model, effort, files loaded,
  tool calls, duration, whether a quota warning appeared); do not invent numbers.
