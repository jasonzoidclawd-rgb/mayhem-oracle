import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { route, loadConfig, checkAccountAuth, RoutingError } from "../route.mjs";

// A logical account slot is not an auth context. Selecting GPT_A must bind the
// runtime to GPT_A's own credential directory and to the provider id that
// credential is filed under — otherwise the dispatcher launches whatever
// account the ambient environment happens to point at, which is how a proven
// GPT_A reported credentials_not_configured on the first real harness task.

const config = loadConfig();
const CLASSES = Object.keys(config.routing.taskClasses);
const ALL_FOUR = ["CLAUDE_A", "CLAUDE_B", "GPT_A", "GPT_B"];

const GPT_A_DIR = join(homedir(), ".pi/accounts/gpt_a");
const GPT_B_DIR = join(homedir(), ".pi/accounts/gpt_b");
const DEFAULT_DIR = join(homedir(), ".pi/agent");

const gptA = () => route({ taskClass: "T1", available: ["GPT_A"], config }).primary;

// A probe that behaves like `pi auth check`: it answers for whatever account
// directory it is handed, and falls back to Pi's default directory when the
// caller hands it none. `ready` lists the directories holding a usable
// openai-codex OAuth credential.
const fakePi = (ready) => {
  const calls = [];
  const probe = ({ command, env }) => {
    calls.push({ command, env });
    const i = command.indexOf("--provider");
    const provider = i === -1 ? null : command[i + 1];
    const dir = env?.PI_CODING_AGENT_DIR ?? DEFAULT_DIR;
    return ready.includes(dir) && provider === "openai-codex"
      ? { status: "ready", provider, authType: "oauth" }
      : { status: "not_ready", provider, reason: "credentials_not_configured" };
  };
  return { probe, calls };
};

const allExist = () => true;

// 1 ------------------------------------------------------------------------
test("a GPT_A assignment names its own isolated Pi account directory", () => {
  const a = gptA();
  assert.equal(a.account, "GPT_A");
  assert.ok(a.runtimeAuth, "the assignment carries no runtime auth context at all");
  assert.equal(a.runtimeAuth.accountDir, GPT_A_DIR);
  assert.ok(isAbsolute(a.runtimeAuth.accountDir), "account directory is not an absolute path");
  assert.doesNotMatch(a.runtimeAuth.accountDir, /~/, "an unexpanded ~ is not a usable env value");
  assert.equal(a.runtimeAuth.authPath, join(GPT_A_DIR, "auth.json"));
});

// 2 ------------------------------------------------------------------------
test("GPT_A authenticates as provider openai-codex, never as plain openai", () => {
  const a = gptA();
  assert.equal(a.runtimeAuth.provider, "openai-codex");
  const cmd = a.runtimeAuth.readinessCommand;
  assert.ok(Array.isArray(cmd) && cmd.length, "GPT_A declares no readiness command");
  const value = cmd[cmd.indexOf("--provider") + 1];
  assert.equal(value, "openai-codex", `readiness probes --provider ${value}, which is not the subscription OAuth provider`);
  // The vendor axis (which model tier applies, who is cross-provider to whom)
  // is a different question and must not leak into an auth flag.
  assert.equal(a.provider, "openai");
  assert.notEqual(a.runtimeAuth.provider, a.provider);
});

// 3 ------------------------------------------------------------------------
test("the GPT_A readiness probe runs with PI_CODING_AGENT_DIR bound to its account directory", () => {
  const a = gptA();
  assert.deepEqual(a.runtimeAuth.env, { PI_CODING_AGENT_DIR: GPT_A_DIR });

  const pi = fakePi([GPT_A_DIR]);
  const result = checkAccountAuth(a, { exists: allExist, probe: pi.probe });
  assert.equal(result.ready, true, `GPT_A was not ready: ${result.reason}`);
  assert.equal(pi.calls.length, 1);
  assert.equal(pi.calls[0].env.PI_CODING_AGENT_DIR, GPT_A_DIR);
});

// 4 ------------------------------------------------------------------------
test("a missing GPT_A credential fails closed, without probing anything", () => {
  const a = gptA();
  const pi = fakePi([GPT_A_DIR, DEFAULT_DIR]);
  const missingCredential = checkAccountAuth(a, {
    exists: (p) => p === GPT_A_DIR,
    probe: pi.probe,
  });
  assert.equal(missingCredential.ready, false);
  assert.match(missingCredential.reason, /credential|auth\.json/i);
  assert.equal(pi.calls.length, 0, "a slot with no credential file was still probed");

  const missingDir = checkAccountAuth(a, { exists: () => false, probe: pi.probe });
  assert.equal(missingDir.ready, false);
  assert.match(missingDir.reason, /does not exist/i);
  for (const r of [missingCredential, missingDir]) {
    assert.doesNotMatch(r.reason, /api[_ -]?key|credits|fall(ing)?[ -]?back/i);
  }
});

// 5 ------------------------------------------------------------------------
test("default ~/.pi/agent OAuth cannot make an unconfigured GPT_A look ready", () => {
  // The real machine state: the default Pi directory holds a ready
  // openai-codex credential. An unbound probe therefore answers "ready" for
  // an account that has none of its own.
  const a = gptA();
  const pi = fakePi([DEFAULT_DIR]);
  const result = checkAccountAuth(a, { exists: allExist, probe: pi.probe });
  assert.equal(result.ready, false, "the default account's credential was accepted as GPT_A's");
  assert.equal(pi.calls[0].env.PI_CODING_AGENT_DIR, GPT_A_DIR);
});

// 6 ------------------------------------------------------------------------
test("GPT_A never silently consumes GPT_B's or the ambient default's auth context", () => {
  const a = gptA();
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = GPT_B_DIR;
  try {
    const pi = fakePi([GPT_B_DIR, DEFAULT_DIR]);
    const result = checkAccountAuth(a, { exists: allExist, probe: pi.probe });
    assert.equal(result.ready, false, "GPT_A resolved to another account's credential");
    assert.equal(pi.calls[0].env.PI_CODING_AGENT_DIR, GPT_A_DIR, "the ambient directory overrode the routed one");
  } finally {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  }

  const gpt_b = config.routing.accounts.GPT_B;
  assert.equal(gpt_b.accountDir, "~/.pi/accounts/gpt_b");
  assert.notEqual(gpt_b.accountDir, config.routing.accounts.GPT_A.accountDir);
  assert.equal(gpt_b.authStatus, "setup-required", "GPT_B must stay unconfigured");

  const dirs = Object.values(config.routing.accounts).map((x) => x.accountDir).filter(Boolean);
  assert.equal(new Set(dirs).size, dirs.length, "two account slots share one credential directory");
});

// 7 ------------------------------------------------------------------------
test("every Pi-backed assignment identifies the account directory it binds", () => {
  for (const taskClass of CLASSES) {
    const r = route({ taskClass, available: ALL_FOUR, config });
    for (const a of [r.primary, ...r.reviewers]) {
      assert.ok(a.runtimeAuth, `${taskClass}: ${a.account} carries no runtime auth context`);
      if (a.runtimeAuth.runtime !== "pi") continue;
      const { accountDir, env, provider, readinessCommand } = a.runtimeAuth;
      assert.ok(accountDir && isAbsolute(accountDir), `${taskClass}: ${a.account} names no account directory`);
      assert.equal(env.PI_CODING_AGENT_DIR, accountDir, `${taskClass}: ${a.account} does not bind its directory`);
      assert.ok(provider, `${taskClass}: ${a.account} names no auth provider`);
      assert.ok(readinessCommand?.includes(provider), `${taskClass}: ${a.account} probes a different provider than it authenticates as`);
    }
  }
});

test("a directory-scoped mechanism with no declared directory is not dispatchable", () => {
  const c = structuredClone(config);
  delete c.routing.accounts.GPT_A.accountDir;
  try {
    route({ taskClass: "T0", available: ["GPT_A"], config: c });
    assert.fail("expected a routing error; GPT_A dispatched with no bound account directory");
  } catch (err) {
    assert.ok(err instanceof RoutingError);
    assert.match(err.message, /accountDir|account directory/i);
  }
});

test("every mechanism that isolates accounts by directory declares how to check one", () => {
  for (const [id, m] of Object.entries(config.routing.executionMechanisms)) {
    if (!m.accountDirEnv) continue;
    assert.ok(m.authFile, `${id} isolates by ${m.accountDirEnv} but names no credential file`);
    assert.ok(m.authProvider, `${id} names no auth provider`);
    assert.ok(m.readinessCommand?.includes(m.authProvider), `${id}: readiness command does not probe ${m.authProvider}`);
  }
});

// 9 ------------------------------------------------------------------------
test("the Claude slots stay on the native claude-code-cli mechanism", () => {
  for (const id of ["CLAUDE_A", "CLAUDE_B"]) {
    const account = config.routing.accounts[id];
    assert.equal(account.execution, "claude-code-cli");
    assert.equal(account.accountDir, undefined, `${id} was given a Pi account directory`);
  }
  const r = route({ taskClass: "T1", available: ["CLAUDE_A"], config });
  assert.equal(r.primary.execution, "claude-code-cli");
  assert.equal(r.primary.runtime, "claude-code");
  assert.equal(r.primary.runtimeAuth.runtime, "claude-code");
  assert.equal(r.primary.runtimeAuth.accountDir, null);
  assert.deepEqual(r.primary.runtimeAuth.env, {});
  assert.notEqual(config.routing.executionMechanisms["claude-code-cli"].runtime, "pi");
});

test("a mechanism with no readiness probe is never guessed ready", () => {
  const claude = route({ taskClass: "T1", available: ["CLAUDE_A"], config }).primary;
  assert.throws(
    () => checkAccountAuth(claude, { exists: allExist, probe: () => ({ status: "ready" }) }),
    /readiness probe/i,
  );
  assert.throws(() => checkAccountAuth(gptA(), {}), /exists|probe/i);
});

// 10 -----------------------------------------------------------------------
test("binding an auth context leaves routing and reviewer semantics unchanged", () => {
  assert.equal(config.routing.defaultParallel, 1);
  for (const taskClass of CLASSES) {
    const r = route({ taskClass, available: ALL_FOUR, config });
    assert.equal(r.defaultParallel, 1);
    assert.equal(r.reviewers.length, r.verification.reviewers);
    const ids = new Set([r.primary.account, ...r.reviewers.map((x) => x.account)]);
    assert.equal(ids.size, 1 + r.reviewers.length);
    for (const a of [r.primary, ...r.reviewers]) {
      for (const key of ["account", "provider", "model", "auth", "execution", "runtime"]) {
        assert.ok(key in a, `${taskClass}: ${key} disappeared from the assignment`);
      }
      assert.equal(a.auth, "subscription");
      assert.equal(a.runtimeAuth.consumesPlanIncludedUsage, true);
    }
  }
});
