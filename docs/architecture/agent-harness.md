# Agent harness architecture

Status: implemented on `feat/pi-agent-harness`, base `4eb271b`.
Operating rules: `AGENTS.md`. Usage: `harness/README.md`.
Controlling audit: `docs/reviews/2026-08-20-v08-recovery-and-harness-audit.md`.

## The objective

Minimum **stateful** control-plane complexity that still discharges every
required responsibility. Component count is not the objective; mutable state is,
because state is what drifts, fails, and has to be reconciled. A responsibility
discharged by a table that holds no state is strictly better than one
discharged by a service that does.

## State ownership

| Responsibility | Owner | Mutable state |
|---|---|---|
| Deterministic gates | `scripts/gate.sh` (commands) + `harness/verify-task.sh` (profiles) | none — reads the tree, exits a code |
| Worktree isolation | `git worktree` | git's own; no new store |
| Handoff context | `docs/task-packets/<slice>.md` | none — a file per slice, versioned with the work |
| Task classification / routing | `harness/config/routing.json` + `harness/route.mjs` | none — a lookup, re-read each call |
| Verification policy | `harness/config/verification-policy.json` | none |
| Account availability / quota pressure | Pi, once authenticated | **the only genuinely stateful responsibility** |
| Bug / work ledger | GitHub issues | **GitHub's own** — the harness reads and labels it, and stores none of it |
| Issue dispatch run records | `<git-common-dir>/mayhem-dispatch/` | per-run packet, reports, `result.json`; disposable, outside every worktree |

Five of the first six are dischargeable with zero new mutable state, and the
sixth is not implemented here: the router takes exhaustion and local auth as
*arguments*. Nothing in this directory remembers anything between calls. When
Pi owns dispatch it will supply those arguments; until then the operator does.

The last two rows are the deliberate exception, and the reason they are safe is
*where* they live. A bug that outlives a session needs a durable record; that
record is a GitHub issue, not a table in this repository. The harness never
mirrors it, caches it, or reconciles against it — it re-reads the issue on
every call, including once more immediately before it claims one. The run
records are the opposite kind of state: write-once evidence of what a single
run did, kept outside every worktree so no agent's `git status` ever sees them,
and safe to delete.

What that buys: the harness cannot go stale, cannot disagree with the
repository, and needs no reconciliation after a crash. What it costs: quota
exhaustion has to be observed and passed in rather than remembered. That is the
right trade at this scale — a quota ledger cannot be filled accurately anyway,
because no provider reports per-request token consumption under subscription
authentication.

## Why not more

This project has built two harnesses this quarter. The bounded-slice contract
(`.claude/skills/slice-contract/`) worked and produced its best root-cause
document. The `overlay-minimal-v2` governance program did not: a twelve-state
FSM, twelve case revisions, and twenty-eight frozen review checkpoints produced
zero lines of overlay code across five days — while clearing its perception
gate. A verification apparatus that cannot authorize implementation has a
correctness-per-unit-capacity of zero, however sound each individual gate is.

The lesson is specific and narrow: **do not build a control plane whose state is
the review process itself.** It says nothing about component counts. So the
review protocol here is a static table plus a read-only role, and the gate is a
shell script.

## Routing

Capability tiers, not model names: `THROUGHPUT`, `BALANCED`, `FRONTIER`. Task
classes T0–T4 map to a tier, a default effort, a parallelism cap, and a risk
level. The mapping is data; the router is a pure function; `AGENTS.md` names no
model at all, which a test enforces.

**Authentication is not usage.** Each account slot declares the execution
mechanism it dispatches through, and each mechanism declares one static fact:
whether execution consumes the plan's included usage. A runtime that
authenticates with a subscription credential but bills per token is metered
execution on subscription auth — the router drops it from the pool and fails
closed rather than substituting another paid route. One property per mechanism,
no ledger, no state.

Default concurrency is 1 — `defaultParallel` in the config, emitted on every
route. A class's `maxParallel` is a ceiling, and exceeding one executor requires
a written answer to "what uncertainty does the second one resolve?". Three or
four executors only for genuinely independent work, and never a 25/25/25/25
split — one strong account is
preserved for independent review, which the router enforces structurally by
refusing to let an account review its own work.

### Evidence used, and its standing

Public agent-evaluation results are a **routing prior, not an oracle**.
Retrieved 2026-08-20 from `https://arena.ai/leaderboard/agent`, leaderboard
self-dated 2026-08-18, 1,889,756 sessions. Independently re-fetched for this
implementation; consistent with the audit's 2026-08-20 reading.

| Model | Net improvement | Confirmed success | Steerability | Bash recovery |
|---|---|---|---|---|
| Claude Opus 5 (High) | 12.34% ±1.53 | 15.49% ±3.15 | 10.95% ±2.98 | 14.31% ±0.81 |
| Claude Opus 5 (Max) | 11.97% ±1.79 | 18.23% ±3.26 | 6.46% ±3.62 | 14.65% ±0.90 |
| Claude Fable 5 (High) | 11.64% ±1.71 | 12.41% ±3.23 | 8.67% ±3.61 | 14.00% ±2.44 |
| GPT 5.6 Sol (xHigh) | 9.80% ±1.39 | 10.12% ±2.86 | 6.01% ±2.88 | 9.67% ±1.03 |
| Claude Sonnet 5 (High) | 6.59% ±2.18 | 1.54% ±4.59 | 4.77% ±4.61 | 11.24% ±1.72 |
| GPT 5.6 Luna (xHigh) | 4.25% ±1.87 | 1.37% ±4.22 | 1.63% ±3.78 | 11.51% ±1.46 |
| GPT 5.6 Terra (xHigh) | 3.16% ±1.20 | 2.13% ±2.93 | 4.70% ±2.38 | 9.84% ±1.24 |

Four conclusions this supports, and nothing more:

1. **Maximum effort is not a default.** Opus 5 High vs Max overlap almost
   entirely on net improvement (12.34 ±1.53 vs 11.97 ±1.79) while steerability
   drops (10.95 ±2.98 vs 6.46 ±3.62). Max earns a place only where confirmed
   success dominates and mid-course correction does not — final arbitration.
2. **FRONTIER is a set, not a ranking.** Opus 5 High and Fable 5 High are
   statistically indistinguishable. Route between them by quota, not by rank.
3. **Two provider preferences are measured, not taste.** Bash recovery
   intervals are disjoint: [13.50, 15.12] vs [8.64, 10.70]. That maps onto git
   archaeology and native-concurrency debugging, which is why exactly those two
   tags carry a `basis` field in `routing.json`. Every other assignment is quota
   balancing and is labelled as such.
4. **Tool hallucination does not discriminate** among reachable options
   (1.04–1.19% ±0.17). Do not route on it.

Caveat recorded: in the fetched rendering, low-ranked rows show magnitudes
without minus signs. No conclusion above depends on that region.

Ranks are deliberately absent from `routing.json` — only tiers, the retrieval
date, and the two tagged preferences are stored, so a leaderboard change is a
data edit rather than a policy rewrite.

## Verification: Verifier-Lite

The published verification framework (arXiv 2607.05391;
`github.com/llm-as-a-verifier/llm-as-a-verifier`, MIT) computes continuous
scores as an expectation over score-token logprobs. **Claude Code and the Codex
CLI do not expose logprobs under subscription authentication**, and API billing
is out of scope, so that primitive is unavailable. Verified independently for
this implementation: the reference implementation requires backends that return
logprobs and API credentials in the environment.

What is portable is the structural half, and it is adopted in full: decomposed
criteria, independent reviewers, fixed-point diffs, mandatory evidence
citations, reversed A/B ordering, disagreement escalation. What is excluded is
the logprob-derived scoring that defines the published method — which is why the
protocol is called **Verifier-Lite** and must never be described as an
implementation of that paper. A test enforces the naming.

Two invariants sit above the protocol:

- **A deterministic gate outranks every verifier.** A failing gate cannot be
  overruled by any model, effort level, or majority.
- **A verifier is read-only and blind to the executor's reasoning.** It
  receives the spec, the fixed-point diff, the gate output, and the invariants.
  The reviewer's tool allowlist enforces this, not its prompt.

## What was deliberately not built

- No workflow database, no review state machine, no persisted chains of thought.
- No issue mirror, no job queue, no dedupe index — dedupe is exact fingerprint
  equality evaluated against the live open issues at dispatch time.
- No GitHub App, no PAT, no repository secret, and no fuzzy or model-driven
  issue matching.
- No worktree wrapper — `git worktree add` is already the right interface.
- No quota ledger — unfillable under subscription auth; record proxies instead.
- No Pi extension yet — untestable until a provider is authenticated in Pi.
- No second command list — the `rust` profile now runs
  `cd overlay/src-tauri && cargo test` because `scripts/gate.sh` owns every
  verification command and `verify-task` owns only the profile mapping.

## GitHub as the bug ledger

The harness had no answer for a defect that outlives a session. A task packet
is a good handoff and a bad ledger: it is one file, in one worktree, describing
one attempt. `harness/dispatch-github-issue.sh <issue>` closes that gap without
adding a control plane, by splitting the responsibilities that were previously
conflated in "a task":

- **GitHub owns the record.** Issue state is the truth about whether a defect
  is known, ready, being worked, or resolved. Labels carry that state;
  the machine block carries the four facts a dispatcher needs (schema,
  fingerprint, task class, base ref). Everything else on the issue is prose for
  humans, and stays prose.
- **The router still routes.** The adapter contains no account slot, no vendor
  name, and no execution-mechanism id — enforced by a test that greps its own
  source. It hands `route()` a task class and interprets what comes back.
- **A worktree is still the isolation.** One per issue, derived from the main
  worktree's own location. An existing one is resumed exactly as found: the
  resume path emits no git command at all, so there is no code path by which
  uncommitted work could be discarded.
- **The gate still decides correctness.** A reviewer is assigned by the risk
  level in `verification-policy.json`, is launched under its runtime's
  read-only flag, and never receives the executor's transcript. An executor
  cannot mark its own work `VERIFIED`.

The one genuinely new rule is epistemic rather than mechanical: a
`FIX_PROPOSED` must carry a **behavioral RED** — existing behavior violating
the issue's acceptance contract. A missing module, an unwritten file, a
scaffolding syntax error, or a missing fixture is rejected as one. Without that
rule the cheapest way to close an issue is to write a test that fails because
nothing exists yet, then make it pass; that reports a fix and proves nothing.

Guarding one exit moves the pressure to the next one. With `FIX_PROPOSED`
holding a real burden and `BLOCKED` and `INTERRUPTED` claiming nothing about
anybody, `NEEDS_EVIDENCE` became the cheapest sentence in the vocabulary — and
it is the one result that bills a *human*, because it moves the issue to
`status:needs-evidence`. An executor out of ideas could write it and the ledger
would record the operator as the blocker.

So it carries a burden of its own: an **evidence request** naming the specific
missing fact, why none of the executor's own means (repository inspection,
source and history, an offline test, deterministic experimentation, static or
runtime analysis) reaches it, the concrete external condition that gates it and
which side holds it, and the protocol for collecting it.

The two axes are deliberately different kinds, and getting this wrong in either
direction is a real failure. Close the whole thing and a genuine boundary
nobody anticipated becomes unrepresentable, so the rule starts costing honest
runs and the fix is a harness source change — which nobody will make at 3am.
Leave it all open and "external boundary" becomes whatever an executor needs it
to mean. So the *source* is closed (`external-human`, `external-system`,
`external-hardware`) because that is the part that makes the claim checkable,
and the *condition* is open text held only to being concrete enough to act on.

The second half of the rule is what happens to a refusal. An unfinished
investigation clears none of the clauses, and the tempting landing — record it
and hand the issue to a human — is wrong for the same reason the original hole
was wrong: it spends a person's attention on work no person was ever needed
for. A refused disposition is executor-incomplete, so the router is asked for
another eligible executor, excluding everyone already tried, and it inherits the
same worktree rather than starting over. Executor and reviewers are re-planned
together, because an alternate executor may be the account that was reviewing.
Only when no eligible alternate remains does the run fail closed as
`INVALID_DISPOSITION` — recording that autonomous execution was exhausted, and
claiming no evidence requirement, because none was ever established.

The distinction the rule protects is between *the agent stopped* and *the
operator owes something*, which the ledger previously spelled the same way.

### Guarding one exit moves the pressure to the next

Closing NEEDS_EVIDENCE did not remove the incentive that found it; it relocated
it. The next run reported `BLOCKED` with a paragraph of honest reasoning — the
root cause was unidentified, the causal operation was unidentified, a change
would have been speculative — and the ledger recorded a stop that reads like an
external obstacle. Nothing was guarding it, because BLOCKED bills nobody and so
looked like it claimed nothing. It does claim something: that the work became
impossible.

So BLOCKED carries a blocker, shaped like an evidence request: which requested
action stopped, the concrete condition, a closed source axis, why this executor
cannot get past it, and what would clear it. The unfinished-run phrasings are
screened by class rather than by phrase, and a refusal reroutes through the
mechanism the evidence rule already built — the third door was closed by the
same lock, not a new one.

The load-bearing choice is which actions are blockable: the engineering phases
broadly — `investigate`, `reproduce`, `implement`, `test`, `commit` — minus
checking. That omission is the rule. Issue #48's gate was genuinely red on
pre-existing type errors, and that is a real constraint on what the run may
conclude; it is not a reason to stop investigating a defect, reproducing it,
writing a repair, exercising it or committing it. Verification blockers are
therefore a separate thing that rides along with whatever result the work
reached and decides no disposition. An executor facing a broken checker is
expected to keep working and say what it could not check.

Naming the phases narrowly was itself a mistake, found the same way: an obstacle
does not wait for the implement step to arrive, and an executor denied the log
it must read to investigate at all had no true word for that. An unsayable truth
is its own pressure towards the wrong word, so the phase list is broad and the
screening stays where it belongs — on whether the thing named is a checking
authority, not on how early it was hit.

The first cut of the cap was too coarse in the other direction: any blocker at
all erased every offline-proof claim. That answers "the overlay checker would
not run" with "then nothing is proven", which is false in the direction that
discards evidence the controller produced itself. A blocker caps what depends on
the surface it names. The unqualified `OFFLINE-PROVEN` still means everything
ran and nothing was left unchecked, so any blocker withholds it — but the scoped
proof survives as `provenSurfaces`, the suites the gate ran less the ones a
blocker names. Only suites that actually ran can appear there, so the older rule
holds unchanged: coverage the controller did not produce cannot be claimed.

Then the pressure moved once more. With NEEDS_EVIDENCE and BLOCKED both
carrying claims that have to be shown, `INTERRUPTED` was the last word in the
vocabulary that owes nobody anything — and an executor could still write it.
"INTERRUPTED: I could not work it out" landed `needs-human` unchallenged, which
is the original failure with a different label on it.

The fix is ownership rather than phrasing, because phrasing was never the
mechanism: whether an execution was interrupted is an observation about the
runtime, and only the thing that ran the runtime can make it. A report that
parsed is an execution that reached the point of answering, so `INTERRUPTED`
joins the concluded-only results and an executor-written one is refused and
rerouted through the machinery the first two doors already built. When a runtime
genuinely dies and writes nothing, the controller synthesizes its own — that is
the same observation, made by the party that can actually make it.

Three doors, one lock. The pattern that closes each is worth naming: a
structured claim with a closed axis and an open condition, prose screened by
class rather than by phrase, refusal rerouted to another executor, and
exhaustion recorded as exhaustion. What it cost each time was not the guard but
noticing which exit the incentive had moved to.

### A claim about the repository is not settled by the claimant

The fourth door was not a disposition at all. Attempt 14 reported FIX_PROPOSED
with a real behavioral RED and the sha `3ba2b37a2acec297808d21572912fbe6be0283f8`.
The controller ran its own commit check, got `commit-not-found`, recorded the
refusal — and concluded `FIX_PROPOSED` / `needs-human` anyway.

The root cause was ordering, not a missing check. Commit evidence was computed
after the reroute loop had already accepted the report, so its only remaining
power was to cap what the run could conclude. The contract can establish that a
sha is well-formed; only git can establish that it is real, and asking git after
the answer was accepted meant a fix nobody committed reached the ledger as a
proposed fix. So the evidence check moved inside the loop and became part of
accepting the disposition: a claim the repository refuses is not a weaker
result, it is not a result, and it takes the road the other three doors already
built.

The origin of the sha is worth recording, because it generalises. The candidate
worktree was at `3ba2b37ecdc1eae66ed6111ce6562bc5df85d105`, and
`git rev-parse --short HEAD` there prints exactly `3ba2b37`. The claimed sha
shares those seven characters and diverges at the eighth: the executor read
git's abbreviation and supplied the remaining thirty-three itself. That is not a
transcription error, and no serialization step touched it — the executor's own
`report-executor.json` holds the fabricated value verbatim.

Hence the second rule: no character of a commit id may be supplied by the thing
being judged. Existence and identity are separate questions, and the harness now
asks git both — `cat-file -e` for the first, `rev-parse <sha>^{commit}` for the
second — then measures ancestry, head and diff against *git's* id rather than
the report's. The record keeps the claim and the observation apart so a
disagreement is visible rather than normalized away.

The pattern is the one the three dispositions taught, applied to a field rather
than a word: whatever a run asserts, ask the authority that can actually answer,
and ask it before the assertion is accepted rather than after.

### An authority with a fallback is not an authority

Closing the commit claim left one more way for something nobody asserted to
become a result. When `report-executor.json` was absent the dispatcher scraped
the last JSON object out of the runtime's captured stdout and used it as the
report. Everything the previous rules established — the disposition contract,
the evidence request, the blocker, the commit check — sat downstream of a source
that was never authoritative: whatever the model happened to print. A draft, a
worked example, a shape it was reasoning about rather than asserting, all of it
one `JSON.parse` away from being the run's answer.

The fix is removal, not a better parser. A parser sophisticated enough to tell
an asserted report from a printed one would still be guessing at intent, and
intent is exactly what writing a file to a path you were given already
expresses. So there is one source, `run/report.mjs`, and output is diagnostic:
echoed for the operator, kept nowhere the lifecycle can reach.

Removing it exposed a conflation the fallback had been hiding. "No report" was
being spelled INTERRUPTED, which is true of a runtime the kernel killed and
false of one that ran to a clean exit and simply did not write. The second is a
protocol failure — the executor was handed the path and declined it — and
calling it an interruption gave it the one word that owes nobody an explanation,
stopping the run where it should have rerouted. The two are now told apart by
how the process ended, in the terms `run/process.mjs` already draws, and only
the first stays the controller's observation.

The same run also asserted in prose that 117 tests passed while declaring none,
on a profile that does not run them. Prose was never evidence here, but the
ledger had not said so out loud: `tests` is now labelled executor-declared, the
gate controller-observed, declared tests in uncovered suites are flagged, and
report prose reaches no ledger line at all.

### A rule that names the wrong thing

Attempt 15 refused a correct answer twice, and both refusals came from a rule
that was right about the principle and wrong about what it was pointing at.

The first: a resumed workspace starts at the previous attempt's commit, so an
executor sent to validate that candidate has, correctly, nothing to commit. It
reported the candidate. `commit-is-starting-head` refused it — the rule that
stops a FIX_PROPOSED which committed nothing. What that rule is actually about
is a workspace sitting on the untouched base, where naming the head claims a fix
that is the base itself. "The head this attempt started from" was a serviceable
proxy for that only while every attempt started from the base.

Deleting the check was not an option: it is the one that catches a fix nobody
made. Nor was accepting inheritance on the executor's say-so, which would let
any report name its own starting point. So the candidate's provenance became
something git establishes, like everything else here. If the sha is ahead of the
starting head it was `produced-this-attempt` and is measured from there, exactly
as before. If it *is* the starting head it is `inherited`, and it is measured
against the pinned base — the one point in this history the attempt did not
choose. It must descend from the base, differ from it, and change a file against
it, and if no base was recorded there is nothing to measure against and it fails
closed. The untouched-base case still fails, because that is the case the rule
was always about.

Provenance then propagated, as facts of this kind do: the reviewer's diff was
computed from the starting head, which for an inherited candidate is the
candidate — an empty diff, and a reviewer handed nothing to review. The evidence
now carries the base each candidate is a change to, and the brief is built from
that.

The second refusal was the mandatory report. The executor did the work and could
not write `report-executor.json`, because the path it was given lived under the
repository's own `.git`, which its runtime treats as sensitive regardless of the
directory grant it was handed. It exited 0 with nothing written, and the
lifecycle classified that as `missing-required-report` and rerouted — which is
precisely correct, and precisely useless, because the next executor would have
been handed the same address.

`.git/mayhem-dispatch/` is the right home for the controller's own record and
the wrong one for a drop-box an agent has to write into. The two had been the
same directory only because both were "run state". They are now separate: a
handoff directory outside the repository, created per try and emptied as it is
created, its writability proven before the turn is spent rather than discovered
after, its path named in the packet and granted to the runtime. The controller
copies the raw bytes back into `runs/` afterwards — including a file that would
not parse, which is the file a person debugging this most wants to see.

Nothing about who may speak changed. Output is still diagnostic, the report file
is still the whole of what an executor said, and an executor that exits clean
without writing one has still declined the protocol. The authority rule was
never the defect; it was the only thing in the run that behaved correctly.

### A contract stated twice is two contracts

Attempt 16 stopped on a rule the controller no longer held. The workspace was
resumed and its head was already this issue's candidate, which since the
previous change is a candidate an executor may report. The executor did not know
that: the skill it was handed still told it to confirm HEAD was `BASE_SHA` and
stop if it was anywhere else, and the packet still told it a commit must descend
from the head the attempt started at. So it read the workspace it had been
given, found HEAD ahead of the base, and reported that as a blocker.

The controller refused the blocker — correctly, by the rule that an unfinished
run is not an obstacle — and rerouted. Rerouting was the right move and bought
nothing, because the next executor was handed the same brief. That is the shape
of the defect: not a wrong rule anywhere, but one rule written down in two
places, where fixing the enforcing copy left the instructing copy behind. A
contract stated twice is two contracts, and they drift in the direction of
whichever one nobody tested.

What was missing was the fact the rule turns on. The controller has always known
whether it created a workspace or resumed one; the executor was told only where
the base was, which is the same sentence in both cases and the wrong sentence in
one of them. So `WORKSPACE_ACTION` and `STARTING_HEAD` go in the packet beside
`BASE_REF` and `RESOLVED_BASE_SHA`, and the packet states the candidate rule for
the workspace that was actually planned. A fresh workspace's head is the pinned
base and a candidate is a commit made after it. A resumed workspace's head may
be ahead of that base, may already be the candidate, and is something to inspect
rather than stop for — and manufacturing a no-op commit to move the sha is named
as the wrong answer it is, because an executor with no way to say the true thing
will find a way to say something.

`BASE_REF` and `RESOLVED_BASE_SHA` do not move. Re-baselining an issue onto its
own candidate would make the provenance agree with the workspace by destroying
the only point in the history the attempt did not choose — the point inheritance
is measured against. The fix is that the executor is told which workspace it is
in, not that the base is redefined to match it.

### An observation nobody can check is not diagnosable

The same run's second try exited 1 and wrote no report. The controller
synthesized `INTERRUPTED` and recorded "executor exited 1 without a report",
which is exactly the right disposition and exactly the right sentence — and
leaves a person with nothing. The exit code was in it; everything that would
explain the exit code was not. The runtime's own account of what happened had
been echoed to a terminal and never written down, so the durable record of a
failed run held the report that was never written and nothing else.

Ownership decides the fix. Whether an execution was interrupted is the
controller's observation, and so is how it ended: every executor try now leaves a
controller-owned `process-executor.json` beside that try's report, with the
process's stdout and stderr as files. It carries the account, the mechanism, the
runtime, the cwd, the timing, whether the program ran at all, its exit status,
the signal that killed it, and a termination classification that keeps a
controller deadline apart from an ordinary kill and both apart from a launch
that never happened — along with whether the required report existed when the
process stopped. It is written before anything is concluded from how the process
ended, so a launch failure is as diagnosable as an exit 1, and a writer that
fails records that and lets the run continue: bookkeeping does not outrank work.

Two lines are load-bearing. The first is that none of it is authority. Adding a
durable copy of stdout is the same material the earlier fallback read a report
out of, and the rule that killed the fallback has to survive the file: a
perfectly-formed lifecycle result printed to the console is a string in a log
here exactly as it was a string on a terminal before, and the report file
remains the only place an executor makes a claim.

The second is that a terminal is not a file. Output nobody stores can carry a
credential and the damage ends with the scrollback; output written beside a
repository does not. So environment values never reach the record — only the key
names, which is what tells a missing credential from a rejected one — the exact
values the controller injected are masked out of both streams along with
anything token-shaped, and the launch line is recorded as the shape the
mechanism declared rather than as the rendered argv, so no path and no secret
arrives through a substitution nobody thought about.

### A proxy is not the invariant it stands for

Attempt 17 sent two executors at the same issue. Both produced canonical
commits, both exited normally, both claimed a sha that was exactly what git
resolved and exactly the workspace head. Both were refused, and both refusals
said the same three words: `worktree-dirty`. The tracked diff was empty. The
index was empty. Every path `git status` had to report was an untracked evidence
artifact left behind by attempts 02 through 16 — pinned manifests, raw live
traces, red and green logs, gate logs, final diffs — under `.codex/evidence/`,
`.codex/gates/` and `debug-evidence/`.

The invariant the check exists for is not in doubt: a gate result describes the
candidate commit plus the environment inputs the gate itself declares, and
nothing else. A workspace holding uncommitted work means the gate tested
something no commit contains, so its PASS proves nothing about the commit it was
asked to prove. That is worth failing closed over.

What was wrong was the question. "Is `git status --porcelain` empty" is not that
invariant; it is a proxy for it, and the proxy fails in both directions. It
refused two correct commits because a directory of traces made a string
non-empty, and it would have said "clean" about a workspace whose contamination
had been committed. A proxy that is wrong in both directions is not a
conservative approximation of the rule — it is a different rule that happens to
agree with it most of the time.

So the question is asked properly, per path. Tracked modifications and staged
changes reach the gate, because the gate reads the working tree; that half was
always right and is unchanged. An untracked file reaches the gate only if some
suite discovers, imports, compiles or executes it — and that is not answerable
from a filename. It is a property of the gate.

The gate already declares what each suite reads, because `scripts/gate.sh` is
already the one place a suite is defined. It now also declares the roots no
suite can reach, with the proof written beside them: every suite's discovery is
rooted somewhere explicit — a literal directory glob for the harness suite, a
pinned `include` for web vitest, `overlay/` for the overlay suite, the skills
suite's own `scripts` directory (a *sibling* of `.codex/evidence/`, not a
parent), `overlay/src-tauri` for cargo — and none of those roots is an ancestor
of a declared one. No tracked file any of them reaches reads out of one either:
the only references in the repository are prose comments transcribing numbers
that were copied into the source.

Everything untracked outside a declared root blocks. That keeps the default
fail-closed, which is the half that matters: an unrecognized path is a path
nobody has shown to be harmless, so an untracked `overlay/src/foo.ts`, an
untracked lockfile and an untracked `harness/test/planted.test.mjs` all still
refuse the candidate exactly as they did before.

And the declaration is a claim like any other, so it is checked. A root that
contains something the gate says it reads is not honored at all — declaring
`.codex/` would exempt the skills suite's own tests, so it exempts nothing — and
a file that matches a declared gate input blocks wherever it sits, including
inside a root whose name looks like evidence. A suite added later that never
declared a root does not inherit the exemption; the root stops being honored
until somebody examines it for that suite.

The record changed with the rule. `worktree-dirty` named a condition and
identified nothing, so the refusal now names the category and the paths, and a
run that proceeds records both facts separately: `cleanForCandidate` says the
gate tested this commit, and `statusEmpty` says whether `git status` was empty —
which, in attempt 17's workspace, it was not. Calling that repository clean
would be the same conflation facing the other way. Alongside them the record
keeps what this attempt found already here and what appeared since, per try, so
a rerouted executor refused for its predecessor's leftovers is distinguishable
from one refused for its own. The rule does not change with that answer —
evidence blocks nobody and untracked source blocks whoever left it — but the
question "who left this here" is one an operator will ask, and a record that
cannot answer it sends them to a machine that has already moved on.

### A claim is a promise

Splitting the record from the executor creates one failure mode that neither
half owns alone: a dispatcher that has already written `status:agent-working`
and then dies mid-slice. GitHub still says the issue is being worked; nothing
is working it. That state is worse than never having claimed it, because it is
indistinguishable from progress.

The rule is therefore that a claim is a promise, and everything after it runs
inside a single recovery boundary. Any bounded failure — worktree, base
resolution, executor launch, executor report, gate, review, conclusion, result
write, GitHub report — records the run `INTERRUPTED` with the stage that
failed, writes `result.json` first so the durable evidence survives an
unreachable GitHub, and hands the issue back as `status:blocked`.

Three choices are deliberate:

- **One recovery state, not a taxonomy.** The dispatcher does not classify a
  failure as retryable, human, or transient; it names the stage and stops. A
  state machine that guesses is a state machine that guesses wrong at 3am, and
  the stage plus the error class is what a human actually reads.
- **No retries.** A failed run leaves an issue a human can re-label. Automatic
  retry converts one broken slice into a loop against a rate limit.
- **Recovery arms only after the claim is genuinely held.** A refused claim
  owes nothing back, so it never enters the boundary — and the failure
  reporting never says GitHub was recovered when the label write itself failed:
  that case raises an error carrying both facts and exits nonzero.

Failure text is redacted and truncated before it is written or posted. An error
message can carry a command line, and a command line can carry a token; issue
comments are public relative to the repository.

**The limit, stated rather than implied.** This covers in-process failures.
`SIGKILL`, a crashed machine, and power loss run no handler, so they still
strand a claim and leave a lock directory behind; recovering those needs a
lease and a sweep, which V1 does not have. The harness would rather document a
gap than imply exactly-once delivery it has not built.

### Why not GitHub Actions yet

The acceptance criterion for V1 is local, because the interesting failure modes
— a mis-claimed issue, a worktree collision, a reviewer that is also the
executor, a RED that is not a reproduction — are all reproducible on this
machine and none of them need a runner. The follow-up shape is deliberately
boring:

```
issue labelled status:ready-for-agent
  -> a trusted, pinned Action in this repository
  -> repository_dispatch
  -> a self-hosted macOS runner
  -> the SAME harness/dispatch-github-issue.sh
```

The runner adds a trigger, not a second dispatcher — if the Action ever needed
its own logic, the split would be wrong. It stays unbuilt until the local
command has proven itself on real issues, and it requires a self-hosted runner
because the subscription-authenticated CLIs live on this machine; a hosted
runner would have no authorized way to execute anything.
