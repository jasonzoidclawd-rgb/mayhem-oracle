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
bash harness/verify-task.sh rust       # NOT WIRED — exits 2 on purpose
```

Exits nonzero on any failure; prints what a profile does **not** cover rather
than passing silently. `rust` fails closed until the native-reproduction task
returns a validated `cargo test` command — see "Deferred" below.

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

## Task packets

```bash
cp docs/task-packets/TEMPLATE.md docs/task-packets/<slice>.md
node harness/route.mjs validate-packet docs/task-packets/<slice>.md
node harness/route.mjs validate-packet docs/task-packets/*.md   # cross-packet checks too
```

## Worktrees

No wrapper — git already does this well:

```bash
git worktree add -b <branch> ~/Desktop/mayhem-oracle-worktrees/<slice> <BASE_SHA>
```

Keep worktrees outside the repository tree so they do not appear as untracked
paths in every other agent's `git status`.

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
| account slot | `PI_CODING_AGENT_DIR=~/.pi/accounts/<slot>` |
| readiness probe | `pi auth check --provider <p> --json` |

**Accounts.** Pi keeps one credential per provider in
`$PI_CODING_AGENT_DIR/auth.json`, so a second account of the same provider is a
second config directory — that is the whole multi-account mechanism:

```bash
PI_CODING_AGENT_DIR=~/.pi/accounts/claude_b pi   # then /login, pick Anthropic
PI_CODING_AGENT_DIR=~/.pi/accounts/gpt_b    pi   # then /login, pick OpenAI
```

`/login` is interactive and account-specific. It is the one step that cannot be
automated here.

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

- **`rust` gate profile** — the validated `cargo test` command is owned by the
  parallel native-starvation reproduction. Wiring a guessed command would let a
  red Rust test report green.
- **Pi extension (`.pi/extensions/oracle-router.ts`)** — a dispatch-time hook
  that would call `route.mjs` and inject the packet automatically. Deferred
  until at least one provider is authenticated in Pi, because an untested
  extension is exactly the machinery this harness exists to avoid.
- **Quota ledger** — no provider exposes per-request token counts under
  subscription authentication. Record proxies (model, effort, files loaded,
  tool calls, duration, whether a quota warning appeared); do not invent numbers.
