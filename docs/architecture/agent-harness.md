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

Five of six are dischargeable with zero new mutable state, and the sixth is not
implemented here: the router takes exhaustion and local auth as *arguments*.
Nothing in this directory remembers anything between calls. When Pi owns
dispatch it will supply those arguments; until then the operator does.

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
- No worktree wrapper — `git worktree add` is already the right interface.
- No quota ledger — unfillable under subscription auth; record proxies instead.
- No Pi extension yet — untestable until a provider is authenticated in Pi.
- No second command list — the `rust` profile now runs
  `cd overlay/src-tauri && cargo test` because `scripts/gate.sh` owns every
  verification command and `verify-task` owns only the profile mapping.
