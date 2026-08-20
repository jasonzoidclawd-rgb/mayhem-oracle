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
"Could not reproduce" is `NEEDS_EVIDENCE` and never becomes a fix.

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
