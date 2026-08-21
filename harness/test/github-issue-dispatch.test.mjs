import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, route, RoutingError } from "../route.mjs";
import {
  checkDispatchable,
  findByFingerprint,
  classifyBehavioralRed,
  normalizeExecutorReport,
  parseMachineBlock,
  ContractError,
  concludeRun,
  RESULTS,
  CONCLUDED_ONLY,
  LABELS,
  STATUS_FOR_DISPOSITION,
} from "../github/issue-contract.mjs";
import { AttemptError, assertReviewerIsolation, DISPOSITIONS, gateArgv, launchArgv, runAttempt } from "../run/attempt.mjs";
import { slugFor } from "../run/workspace.mjs";
import { verifyCommitEvidence } from "../run/evidence.mjs";
import { createGh, GhError } from "../github/gh.mjs";
import { parseWorktreeList, planWorkspace, WorkspaceError } from "../run/workspace.mjs";
import { dispatchIssue, DispatchRecoveryError } from "../github/dispatch.mjs";
import { summaryLine } from "../dispatch-github-issue.mjs";

// GitHub is the durable bug ledger; the harness router is still the routing
// authority. These tests prove the seam between them without touching the
// network: every gh read/write, every git call, and every executor launch is
// injected. A test that reaches real GitHub is a broken test.

const config = loadConfig();
const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const BASE = "b9e12a98dcecd777e0abb425fb3f0cc24fce5286";
const HEAD = "e13884973a1dcf1af5dca79d4c98a62ab1c3b4c7";
const FINGERPRINT = "geometry:response-delivery:async-transport";
const COMMIT = "c0ffee11deadbeef2222333344445555666677a8";
const MAIN = "/repo/mayhem-oracle";
const WT_ROOT = "/repo/mayhem-oracle-worktrees/issues";

const machine = (over = {}) => {
  const fields = { schema: 1, fingerprint: FINGERPRINT, task_class: "T3", base_ref: BASE, ...over };
  const body = Object.entries(fields)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `<!-- mayhem-agent\n${body}\n-->`;
};

const issue = (over = {}) => ({
  number: 147,
  title: "Overlay geometry stalls after the async transport swap",
  state: "OPEN",
  url: "https://github.com/jasonzoidclawd-rgb/wasfun.lol/issues/147",
  labels: [{ name: "bug" }, { name: "status:ready-for-agent" }],
  body: `## Summary\n\nHuman prose describing the defect.\n\n${machine()}\n`,
  ...over,
});

const withMachine = (over, issueOver = {}) =>
  issue({ body: `## Summary\n\nprose\n\n${machine(over)}\n`, ...issueOver });

const resolveRef = (ref) => (ref === BASE || ref === HEAD ? ref : null);
const dispatchable = (i, over = {}) =>
  checkDispatchable(i, { taskClasses: config.routing.taskClasses, resolveRef, ...over });

// --- C. issue contract ---------------------------------------------------

test("1. an open, ready, well-formed issue is dispatchable", () => {
  const verdict = dispatchable(issue());
  assert.equal(verdict.ok, true, `expected dispatchable, got ${verdict.code}: ${verdict.reason}`);
  assert.equal(verdict.machine.fingerprint, FINGERPRINT);
  assert.equal(verdict.machine.task_class, "T3");
  assert.equal(verdict.resolvedBaseSha, BASE);
});

test("1b. unrelated labels do not disturb a dispatchable issue", () => {
  const tolerated = issue({
    labels: [{ name: "bug" }, { name: "priority:p1" }, { name: "status:ready-for-agent" }],
  });
  assert.equal(dispatchable(tolerated).ok, true);
});

test("2. an issue without status:ready-for-agent is refused", () => {
  const verdict = dispatchable(issue({ labels: [{ name: "bug" }] }));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "not-ready");
  assert.match(verdict.reason, /status:ready-for-agent/);
});

test("3. an issue already labelled status:agent-working is refused", () => {
  const claimed = issue({
    labels: [{ name: "status:ready-for-agent" }, { name: "status:agent-working" }],
  });
  const verdict = dispatchable(claimed);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "already-claimed");
});

test("4. a closed issue is refused even when it is still labelled ready", () => {
  const verdict = dispatchable(issue({ state: "CLOSED" }));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "not-open");
});

test("5. an unsupported machine schema is refused", () => {
  const verdict = dispatchable(withMachine({ schema: 2 }));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "unsupported-schema");
});

test("5b. an issue with no machine block at all is refused", () => {
  const verdict = dispatchable(issue({ body: "## Summary\n\nprose only, no machine block.\n" }));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "no-machine-block");
  assert.equal(parseMachineBlock("no block here"), null);
});

test("6. a missing or empty fingerprint is refused", () => {
  assert.equal(dispatchable(withMachine({ fingerprint: null })).code, "missing-fingerprint");
  assert.equal(dispatchable(withMachine({ fingerprint: "   " })).code, "missing-fingerprint");
});

test("7. a task class the router does not accept is refused", () => {
  assert.equal(dispatchable(withMachine({ task_class: "T9" })).code, "unknown-task-class");
  assert.equal(dispatchable(withMachine({ task_class: null })).code, "unknown-task-class");
  // V1 never infers a class: an unparseable one is a refusal, not a guess.
  assert.equal(dispatchable(withMachine({ task_class: "difficult debugging" })).code, "unknown-task-class");
});

test("8. a base_ref that does not resolve locally is refused", () => {
  const verdict = dispatchable(withMachine({ base_ref: "0".repeat(40) }));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "unresolved-base-ref");
});

// --- E. dedupe -----------------------------------------------------------

test("9. an identical fingerprint resolves to the existing open issue", () => {
  const open = [issue({ number: 147 }), withMachine({ fingerprint: "other:thing" }, { number: 152 })];
  const found = findByFingerprint(open, FINGERPRINT);
  assert.ok(found, "exact fingerprint match was not found");
  assert.equal(found.number, 147);
});

test("10. a different fingerprint stays a distinct issue — no fuzzy matching", () => {
  const open = [issue({ number: 147 })];
  // One character apart. Exact equality only: V1 has no embeddings and no
  // fuzzy matcher, so a near-miss must never absorb a distinct defect.
  assert.equal(findByFingerprint(open, `${FINGERPRINT}-2`), null);
  assert.equal(findByFingerprint(open, "geometry:response-delivery:async-transports"), null);
  assert.equal(findByFingerprint(open, ""), null);
  assert.ok(!/levenshtein|similarity|embedding|fuzz/i.test(source("github/issue-contract.mjs")));
});

// --- H. routing delegation ----------------------------------------------

test("11. the adapter delegates every account choice to route()", () => {
  const text = source("github/dispatch.mjs");
  assert.ok(!/\bCLAUDE_[AB]\b|\bGPT_[AB]\b/.test(text), "dispatch.mjs names an account slot");
  assert.ok(
    !/claude-code-cli|pi-openai-chatgpt-oauth|pi-anthropic-oauth/.test(text),
    "dispatch.mjs hardcodes an execution mechanism id",
  );
  assert.ok(!/\banthropic\b|\bopenai\b/.test(text), "dispatch.mjs branches on a provider");
});

test("11b. the dispatched account is exactly the one route() returned", async () => {
  const seen = [];
  const io = makeIo({
    route: (args) => {
      seen.push(args);
      return route({ ...args, config });
    },
  });
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true, `dispatch refused: ${out.code} ${out.reason}`);
  assert.equal(seen.length, 1, "route() was consulted more than once per dispatch");
  assert.equal(seen[0].taskClass, "T3");
  const expected = route({ taskClass: "T3", available: io.available, config });
  assert.equal(out.result.primaryAccount, expected.primary.account);
  assert.equal(out.result.primaryExecution, expected.primary.execution);
  assert.equal(out.result.primaryRuntime, expected.primary.runtime);
});

test("12. one executor per slice — defaultParallel stays 1 and one process launches", async () => {
  assert.equal(config.routing.defaultParallel, 1);
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true);
  const executors = io.spawned.filter((s) => s.role === "executor");
  assert.equal(executors.length, 1, `launched ${executors.length} executors for one issue`);
});

test("13. Claude slots still execute through the native Claude Code CLI", () => {
  for (const [id, account] of Object.entries(config.routing.accounts)) {
    if (account.provider !== "anthropic") continue;
    assert.equal(account.execution, "claude-code-cli", `${id} left the Claude Code CLI`);
  }
  const mechanism = config.routing.executionMechanisms["claude-code-cli"];
  assert.ok(mechanism.launch?.executor?.length, "claude-code-cli declares no executor launch argv");
  assert.equal(mechanism.launch.executor[0], "claude");
  assert.ok(mechanism.launch.reviewer?.length, "claude-code-cli declares no read-only reviewer launch");
});

test("14. GPT slots still execute through the Pi ChatGPT OAuth path", () => {
  for (const [id, account] of Object.entries(config.routing.accounts)) {
    if (account.provider !== "openai") continue;
    assert.equal(account.execution, "pi-openai-chatgpt-oauth", `${id} left the Codex OAuth path`);
  }
  const mechanism = config.routing.executionMechanisms["pi-openai-chatgpt-oauth"];
  assert.equal(mechanism.launch.executor[0], "pi");
  assert.ok(
    mechanism.launch.executor.includes("{authProvider}"),
    "the Pi launch must carry the mechanism's authProvider, not an account's vendor axis",
  );
  const argv = launchArgv({
    mechanism,
    role: "executor",
    model: "gpt-5.6-terra",
    effort: "high",
    authProvider: mechanism.authProvider,
    prompt: "PACKET",
    sessionDir: "/wt/.pi-session",
  });
  assert.ok(argv.includes("openai-codex"), "authProvider was not substituted");
  assert.ok(!argv.some((a) => /[{}]/.test(a)), `unsubstituted placeholder in ${JSON.stringify(argv)}`);
});

test("15. a metered Anthropic mechanism is never dispatched or substituted", async () => {
  const metered = structuredClone(config);
  for (const account of Object.values(metered.routing.accounts)) {
    if (account.provider === "anthropic") account.execution = "pi-anthropic-oauth";
  }
  const io = makeIo({ config: metered, available: ["CLAUDE_A"] });
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, false);
  assert.equal(out.code, "unroutable");
  assert.match(out.reason, /plan's included usage|subscription/i);
  assert.equal(io.spawned.length, 0, "a metered route still launched something");
  assert.equal(io.gh.labelWrites.length, 0, "a metered route still claimed the issue");
});

test("16. the reviewer is never the executor", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true);
  const policy = config.policy.riskLevels["3"];
  assert.equal(policy.reviewers, 1);
  assert.ok(out.result.reviewerAccount, "a risk-3 issue produced no reviewer");
  assert.notEqual(out.result.reviewerAccount, out.result.primaryAccount);
  const reviewer = io.spawned.find((s) => s.role === "reviewer");
  assert.ok(reviewer, "no reviewer process was launched");
  assert.notEqual(reviewer.account, out.result.primaryAccount);
});

// --- G. worktree isolation -----------------------------------------------

const worktrees = (entries) =>
  entries.map((e) => `worktree ${e.path}\nHEAD ${e.head ?? HEAD}\nbranch refs/heads/${e.branch}\n`).join("\n");

test("17. a branch or path collision fails closed", () => {
  const plan = (over = {}) =>
    planWorkspace({
      identity: { kind: "issue", id: 147, slug: slugFor("Overlay geometry stalls") },
      baseSha: BASE,
      mainWorktree: MAIN,
      worktrees: parseWorktreeList(worktrees([{ path: MAIN, branch: "main" }])),
      branchExists: () => false,
      pathExists: () => false,
      ...over,
    });

  // The branch already exists but no worktree holds it: adopting it silently
  // would move someone else's branch.
  assert.throws(() => plan({ branchExists: (b) => b === "issue/147-overlay-geometry-stalls" }), WorkspaceError);
  // The path exists but git does not know it as a worktree.
  assert.throws(() => plan({ pathExists: () => true }), WorkspaceError);
  // The path is a worktree, but it belongs to a different issue.
  assert.throws(
    () =>
      plan({
        pathExists: () => true,
        worktrees: parseWorktreeList(
          worktrees([
            { path: MAIN, branch: "main" },
            { path: `${WT_ROOT}/147-overlay-geometry-stalls`, branch: "issue/152-something-else" },
          ]),
        ),
      }),
    WorkspaceError,
  );
});

test("18. a matching issue worktree resumes and is never reset", () => {
  const path = `${WT_ROOT}/147-overlay-geometry-stalls`;
  const plan = planWorkspace({
    identity: { kind: "issue", id: 147, slug: slugFor("Overlay geometry stalls") },
    baseSha: BASE,
    mainWorktree: MAIN,
    worktrees: parseWorktreeList(
      worktrees([
        { path: MAIN, branch: "main" },
        { path, branch: "issue/147-overlay-geometry-stalls" },
      ]),
    ),
    branchExists: (b) => b === "issue/147-overlay-geometry-stalls",
    pathExists: () => true,
  });
  assert.equal(plan.action, "resume");
  assert.equal(plan.path, path);
  assert.equal(plan.branch, "issue/147-overlay-geometry-stalls");
  assert.deepEqual(plan.git, [], "resuming a worktree must issue no git command at all");
});

test("18c. an issue rename resumes its existing dirty worktree", () => {
  const oldPath = `${WT_ROOT}/147-overlay-geometry-stalls`;
  const plan = planWorkspace({
    identity: { kind: "issue", id: 147, slug: slugFor("Overlay geometry no longer stalls") },
    baseSha: BASE,
    mainWorktree: MAIN,
    worktrees: parseWorktreeList(
      worktrees([
        { path: MAIN, branch: "main" },
        { path: oldPath, branch: "issue/147-overlay-geometry-stalls" },
      ]),
    ),
    branchExists: () => true,
    pathExists: () => false,
    dirty: true,
  });
  assert.equal(plan.action, "resume");
  assert.equal(plan.path, oldPath);
  assert.equal(plan.branch, "issue/147-overlay-geometry-stalls");
  assert.equal(plan.dirty, true);
  assert.deepEqual(plan.git, [], "resuming after a rename must not touch dirty or untracked contents");
});

test("19. a dirty matching worktree is resumed, never discarded", () => {
  const path = `${WT_ROOT}/147-overlay-geometry-stalls`;
  const base = {
    identity: { kind: "issue", id: 147, slug: slugFor("Overlay geometry stalls") },
    baseSha: BASE,
    mainWorktree: MAIN,
    worktrees: parseWorktreeList(
      worktrees([
        { path: MAIN, branch: "main" },
        { path, branch: "issue/147-overlay-geometry-stalls" },
      ]),
    ),
    branchExists: () => true,
    pathExists: () => true,
  };
  const plan = planWorkspace({ ...base, dirty: true });
  assert.equal(plan.action, "resume");
  assert.equal(plan.dirty, true);
  const emitted = JSON.stringify(plan.git ?? []);
  for (const destructive of ["reset", "clean", "checkout", "restore", "stash", "worktree remove"]) {
    assert.ok(!emitted.includes(destructive), `resume plan emitted ${destructive}`);
  }
  const text = source("run/workspace.mjs");
  assert.ok(!/--hard|\bclean\b|\bstash\b/.test(text), "worktree.mjs can discard work");
});

test("18b. a worktree reported under a realised path still resumes", () => {
  // git reports /private/var/...; the derived path says /var/... . Comparing
  // raw strings would miss it and then refuse to create it.
  const derived = `${WT_ROOT}/147-overlay-geometry-stalls`;
  const reported = `/private${derived}`;
  const plan = planWorkspace({
    identity: { kind: "issue", id: 147, slug: slugFor("Overlay geometry stalls") },
    baseSha: BASE,
    mainWorktree: MAIN,
    worktrees: parseWorktreeList(
      worktrees([
        { path: MAIN, branch: "main" },
        { path: reported, branch: "issue/147-overlay-geometry-stalls" },
      ]),
    ),
    branchExists: () => true,
    pathExists: () => true,
    realPath: (p) => (p.startsWith("/private") ? p : `/private${p}`),
  });
  assert.equal(plan.action, "resume");
  assert.equal(plan.path, reported, "resume must use the path git actually knows");
  assert.deepEqual(plan.git, []);
});

test("19b. a fresh issue worktree is created from the resolved base sha", () => {
  const plan = planWorkspace({
    identity: { kind: "issue", id: 147, slug: slugFor("Overlay geometry stalls") },
    baseSha: BASE,
    mainWorktree: MAIN,
    worktrees: parseWorktreeList(worktrees([{ path: MAIN, branch: "main" }])),
    branchExists: () => false,
    pathExists: () => false,
  });
  assert.equal(plan.action, "create");
  assert.equal(plan.path, `${WT_ROOT}/147-overlay-geometry-stalls`);
  assert.equal(plan.branch, "issue/147-overlay-geometry-stalls");
  assert.deepEqual(plan.git, [["worktree", "add", "-b", plan.branch, plan.path, BASE]]);
  assert.equal(slugFor("Overlay geometry stalls"), "overlay-geometry-stalls");
});

// --- K / M. result contract ----------------------------------------------

test("20. a missing-module failure cannot count as a behavioral RED", () => {
  for (const fake of [
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../github/thing.mjs'",
    "FAIL src/new-file.test.ts — Cannot find module './not-written-yet'",
    "SyntaxError: Unexpected token '}' in scaffold.ts",
    "Error: ENOENT: no such file or directory, open 'fixtures/missing.json'",
    "ReferenceError: describeBehaviour is not defined",
    "",
    "   ",
  ]) {
    const verdict = classifyBehavioralRed(fake);
    assert.equal(verdict.valid, false, `accepted a non-behavioral RED: ${JSON.stringify(fake)}`);
  }
  const real =
    "cross-parity.test.ts > geometry transport: expected 4 rounds, received 0 — " +
    "existing behavior violates the acceptance contract at overlay/src/scoring/index.ts:88";
  assert.equal(classifyBehavioralRed(real).valid, true, "rejected a real behavioral RED");
});

test("20b. FIX_PROPOSED without a valid behavioral RED is rejected", () => {
  assert.throws(
    () =>
      normalizeExecutorReport(
        { result: "FIX_PROPOSED", behavioralRed: "Cannot find module './fix'", commitSha: HEAD },
        { fingerprint: FINGERPRINT, role: "executor" },
      ),
    ContractError,
  );
  const ok = normalizeExecutorReport(
    {
      result: "NEEDS_EVIDENCE",
      behavioralRed: "could not reproduce at the named seam",
      notes: "no reproduction",
    },
    { fingerprint: FINGERPRINT, role: "executor" },
  );
  assert.equal(ok.result, "NEEDS_EVIDENCE", "a failed reproduction must stay NEEDS_EVIDENCE");
});

test("21. the result vocabulary is closed", () => {
  assert.deepEqual([...RESULTS].sort(), [
    "BLOCKED",
    "FIX_PROPOSED",
    "GATE_PASSED",
    "INTERRUPTED",
    "NEEDS_EVIDENCE",
    "VERIFIED",
  ]);
  for (const bogus of ["DONE", "fixed", "PASS", "SUCCESS", "FIX_PROPOSED ", null, undefined, 1]) {
    assert.throws(
      () => normalizeExecutorReport({ result: bogus }, { fingerprint: FINGERPRINT, role: "executor" }),
      ContractError,
      `accepted result ${JSON.stringify(bogus)}`,
    );
  }
});

test("21b. a primary can never mark its own work verified", () => {
  assert.throws(
    () =>
      normalizeExecutorReport(
        { result: "VERIFIED", behavioralRed: "real red", commitSha: HEAD },
        { fingerprint: FINGERPRINT, role: "executor" },
      ),
    ContractError,
  );
});

test("22. NEW_BUG_DISCOVERED cannot silently expand the current issue", () => {
  // A second failure mechanism found mid-slice is a new issue, not a wider one.
  const report = normalizeExecutorReport(
    {
      result: "FIX_PROPOSED",
      behavioralRed: "overlay round counter reports 0 where the contract requires 4 (observed at :88)",
      commitSha: HEAD,
      newBugs: [{ fingerprint: "overlay:consent:focus-loss", title: "Focus lost on consent", summary: "x" }],
    },
    { fingerprint: FINGERPRINT, role: "executor" },
  );
  assert.equal(report.newBugs.length, 1);
  assert.equal(report.newBugs[0].fingerprint, "overlay:consent:focus-loss");
  assert.equal(report.fingerprint, FINGERPRINT, "the current issue's fingerprint drifted");

  // Re-using the current fingerprint for a "new" bug IS the scope expansion.
  assert.throws(
    () =>
      normalizeExecutorReport(
        {
          result: "FIX_PROPOSED",
          behavioralRed: "real observed contract violation at :88",
          commitSha: HEAD,
          newBugs: [{ fingerprint: FINGERPRINT, title: "also this", summary: "y" }],
        },
        { fingerprint: FINGERPRINT, role: "executor" },
      ),
    ContractError,
  );
});

// --- D. gh access layer --------------------------------------------------

test("gh reads and writes go through argv, never a shell string", () => {
  const calls = [];
  const gh = createGh({
    repo: "jasonzoidclawd-rgb/wasfun.lol",
    run: (argv, opts) => {
      calls.push({ argv, opts });
      assert.ok(Array.isArray(argv), "gh was handed a string instead of argv");
      for (const arg of argv) assert.equal(typeof arg, "string");
      return { status: 0, stdout: JSON.stringify(issue()), stderr: "" };
    },
  });
  const view = gh.viewIssue(147);
  assert.equal(view.number, 147);
  const argv = calls[0].argv;
  assert.deepEqual(argv.slice(0, 3), ["issue", "view", "147"]);
  assert.ok(argv.includes("--repo") && argv.includes("jasonzoidclawd-rgb/wasfun.lol"));
  assert.ok(argv.includes("--json"), "gh must request explicit JSON fields");

  // A hostile issue body must never reach a shell, and a comment body is
  // delivered on stdin rather than interpolated into argv.
  calls.length = 0;
  gh.comment(147, "RESULT=FIX_PROPOSED\n`rm -rf /` $(whoami)");
  const commentCall = calls[0];
  assert.ok(commentCall.argv.includes("--body-file"), "comment body was not passed by file/stdin");
  assert.ok(
    !commentCall.argv.some((a) => a.includes("rm -rf")),
    "comment body was interpolated into argv",
  );
  assert.match(commentCall.opts.input, /RESULT=FIX_PROPOSED/);

  const text = source("github/gh.mjs");
  assert.ok(!/exec\(|execSync\(|shell\s*:\s*true|`gh /.test(text), "gh.mjs can reach a shell");
});

test("a failing gh call fails closed with a deterministic error", () => {
  const gh = createGh({
    repo: "r/r",
    run: () => ({ status: 1, stdout: "", stderr: "gh: issue not found" }),
  });
  assert.throws(() => gh.viewIssue(999), GhError);
  const gh2 = createGh({ repo: "r/r", run: () => ({ status: 0, stdout: "not json", stderr: "" }) });
  assert.throws(() => gh2.viewIssue(1), GhError);
});

// --- F. claiming / idempotency -------------------------------------------

test("a claim re-checks issue state and takes the label transition", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true);
  assert.ok(io.gh.views >= 2, "the issue was not re-fetched immediately before claiming");
  const claim = io.gh.labelWrites[0];
  assert.deepEqual(claim.add, [LABELS.working]);
  assert.deepEqual(claim.remove, [LABELS.ready]);
  const claimAt = io.order.indexOf("claim");
  const launchAt = io.order.indexOf("launch:executor");
  assert.ok(claimAt !== -1 && claimAt < launchAt, "the executor launched before the issue was claimed");
});

test("an issue claimed between the read and the claim launches nothing", async () => {
  let views = 0;
  const io = makeIo({
    ghOver: {
      viewIssue: () => {
        views += 1;
        return views === 1
          ? issue()
          : issue({ labels: [{ name: "status:ready-for-agent" }, { name: "status:agent-working" }] });
      },
    },
  });
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, false);
  assert.equal(out.code, "already-claimed");
  assert.equal(io.spawned.length, 0);
  assert.equal(io.gh.labelWrites.length, 0);
});

test("a held local lock exits cleanly instead of launching a second executor", async () => {
  const io = makeIo({ lock: () => null });
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, false);
  assert.equal(out.code, "locked");
  assert.equal(io.spawned.length, 0);
});

test("the local lock is released even when the run fails", async () => {
  const io = makeIo({ spawn: () => { throw new Error("runtime exploded"); } });
  await assert.rejects(dispatchIssue(147, io));
  assert.equal(io.lockReleased, true, "the local lock outlived a failed run");
});

// --- I. readiness / blocked ---------------------------------------------

test("an unready account is BLOCKED, never swapped for a metered one", async () => {
  const io = makeIo({ available: ["GPT_A", "CLAUDE_A"], probe: () => ({ status: "not_ready", reason: "quota" }) });
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, false);
  assert.equal(out.code, "blocked");
  assert.equal(io.spawned.length, 0);
  assert.equal(io.gh.labelWrites.length, 0, "a blocked dispatch still claimed the issue");
});

// --- M. result json ------------------------------------------------------

test("the result JSON is written before GitHub is told anything", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true);
  const written = io.order.indexOf("write-result");
  const commented = io.order.indexOf("comment");
  assert.ok(written !== -1, "no result JSON was written");
  assert.ok(written < commented, "GitHub was told before the durable result was written");

  for (const field of [
    "schema", "issue", "fingerprint", "runId", "baseRef", "resolvedBaseSha", "startingHead",
    "workspace", "primaryAccount", "primaryExecution", "primaryRuntime", "reviewerAccount",
    "behavioralRed", "commitSha", "tests", "gateResult", "reviewVerdict", "result", "nextStatus",
  ]) {
    assert.ok(field in out.result, `result JSON is missing ${field}`);
  }
  assert.equal(out.result.issue, 147);
  assert.equal(out.result.fingerprint, FINGERPRINT);
  assert.ok(RESULTS.includes(out.result.result));
  assert.ok(Object.values(LABELS).includes(out.result.nextStatus));

  const body = io.gh.comments[0].body;
  assert.match(body, /^RUN_ID=/m);
  assert.match(body, /^RESULT=/m);
  assert.ok(body.length < 1200, "the GitHub comment is dumping logs");
});

test("a dry run reads the ledger and mutates nothing", async () => {
  const io = makeIo({});
  io.dryRun = true;
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, false);
  assert.equal(out.code, "dry-run");
  assert.equal(out.preview.taskClass, "T3");
  assert.equal(out.preview.fingerprint, FINGERPRINT);
  assert.ok(out.preview.primaryAccount);
  assert.equal(io.gh.labelWrites.length, 0, "a dry run wrote a label");
  assert.equal(io.gh.comments.length, 0, "a dry run commented");
  assert.equal(io.spawned.filter((s) => s.role === "executor" || s.role === "reviewer").length, 0);
});

// --- claim recovery -------------------------------------------------------
//
// Once the claim succeeds the issue is ours, and every bounded failure after
// it has to leave the ledger somewhere a human or a later run can act on.
// Stranding it at status:agent-working is silent, permanent, and invisible.

const gitFailingAt = (verb) => (argv) =>
  argv[0] === "worktree" && argv[1] === verb
    ? { status: 1, stdout: "", stderr: "fatal: could not create worktree: No space left on device" }
    : defaultGit(argv);

// The real `verify-task.sh <profile> --plan` names the profile it planned. A
// fake that answers a bare exit 0 cannot tell a gate that ran from one that was
// never found — which is the gap the live issue-47 dry-run fell into, so the
// fakes here answer the plan the way the real command does.
const gateAnswer = (argv) => {
  const profile = argv[2];
  const tail = argv.includes("--plan")
    ? `PLAN ONLY (profile=${profile}) — nothing executed`
    : `GATE: PASS (profile=${profile})`;
  return {
    status: 0,
    stdout:
      `PROFILE: ${profile}\nSUITES: harness\n\n` +
      "NOT COVERED BY THIS PROFILE:\n  - web (web vitest + eslint)\n  - overlay (overlay vitest + overlay tsc)\n" +
      `\n${tail}\n`,
    stderr: "",
  };
};

// A reviewer writes no file: it is launched read-only, so the only thing it can
// leave behind is what it printed. The fakes therefore answer as a reviewer
// process does, and never through a report on disk the executor could forge.
const reviewerSaying = (verdict) => ({
  status: 0,
  stdout: `reviewed the diff\n\n\`\`\`json\n${JSON.stringify({ verdict, findings: [] })}\n\`\`\`\n`,
  stderr: "",
});

const runtimeAnswer = (argv, options = {}) =>
  (options.role === "reviewer" ? reviewerSaying("PASS") : gateAnswer(argv));

const spawnThrowingAt = (role, message) => {
  const spawned = [];
  const fn = (argv, options = {}) => {
    spawned.push({ argv, ...options });
    if (options.role === role) throw new Error(message);
    return runtimeAnswer(argv, options);
  };
  fn.spawned = spawned;
  return fn;
};

// The claim happened, and it was undone in favour of a state that names itself.
const reportingCommit = (sha) => (runId, role) => {
  if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
  return {
    result: "FIX_PROPOSED",
    behavioralRed:
      "geometry round counter reports 0 where the contract requires 4 — observed at overlay/src/scoring/index.ts:88",
    commitSha: sha,
    tests: ["overlay/src/scoring/__tests__/geometry.test.ts"],
  };
};

const assertRecovered = (io, out) => {
  assert.ok(io.gh.labelWrites.length >= 1, "the issue was never claimed");
  assert.deepEqual(io.gh.labelWrites[0].add, [LABELS.working], "the first write was not the claim");
  assert.ok(
    io.gh.labelWrites.length >= 2,
    "the issue is still at status:agent-working — a post-claim failure stranded it",
  );
  const recovery = io.gh.labelWrites.at(-1);
  assert.deepEqual(recovery.remove, [LABELS.working], "status:agent-working was never removed");
  assert.deepEqual(recovery.add, [LABELS.blocked], "the issue was not moved to a recoverable status");
  assert.ok(out?.result, "no durable result was produced for the failed run");
  assert.equal(out.result.result, "INTERRUPTED");
  assert.equal(out.result.nextStatus, LABELS.blocked);
  assert.ok(out.result.failureStage, "the result names no failure stage");
  assert.equal(io.lockReleased, true, "the local lock outlived the recovery");
};

test("23. a post-claim worktree failure recovers the issue instead of stranding it", async () => {
  const io = makeIo({ git: gitFailingAt("add") });
  const out = await dispatchIssue(147, io);
  assertRecovered(io, out);
  assert.equal(out.result.failureStage, "workspace");
  // Nothing may read as a successful run.
  assert.notEqual(out.code, "ran");
  assert.equal(out.result.commitSha, null);
  assert.equal(out.result.behavioralRed, null);
  assert.equal(out.result.gateResult, null);
  // Durable evidence is written before the ledger is touched.
  const written = io.order.indexOf("write-result");
  assert.ok(written !== -1, "no INTERRUPTED result was written");
  assert.ok(written < io.order.lastIndexOf("status"), "GitHub was updated before the durable record");
  // Enough to resume from.
  assert.equal(out.result.issue, 147);
  assert.equal(out.result.fingerprint, FINGERPRINT);
  assert.match(out.result.runId, /^issue-147-attempt-/);
  assert.equal(out.result.resolvedBaseSha, BASE);
  assert.ok(out.result.primaryAccount, "the selected account was not recorded");
});

test("24. a post-claim launcher failure recovers too — not tied to one place", async () => {
  const spawn = spawnThrowingAt("executor", "spawn claude ENOENT");
  const io = makeIo({ spawn });
  const out = await dispatchIssue(147, io);
  assertRecovered(io, out);
  assert.equal(out.result.failureStage, "executor-launch");
  assert.ok(out.result.workspace, "the worktree reached before the failure was not recorded");
  assert.equal(spawn.spawned.filter((s) => s.role === "reviewer").length, 0, "a reviewer ran after the executor died");
});

test("24b. a post-claim gate failure recovers too", async () => {
  const io = makeIo({ spawn: spawnThrowingAt("gate", "bash: verify-task.sh: Input/output error") });
  const out = await dispatchIssue(147, io);
  assertRecovered(io, out);
  assert.equal(out.result.failureStage, "gate");
});

test("25. a failed final comment still moves the issue off agent-working", async () => {
  // The run concluded; only the delivery failed. The conclusion must survive
  // in the durable record, and the issue must not stay claimed.
  const io = makeIo({ ghOver: { comment: () => { throw new Error("gh: API rate limit exceeded"); } } });
  const out = await dispatchIssue(147, io);
  const recovery = io.gh.labelWrites.at(-1);
  assert.deepEqual(recovery.remove, [LABELS.working]);
  assert.deepEqual(recovery.add, [LABELS.blocked]);
  assert.equal(out.result.failureStage, "github-report");
  assert.equal(out.result.result, "VERIFIED", "the concluded result was overwritten by the reporting failure");
  assert.equal(out.result.nextStatus, LABELS.blocked, "an undelivered conclusion must not read as delivered");
  assert.equal(io.lockReleased, true);
});

test("26. a failed recovery write preserves BOTH failures and never claims success", async () => {
  // The claim succeeds; the write that would hand the issue back does not.
  let writes = 0;
  const io = makeIo({
    git: gitFailingAt("add"),
    ghOver: {
      setLabels: (number, change) => {
        writes += 1;
        if (writes === 1) return;
        throw new Error("gh: 403 Resource not accessible");
      },
    },
  });
  const err = await dispatchIssue(147, io).then(
    () => null,
    (e) => e,
  );
  assert.ok(err, "a stranded issue was reported as handled");
  assert.ok(err instanceof DispatchRecoveryError);
  assert.match(err.message, /No space left on device/, "the original failure was hidden");
  assert.match(err.message, /403 Resource not accessible/, "the recovery failure was hidden");
  assert.equal(err.recovered, false);
  assert.equal(err.result.nextStatus, LABELS.blocked, "the durable record does not say what was intended");
  assert.equal(io.lockReleased, true);
});

test("26c. a claim that never succeeded is not 'recovered'", async () => {
  // If the claiming write itself fails, this process does not own the issue.
  // Retrying the same write as recovery would be both pointless and a lie.
  const io = makeIo({ ghOver: { setLabels: () => { throw new Error("gh: 502 Bad Gateway"); } } });
  const err = await dispatchIssue(147, io).then(() => null, (e) => e);
  assert.ok(err, "a failed claim was reported as handled");
  assert.ok(!(err instanceof DispatchRecoveryError), "a failed claim triggered claim recovery");
  assert.match(err.message, /502 Bad Gateway/);
  assert.equal(io.gh.comments.length, 0, "a failed claim commented on the issue");
  assert.equal(io.spawned.filter((s) => s.role === "executor").length, 0);
  assert.equal(io.lockReleased, true);
});

test("26b. recovery survives a failed local write and still frees the issue", async () => {
  const io = makeIo({ git: gitFailingAt("add") });
  io.writeResult = () => { throw new Error("EROFS: read-only file system"); };
  const out = await dispatchIssue(147, io);
  const recovery = io.gh.labelWrites.at(-1);
  assert.deepEqual(recovery.add, [LABELS.blocked], "a local write failure blocked the ledger recovery");
  assert.match(out.recovery.result, /EROFS/, "the local write failure was swallowed");
});

test("27. recovery never fires before this process holds the claim", async () => {
  // A pre-claim failure must not touch labels: the dispatcher does not own the
  // issue yet, and "recovering" it would clear someone else's state.
  const io = makeIo({ ghOver: { listOpenIssues: () => { throw new Error("gh: network unreachable"); } } });
  await assert.rejects(dispatchIssue(147, io));
  assert.equal(io.gh.labelWrites.length, 0, "a pre-claim failure edited labels");
  assert.equal(io.gh.comments.length, 0);
  assert.equal(io.lockReleased, true);
});

test("27b. a racing dispatcher never recovers another process's claim", async () => {
  let views = 0;
  const io = makeIo({
    ghOver: {
      viewIssue: () => {
        views += 1;
        return views === 1
          ? issue()
          : issue({ labels: [{ name: "status:ready-for-agent" }, { name: "status:agent-working" }] });
      },
    },
  });
  const out = await dispatchIssue(147, io);
  assert.equal(out.code, "already-claimed");
  assert.equal(io.gh.labelWrites.length, 0, "the racer edited the holder's labels");
  assert.equal(io.spawned.length, 0);
});

test("28. recovery evidence carries no stack trace and redacts token shapes", async () => {
  const io = makeIo({
    spawn: spawnThrowingAt("executor", "auth failed for gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 and sk-abcdefghijklmnopqrstuvwx"),
  });
  const out = await dispatchIssue(147, io);
  const serialized = JSON.stringify(out.result);
  assert.ok(!/gho_[A-Za-z0-9]{16,}/.test(serialized), "a token-shaped string reached the durable record");
  assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(serialized), "a key-shaped string reached the durable record");
  assert.match(out.result.errorMessage, /\[redacted\]/);
  assert.ok(!("stack" in out.result), "a stack trace was serialized");
  assert.ok(!/ at .*\.mjs:\d+/.test(serialized), "a stack frame reached the durable record");
  assert.ok(!/PI_CODING_AGENT_DIR|env/i.test(out.result.errorMessage ?? ""), "environment detail leaked");
  const body = io.gh.comments.at(-1)?.body ?? "";
  assert.ok(!/gho_|sk-/.test(body), "a credential shape reached the issue comment");
});

// `-C <path>` only says where git runs; it never changes which question is
// being asked, so the fake answers the verb underneath it.
const defaultGit = (argv, repo = { head: BASE, dirty: false, commits: [BASE, COMMIT], descendants: [COMMIT] }) => {
  const a = argv[0] === "-C" ? argv.slice(2) : argv;
  if (a[0] === "worktree" && a[1] === "list") {
    return { status: 0, stdout: worktrees([{ path: MAIN, branch: "main" }]), stderr: "" };
  }
  if (a[0] === "worktree") return { status: 0, stdout: "", stderr: "" };
  // No issue branch exists in this fake repository.
  if (a[0] === "rev-parse" && String(a.at(-1)).startsWith("refs/heads/")) {
    return { status: 1, stdout: "", stderr: "" };
  }
  if (a[0] === "rev-parse" && a.at(-1) === "HEAD") return { status: 0, stdout: `${repo.head}\n`, stderr: "" };
  if (a[0] === "rev-parse") return { status: 0, stdout: `${BASE}\n`, stderr: "" };
  // Object existence: only the shas this fake repository actually contains.
  if (a[0] === "cat-file") {
    const wanted = String(a.at(-1)).replace(/\^\{commit\}$/, "");
    return { status: repo.commits.includes(wanted) ? 0 : 128, stdout: "", stderr: "fatal: Not a valid object name" };
  }
  // Ancestry: BASE precedes COMMIT, and every commit is its own ancestor.
  if (a[0] === "merge-base" && a[1] === "--is-ancestor") {
    const [, , older, newer] = a;
    const ok = older === newer || (older === BASE && repo.descendants.includes(newer));
    return { status: ok ? 0 : 1, stdout: "", stderr: "" };
  }
  if (a[0] === "status") return { status: 0, stdout: repo.dirty ? " M src/x.ts\n" : "", stderr: "" };
  if (a[0] === "diff" && a.includes("--name-only")) {
    return { status: 0, stdout: repo.emptyDiff ? "\n" : "overlay/src/scoring/index.ts\n", stderr: "" };
  }
  if (a[0] === "log") return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
  return { status: 0, stdout: "", stderr: "" };
};

// --- T. reviewer isolation (trust boundary) -------------------------------

test("T1. the reviewer never runs inside the executor's mutable worktree", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true);
  const executor = io.spawned.find((s) => s.role === "executor");
  const reviewer = io.spawned.find((s) => s.role === "reviewer");
  assert.ok(reviewer, "no reviewer process was launched");
  assert.equal(executor.cwd, out.result.workspace, "the executor did not run in its own worktree");
  // "inside" is containment, not inequality: a subdirectory of the executor's
  // worktree is still the executor's worktree, and notEqual would wave it past.
  for (const root of [executor.cwd, out.result.workspace]) {
    assert.ok(
      reviewer.cwd !== root && !String(reviewer.cwd).startsWith(`${root}/`),
      `the reviewer ran inside the executor's ${root}`,
    );
  }
  assert.ok(out.result.reviewWorkspace, "no review workspace was recorded");
  assert.equal(reviewer.cwd, out.result.reviewWorkspace);
});

test("T2. the review workspace is a detached checkout of the verified commit", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  const add = io.gitCalls.find((a) => a[0] === "worktree" && a[1] === "add" && a.includes("--detach"));
  assert.ok(add, "the reviewer was given no workspace of its own");
  assert.equal(add.at(-1), out.result.commitSha, "the reviewer was not pointed at the verified commit");
  assert.ok(add.includes(out.result.reviewWorkspace), "the recorded review workspace is not the one git created");
  assert.ok(
    io.gitCalls.some((a) => a[0] === "worktree" && a[1] === "remove" && a.includes(out.result.reviewWorkspace)),
    "the review workspace outlived the run",
  );
});

test("T3. the reviewer is handed no path into the executor's run state", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  const executor = io.spawned.find((s) => s.role === "executor");
  const reviewer = io.spawned.find((s) => s.role === "reviewer");
  const executorState = [out.result.workspace, executor.runDir].filter(Boolean);
  const handed = [...reviewer.argv, reviewer.cwd, reviewer.runDir, ...Object.values(reviewer.env ?? {})]
    .filter(Boolean)
    .map(String);
  for (const token of handed) {
    for (const leak of executorState) {
      assert.ok(!token.includes(leak), `the reviewer was handed the executor's ${leak} (in ${token.slice(0, 80)})`);
    }
  }
  assert.ok(
    !String(reviewer.runDir).startsWith(String(executor.runDir)),
    "reviewer state was placed inside the executor's run directory",
  );
});

test("T4. reviewer isolation is enforced by the launcher, not by prompt wording", () => {
  const executor = { workspace: "/repo/x-worktrees/issues/147-y", runDir: "/state/runs/issue-147-attempt-01" };
  assert.throws(
    () => assertReviewerIsolation({ argv: ["claude", "--print", "brief"], cwd: executor.workspace, executor }),
    AttemptError,
    "a reviewer launched in the executor's worktree was allowed",
  );
  assert.throws(
    () =>
      assertReviewerIsolation({
        argv: ["pi", "--session-dir", `${executor.runDir}/session-reviewer`, "brief"],
        cwd: "/repo/x-worktrees/reviews/r1",
        executor,
      }),
    AttemptError,
    "a reviewer session adjacent to the executor's was allowed",
  );
  assert.doesNotThrow(() =>
    assertReviewerIsolation({
      argv: ["pi", "--session-dir", "/state/reviews/r1/session", "brief"],
      cwd: "/repo/x-worktrees/reviews/r1",
      executor,
    }),
  );
});

// --- U. git evidence ------------------------------------------------------

test("T4b. a subdirectory of the executor's worktree is still inside it", () => {
  const executor = { workspace: "/repo/x-worktrees/issues/147-y", runDir: "/state/runs/issue-147-attempt-01" };
  assert.throws(
    () => assertReviewerIsolation({ argv: ["claude", "brief"], cwd: `${executor.workspace}/src/lib`, executor }),
    AttemptError,
    "a reviewer one directory down from the executor's worktree was allowed",
  );
  // A trailing slash is the same directory by another spelling.
  assert.throws(
    () => assertReviewerIsolation({ argv: ["claude", "brief"], cwd: `${executor.workspace}/`, executor }),
    AttemptError,
    "a trailing slash defeated the containment check",
  );
});

test("T4c. the executor's roots may not reach the reviewer through the environment", () => {
  // The launch is argv AND env. A root forwarded through env reaches the
  // reviewer exactly as well as one in argv, and is easier to forward by accident.
  const executor = { workspace: "/repo/x-worktrees/issues/147-y", runDir: "/state/runs/issue-147-attempt-01" };
  const clean = { argv: ["pi", "brief"], cwd: "/repo/x-worktrees/reviews/r1", executor };
  assert.throws(
    () => assertReviewerIsolation({ ...clean, env: { MAYHEM_RUN_DIR: executor.runDir } }),
    AttemptError,
    "the executor's run directory was passed to the reviewer in the environment",
  );
  assert.throws(
    () => assertReviewerIsolation({ ...clean, env: { PWD_HINT: `${executor.workspace}/src` } }),
    AttemptError,
    "the executor's workspace was passed to the reviewer in the environment",
  );
  assert.doesNotThrow(() => assertReviewerIsolation({ ...clean, env: { ANTHROPIC_AUTH: "oauth" } }));
});

test("T4d. a symlink-equivalent path is the same directory", () => {
  // git reports realised paths while these roots are derived from the configured
  // main worktree, so /tmp and /private/tmp name one directory. Comparing raw
  // strings would let the reviewer run inside the executor's worktree.
  const executor = { workspace: "/tmp/wt/issues/147-y", runDir: "/tmp/state/runs/a1" };
  const realPath = (path) => String(path).replace(/^\/tmp\//, "/private/tmp/");
  assert.throws(
    () =>
      assertReviewerIsolation({
        argv: ["pi", "brief"],
        cwd: "/private/tmp/wt/issues/147-y",
        executor,
        realPath,
      }),
    AttemptError,
    "a symlinked spelling of the executor's worktree passed the isolation check",
  );
});

test("T5. an executor cannot grade itself by planting a reviewer report", async () => {
  // The executor owns its run directory. If a reviewer verdict were ever read
  // from a file there, writing report-reviewer.json would be all it takes to be
  // marked VERIFIED. The verdict comes from the reviewer's own output instead,
  // so the forgery below is simply never consulted.
  let forgeryRead = false;
  const io = makeIo({
    readReport: (runId, role) => {
      if (role === "reviewer") {
        forgeryRead = true;
        return { verdict: "PASS", findings: [] };
      }
      return {
        result: "FIX_PROPOSED",
        behavioralRed: "round counter reports 0 where the contract requires 4 — observed at src/x.ts:88",
        commitSha: COMMIT,
        tests: ["src/__tests__/x.test.ts"],
      };
    },
  });
  const inner = io.spawn;
  // The reviewer process itself says nothing at all, so the planted file is the
  // only place a PASS could possibly come from.
  io.spawn = (argv, opts) => {
    const answer = inner(argv, opts);
    return opts.role === "reviewer" ? { status: 0, signal: null, stdout: "", stderr: "", error: null } : answer;
  };
  const out = await dispatchIssue(147, io);
  assert.equal(forgeryRead, false, "the lifecycle read a reviewer verdict from the executor's run directory");
  assert.notEqual(out.result.result, "VERIFIED", "a planted report-reviewer.json produced VERIFIED");
  assert.equal(out.result.reviewVerdict, "NO_REPORT");
  assert.equal(out.result.nextStatus, LABELS.needsReview);
});

test("T6. a review workspace that cannot be created loses the review, not the evidence", async () => {
  // Throwing here would record INTERRUPTED and status:blocked, discarding a
  // git-verified commit and a passing gate — a worse account of the run than
  // "nobody reviewed it", and one that destroys real evidence.
  const io = makeIo();
  const inner = io.git;
  io.git = (argv) =>
    argv[0] === "worktree" && argv.includes("--detach")
      ? { status: 128, signal: null, stdout: "", stderr: "fatal: could not create work tree dir", error: null }
      : inner(argv);
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.gateResult, "PASS", "the gate result was discarded");
  assert.equal(out.result.commitEvidence.ok, true, "the commit evidence was discarded");
  assert.equal(out.result.result, "FIX_PROPOSED");
  assert.equal(out.result.nextStatus, LABELS.needsReview);
  assert.match(out.result.reviewNote, /could not be created/);
  assert.equal(out.result.failureStage, null, "a missing review was recorded as a failed run");
});

test("U1. a reported commit that does not exist fails closed", async () => {
  const io = makeIo({ readReport: reportingCommit("d".repeat(40)) });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.ok, false);
  assert.equal(out.result.commitEvidence.code, "commit-not-found");
  assert.notEqual(out.result.result, "VERIFIED");
  assert.notEqual(out.result.result, "GATE_PASSED");
  assert.equal(out.result.nextStatus, LABELS.needsHuman);
  assert.equal(io.spawned.filter((s) => s.role === "reviewer").length, 0, "a reviewer ran on unverified work");
});

test("U2. a real commit that does not descend from the starting head fails closed", async () => {
  const UNRELATED = "a".repeat(40);
  const io = makeIo({
    readReport: reportingCommit(UNRELATED),
    repo: { commits: [BASE, COMMIT, UNRELATED], descendants: [], afterExecutor: UNRELATED },
  });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.ok, false);
  assert.equal(out.result.commitEvidence.code, "commit-not-descended");
  assert.notEqual(out.result.result, "VERIFIED");
  assert.equal(out.result.nextStatus, LABELS.needsHuman);
});

test("U3. a stale reported sha that is not the gated head fails closed", async () => {
  // The executor reports its first commit but committed twice; the gate ran on
  // the second. Nothing here may claim the reported sha was proven.
  const io = makeIo({ readReport: reportingCommit(BASE) });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.ok, false);
  assert.equal(out.result.commitEvidence.code, "commit-not-head");
  assert.match(out.result.commitEvidence.reason, /c0ffee11dead/);
  assert.notEqual(out.result.result, "VERIFIED");
});

test("U4. a dirty worktree means the gate did not test the commit", async () => {
  const io = makeIo({ repo: { dirty: true } });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.ok, false);
  assert.equal(out.result.commitEvidence.code, "worktree-dirty");
  assert.notEqual(out.result.result, "VERIFIED");
});

test("U5. the recorded git facts are derived from git, never from the report", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  const evidence = out.result.commitEvidence;
  assert.equal(evidence.ok, true);
  assert.equal(evidence.commitSha, COMMIT);
  assert.equal(evidence.head, COMMIT, "the resulting HEAD was not read from git");
  assert.equal(evidence.startingHead, BASE);
  assert.deepEqual(evidence.changedFiles, ["overlay/src/scoring/index.ts"]);
  // Object existence and ancestry are asked of git, not assumed from the sha.
  assert.ok(
    io.gitCalls.some((a) => a.includes("cat-file") && a.some((t) => String(t).startsWith(COMMIT))),
    "the reported commit's existence was never checked",
  );
  assert.ok(
    io.gitCalls.some((a) => a.includes("merge-base") && a.includes("--is-ancestor")),
    "ancestry from the starting head was never checked",
  );
});

test("U6. a FIX_PROPOSED that committed nothing fails closed", async () => {
  // The executor reports the head it started from: no commit was made, and
  // every relational check below would otherwise pass trivially.
  const io = makeIo({ readReport: reportingCommit(BASE), repo: { afterExecutor: BASE } });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.code, "commit-is-starting-head");
  assert.notEqual(out.result.result, "VERIFIED");
  assert.notEqual(out.result.result, "GATE_PASSED");
});

test("U7. a commit that changes no file is not the fix it claims to be", async () => {
  const io = makeIo({ repo: { emptyDiff: true } });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.code, "commit-changes-nothing");
  assert.notEqual(out.result.result, "GATE_PASSED");
});

test("U8. git plumbing that never ran does not read as evidence", async () => {
  // spawnSync reports a launch that never happened as status:null. Every check
  // must treat that as "not established", never as "established clean".
  for (const verb of ["rev-parse", "cat-file", "merge-base", "status", "diff"]) {
    const io = makeIo({
      git: (argv) => {
        const a = argv[0] === "-C" ? argv.slice(2) : argv;
        if (a[0] === verb) return { status: null, signal: null, stdout: "", stderr: "", error: { code: "ENOENT", message: "spawn git ENOENT" } };
        return defaultGit(argv, { head: COMMIT, dirty: false, commits: [BASE, COMMIT], descendants: [COMMIT] });
      },
    });
    const out = await dispatchIssue(147, io);
    // A verb that fails before the evidence stage ends the run outright; one
    // that fails inside it leaves the evidence unestablished. Both are closed,
    // and neither may reach a result that claims something was proven.
    assert.ok(
      !["VERIFIED", "GATE_PASSED"].includes(out.result?.result),
      `a failed \`git ${verb}\` concluded ${out.result?.result}`,
    );
    if (out.result) {
      assert.equal(out.result.commitEvidence?.ok ?? false, false, `a failed \`git ${verb}\` was read as evidence`);
    }
  }
});

// --- V. result vocabulary -------------------------------------------------

test("U9. every check in verifyCommitEvidence fails closed on its own", () => {
  // Driven directly, so each git call can be broken in isolation. Reaching these
  // only through dispatchIssue hides them: a broken `rev-parse` also breaks the
  // stage that resolves the base head, so the run dies before the evidence code
  // is asked anything and the check appears covered when it is not.
  const NEVER_RAN = { status: null, signal: null, stdout: "", stderr: "", error: { code: "ENOENT" } };
  const answers = {
    "rev-parse": { status: 0, stdout: `${COMMIT}\n` },
    "cat-file": { status: 0, stdout: "" },
    "merge-base": { status: 0, stdout: "" },
    status: { status: 0, stdout: "" },
    diff: { status: 0, stdout: "src/x.ts\n" },
  };
  const gitWith = (over) => (argv) => {
    const a = argv[0] === "-C" ? argv.slice(2) : argv;
    return over[a[0]] ?? answers[a[0]] ?? { status: 0, stdout: "" };
  };
  const base = { reportedSha: COMMIT, startingHead: BASE, workspace: "/w" };

  assert.equal(verifyCommitEvidence({ ...base, git: gitWith({}) }).ok, true, "the clean case does not pass");

  // One broken verb per code, each proving that verb's check and no other.
  const cases = [
    ["rev-parse", NEVER_RAN, "head-unreadable"],
    ["cat-file", { status: 1, stdout: "" }, "commit-not-found"],
    ["merge-base", { status: 1, stdout: "" }, "commit-not-descended"],
    ["status", NEVER_RAN, "cleanliness-unknown"],
    ["status", { status: 0, stdout: " M src/x.ts\n" }, "worktree-dirty"],
    ["diff", NEVER_RAN, "diff-unreadable"],
    ["diff", { status: 0, stdout: "\n  \n" }, "commit-changes-nothing"],
  ];
  for (const [verb, answer, code] of cases) {
    const out = verifyCommitEvidence({ ...base, git: gitWith({ [verb]: answer }) });
    assert.equal(out.ok, false, `a broken \`git ${verb}\` was read as evidence`);
    assert.equal(out.code, code, `a broken \`git ${verb}\` reported ${out.code}`);
    assert.equal(out.commitSha, null, "a failed verification still returned a commit sha");
  }

  // Claims the caller makes, rather than answers git gives.
  assert.equal(verifyCommitEvidence({ ...base, reportedSha: "nope", git: gitWith({}) }).code, "commit-missing");
  assert.equal(verifyCommitEvidence({ ...base, startingHead: null, git: gitWith({}) }).code, "starting-head-unknown");
  // The workspace moved past the commit the report names, so the gate ran on
  // something else.
  assert.equal(
    verifyCommitEvidence({ ...base, git: gitWith({ "rev-parse": { status: 0, stdout: `${BASE}\n` } }) }).code,
    "commit-not-head",
  );
  // A FIX_PROPOSED that committed nothing: head is the starting head.
  assert.equal(
    verifyCommitEvidence({
      reportedSha: BASE,
      startingHead: BASE,
      workspace: "/w",
      git: gitWith({ "rev-parse": { status: 0, stdout: `${BASE}\n` } }),
    }).code,
    "commit-is-starting-head",
  );
});

test("V1. a deterministic gate pass alone is GATE_PASSED, never VERIFIED", () => {
  const reported = { result: "FIX_PROPOSED" };
  const base = { reported, gateResult: "PASS", reviewVerdicts: [], reviewersRequired: 0, commitVerified: true };
  const out = concludeRun({ ...base, gateComplete: true });
  assert.equal(out.result, "GATE_PASSED", "a gate pass with no independent review claimed VERIFIED");
  assert.equal(out.completionLevel, "OFFLINE-PROVEN");
});

test("V1b. a profile that skipped suites is not OFFLINE-PROVEN", () => {
  // The default profile runs one suite out of five. Calling that outcome
  // offline-proven overstates almost every run the dispatcher will ever do.
  const reported = { result: "FIX_PROPOSED" };
  const partial = { reported, gateResult: "PASS", commitVerified: true, gateComplete: false };
  assert.equal(concludeRun({ ...partial, reviewVerdicts: [], reviewersRequired: 0 }).completionLevel, "IMPLEMENTED");
  assert.equal(
    concludeRun({ ...partial, reviewVerdicts: ["PASS"], reviewersRequired: 1 }).completionLevel,
    "IMPLEMENTED",
    "a partial gate was recorded as offline-proven because a reviewer agreed",
  );
  // The result itself is unaffected: coverage bounds the proof, not the verdict.
  assert.equal(concludeRun({ ...partial, reviewVerdicts: ["PASS"], reviewersRequired: 1 }).result, "VERIFIED");
});

test("V2. VERIFIED requires an independent reviewer to have passed", () => {
  const reported = { result: "FIX_PROPOSED" };
  const base = { reported, gateResult: "PASS", reviewersRequired: 1, commitVerified: true, gateComplete: true };
  assert.equal(concludeRun({ ...base, reviewVerdicts: ["PASS"] }).result, "VERIFIED");
  assert.equal(concludeRun({ ...base, reviewVerdicts: ["FAIL"] }).result, "FIX_PROPOSED");
  assert.equal(concludeRun({ ...base, reviewVerdicts: ["NO_REPORT"] }).result, "FIX_PROPOSED");
  assert.equal(concludeRun({ ...base, reviewVerdicts: [] }).result, "FIX_PROPOSED", "no review at all read as VERIFIED");
  assert.equal(concludeRun({ ...base, reviewVerdicts: ["NO_REPORT"] }).nextStatus, LABELS.needsReview);
});

test("V2b. VERIFIED requires EVERY reviewer the policy asked for", () => {
  // Risk 4 asks for two independent reviewers. One PASS is half an answer and
  // must not be recorded in the same word as the whole one.
  const reported = { result: "FIX_PROPOSED" };
  const base = { reported, gateResult: "PASS", reviewersRequired: 2, commitVerified: true, gateComplete: true };
  const half = concludeRun({ ...base, reviewVerdicts: ["PASS"] });
  assert.equal(half.result, "FIX_PROPOSED", "one of two required reviewers passed and the run claimed VERIFIED");
  assert.equal(half.nextStatus, LABELS.needsReview);
  assert.equal(concludeRun({ ...base, reviewVerdicts: ["PASS", "PASS"] }).result, "VERIFIED");
  // One dissent is enough, whichever reviewer it came from.
  assert.equal(concludeRun({ ...base, reviewVerdicts: ["PASS", "FAIL"] }).result, "FIX_PROPOSED");
  assert.equal(concludeRun({ ...base, reviewVerdicts: ["FAIL", "PASS"] }).nextStatus, LABELS.needsHuman);
});

test("V3. an unverified commit can conclude neither VERIFIED nor GATE_PASSED", () => {
  const reported = { result: "FIX_PROPOSED" };
  for (const reviewersRequired of [0, 1, 2]) {
    const out = concludeRun({
      reported,
      gateResult: "PASS",
      reviewVerdicts: Array.from({ length: reviewersRequired }, () => "PASS"),
      reviewersRequired,
      commitVerified: false,
      gateComplete: true,
    });
    assert.ok(!["VERIFIED", "GATE_PASSED"].includes(out.result), `unverified work concluded ${out.result}`);
    assert.equal(out.nextStatus, LABELS.needsHuman);
    assert.equal(out.completionLevel, null, "an unverified commit claimed a completion level");
  }
});

test("V4. a concluded-only result is not something an executor may report", () => {
  for (const claimed of CONCLUDED_ONLY) {
    assert.throws(
      () =>
        normalizeExecutorReport(
          { result: claimed, behavioralRed: "real observed violation at :88", commitSha: HEAD },
          { fingerprint: FINGERPRINT, role: "executor" },
        ),
      ContractError,
      `an executor was allowed to claim ${claimed}`,
    );
  }
  assert.ok(CONCLUDED_ONLY.includes("VERIFIED") && CONCLUDED_ONLY.includes("GATE_PASSED"));
});

test("V5. a gate pass records what the profile did not cover", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.gateCoverage.profile, "harness");
  assert.deepEqual(out.result.gateCoverage.suites, ["harness"]);
  assert.deepEqual(out.result.gateCoverage.notCovered, ["web", "overlay"]);
  assert.match(io.gh.comments.at(-1).body, /NOT_COVERED=web,overlay/);
});

// --- W. source neutrality -------------------------------------------------

test("W1. a Task that is not a GitHub issue runs the whole attempt lifecycle", async () => {
  // The io below has no `gh` key at all, and the task has no issue number. If
  // the lifecycle still needed GitHub for anything, this could not run.
  const repo = { head: BASE, dirty: false, commits: [BASE, COMMIT], descendants: [COMMIT], afterExecutor: COMMIT };
  const spawned = [];
  const task = {
    id: "local-task-7",
    attemptId: "local-task-7-attempt-01",
    identity: { kind: "task", id: 7, slug: "async-transport" },
    title: "Async transport stalls",
    url: "file:///dev/null",
    spec: "round counter reports 0 where the contract requires 4",
    fingerprint: "local:async-transport",
    taskClass: "T3",
    baseRef: BASE,
    resolvedBaseSha: BASE,
    gateProfile: "harness",
    contextPaths: ["AGENTS.md"],
  };
  const routed = route({ taskClass: "T3", available: ["CLAUDE_A", "GPT_A"], config });
  const plan = {
    effort: routed.effort,
    primary: routed.primary,
    reviewers: routed.reviewers,
    verification: routed.verification,
    mechanismOf: (a) => config.routing.executionMechanisms[a.execution],
  };
  const io = {
    mainWorktree: MAIN,
    harnessRoot: MAIN,
    runsDir: "/state/runs",
    reviewsDir: "/state/reviews",
    git: (argv) => defaultGit(argv, repo),
    pathExists: () => false,
    realPath: (p) => p,
    spawn: (argv, opts) => {
      spawned.push({ argv, ...opts });
      if (opts.role === "executor" && repo.head === BASE) repo.head = repo.afterExecutor;
      return runtimeAnswer(argv, opts);
    },
    readReport: (_id, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      return {
        result: "FIX_PROPOSED",
        behavioralRed: "round counter reports 0 where the contract requires 4 — observed at src/x.ts:88",
        commitSha: COMMIT,
        tests: ["src/__tests__/x.test.ts"],
      };
    },
    normalizeReport: (raw) => normalizeExecutorReport(raw, { fingerprint: task.fingerprint, role: "executor" }),
    buildPacket: ({ workspace, reportPath }) => `work in ${workspace}; report to ${reportPath}`,
    buildReviewBrief: ({ workspace, diff }) => `review ${workspace}\n${diff}`,
  };
  assert.ok(!("gh" in io), "the lifecycle io was given a GitHub client");

  const attempt = await runAttempt(task, plan, io);

  assert.equal(attempt.taskId, "local-task-7");
  assert.equal(attempt.workspace, "/repo/mayhem-oracle-worktrees/tasks/7-async-transport");
  assert.equal(attempt.branch, "task/7-async-transport");
  assert.equal(attempt.commitEvidence.ok, true);
  assert.equal(attempt.gateResult, "PASS");
  assert.equal(attempt.reviewVerdict, "PASS");
  assert.equal(attempt.result, "VERIFIED");
  assert.equal(attempt.disposition, "accepted");
  // The fake gate reports web and overlay as not covered, so this run is not
  // offline-proven however green the profile it did run came back.
  assert.equal(attempt.completionLevel, "IMPLEMENTED");
  assert.deepEqual(attempt.gateCoverage.notCovered, ["web", "overlay"]);
  assert.ok(spawned.some((x) => x.role === "reviewer"), "no reviewer ran for a risk-3 task");
  // The generic record carries no ledger state of any kind.
  const serialized = JSON.stringify(attempt);
  assert.ok(!serialized.includes("status:"), "a ledger label reached the generic attempt record");
  assert.ok(!("nextStatus" in attempt), "the lifecycle decided a ledger status");
  assert.ok(!("issue" in attempt), "the lifecycle recorded an issue number");
});

test("W2. nothing under harness/run/ depends on GitHub", () => {
  // Comments may discuss the boundary; code may not cross it.
  const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const file of ["run/attempt.mjs", "run/workspace.mjs", "run/evidence.mjs", "run/process.mjs"]) {
    const code = codeOf(source(file));
    for (const forbidden of [/\bgithub\b/i, /\bissue\b/i, /\bLABELS\b/, /status:[a-z-]+/, /\bgh\b/]) {
      assert.ok(!forbidden.test(code), `${file} code names ${forbidden} — the lifecycle knows its caller`);
    }
    assert.ok(!/from\s+"\.\.\/github\//.test(code), `${file} imports from the GitHub adapter`);
  }
});

test("W3. the GitHub adapter is the only place a disposition becomes a label", () => {
  const adapter = source("github/issue-contract.mjs");
  assert.match(adapter, /STATUS_FOR_DISPOSITION/, "no disposition mapping exists");
  for (const disposition of DISPOSITIONS) {
    assert.ok(STATUS_FOR_DISPOSITION[disposition], `disposition ${disposition} has no ledger status`);
    assert.ok(Object.values(LABELS).includes(STATUS_FOR_DISPOSITION[disposition]));
  }
  // Every disposition the lifecycle can produce is one the ledger can express.
  const lifecycle = source("run/attempt.mjs");
  for (const quoted of [...lifecycle.matchAll(/at\("[A-Z_]+",\s*"([a-z-]+)"/g)].map((m) => m[1])) {
    assert.ok(DISPOSITIONS.includes(quoted), `concludeAttempt can return unmapped disposition ${quoted}`);
  }
});

// --- X. capability vs content in the reviewer launch -----------------------
//
// An access-control check answers "what can the reviewer reach", not "what was
// the reviewer told". The review brief quotes the diff under review, so it can
// legitimately contain any string in the repository — the executor's own paths
// among them. Scanning it conflates the two, and the failure is not harmless:
// it throws at stage=review, which recovers the issue as INTERRUPTED/blocked
// and discards a git-verified commit and a passing gate.

const EXEC_STATE = { workspace: "/repo/wt/issues/147-y", runDir: "/state/runs/issue-147-attempt-01" };
// Shaped like the mechanisms in routing.json: literals, path-bearing
// substitutions, and one bare content placeholder at the end.
const REVIEW_TEMPLATE = ["pi", "--print", "--session-dir", "{sessionDir}", "--tools", "read", "{prompt}"];
const briefMentioning = (path) => `# Independent review\n\n## FIXED-POINT DIFF\n\`\`\`diff\n+// produced in ${path}/src/x.ts\n\`\`\`\n`;

test("X1. a review brief that merely mentions the executor's path is not access", () => {
  assert.doesNotThrow(() =>
    assertReviewerIsolation({
      argv: ["pi", "--print", "--session-dir", "/state/reviews/r1/0/session-reviewer", "--tools", "read", briefMentioning(EXEC_STATE.workspace)],
      template: REVIEW_TEMPLATE,
      cwd: "/repo/wt/reviews/r1",
      runDir: "/state/reviews/r1/0",
      env: {},
      executor: EXEC_STATE,
    }),
  );
  // The run directory reads the same way: quoting it is not holding it.
  assert.doesNotThrow(() =>
    assertReviewerIsolation({
      argv: ["pi", "--print", "--session-dir", "/state/reviews/r1/0/session-reviewer", "--tools", "read", briefMentioning(EXEC_STATE.runDir)],
      template: REVIEW_TEMPLATE,
      cwd: "/repo/wt/reviews/r1",
      runDir: "/state/reviews/r1/0",
      env: {},
      executor: EXEC_STATE,
    }),
  );
});

test("X2. a path-bearing launch argument naming the executor's root is still refused", () => {
  // Same string, a different slot: this one is a capability.
  assert.throws(
    () =>
      assertReviewerIsolation({
        argv: ["pi", "--print", "--session-dir", `${EXEC_STATE.runDir}/session-reviewer`, "--tools", "read", "brief"],
        template: REVIEW_TEMPLATE,
        cwd: "/repo/wt/reviews/r1",
        runDir: "/state/reviews/r1/0",
        env: {},
        executor: EXEC_STATE,
      }),
    AttemptError,
    "a session directory inside the executor's run state was allowed",
  );
  // A literal in the template is not exempt either.
  assert.throws(
    () =>
      assertReviewerIsolation({
        argv: ["pi", "--print", "--session-dir", "/state/reviews/r1/0/session-reviewer", "--add-dir", EXEC_STATE.workspace, "brief"],
        template: ["pi", "--print", "--session-dir", "{sessionDir}", "--add-dir", EXEC_STATE.workspace, "{prompt}"],
        cwd: "/repo/wt/reviews/r1",
        runDir: "/state/reviews/r1/0",
        env: {},
        executor: EXEC_STATE,
      }),
    AttemptError,
    "a hardcoded grant of the executor's worktree was allowed",
  );
});

test("X3. a reviewer run directory inside the executor's run state is refused", () => {
  // Where the reviewer's own state is placed is a capability whether or not the
  // launch template happens to pass it through: the dispatcher creates it.
  assert.throws(
    () =>
      assertReviewerIsolation({
        argv: ["claude", "--print", "--permission-mode", "plan", "brief"],
        template: ["claude", "--print", "--permission-mode", "plan", "{prompt}"],
        cwd: "/repo/wt/reviews/r1",
        runDir: `${EXEC_STATE.runDir}/reviewer`,
        env: {},
        executor: EXEC_STATE,
      }),
    AttemptError,
    "the reviewer's own state was placed inside the executor's run directory",
  );
});

test("X4. a template that mixes the brief into a control argument is refused", () => {
  // Content and capability cannot be told apart inside one token. Refusing the
  // template is the honest answer; scanning it reintroduces X1 and skipping it
  // opens a hole.
  assert.throws(
    () =>
      assertReviewerIsolation({
        argv: ["pi", "--prompt=brief"],
        template: ["pi", "--prompt={prompt}"],
        cwd: "/repo/wt/reviews/r1",
        runDir: "/state/reviews/r1/0",
        env: {},
        executor: EXEC_STATE,
      }),
    AttemptError,
    "a template mixing content into a control argument was accepted",
  );
});

test("X5. a fixed-point diff quoting the executor's worktree does not abort the run", async () => {
  // The whole point, end to end: a run that produced a git-verified commit and
  // a passing gate must not be recorded INTERRUPTED because the diff it is
  // being reviewed on mentions where it was produced.
  const workspace = `${WT_ROOT}/147-${slugFor(issue().title)}`;
  const io = makeIo();
  const inner = io.git;
  io.git = (argv) => {
    const a = argv[0] === "-C" ? argv.slice(2) : argv;
    if (a[0] === "diff" && !a.includes("--name-only")) {
      io.gitCalls.push(argv);
      return { status: 0, stdout: `--- a/docs/x.md\n+++ b/docs/x.md\n+built in ${workspace}\n`, stderr: "" };
    }
    return inner(argv);
  };
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.workspace, workspace, "the fixture no longer names the real workspace");
  assert.equal(out.result.failureStage, null, `the run aborted at ${out.result.failureStage}`);
  assert.equal(out.result.commitEvidence.ok, true, "the commit evidence was discarded");
  assert.equal(out.result.gateResult, "PASS", "the gate result was discarded");
  assert.equal(out.result.result, "VERIFIED");
  const reviewer = io.spawned.find((s) => s.role === "reviewer");
  assert.ok(reviewer, "no reviewer was launched");
  assert.ok(reviewer.argv.some((t) => t.includes(workspace)), "the fixture never reached the brief");
});

// --- Y. one validated snapshot is the Task --------------------------------
//
// The task executed must be the task version that was validated. Everything
// derived above the claim — the route, the gate preflight, the packet — comes
// from one snapshot, and a contract that moved under it invalidates all three.

test("Y1. a contract that moves between the read and the claim is refused", async () => {
  // The route was already decided from the first task_class. Executing the
  // second one under that route is a run nobody validated.
  for (const [field, moved] of [
    ["task_class", { task_class: "T1" }],
    ["gate_profile", { gate_profile: "web" }],
    ["fingerprint", { fingerprint: "geometry:something:else" }],
  ]) {
    let views = 0;
    const io = makeIo({
      ghOver: {
        viewIssue: () => {
          views += 1;
          return views === 1 ? issue() : withMachine(moved);
        },
      },
    });
    const out = await dispatchIssue(147, io);
    assert.equal(out.dispatched, false, `a changed ${field} still dispatched`);
    assert.equal(out.code, "issue-changed", `a changed ${field} refused as ${out.code}`);
    assert.match(out.reason, new RegExp(field));
    assert.equal(io.spawned.length, 0, `a changed ${field} started a process`);
    assert.equal(io.gh.labelWrites.length, 0, `a changed ${field} claimed the issue`);
  }
});

test("Y2. the executor is handed the spec that was validated, never a later one", async () => {
  // There used to be a third read, after the gate preflight and unchecked by
  // anything, whose body became task.spec. Two reads now, and the second is
  // the Task.
  const VALIDATED = "the defect statement that was validated";
  const LATER = "an entirely different defect nobody validated";
  let views = 0;
  const io = makeIo({
    ghOver: {
      viewIssue: () => {
        views += 1;
        return issue({ body: `## Summary\n\n${views >= 3 ? LATER : VALIDATED}\n\n${machine()}\n` });
      },
    },
  });
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true);
  assert.equal(views, 2, "the issue was read a third time, and that read was validated by nothing");
  const packet = io.spawned.find((s) => s.role === "executor").argv.at(-1);
  assert.ok(packet.includes(VALIDATED), "the executor was not handed the validated spec");
  assert.ok(!packet.includes(LATER), "the executor was handed a spec that was never validated");
  // And the rest of the Task comes from that same snapshot.
  assert.equal(out.result.fingerprint, FINGERPRINT);
  assert.equal(out.result.resolvedBaseSha, BASE);
  assert.ok(packet.includes(`RESOLVED_BASE_SHA: ${BASE}`), "the packet base sha is not the validated one");
});

test("Y3. a title edited between the reads dispatches and never orphans the worktree", async () => {
  // A title is decoration, not contract: it must not refuse the run. Identity
  // is kind+id, so the worktree the old slug created is resumed, not orphaned.
  const oldSlug = slugFor(issue().title);
  const renamed = "Overlay geometry no longer stalls";
  let views = 0;
  const io = makeIo({
    ghOver: {
      viewIssue: () => {
        views += 1;
        return views === 1 ? issue() : issue({ title: renamed });
      },
    },
  });
  const inner = io.git;
  io.git = (argv) => {
    const a = argv[0] === "-C" ? argv.slice(2) : argv;
    if (a[0] === "worktree" && a[1] === "list") {
      io.gitCalls.push(argv);
      return {
        status: 0,
        stdout: worktrees([
          { path: MAIN, branch: "main" },
          { path: `${WT_ROOT}/147-${oldSlug}`, branch: `issue/147-${oldSlug}`, head: BASE },
        ]),
        stderr: "",
      };
    }
    return inner(argv);
  };
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true, `a renamed issue refused with ${out.code}`);
  assert.equal(out.result.workspaceAction, "resume", "a renamed issue did not resume its worktree");
  assert.equal(out.result.workspace, `${WT_ROOT}/147-${oldSlug}`);
  assert.ok(
    !io.gitCalls.some((a) => a[0] === "worktree" && a[1] === "add" && !a.includes("--detach")),
    "a renamed issue created a second worktree",
  );
  // The fresher title still reaches the packet: it is presentation, and stale
  // presentation is its own defect.
  assert.ok(io.spawned.find((s) => s.role === "executor").argv.at(-1).includes(renamed));
});

test("Y4. a base that advanced while routing is used, not refused", async () => {
  // The contract is what the machine block says, not what its base_ref resolves
  // to: nothing above the claim is derived from the sha, so a branch that moved
  // invalidates nothing. Refusing here would stop every dispatch that raced a
  // push, and the run would still have to be cut from some base.
  let resolves = 0;
  const io = makeIo();
  const inner = io.git;
  io.git = (argv) => {
    const a = argv[0] === "-C" ? argv.slice(2) : argv;
    if (a[0] === "rev-parse" && a.includes("--verify") && String(a.at(-1)).endsWith("^{commit}")) {
      resolves += 1;
      io.gitCalls.push(argv);
      return { status: 0, stdout: `${resolves === 1 ? BASE : HEAD}\n`, stderr: "" };
    }
    return inner(argv);
  };
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true, `a moved base refused with ${out.code}`);
  assert.equal(out.result.resolvedBaseSha, HEAD, "the run was cut from the stale base");
  assert.ok(
    io.gitCalls.some((a) => a[0] === "worktree" && a[1] === "add" && a.includes(HEAD)),
    "the worktree was created from a base other than the validated one",
  );
});

// --- Z. the operator-facing summary ---------------------------------------

test("Z1. the CLI summary names the workspace the attempt actually used", async () => {
  // The record renamed worktree -> workspace at schema 2 and this line did not,
  // so every dispatch printed WORKSPACE=undefined. A field the record does not
  // carry must fail a test rather than reach a terminal.
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.ok(out.result.workspace, "the attempt recorded no workspace");
  const line = summaryLine(out.result);
  assert.ok(line.includes(out.result.workspace), `the summary does not name the workspace: ${line}`);
  assert.doesNotMatch(line, /undefined/, `the summary printed a field the record does not carry: ${line}`);
  assert.ok(line.includes(out.result.result) && line.includes(out.result.nextStatus));
});

// --- R. the candidate is subject data, not reviewer configuration ---------

test("R1. a candidate that changes CLAUDE.md is reviewed like any other diff", async () => {
  // Verification correctness must not be coupled to a filename. A task whose
  // whole purpose is to edit the project instructions has to be reviewable, so
  // the boundary is where the file is *loaded*, never whether it changed.
  const io = makeIo();
  const inner = io.git;
  io.git = (argv) => {
    const a = argv[0] === "-C" ? argv.slice(2) : argv;
    if (a[0] === "diff" && a.includes("--name-only")) {
      io.gitCalls.push(argv);
      return { status: 0, stdout: "CLAUDE.md\n.claude/settings.json\n", stderr: "" };
    }
    return inner(argv);
  };
  const out = await dispatchIssue(147, io);
  assert.deepEqual(out.result.changedFiles, ["CLAUDE.md", ".claude/settings.json"]);
  assert.equal(out.result.commitEvidence.ok, true, "a project-instruction change was refused as evidence");
  assert.equal(out.result.result, "VERIFIED", `a CLAUDE.md change concluded ${out.result.result}`);
  assert.equal(out.result.reviewVerdict, "PASS");
  assert.equal(out.result.nextStatus, LABELS.verified);
});

test("R2. the reviewer receives the controller's explicit brief", async () => {
  // Disabling the candidate's own configuration must not leave the reviewer
  // undefined: everything it needs is controller-authored and passed in argv.
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  const brief = io.spawned.find((s) => s.role === "reviewer").argv.at(-1);
  assert.match(brief, /Independent review/, "the reviewer was not handed the review brief");
  assert.ok(brief.includes(out.result.commitSha), "the brief does not pin the commit under review");
  assert.ok(brief.includes(out.result.startingHead), "the brief does not pin the base");
  assert.match(brief, /DETERMINISTIC GATE OUTPUT/, "the brief carries no gate evidence");
  assert.match(brief, /FIXED-POINT DIFF/, "the brief carries no diff");
  for (const criterion of config.policy.criteria) {
    assert.ok(brief.includes(criterion), `the brief omits criterion ${criterion}`);
  }
  assert.match(brief, /"verdict"/, "the brief states no return format");
});

// --- fake io -------------------------------------------------------------

// The gate's own acceptance-authority declaration, run for real.
const VERIFY_TASK = fileURLToPath(new URL("../verify-task.sh", import.meta.url));
const realAuthority = (profile) =>
  spawnSync("bash", [VERIFY_TASK, profile, "--authority"], { encoding: "utf8" });

function makeIo(over = {}) {
  const order = [];
  const spawned = [];
  const labelWrites = [];
  const comments = [];
  const results = [];
  const gitCalls = [];
  // A fake repository with a head the fake executor advances, so "what the
  // executor said it committed" and "what the worktree actually is" are two
  // separate facts here exactly as they are on a real machine.
  const repo = {
    head: BASE,
    dirty: false,
    commits: [BASE, COMMIT],
    descendants: [COMMIT],
    afterExecutor: COMMIT,
    ...(over.repo ?? {}),
  };
  let views = 0;
  const io = {
    config: over.config ?? config,
    route: over.route ?? ((args) => route({ ...args, config: io.config })),
    available: over.available ?? ["CLAUDE_A", "GPT_A"],
    mainWorktree: MAIN,
    harnessRoot: "harnessRoot" in over ? over.harnessRoot : MAIN,
    startingHead: HEAD,
    order,
    spawned,
    lockReleased: false,
    gh: {
      get views() { return views; },
      labelWrites,
      comments,
      viewIssue: () => { views += 1; return over.machine ? withMachine(over.machine) : issue(); },
      listOpenIssues: () => [over.machine ? withMachine(over.machine) : issue()],
      repoLabels: () => Object.values(LABELS),
      setLabels: (number, change) => { order.push(labelWrites.length ? "status" : "claim"); labelWrites.push({ number, ...change }); },
      comment: (number, body) => { order.push("comment"); comments.push({ number, body }); },
      ...(over.ghOver ?? {}),
    },
    gitCalls,
    repo,
    git: over.git ?? ((argv) => { gitCalls.push(argv); return defaultGit(argv, repo); }),
    exists: over.exists ?? (() => true),
    pathExists: over.pathExists ?? (() => false),
    probe: over.probe ?? (({ command }) => {
      const i = command.indexOf("--provider");
      return { status: "ready", provider: i === -1 ? null : command[i + 1], authType: "oauth" };
    }),
    spawn: over.spawn ?? ((argv, opts) => {
      order.push(`launch:${opts.role ?? "gate"}`);
      spawned.push({ argv, ...opts });
      if (opts.role === "executor" && repo.head === BASE) repo.head = repo.afterExecutor;
      // Answered by the real gate, deliberately: a stub here would let the
      // lifecycle agree with a declaration the gate does not actually make.
      if (opts.role === "gate-authority") return realAuthority(argv[2]);
      return runtimeAnswer(argv, opts);
    }),
    readReport: over.readReport ?? ((runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      return {
        result: "FIX_PROPOSED",
        behavioralRed:
          "geometry round counter reports 0 where the contract requires 4 — observed at overlay/src/scoring/index.ts:88",
        commitSha: COMMIT,
        tests: ["overlay/src/scoring/__tests__/geometry.test.ts"],
      };
    }),
    writeResult: (runId, result) => { order.push("write-result"); results.push({ runId, result }); },
    runsDir: over.runsDir ?? "/state/runs",
    reviewsDir: over.reviewsDir ?? "/state/reviews",
    lock: over.lock ?? ((number) => ({ number, release: () => { io.lockReleased = true; } })),
    log: () => {},
  };
  return io;
}

// G. the gate authority is the controller's, never the candidate's ----------
//
// The gate outranks every reviewer, so whoever writes the gate outranks every
// reviewer too. These hold the line that the workspace being judged supplies
// only the subject: the runner, the suite inventory and the profile all come
// from the checkout the dispatcher itself runs out of.

test("G1. the gate runs the controller's runner against the candidate as an argument", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true);

  const gate = io.spawned.find((s) => s.role === "gate");
  assert.ok(gate, "no gate ever ran");
  assert.equal(gate.argv[0], "bash");
  assert.equal(
    gate.argv[1],
    `${MAIN}/harness/verify-task.sh`,
    "the gate script was not taken from the controller's own harness checkout",
  );
  const target = gate.argv[gate.argv.indexOf("--worktree") + 1];
  assert.ok(gate.argv.includes("--worktree"), "the gate was never told which workspace to judge");
  assert.equal(target, out.result.workspace, "the gate judged something other than the attempt's workspace");
  assert.notEqual(gate.cwd, out.result.workspace, "the gate still ran from inside the candidate checkout");
});

test("G2. a gate with no trusted checkout to run from fails closed", async () => {
  const io = makeIo({ harnessRoot: null });
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, false, "an attempt started with nothing trusted to gate it");
  assert.equal(out.code, "no-gate-authority");
  assert.equal(io.gh.labelWrites.length, 0, "the issue was claimed before the gate authority was known");
  assert.equal(
    io.spawned.filter((s) => s.role === "gate" || s.role === "gate-plan").length,
    0,
    "the gate ran anyway, resolving its script from somewhere untrusted",
  );

  // The lifecycle refuses on its own too, for callers that are not the adapter.
  assert.throws(
    () => gateArgv({ harnessRoot: null, profile: "harness", worktree: "/w" }),
    /no trusted harness checkout/,
  );
});

test("G3. the record says which gate authority judged which workspace", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.gateResult, "PASS");
  assert.equal(out.result.gateWorkspace, out.result.workspace);
  assert.match(
    out.result.gateAuthorityRevision,
    /^[0-9a-f]{40}$/,
    "the record cannot say which revision of the gate decided this attempt",
  );
});

test("G4. the preflight and the authoritative gate share one trusted runner", async () => {
  const io = makeIo();
  await dispatchIssue(147, io);
  const plan = io.spawned.find((s) => s.role === "gate-plan");
  const gate = io.spawned.find((s) => s.role === "gate");
  assert.ok(plan && gate, "preflight or gate never ran");
  assert.equal(plan.argv[1], gate.argv[1], "the profile was planned by a different script than the one that ran");
  assert.ok(plan.argv.includes("--plan"));
});

// J. a candidate may not be its own examiner --------------------------------
//
// The trusted runner still reads its checks out of the workspace it judges, so
// a diff that edits those checks is editing what PASS means. Such a run is not
// refused and its result is not discarded — it simply stops being the kind of
// pass that can advance the ledger on its own.

// Every changed path a test wants, in place of the fake repo's diff.
const changing = (io, files) => {
  const inner = io.git;
  io.git = (argv) => {
    const a = argv[0] === "-C" ? argv.slice(2) : argv;
    if (a[0] === "diff" && a.includes("--name-only")) {
      io.gitCalls.push(argv);
      return { status: 0, stdout: `${files.join("\n")}\n`, stderr: "" };
    }
    return inner(argv);
  };
  return io;
};

test("J1. a gate pass on an untouched examiner is authoritative", () => {
  const base = {
    reported: { result: "FIX_PROPOSED" },
    gateResult: "PASS",
    reviewVerdicts: [],
    reviewersRequired: 0,
    commitVerified: true,
    gateComplete: true,
  };
  const out = concludeRun({ ...base, gateAuthoritative: true });
  assert.equal(out.result, "GATE_PASSED");
  assert.equal(out.disposition, "accepted");
});

test("J2. a gate pass produced by a candidate-edited examiner cannot advance alone", () => {
  const base = {
    reported: { result: "FIX_PROPOSED" },
    gateResult: "PASS",
    reviewVerdicts: [],
    reviewersRequired: 0,
    commitVerified: true,
    gateComplete: true,
  };
  const out = concludeRun({ ...base, gateAuthoritative: false });
  assert.notEqual(out.result, "GATE_PASSED", "the candidate's own examiner produced an authoritative pass");
  assert.equal(out.disposition, "needs-review");
  assert.equal(out.completionLevel, "IMPLEMENTED", "an examiner the candidate wrote proved the change offline");
});

test("J3. an independent reviewer still decides where one is required", () => {
  const base = {
    reported: { result: "FIX_PROPOSED" },
    gateResult: "PASS",
    commitVerified: true,
    gateComplete: true,
    gateAuthoritative: false,
  };
  assert.equal(concludeRun({ ...base, reviewVerdicts: ["PASS"], reviewersRequired: 1 }).result, "VERIFIED");
  assert.equal(concludeRun({ ...base, reviewVerdicts: ["FAIL"], reviewersRequired: 1 }).result, "FIX_PROPOSED");
});

test("J4. weakening the tests that catch a bug does not manufacture an authoritative pass", async () => {
  const io = changing(makeIo({ machine: { task_class: "T1" } }), ["src/lib/scoring/round.ts", "harness/test/policy.test.mjs"]);
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.gateResult, "PASS", "the gate result itself was discarded rather than recorded");
  assert.equal(out.result.gateAuthority, "candidate-influenced");
  assert.deepEqual(out.result.gateAuthorityTouched, ["harness/test/policy.test.mjs"]);
  assert.notEqual(out.result.result, "GATE_PASSED");
});

test("J5. an ordinary candidate keeps the behaviour it had", async () => {
  const io = changing(makeIo({ machine: { task_class: "T1" } }), ["src/lib/scoring/round.ts", "src/app/page.tsx"]);
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.gateAuthority, "controller");
  assert.deepEqual(out.result.gateAuthorityTouched, []);
  assert.equal(out.result.result, "GATE_PASSED");
  assert.equal(out.result.nextStatus, LABELS.verified);
});

test("J6. a candidate that adds its own tests still runs them and is recorded", async () => {
  const io = changing(makeIo({ machine: { task_class: "T1", gate_profile: "web" } }), [
    "src/lib/scoring/round.ts",
    "src/lib/__tests__/round.test.ts",
  ]);
  const out = await dispatchIssue(147, io);
  assert.equal(io.spawned.filter((s) => s.role === "gate").length, 1, "the added tests never ran");
  assert.equal(out.result.gateResult, "PASS");
  assert.ok(
    out.result.changedFiles.includes("src/lib/__tests__/round.test.ts"),
    "a candidate-authored test vanished from the record",
  );
  // Its own tests are evidence, and evidence is not authority.
  assert.equal(out.result.gateAuthority, "candidate-influenced");
});

test("J7. touching the examiner is reviewable, never a refusal", async () => {
  const io = changing(makeIo(), ["harness/test/gate.test.mjs", "scripts/gate.sh"]);
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true, "a task whose whole purpose is the gate could not be dispatched");
  assert.equal(out.result.commitEvidence.ok, true);
  assert.ok(io.spawned.some((s) => s.role === "reviewer"), "the change was never put in front of a reviewer");
  assert.equal(out.result.result, "VERIFIED");
});
