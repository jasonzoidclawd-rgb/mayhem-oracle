import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig, route, RoutingError } from "../route.mjs";
import {
  checkDispatchable,
  findByFingerprint,
  classifyBehavioralRed,
  normalizeExecutorReport,
  parseMachineBlock,
  slugFor,
  ContractError,
  RESULTS,
  LABELS,
} from "../github/issue-contract.mjs";
import { createGh, GhError } from "../github/gh.mjs";
import { parseWorktreeList, planIssueWorktree, WorktreeError } from "../github/worktree.mjs";
import { dispatchIssue, launchArgv, DispatchRecoveryError } from "../github/dispatch.mjs";

// GitHub is the durable bug ledger; the harness router is still the routing
// authority. These tests prove the seam between them without touching the
// network: every gh read/write, every git call, and every executor launch is
// injected. A test that reaches real GitHub is a broken test.

const config = loadConfig();
const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const BASE = "b9e12a98dcecd777e0abb425fb3f0cc24fce5286";
const HEAD = "e13884973a1dcf1af5dca79d4c98a62ab1c3b4c7";
const FINGERPRINT = "geometry:response-delivery:async-transport";
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
    planIssueWorktree({
      number: 147,
      title: "Overlay geometry stalls",
      baseSha: BASE,
      mainWorktree: MAIN,
      worktrees: parseWorktreeList(worktrees([{ path: MAIN, branch: "main" }])),
      branchExists: () => false,
      pathExists: () => false,
      ...over,
    });

  // The branch already exists but no worktree holds it: adopting it silently
  // would move someone else's branch.
  assert.throws(() => plan({ branchExists: (b) => b === "issue/147-overlay-geometry-stalls" }), WorktreeError);
  // The path exists but git does not know it as a worktree.
  assert.throws(() => plan({ pathExists: () => true }), WorktreeError);
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
    WorktreeError,
  );
});

test("18. a matching issue worktree resumes and is never reset", () => {
  const path = `${WT_ROOT}/147-overlay-geometry-stalls`;
  const plan = planIssueWorktree({
    number: 147,
    title: "Overlay geometry stalls",
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

test("19. a dirty matching worktree is resumed, never discarded", () => {
  const path = `${WT_ROOT}/147-overlay-geometry-stalls`;
  const base = {
    number: 147,
    title: "Overlay geometry stalls",
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
  const plan = planIssueWorktree({ ...base, dirty: true });
  assert.equal(plan.action, "resume");
  assert.equal(plan.dirty, true);
  const emitted = JSON.stringify(plan.git ?? []);
  for (const destructive of ["reset", "clean", "checkout", "restore", "stash", "worktree remove"]) {
    assert.ok(!emitted.includes(destructive), `resume plan emitted ${destructive}`);
  }
  const text = source("github/worktree.mjs");
  assert.ok(!/--hard|\bclean\b|\bstash\b/.test(text), "worktree.mjs can discard work");
});

test("18b. a worktree reported under a realised path still resumes", () => {
  // git reports /private/var/...; the derived path says /var/... . Comparing
  // raw strings would miss it and then refuse to create it.
  const derived = `${WT_ROOT}/147-overlay-geometry-stalls`;
  const reported = `/private${derived}`;
  const plan = planIssueWorktree({
    number: 147,
    title: "Overlay geometry stalls",
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
  const plan = planIssueWorktree({
    number: 147,
    title: "Overlay geometry stalls",
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
    "worktree", "primaryAccount", "primaryExecution", "primaryRuntime", "reviewerAccount",
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
const gateAnswer = (argv) => ({
  status: 0,
  stdout: argv.includes("--plan") ? `PROFILE: ${argv[2]}\nSUITES: harness\n` : "",
  stderr: "",
});

const spawnThrowingAt = (role, message) => {
  const spawned = [];
  const fn = (argv, options = {}) => {
    spawned.push({ argv, ...options });
    if (options.role === role) throw new Error(message);
    return gateAnswer(argv);
  };
  fn.spawned = spawned;
  return fn;
};

// The claim happened, and it was undone in favour of a state that names itself.
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
  assert.equal(out.result.failureStage, "worktree");
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
  assert.ok(out.result.worktree, "the worktree reached before the failure was not recorded");
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

const defaultGit = (argv) => {
  if (argv[0] === "worktree" && argv[1] === "list") {
    return { status: 0, stdout: worktrees([{ path: MAIN, branch: "main" }]), stderr: "" };
  }
  // No issue branch exists in this fake repository.
  if (argv[0] === "rev-parse" && String(argv.at(-1)).startsWith("refs/heads/")) {
    return { status: 1, stdout: "", stderr: "" };
  }
  if (argv[0] === "rev-parse") return { status: 0, stdout: `${BASE}\n`, stderr: "" };
  if (argv[0] === "status") return { status: 0, stdout: "", stderr: "" };
  if (argv[0] === "log") return { status: 0, stdout: `${HEAD}\n`, stderr: "" };
  return { status: 0, stdout: "", stderr: "" };
};

// --- fake io -------------------------------------------------------------

function makeIo(over = {}) {
  const order = [];
  const spawned = [];
  const labelWrites = [];
  const comments = [];
  const results = [];
  let views = 0;
  const io = {
    config: over.config ?? config,
    route: over.route ?? ((args) => route({ ...args, config: io.config })),
    available: over.available ?? ["CLAUDE_A", "GPT_A"],
    mainWorktree: MAIN,
    harnessRoot: over.harnessRoot ?? MAIN,
    startingHead: HEAD,
    order,
    spawned,
    lockReleased: false,
    gh: {
      get views() { return views; },
      labelWrites,
      comments,
      viewIssue: () => { views += 1; return issue(); },
      listOpenIssues: () => [issue()],
      repoLabels: () => Object.values(LABELS),
      setLabels: (number, change) => { order.push(labelWrites.length ? "status" : "claim"); labelWrites.push({ number, ...change }); },
      comment: (number, body) => { order.push("comment"); comments.push({ number, body }); },
      ...(over.ghOver ?? {}),
    },
    git: over.git ?? defaultGit,
    exists: over.exists ?? (() => true),
    pathExists: over.pathExists ?? (() => false),
    probe: over.probe ?? (({ command }) => {
      const i = command.indexOf("--provider");
      return { status: "ready", provider: i === -1 ? null : command[i + 1], authType: "oauth" };
    }),
    spawn: over.spawn ?? ((argv, opts) => {
      order.push(`launch:${opts.role ?? "gate"}`);
      spawned.push({ argv, ...opts });
      return gateAnswer(argv);
    }),
    readReport: over.readReport ?? ((runId, role) =>
      role === "reviewer"
        ? { verdict: "PASS", findings: [] }
        : {
            result: "FIX_PROPOSED",
            behavioralRed:
              "geometry round counter reports 0 where the contract requires 4 — observed at overlay/src/scoring/index.ts:88",
            commitSha: "1".repeat(40),
            tests: ["overlay/src/scoring/__tests__/geometry.test.ts"],
          }),
    writeResult: (runId, result) => { order.push("write-result"); results.push({ runId, result }); },
    runsDir: "/runs",
    lock: over.lock ?? ((number) => ({ number, release: () => { io.lockReleased = true; } })),
    log: () => {},
  };
  return io;
}
