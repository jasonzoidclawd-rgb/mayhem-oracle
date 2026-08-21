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
  one. "Could not reproduce" is `NEEDS_EVIDENCE` and never becomes a fix.
- `GATE_PASSED` and `VERIFIED` are **concluded**, never reported. An executor
  claiming either is rejected. They are deliberately different claims:
  `GATE_PASSED` says the requested deterministic profile passed on a
  git-verified commit — and says nothing about the suites that profile did not
  run, which the record lists under `gateCoverage.notCovered`. `VERIFIED`
  additionally says the risk level's verification policy was satisfied by an
  independent reviewer.
- Before result schema 2 every gate pass was recorded as `VERIFIED`, so a
  schema-1 record reading `VERIFIED` may mean either. Schema 2 onward it means
  only the second.
- The completion level stops where the evidence stops: `IMPLEMENTED` for a
  verified commit whose gate did not pass, `OFFLINE-PROVEN` once it did. No
  gate profile establishes live behaviour, so the dispatcher never concludes
  `LIVE-PROVEN`.
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
