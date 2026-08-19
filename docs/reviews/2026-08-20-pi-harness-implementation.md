# Pi harness implementation — 2026-08-20

Control-plane task, executed in parallel with a native-starvation reproduction
owned by a separate agent. No product code was touched. Nothing was pushed,
tagged, or merged.

Controlling input: `docs/reviews/2026-08-20-v08-recovery-and-harness-audit.md`
(revision 2), plus its two proposal files. Where the task brief and the audit
disagreed, the disagreement is recorded below rather than silently resolved.

Evidence grades: **OBSERVED** (ran it, saw the output), **SOURCE-PROVEN** (read
in source), **TEST-PROVEN** (a deterministic gate demonstrated it),
**DEFERRED**, **UNVERIFIED**.

---

## A. Starting repository state

| Fact | Value | Grade |
|---|---|---|
| Primary checkout | `/Users/jason/Desktop/mayhem-oracle`, branch `claude/windows-overlay-clickthrough`, HEAD `5047c19`, dirty | OBSERVED |
| Base for this work | `4eb271b` — tip of `feat/overlay-tier-card`, the V0.8-CANDIDATE line | OBSERVED |
| Why that base | The audit and both proposals were written against `4eb271b`; `main` (`bf605c4`) lacks `.claude/skills/slice-contract/`, `scripts/checkpoint.sh`, and the AGENTS.md sections they extend | SOURCE-PROVEN |
| Audit location | Untracked in `.claude/worktrees/overlay-tier-card/docs/reviews/` — it exists on no branch | OBSERVED |
| Registered worktrees at start | 21 | OBSERVED |
| `scripts/gate.sh` | did not exist (proposal only) | OBSERVED |
| eslint at base | clean, exit 0 — checked before wiring it into the gate | OBSERVED |

Read before writing anything: the audit in full, both proposals, `AGENTS.md`,
`CLAUDE.md`, `CO_WORKFLOW.md`, `scripts/update-state.sh`, `scripts/test-state.sh`,
and `.git/hooks/post-commit`.

## B. Pi version / install state

| Fact | Value | Grade |
|---|---|---|
| Before | `command -v pi` → not found; no `~/.pi` | OBSERVED |
| Installed | `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` | OBSERVED |
| Version | **0.84.2** at `/opt/homebrew/bin/pi` | OBSERVED |
| Config dir | `~/.pi/agent/` created with `auth.json` and `models-store.json`, mode 0600 | OBSERVED |
| Credentials | none configured — `pi auth check --provider anthropic --json` → `{"status":"not_ready","reason":"credentials_not_configured"}`; same for `openai` | OBSERVED |
| Paid providers | none enabled. No API key was set, in Pi or anywhere else | OBSERVED |
| Existing config | Claude Code and Codex configuration untouched | OBSERVED |

Pi's own CLI confirmed the seams the harness routes onto — `--provider`,
`--model`, `--thinking {off,minimal,low,medium,high,xhigh,max}`, `--tools`
allowlist, `--session-dir`, `--mode rpc`, `PI_CODING_AGENT_DIR`. **OBSERVED.**
The harness effort ladder is a subset of Pi's `--thinking` levels, asserted by a
test rather than assumed.

**Stopped at the authentication boundary.** `/login` is interactive and
per-account. The exact next step is in §C.

## C. Account setup state

Target pool is 2 Claude Pro + 2 ChatGPT Plus. That is a given, not something
local credential state revises. Local authentication is setup debt.

| Slot | Provider | Pool | Authenticated for Claude Code / Codex | Authenticated for Pi | Action |
|---|---|---|---|---|---|
| CLAUDE_A | anthropic | yes | **yes** — `claude_pro`, `stripe_subscription` | no | `PI_CODING_AGENT_DIR=~/.pi/accounts/claude_a pi` → `/login` → Anthropic |
| CLAUDE_B | anthropic | yes | **no** — one credential in the keychain, one `oauthAccount` | no | same, `claude_b`, second account |
| GPT_A | openai | yes | **yes** — Codex CLI 0.148.0, ChatGPT OAuth, `OPENAI_API_KEY` absent | no | `PI_CODING_AGENT_DIR=~/.pi/accounts/gpt_a pi` → `/login` → OpenAI |
| GPT_B | openai | yes | **no** — single `~/.codex/auth.json` | no | same, `gpt_b`, second account |

Pi stores one credential per provider in `$PI_CODING_AGENT_DIR/auth.json`, so a
second account of the same provider **is** a second config directory. That is
the entire multi-account mechanism, and it needs no harness code. **SOURCE-PROVEN**
(providers doc + environment-variables doc), directory layout **OBSERVED**.

Readiness is machine-checkable without a wrapper:
`pi auth check --provider anthropic --json`.

## D. Architecture implemented

```
harness/verify-task.sh          the deterministic gate, profile-selected
harness/route.mjs               pure routing + task-packet validation
harness/config/routing.json     accounts, capability tiers, task classes, effort
harness/config/verification-policy.json   risk levels, criteria, verifier rules
harness/schemas/task-packet.schema.json   required packet fields + constraints
harness/test/*.test.mjs         28 policy tests, no network, no provider calls
harness/README.md               usage, Pi seams, deferred items
docs/task-packets/TEMPLATE.md   the packet
docs/architecture/agent-harness.md   rationale + the evidence behind routing
.agents/skills/mayhem-task/     executor role
.agents/skills/mayhem-review/   read-only verifier role
```

Eleven files. Four things in the brief's suggested structure were deliberately
**not** built — see §N.

## E. State ownership

| Responsibility | Owner | Mutable state |
|---|---|---|
| Deterministic gates | `harness/verify-task.sh` | none — reads the tree, exits a code |
| Worktree isolation | `git worktree` | git's own |
| Handoff context | `docs/task-packets/<slice>.md` | none — a file per slice |
| Task classification / routing | `harness/config/routing.json` + `route.mjs` | none — a lookup per call |
| Verification policy | `harness/config/verification-policy.json` | none |
| Account availability / quota pressure | Pi, once authenticated | **not implemented here** |

**STATEFUL COMPONENT COUNT: 0.** The router takes exhaustion and local auth as
arguments (`--exhausted`, `--available`); nothing in `harness/` remembers
anything between calls. The one genuinely stateful responsibility is left to Pi
because a quota ledger cannot be filled honestly today — neither Claude Code nor
the Codex CLI reports per-request token consumption under subscription
authentication.

Cost of that choice, stated plainly: exhaustion must be observed and passed in
rather than remembered. That is the right trade at this scale, and it means the
harness cannot go stale or need reconciliation after a crash.

## F. Model routing policy

Capability tiers, never model names. `THROUGHPUT` / `BALANCED` / `FRONTIER`,
mapped per provider in `routing.json`.

| Class | Work | Tier | Effort | Risk | Max parallel |
|---|---|---|---|---|---|
| T0 | retrieval / mechanical | THROUGHPUT | low | 0 | 4 |
| T1 | bounded coding | BALANCED | medium | 1 | 2 |
| T2 | difficult debugging | BALANCED → FRONTIER | high | 2 | 1 |
| T3 | concurrency / architecture / contradictory evidence | FRONTIER | high | 3 | 1 |
| T4 | disputed / release-critical | FRONTIER, cross-provider | high | 4 | 2 |

Account preference order per class is data (`preferAccounts`), reflecting the
conceptual roles — CLAUDE_A architecture/orchestration, GPT_A primary bounded
executor, the B accounts as independent reviewers — as defaults, not bindings.
Load is not split evenly; default useful concurrency is 1–2.

**Effort routing.** Default medium. `xhigh` and `max` are never a default: the
router refuses them unless requested explicitly *and* given one sentence of
justification, which it echoes into the result. TEST-PROVEN.

**Fails closed** on: unknown task class; unknown effort; unjustified escalation;
no authorized account available; too few accounts for the required number of
independent reviewers. Every route carries `auth: "subscription"`, and no path
emits a metered-API route.

Observable consequence worth acting on: **T4 is currently undispatchable.** Two
independent reviewers plus an executor needs three accounts; two are
authenticated. The router says so and names the setup gap instead of quietly
letting an account review its own work.

## G. Current Arena evidence used

Re-fetched independently for this task, not inherited: `arena.ai/leaderboard/agent`,
retrieved **2026-08-20**, leaderboard self-dated **2026-08-18**, 1,889,756
sessions. Consistent with the audit's reading (1,893,896 — ordinary drift).
**OBSERVED.** The table and the four conclusions it supports are in
`docs/architecture/agent-harness.md`.

Standing: **routing prior, not an oracle.** Never overrides a deterministic gate
or a reproduction. Ranks are not stored in the repository — `routing.json` keeps
tiers, the retrieval date, and exactly two tagged provider preferences
(`git-archaeology`, `native-concurrency`) whose basis is the disjoint
bash-recovery interval. Every other assignment is quota balancing and the router
labels it as such rather than dressing it as a quality claim.

## H. Token / quota policy

1. Run the gate before asking any model about correctness — it is faster,
   cheaper, and more trustworthy than any reviewer.
2. Send a task packet, never a transcript. No repository dump, no evidence tree,
   no multi-day history.
3. Never read a multi-megabyte runtime log into a model context; grep it.
4. Default effort medium; escalate on evidence, not on importance.
5. One executor per slice. A second candidate requires a written answer to
   "what uncertainty does B resolve?"
6. Fresh bounded session per packet; conversation history is disposable cache.
7. **No quota ledger.** Per-request token counts are unavailable under
   subscription auth. Record proxies — model, effort, files loaded, tool calls,
   duration, whether a quota warning appeared. Do not fabricate numbers.

## I. Matt Pocock skills adopted

Verified current upstream: `github.com/mattpocock/skills`, MIT, install via
`npx skills@latest add mattpocock/skills` or
`claude plugins install mattpocock-skills`. All three named defaults exist as
model-invoked skills. **OBSERVED.**

Adopted by policy: **`diagnosing-bugs`**, **`tdd`**, **`code-review`**.
Available on demand but off the default path: `codebase-design`,
`improve-codebase-architecture` — load them deliberately for an architectural
task so they cannot become a substitute for shipping.

Their text is not reproduced in `AGENTS.md`. Mayhem-specific rules override
generic skill defaults: no automatic push, no automatic merge, candidate commits
stay isolated, the orchestrator selects integration, deterministic evidence is
mandatory.

**Not installed by this change** — deliberate, following the audit's sequencing:
adopting three skills and attempting the native defect in the same week
reproduces the pattern where tooling investment displaces the fix. The exact
command is in `harness/README.md`; installation also writes outside the
repository, which is the user's call.

## J. Verifier-Lite implementation

The published method (arXiv 2607.05391, MIT reference implementation) scores by
taking an expectation over score-token logprobs. Independently re-verified: the
reference implementation requires backends that return logprobs and API
credentials in the environment. Subscription authentication exposes neither, and
API billing is out of scope. **The exact mechanism is therefore unavailable.**

Implemented as `harness/config/verification-policy.json` plus
`.agents/skills/mayhem-review/`:

- **Adopted** — decomposed criteria (the nine), independent reviewers,
  fixed-point diffs, mandatory evidence citations, reversed A/B ordering,
  disagreement escalation.
- **Excluded** — logprob-derived continuous scoring; the pivot tournament
  (irrelevant at N≤2).
- Risk 0→4 maps to 0, 0(+1 optional), 1, 1 cross-provider, 2 cross-provider with
  reversed A/B.
- Findings carry CLAIM / EVIDENCE / SEVERITY / CONFIDENCE / VIOLATED_INVARIANT.
- The verifier receives spec, fixed-point diff, gate output, invariants — and
  **never** the executor's reasoning transcript or write access.
- A deterministic gate outranks every verifier, always.

Read-only is enforced, not merely asserted: the reviewer skill declares
`allowed-tools: [read]`, a test fails if `write`, `edit`, `bash`, `multiedit`, or
`apply_patch` ever appears there, and dispatch uses Pi's `--tools read`
allowlist. A test also fails if any file describes Verifier-Lite as an
implementation of the published paper.

## K. AGENTS.md changes

Additive only; nothing rewritten or removed. Four sections: **The Deterministic
Gate Comes First**, **Model Routing and Effort**, **Task Packets**, **Review
Independence**. +125 lines.

Adapted rather than copied from the audit's addendum, because that draft
contained model names, measured test counts, retrieval dates, and leaderboard
intervals — all of which the task brief forbids in an always-loaded instruction
file. Those live in `docs/architecture/agent-harness.md` and in this report
instead. A test greps `AGENTS.md` for model names, test counts, leaderboard
language, and machine state, and asserts it still points at the harness paths.
That doubles as the proof that a tier mapping can change without editing it.

## L. CLAUDE.md changes

- The `<!-- STATE:START -->` block is **removed**, and `scripts/update-state.sh`
  no longer writes any instruction file. It still regenerates
  `scripts/state.json`, whose only consumers are `install-hooks.sh` and
  `test-state.sh`; the pre-existing `bash scripts/test-state.sh` still passes.
- `.git/hooks/post-commit` was **not touched** — it is shared by every worktree,
  including the parallel task's.
- Added **Loading Context** (read AGENTS.md first; load packet → spec → skill →
  architecture only when needed; inspect the repository instead of trusting
  conversation memory), **Current State** (query, don't record), and **Working
  Posture** (executor narrow, reviewer read-only, uncertainty graded, no push).

**Recorded disagreement.** The brief asks CLAUDE.md to *become* a small loader.
The audit says the rest of the file — project context, contracts, data pipeline
— is durable and correctly placed, and `AGENTS.md` explicitly delegates that
content to it. Gutting it would break that pointer and would be the unrequested
churn `AGENTS.md` rule 3 forbids. Resolution: loader added at the top, volatile
state deleted, durable content left alone. Flagged rather than decided silently.

## M. Deterministic harness tests

`node --test harness/test/*.test.mjs` — 28 tests, pure policy, no network, no
provider calls. Every §18 requirement has a test:

| Requirement | Test |
|---|---|
| Task packet validates | template validates; missing/empty sections fail |
| Unknown task tier fails closed | `T9`, `undefined`, `""` all throw |
| Routing never silently selects max/xhigh | no class defaults to either; both require explicit request + justification |
| Verifier cannot mutate the candidate worktree | reviewer tool allowlist excludes write/edit/bash; verifier packet sharing the executor's worktree is an error |
| Parallel executors get different worktrees | two packets naming one worktree is an error |
| Missing account ≠ paid fallback | routes on one account, `auth: subscription`, billing flags false, error text names no API/credits path |
| Quota exhaustion reroutes new work | exhausting the primary yields a different authorized account |
| Task stays bound to its base SHA | short SHA and branch name both rejected |
| Tier mapping changes without editing AGENTS.md | swap a model in cloned config → new route; AGENTS.md contains no model name |

Plus: risk levels escalate monotonically; verifier independence fields; the
five finding fields and nine criteria; skill frontmatter satisfies Pi's
discovery contract; instruction-file hygiene; every harness effort level is a
level Pi accepts.

**Full gate at `b1aac45`** — `bash harness/verify-task.sh all`, exit **0**:

| Suite | Result |
|---|---|
| harness policy | **28/28** |
| task packet template | OK |
| web unit | **1209/1209** (116 files, 4.01 s) |
| eslint | exit 0 |
| overlay unit | **727/727** (60 files, 1.28 s) |
| overlay types (`tsc --noEmit`) | exit 0 |
| skill suite | **317 tests OK** (19.1 s) |
| skill cwd | PASS |
| rust | **NOT COVERED — declared in the output, not hidden** |

`bash harness/verify-task.sh rust` exits **2** with `GATE: BLOCKED`. An unknown
profile exits 2. OBSERVED.

## N. Deliberately deferred

| Item | Why |
|---|---|
| **`rust` gate profile** | The validated `cargo test` command is owned by the parallel task. `cargo test` runs today in exactly one place — `.github/workflows/windows-overlay.yml` — so it never runs on macOS or locally. Guessing it would let a red Rust test report green. Fails closed instead. |
| **Pi extension `.pi/extensions/oracle-router.ts`** | Pi has no credentials yet, so an extension cannot be executed, let alone tested. Untested orchestration machinery is exactly what this harness exists to avoid. Routing is already a CLI any harness can call. |
| **`create-worktree` wrapper** | `git worktree add` already does this cleanly. |
| **Quota ledger / account state store** | Unfillable under subscription auth. Proxies recorded instead. |
| **Provider-integration tests** | Would require a second authenticated account per provider. Not faked. |
| **Pocock skill installation** | Sequencing (§I); also writes outside the repository. |
| **Billing settings** | §O. |

## O. Conflicts avoided with the parallel task

| Boundary | What I did |
|---|---|
| Worktree | Created `/Users/jason/Desktop/mayhem-oracle-worktrees/pi-agent-harness`, **outside** the repository — no new untracked path in anyone else's `git status`. Never entered `.claude/worktrees/overlay-tier-card` except to read. |
| Rust | Touched no `.rs` file, no `surface_probe.rs`, no `lib.rs`, no native capture, no overlay runtime or scheduling behavior. |
| Gate | Did **not** wire `cargo test` into any gate. Defined the stable interface `verify-task <profile>` and left `rust` failing closed. |
| `scripts/gate.sh` | Not created — the name the audit proposal claims is left free. `harness/verify-task.sh all` subsumes it; if `gate.sh` later appears, `verify-task` should delegate to it, not duplicate it. |
| `~/.codex/config.toml` | Read only. `model_reasoning_effort` was `"xhigh"` at the start of this session and is **now `"medium"`** — the parallel task's edit landed. I did not race it. |
| `.git/hooks/post-commit` | Not touched — shared by every worktree. |
| Branch | Based at `4eb271b`, the pre-existing tip. Nothing merged, nothing cherry-picked, nothing pushed, nothing tagged. |

**Merge implication, stated because it is the user's call:** this branch is
based at `4eb271b`, so integrating it also integrates the 73-commit overlay
line. If the harness should land on `main` independently, the eleven new files
are additive and rebase cleanly; the three instruction-file edits would need the
`4eb271b` versions of `AGENTS.md` / `CLAUDE.md` first.

**Billing safety — documented, not applied.** `hasExtraUsageEnabled: true`
remains set on CLAUDE_A (`~/.claude.json`, inside `oauthAccount`). That key is a
server-synced mirror, so a local edit would be overwritten and would not change
billing. **User action:** turn extra usage off in Claude account settings on
claude.ai, then confirm the mirror flips to `false`; review
`fableOverageConsentV2` alongside it. No local command can prove billing is
disabled — only the account page is authoritative.

## P. Exact next integration step after the parallel task returns

1. Take the validated command verbatim from its reproduction report.
2. In `harness/verify-task.sh`, replace the `rust)` block's refusal with that
   command wrapped in `run "rust unit" …`, and add `suite_rust` to `all`,
   removing the `NOT COVERED` entry in the same edit.
3. Run `bash harness/verify-task.sh rust` — it must go **red** against the
   unfixed defect. A green first run means the repro is not wired to the defect;
   stop and say so rather than proceeding.
4. Run `bash harness/verify-task.sh all` and record the exact counts.
5. Write the fix packet: `cp docs/task-packets/TEMPLATE.md
   docs/task-packets/native-starvation-fix.md`, `TASK_CLASS: T3`, `BASE_SHA` =
   the reproduction's commit, its own worktree, `ACCEPTANCE TESTS:
   bash harness/verify-task.sh all`. Validate it.
6. `node harness/route.mjs route T3 --tag native-concurrency` for the executor
   and the cross-provider reviewer. Risk 3 requires one independent reviewer of
   the other provider — available today with CLAUDE_A + GPT_A.
7. Only then decide integration. The orchestrator selects what merges; the
   harness never merges anything.

---

## Stop conditions — none triggered

Pi's architecture contradicted no premise: it supports subscription OAuth for
both providers, exposes effort and tool-allowlist seams, and `PI_CODING_AGENT_DIR`
gives multi-account support cleanly. No paid API access was required or enabled.
No Codex-owned file was edited. The harness is eleven files, zero stateful
components, and one command.

## Unverified claims

1. **Existence of CLAUDE_B / GPT_B** — asserted by the user, not observable
   locally. The architecture treats them as available resource with setup debt.
2. **Pi dispatch end-to-end** — no provider is authenticated in Pi, so no
   session has been run. Every Pi claim here is from its shipped CLI, its
   current documentation, and the created config directory.
3. **Whether the harness reduces token spend in practice** — the mechanism is
   argued, not measured; per-request token counts are unavailable.
4. **`routing.json` account preference order** is a starting default from the
   audit's matrix, not a measured optimum. Only the two tagged provider
   preferences claim evidence.
