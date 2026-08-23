import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, route, RoutingError } from "../route.mjs";
import {
  checkDispatchable,
  findByFingerprint,
  classifyBehavioralRed,
  classifyEvidenceRequest,
  classifyBlocker,
  BLOCKED_ACTIONS,
  BLOCKER_SOURCES,
  EXTERNAL_SOURCES,
  KNOWN_CONDITIONS,
  normalizeExecutorReport,
  parseMachineBlock,
  ContractError,
  concludeRun,
  buildPacket,
  buildReviewBrief,
  RESULTS,
  CONCLUDED_ONLY,
  LABELS,
  STATUS_FOR_DISPOSITION,
} from "../github/issue-contract.mjs";
import {
  AttemptError,
  assertReviewerIsolation,
  classifyGatePreflight,
  DISPOSITIONS,
  gateArgv,
  launchArgv,
  runAttempt,
} from "../run/attempt.mjs";
import { slugFor } from "../run/workspace.mjs";
import { verifyCommitEvidence } from "../run/evidence.mjs";
import { createGh, GhError } from "../github/gh.mjs";
import { parseWorktreeList, planWorkspace, WorkspaceError } from "../run/workspace.mjs";
import { dispatchIssue, DispatchRecoveryError } from "../github/dispatch.mjs";
import { summaryLine } from "../dispatch-github-issue.mjs";
import { archiveReport, createReportSink, executorReportExists, readExecutorReport, reportSinkRoot } from "../run/report.mjs";

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
  // A failed reproduction still never becomes a fix. It is no longer, on its
  // own, an evidence request either: it names no missing fact and no external
  // condition, so it is a report contract violation. See 20c.
  assert.throws(
    () =>
      normalizeExecutorReport(
        {
          result: "NEEDS_EVIDENCE",
          behavioralRed: "could not reproduce at the named seam",
          notes: "no reproduction",
        },
        { fingerprint: FINGERPRINT, role: "executor" },
      ),
    ContractError,
    "a bare failed reproduction was accepted as an evidence request",
  );
});

// The one shape that is a real evidence request: a named missing fact, why the
// executor's own means cannot reach it, the external condition that gates it,
// and how a human would go and collect it.
const EVIDENCE_REQUEST = {
  missingFact: "the round-owner index the overlay reads at augment offer 3 during a live ARAM Mayhem game",
  whyUnobtainable:
    "the value is produced by the live client's in-game socket; no fixture, repository state or " +
    "offline harness run observes it, and the recorded frames under test carry no round-owner field",
  externalCondition: "live-game",
  protocol: [
    "queue an ARAM Mayhem game with MAYHEM_OVERLAY_TIER_FIXTURE=1 set",
    "at the third augment offer, capture the overlay log line tagged [round-owner]",
    "attach the captured line and the game's patch string to this issue",
  ],
};

test("20c. NEEDS_EVIDENCE is an external boundary, not an executor's effort report", () => {
  const ok = normalizeExecutorReport(
    { result: "NEEDS_EVIDENCE", evidenceRequest: EVIDENCE_REQUEST, notes: "gated on a live game" },
    { fingerprint: FINGERPRINT, role: "executor" },
  );
  assert.equal(ok.result, "NEEDS_EVIDENCE", "a complete evidence request was rejected");
  assert.equal(ok.evidenceRequest.externalCondition, "live-game");
  assert.deepEqual(ok.evidenceRequest.protocol, EVIDENCE_REQUEST.protocol, "the protocol must survive to the record");
  assert.equal(classifyEvidenceRequest(EVIDENCE_REQUEST).valid, true, "rejected a real evidence request");
});

test("20d. an unfinished investigation is not a missing fact", () => {
  // These are the phrasings that describe the executor's own state rather than
  // a fact outside its reach. Each is a stop, not an evidence request.
  const notFacts = [
    "root cause not identified",
    "the root cause is not yet identified",
    "more investigation is required before a fix can be written",
    "further investigation needed to localize this",
    "cannot construct a RED yet for this defect",
    "need to know which operation causes the corruption",
    "could not reproduce the failure described in the issue",
    "unclear which code path is responsible for the bad value",
  ];
  for (const missingFact of notFacts) {
    const verdict = classifyEvidenceRequest({ ...EVIDENCE_REQUEST, missingFact });
    assert.equal(verdict.valid, false, `accepted "${missingFact}" as a missing fact`);
    assert.throws(
      () =>
        normalizeExecutorReport(
          { result: "NEEDS_EVIDENCE", evidenceRequest: { ...EVIDENCE_REQUEST, missingFact } },
          { fingerprint: FINGERPRINT, role: "executor" },
        ),
      ContractError,
      `accepted "${missingFact}" through the report contract`,
    );
  }
});

test("20e. every clause of an evidence request is load-bearing", () => {
  const bad = [
    ["missingFact", { ...EVIDENCE_REQUEST, missingFact: "" }],
    ["missingFact too thin", { ...EVIDENCE_REQUEST, missingFact: "the value" }],
    ["whyUnobtainable", { ...EVIDENCE_REQUEST, whyUnobtainable: "" }],
    ["whyUnobtainable too thin", { ...EVIDENCE_REQUEST, whyUnobtainable: "offline" }],
    ["externalCondition missing", { ...EVIDENCE_REQUEST, externalCondition: "" }],
    // Not on the list is fine; not concrete is not. "hard-to-debug" names no
    // boundary a person could go and stand in front of.
    ["externalCondition too thin", { ...EVIDENCE_REQUEST, externalCondition: "hard-to-debug" }],
    ["externalSource unanswerable", { ...EVIDENCE_REQUEST, externalCondition: "a boundary described at some length but not on any list", externalSource: "" }],
    ["protocol empty", { ...EVIDENCE_REQUEST, protocol: [] }],
    ["protocol not concrete", { ...EVIDENCE_REQUEST, protocol: ["look"] }],
    ["protocol not a list", { ...EVIDENCE_REQUEST, protocol: "run the game and look" }],
    ["no request at all", undefined],
    ["request is a string", "needs a live game"],
  ];
  for (const [what, evidenceRequest] of bad) {
    assert.throws(
      () =>
        normalizeExecutorReport({ result: "NEEDS_EVIDENCE", evidenceRequest }, { fingerprint: FINGERPRINT, role: "executor" }),
      ContractError,
      `accepted an evidence request with a bad ${what}`,
    );
  }
});

test("20f. a boundary nobody anticipated is still representable", () => {
  // J. What is closed is the axis that makes the claim checkable — who or what
  // holds the fact. The boundaries themselves are open, because a real external
  // condition must never be refused for the sole reason that nobody wrote its
  // noun into this file, and a harness source change is not a fair price for one.
  const novel = {
    ...EVIDENCE_REQUEST,
    externalSource: "external-system",
    externalCondition:
      "the regional match-v5 shard answers 403 for this queue until the operator's tournament key leaves its embargo window",
  };
  const verdict = classifyEvidenceRequest(novel);
  assert.equal(verdict.valid, true, `a real boundary was refused for not being on a list: ${verdict.reason}`);
  const ok = normalizeExecutorReport(
    { result: "NEEDS_EVIDENCE", evidenceRequest: novel },
    { fingerprint: FINGERPRINT, role: "executor" },
  );
  assert.equal(ok.evidenceRequest.externalSource, "external-system");
  assert.equal(ok.evidenceRequest.externalCondition, novel.externalCondition, "the concrete condition was not preserved");

  // Recognized shorthands still work, and answer the axis on the executor's behalf.
  for (const [externalCondition, source] of Object.entries(KNOWN_CONDITIONS)) {
    const v = classifyEvidenceRequest({ ...EVIDENCE_REQUEST, externalCondition });
    assert.equal(v.valid, true, `the recognized condition ${externalCondition} was rejected`);
    assert.equal(v.request.externalSource, source, `${externalCondition} inferred the wrong source`);
  }

  // The axis stays closed: without it "external" means whatever is convenient.
  assert.deepEqual([...EXTERNAL_SOURCES].sort(), ["external-hardware", "external-human", "external-system"]);
  const described = "a boundary described at length but on no list anywhere in this repository";
  for (const externalSource of ["", "external-vibes", null, 7]) {
    assert.equal(
      classifyEvidenceRequest({ ...EVIDENCE_REQUEST, externalCondition: described, externalSource }).valid,
      false,
      `accepted externalSource ${JSON.stringify(externalSource)}`,
    );
  }
  // A condition that is neither recognized nor actually described is nothing.
  assert.equal(classifyEvidenceRequest({ ...EVIDENCE_REQUEST, externalCondition: "hard" }).valid, false);
  assert.equal(classifyEvidenceRequest({ ...EVIDENCE_REQUEST, externalCondition: "" }).valid, false);
});

test("20f2. the spec's alternate field names are accepted", () => {
  // whyExecutorCannotAcquire / collectionProtocol say the same thing as
  // whyUnobtainable / protocol. Refusing an otherwise complete request over
  // which synonym it used would be a contract about spelling, not evidence.
  const { whyUnobtainable, protocol, ...rest } = EVIDENCE_REQUEST;
  const v = classifyEvidenceRequest({ ...rest, whyExecutorCannotAcquire: whyUnobtainable, collectionProtocol: protocol });
  assert.equal(v.valid, true, `the alternate field names were rejected: ${v.reason}`);
  assert.deepEqual(v.request.protocol, protocol);
  assert.equal(v.request.whyUnobtainable, whyUnobtainable);
});

// A real obstacle: something outside the executor that no amount of thinking
// gets past, named concretely enough that someone else could go and clear it.
const VALID_BLOCKER = {
  blockedAction: "implement",
  condition:
    "the vendored asset bundle this repair has to patch is absent from the worktree and its host answers 403 for this run's token",
  blockerSource: "upstream-missing",
  whyExecutorCannotProceed:
    "the bundle is fetched from a host this worktree cannot reach, and no cached copy exists under public/data to patch instead",
  recovery: "restore the bundle from the last successful scrape, or grant the run an egress token for the asset host",
};

test("20g. an interruption owes nothing; BLOCKED owes an obstacle", () => {
  // An interruption claims nothing of anybody and stays unguarded — but it is
  // the controller's observation of the execution, so it is the controller that
  // is allowed to make it. See 20m for the ownership itself.
  const stopped = normalizeExecutorReport({ result: "INTERRUPTED", notes: "stopped" }, { fingerprint: FINGERPRINT, role: "controller" });
  assert.equal(stopped.result, "INTERRUPTED");
  assert.equal(stopped.evidenceRequest, null);
  assert.equal(stopped.blocker, null);

  // BLOCKED does claim something — that the work became impossible — so it has
  // to show it. A bare one is the same unfinished-investigation escape the
  // evidence-request rule closed, taken through the next available door.
  assert.throws(
    () => normalizeExecutorReport({ result: "BLOCKED", notes: "stopped" }, { fingerprint: FINGERPRINT, role: "executor" }),
    ContractError,
    "a bare BLOCKED was accepted",
  );
  const ok = normalizeExecutorReport(
    { result: "BLOCKED", blocker: VALID_BLOCKER },
    { fingerprint: FINGERPRINT, role: "executor" },
  );
  assert.equal(ok.result, "BLOCKED");
  assert.equal(ok.blocker.blockedAction, "implement");
  assert.equal(ok.blocker.recovery, VALID_BLOCKER.recovery, "the way out was dropped from the record");
  assert.equal(ok.evidenceRequest, null, "a blocker was read as an evidence request");
});

test("20h. a genuine access or infrastructure obstacle is a real BLOCKED", () => {
  // G. Each closed source has to actually work, or the axis advertises a
  // category no executor can use.
  for (const blockerSource of BLOCKER_SOURCES) {
    const v = classifyBlocker({ ...VALID_BLOCKER, blockerSource });
    assert.equal(v.valid, true, `the source ${blockerSource} was rejected: ${v.reason}`);
  }
  for (const blockedAction of BLOCKED_ACTIONS) {
    assert.equal(classifyBlocker({ ...VALID_BLOCKER, blockedAction }).valid, true, `the action ${blockedAction} was rejected`);
  }
  assert.deepEqual([...BLOCKED_ACTIONS].sort(), ["commit", "implement", "investigate", "reproduce", "test"]);
});

test("20i. an unfinished investigation is not an obstacle", () => {
  // A + B. Attempt 13's own reasoning, in the fields a blocker provides for it.
  // Every one of these sentences is true about the run and none of them is an
  // obstacle: the work did not become impossible, it became hard.
  const attempt13 = {
    blockedAction: "implement",
    condition: "source and offline analysis do not identify an occupying production operation behind the first-poll delay",
    blockerSource: "infrastructure-failure",
    whyExecutorCannotProceed: "changing the queue policy or moving a candidate operation would be speculative without an identified cause",
    recovery: "identify the occupying operation first",
  };
  assert.equal(classifyBlocker(attempt13).valid, false, "Attempt 13's reasoning was accepted as an obstacle");

  const notObstacles = [
    "the root cause is not yet identified for this delay",
    "source and runtime analysis do not identify the responsible call",
    "this needs further runtime analysis before a change can be chosen",
    "more investigation is required before a repair can be written here",
    "multiple hypotheses remain open about which operation occupies it",
    "any change here would be speculative given what is known so far",
    "the executor is out of ideas about this particular delay",
    "no RED has been constructed yet for the reported behaviour",
    "unable to construct a RED for the reported first-poll delay",
  ];
  for (const whyExecutorCannotProceed of notObstacles) {
    const v = classifyBlocker({ ...VALID_BLOCKER, whyExecutorCannotProceed });
    assert.equal(v.valid, false, `accepted "${whyExecutorCannotProceed}" as an obstacle`);
    assert.throws(
      () =>
        normalizeExecutorReport(
          { result: "BLOCKED", blocker: { ...VALID_BLOCKER, whyExecutorCannotProceed } },
          { fingerprint: FINGERPRINT, role: "executor" },
        ),
      ContractError,
      `accepted "${whyExecutorCannotProceed}" through the report contract`,
    );
  }
});

test("20j. every clause of a blocker is load-bearing", () => {
  const bad = [
    ["no blocker", undefined],
    ["blocker is a string", "the thing is broken"],
    ["blockedAction missing", { ...VALID_BLOCKER, blockedAction: "" }],
    ["blockedAction invented", { ...VALID_BLOCKER, blockedAction: "verify" }],
    ["condition missing", { ...VALID_BLOCKER, condition: "" }],
    ["condition too thin", { ...VALID_BLOCKER, condition: "it is broken" }],
    ["blockerSource missing", { ...VALID_BLOCKER, blockerSource: "" }],
    ["blockerSource invented", { ...VALID_BLOCKER, blockerSource: "too-hard" }],
    ["why missing", { ...VALID_BLOCKER, whyExecutorCannotProceed: "" }],
    ["why too thin", { ...VALID_BLOCKER, whyExecutorCannotProceed: "cannot" }],
    ["recovery missing", { ...VALID_BLOCKER, recovery: "" }],
  ];
  for (const [what, blocker] of bad) {
    assert.throws(
      () => normalizeExecutorReport({ result: "BLOCKED", blocker }, { fingerprint: FINGERPRINT, role: "executor" }),
      ContractError,
      `accepted a blocker with a bad ${what}`,
    );
  }
});

test("20k. a broken checker is not an obstacle to the work", () => {
  // H. The gate is not among the actions a blocker may name, because a gate you
  // cannot run does not stop you reproducing, implementing or committing.
  const asAction = classifyBlocker({ ...VALID_BLOCKER, blockedAction: "gate" });
  assert.equal(asAction.valid, false);
  assert.match(asAction.reason, /verification blocker/);

  // Nor may it arrive dressed as an infrastructure problem. Issue #48's real
  // situation: the authoritative gate is red on pre-existing type errors.
  for (const field of ["condition", "whyExecutorCannotProceed"]) {
    const v = classifyBlocker({
      ...VALID_BLOCKER,
      [field]: "the authoritative overlay gate fails on pre-existing Node/ES-target TypeScript errors unrelated to this change",
    });
    assert.equal(v.valid, false, `a blocked gate in ${field} was accepted as an execution obstacle`);
    assert.equal(v.verificationOnly, true);
    assert.match(v.reason, /verificationBlockers/);
  }
  // A missing toolchain is still a real dependency problem and stays sayable.
  assert.equal(
    classifyBlocker({
      ...VALID_BLOCKER,
      blockerSource: "platform-unavailable",
      condition: "the cross-compilation toolchain this target needs is not installed on the runner and cannot be installed here",
      whyExecutorCannotProceed: "the runner image has no package manager available to the run, so the toolchain cannot be added",
    }).valid,
    true,
    "a genuinely missing platform was mistaken for a verification blocker",
  );
});

test("20l. verification blockers ride along with any result and only cap it", () => {
  // H. The distinction, made explicit: what could not be checked is recorded on
  // whatever result the work actually reached, and never ends the work.
  const ok = normalizeExecutorReport(
    {
      result: "FIX_PROPOSED",
      behavioralRed: "round counter reports 0 where the contract requires 4 — observed at src/x.ts:88",
      commitSha: HEAD,
      verificationBlockers: [
        { surface: "overlay gate", detail: "pre-existing Node/ES-target TypeScript errors unrelated to this change" },
        "rust suite",
      ],
    },
    { fingerprint: FINGERPRINT, role: "executor" },
  );
  assert.equal(ok.result, "FIX_PROPOSED", "a verification blocker terminated engineering work");
  assert.deepEqual(ok.verificationBlockers.map((v) => v.surface), ["overlay gate", "rust suite"]);

  // It caps what may be concluded, and decides nothing about the disposition.
  const base = {
    reported: ok,
    gateResult: "PASS",
    reviewVerdicts: [],
    reviewersRequired: 0,
    commitVerified: true,
    gateComplete: true,
  };
  assert.equal(concludeRun({ ...base }).completionLevel, "OFFLINE-PROVEN");
  const capped = concludeRun({ ...base, verificationBlockers: ok.verificationBlockers });
  assert.equal(capped.completionLevel, "IMPLEMENTED", "an unrunnable surface still claimed a complete offline proof");
  assert.equal(capped.disposition, base.reviewersRequired ? "needs-review" : "accepted", "a verification blocker changed the disposition");
});

test("20m. an interruption is the controller's observation, never the executor's claim", () => {
  // A. An executor that got far enough to write a well-formed report was not
  // interrupted — it stopped. INTERRUPTED is the one word in the vocabulary
  // that owes nobody anything, so an executor allowed to reach for it has the
  // next door out of the room the evidence-request and blocker rules closed.
  // The refusal is ownership, not phrasing: no wording of an executor's own
  // report reaches it.
  for (const notes of ["I could not work it out", "stopped", "ran out of time"]) {
    assert.throws(
      () => normalizeExecutorReport({ result: "INTERRUPTED", notes }, { fingerprint: FINGERPRINT, role: "executor" }),
      ContractError,
      `an executor declared its own execution interrupted with ${JSON.stringify(notes)}`,
    );
  }
  assert.ok(CONCLUDED_ONLY.includes("INTERRUPTED"), "INTERRUPTED is still something an executor may report");

  // D. What the controller saw is unchanged, and still owes nothing: nobody
  // claimed anything of anybody, so there is nothing to show.
  const observed = normalizeExecutorReport(
    { result: "INTERRUPTED", notes: "executor exited 137 without a report" },
    { fingerprint: FINGERPRINT, role: "controller" },
  );
  assert.equal(observed.result, "INTERRUPTED");
  assert.equal(observed.evidenceRequest, null);
  assert.equal(observed.blocker, null);
});

test("20n. an obstacle can land in any engineering phase, and checking is not one of them", () => {
  // An obstacle does not wait for the implement step to arrive. Naming only the
  // late phases made a real early one unsayable, which is its own pressure
  // towards the wrong word.
  for (const blockedAction of ["investigate", "test"]) {
    const v = classifyBlocker({ ...VALID_BLOCKER, blockedAction });
    assert.equal(v.valid, true, `a genuine obstacle during ${blockedAction} was unrepresentable: ${v.reason}`);
  }

  // A wider phase list is not a wider excuse. The unfinished investigation is
  // still unfinished work in the phase named after it.
  const stalled = classifyBlocker({
    ...VALID_BLOCKER,
    blockedAction: "investigate",
    whyExecutorCannotProceed: "the root cause is not identified and further analysis is required before any change",
  });
  assert.equal(stalled.valid, false, "an unfinished investigation became an obstacle by being filed under investigate");

  // And a checker that will not run is still not an obstacle to the work, in
  // whichever phase it is written into.
  const checker = classifyBlocker({
    ...VALID_BLOCKER,
    blockedAction: "test",
    condition: "the authoritative overlay gate fails on pre-existing Node/ES-target TypeScript errors unrelated to this change",
    whyExecutorCannotProceed: "those errors predate this branch and cannot be repaired inside this task's paths",
  });
  assert.equal(checker.valid, false, "a verification-only failure was disguised as an execution blocker");
  assert.equal(checker.verificationOnly, true);

  // What must stay sayable: the thing a targeted test needs in order to run at
  // all is a dependency, not a checking authority.
  const toolchain = classifyBlocker({
    blockedAction: "test",
    condition: "the aarch64 Rust toolchain the targeted regression needs is absent from this runtime image, which is read-only",
    blockerSource: "platform-unavailable",
    whyExecutorCannotProceed: "installing it needs root in an image this run cannot modify, and no other runtime is offered to this account",
    recovery: "publish a runtime image with the aarch64 toolchain preinstalled, or grant this account a runtime that has it",
  });
  assert.equal(toolchain.valid, true, `a genuinely missing platform during testing was refused: ${toolchain.reason}`);
});

test("21. the result vocabulary is closed", () => {
  assert.deepEqual([...RESULTS].sort(), [
    "BLOCKED",
    "FIX_PROPOSED",
    "GATE_PASSED",
    "INTERRUPTED",
    "INVALID_DISPOSITION",
    "NEEDS_EVIDENCE",
    "VERIFIED",
  ]);
  // Executor-incomplete work has a word of its own, and it is the controller's
  // to say — an executor claiming it would be grading its own answer.
  assert.ok(CONCLUDED_ONLY.includes("INVALID_DISPOSITION"));
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
  // Canonical object id. Real git resolves a full sha to itself and only for an
  // object it actually holds, so a fake that answered anything else would let a
  // fabricated sha pass a check the real one fails.
  if (a[0] === "rev-parse" && /\^\{commit\}$/.test(String(a.at(-1)))) {
    const wanted = String(a.at(-1)).replace(/\^\{commit\}$/, "");
    return repo.commits.includes(wanted)
      ? { status: 0, stdout: `${wanted}\n`, stderr: "" }
      : { status: 128, stdout: "", stderr: "fatal: Not a valid object name" };
  }
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
  if (a[0] === "status") {
    return { status: 0, stdout: repo.status ?? (repo.dirty ? " M src/x.ts\n" : ""), stderr: "" };
  }
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
    // "What is HEAD" and "what is this object's id" are two different questions
    // that real git answers differently. A fake that conflates them cannot
    // exercise either check, so the object query has its own override key.
    if (a[0] === "rev-parse" && /\^\{commit\}$/.test(String(a.at(-1)))) {
      return over["rev-parse-object"] ?? { status: 0, stdout: `${String(a.at(-1)).replace(/\^\{commit\}$/, "")}\n` };
    }
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
    // Identity, which is a separate question from existence: cat-file says the
    // object is there, and only rev-parse says what its id actually is.
    ["rev-parse-object", NEVER_RAN, "commit-id-unreadable"],
    ["rev-parse-object", { status: 0, stdout: `${BASE}\n` }, "commit-id-mismatch"],
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
  // A FIX_PROPOSED that committed nothing: head is the starting head, and the
  // starting head is the base, so nothing was resumed either.
  assert.equal(
    verifyCommitEvidence({
      reportedSha: BASE,
      startingHead: BASE,
      resolvedBaseSha: BASE,
      workspace: "/w",
      git: gitWith({ "rev-parse": { status: 0, stdout: `${BASE}\n` } }),
    }).code,
    "commit-is-starting-head",
  );
  // The same shape with no pinned base cannot be told apart from a resumed
  // attempt validating an inherited candidate, so it is refused rather than
  // guessed at.
  assert.equal(
    verifyCommitEvidence({
      reportedSha: BASE,
      startingHead: BASE,
      workspace: "/w",
      git: gitWith({ "rev-parse": { status: 0, stdout: `${BASE}\n` } }),
    }).code,
    "base-unknown",
  );
});

// --- P. an inherited candidate is still a candidate ------------------------

// Attempt 15. The workspace was resumed: the previous attempt's commit was
// already its HEAD, so the executor's job was to validate that candidate rather
// than manufacture a new one. It reported the canonical sha, the controller
// observed exactly the same sha — and the run was refused for committing
// nothing, because "nothing new since the attempt started" had been written as
// "nothing at all".
const CANDIDATE = COMMIT;
// Attempt 15's executor report in shape: sent to validate a candidate that was
// already the workspace's head, it reported that candidate, spelled exactly as
// git spells it. Nothing about it is wrong.
const ATTEMPT_15 = reportingCommit(CANDIDATE);
const resumedAt = (head) => ({ head, dirty: false, commits: [BASE, head], descendants: [head], afterExecutor: head });

// Driven directly: through the lifecycle only one provenance can be exercised
// per run, and the point is the boundary between them.
const evidenceFor = ({
  reportedSha,
  startingHead,
  resolvedBaseSha,
  head,
  commits,
  descendants,
  diff = "src/x.ts\n",
  // What `git status --porcelain` reports, and what the gate says it can and
  // cannot reach. Empty status and no declaration is the old shape: nothing is
  // exempt, which is the fail-closed reading.
  status = "",
  declared = null,
  baseline = null,
  tryBaseline = null,
}) =>
  verifyCommitEvidence({
    reportedSha,
    startingHead,
    resolvedBaseSha,
    workspace: "/w",
    declared,
    baseline,
    tryBaseline,
    git: (argv) => {
      const a = argv[0] === "-C" ? argv.slice(2) : argv;
      if (a[0] === "rev-parse" && a.at(-1) === "HEAD") return { status: 0, stdout: `${head}\n` };
      if (a[0] === "rev-parse") {
        const wanted = String(a.at(-1)).replace(/\^\{commit\}$/, "");
        return commits.includes(wanted) ? { status: 0, stdout: `${wanted}\n` } : { status: 128, stdout: "" };
      }
      if (a[0] === "cat-file") {
        const wanted = String(a.at(-1)).replace(/\^\{commit\}$/, "");
        return { status: commits.includes(wanted) ? 0 : 128, stdout: "" };
      }
      if (a[0] === "merge-base") return { status: descendants[a[2]]?.includes(a[3]) ? 0 : 1, stdout: "" };
      if (a[0] === "status") return { status: 0, stdout: status };
      if (a[0] === "diff") return { status: 0, stdout: diff };
      return { status: 0, stdout: "" };
    },
  });

test("P1. A + G. a resumed attempt may report the candidate it inherited", () => {
  // The executor committed nothing during this attempt, and it should not have
  // had to: the candidate already existed and its job was to check it. An
  // amend or a no-op commit made purely to change the sha would be a worse
  // record of what happened, not a better one.
  const out = evidenceFor({
    reportedSha: CANDIDATE,
    startingHead: CANDIDATE,
    resolvedBaseSha: BASE,
    head: CANDIDATE,
    commits: [BASE, CANDIDATE],
    descendants: { [BASE]: [CANDIDATE], [CANDIDATE]: [CANDIDATE] },
  });
  assert.equal(out.ok, true, `an inherited candidate was refused: ${out.code} — ${out.reason}`);
  // H. The record says which kind of candidate this is.
  assert.equal(out.candidateOrigin, "inherited");
  assert.equal(out.candidateSha, CANDIDATE);
  assert.equal(out.inheritedCandidateSha, CANDIDATE);
  assert.equal(out.attemptProducedCommitSha, null, "an inherited candidate was filed as this attempt's own commit");
  // Measured against the pinned base, because that is what it is a change to.
  assert.equal(out.diffBase, BASE);
  assert.deepEqual(out.changedFiles, ["src/x.ts"]);
});

test("P2. F + H. a commit produced during the attempt keeps the path it had", () => {
  const out = evidenceFor({
    reportedSha: CANDIDATE,
    startingHead: BASE,
    resolvedBaseSha: BASE,
    head: CANDIDATE,
    commits: [BASE, CANDIDATE],
    descendants: { [BASE]: [CANDIDATE] },
  });
  assert.equal(out.ok, true, `a new commit was refused: ${out.code}`);
  assert.equal(out.candidateOrigin, "produced-this-attempt");
  assert.equal(out.attemptProducedCommitSha, CANDIDATE);
  assert.equal(out.inheritedCandidateSha, null, "a fresh commit was filed as inherited");
  assert.equal(out.diffBase, BASE, "a produced commit stopped being measured from the attempt's own starting point");
});

test("P3. B + C + D + E. inheritance has to be proven, not asserted", () => {
  const cases = [
    // B. Nothing was resumed: the workspace is at the untouched base, so
    // naming it claims a fix that is the base itself.
    [
      "a fresh attempt at the untouched base",
      { reportedSha: BASE, startingHead: BASE, resolvedBaseSha: BASE, head: BASE, commits: [BASE], descendants: { [BASE]: [BASE] } },
      "commit-is-starting-head",
    ],
    // C. Resumed, but the head carries no change against the pinned base.
    [
      "an inherited head with no diff from the base",
      {
        reportedSha: CANDIDATE,
        startingHead: CANDIDATE,
        resolvedBaseSha: BASE,
        head: CANDIDATE,
        commits: [BASE, CANDIDATE],
        descendants: { [BASE]: [CANDIDATE] },
        diff: "\n  \n",
      },
      "commit-changes-nothing",
    ],
    // D. A candidate from some other lineage is not this issue's work, however
    // real a commit it is.
    [
      "an inherited head outside the pinned base's lineage",
      {
        reportedSha: CANDIDATE,
        startingHead: CANDIDATE,
        resolvedBaseSha: BASE,
        head: CANDIDATE,
        commits: [BASE, CANDIDATE],
        descendants: { [BASE]: [] },
      },
      "commit-not-descended",
    ],
    // E. Fabrication is still fabrication in a resumed workspace.
    [
      "a sha naming no object",
      { reportedSha: "d".repeat(40), startingHead: CANDIDATE, resolvedBaseSha: BASE, head: CANDIDATE, commits: [BASE, CANDIDATE], descendants: { [BASE]: [CANDIDATE] } },
      "commit-not-found",
    ],
    // And inheritance cannot be proven at all with no pinned base to measure
    // against, so it fails closed rather than being taken on trust.
    [
      "an inherited head with no pinned base",
      { reportedSha: CANDIDATE, startingHead: CANDIDATE, resolvedBaseSha: null, head: CANDIDATE, commits: [BASE, CANDIDATE], descendants: { [BASE]: [CANDIDATE] } },
      "base-unknown",
    ],
  ];
  for (const [what, args, code] of cases) {
    const out = evidenceFor(args);
    assert.equal(out.ok, false, `${what} was accepted`);
    assert.equal(out.code, code, `${what} produced ${out.code}`);
    assert.equal(out.commitSha, null, `${what} still returned a commit sha`);
  }
});

test("P4. A. the whole lifecycle accepts a resumed attempt's inherited candidate", async () => {
  // Attempt 15 end to end: nothing new is committed, and the run still reaches
  // a real conclusion on a candidate the controller established itself.
  const io = makeIo({ repo: resumedAt(CANDIDATE), readReport: ATTEMPT_15 });
  const out = await dispatchIssue(147, io);

  assert.equal(out.result.commitEvidence.ok, true, `the inherited candidate was refused: ${out.result.commitEvidence.code}`);
  assert.notEqual(out.result.commitEvidence.code, "commit-is-starting-head");
  assert.equal(out.result.startingHead, CANDIDATE, "the fixture did not resume an existing candidate");
  assert.equal(out.result.candidateOrigin, "inherited");
  assert.equal(out.result.commitSha, CANDIDATE);
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [true], "a valid inherited candidate was rerouted");
  assert.equal(out.result.result, "VERIFIED");
  assert.equal(out.result.nextStatus, LABELS.verified);
  // The reviewer has to be shown the change, and for an inherited candidate the
  // change is against the base — diffing it against the starting head is empty.
  const diffed = io.gitCalls.filter((a) => a.includes("diff") && a.includes(CANDIDATE));
  assert.ok(
    diffed.some((a) => a.includes(BASE)),
    "the reviewer was handed a diff measured from the candidate against itself",
  );
});

// --- S. the report sink is somewhere every runtime may write ---------------

test("S1. J + N. the handoff is outside .git, writable, and never stale", () => {
  const root = mkdtempSync(join(tmpdir(), "mayhem-sink-"));
  const sink = createReportSink(root, "issue-147-attempt-01", "executor");

  // J. Not under .git, and proven writable by the controller before any
  // executor turn is spent on work that would have nowhere to land.
  assert.ok(!/\/\.git(\/|$)/.test(sink.path), `the handoff is still inside .git: ${sink.path}`);
  writeFileSync(sink.path, JSON.stringify({ result: "BLOCKED", blocker: VALID_BLOCKER }));
  assert.equal(readExecutorReport(root, "issue-147-attempt-01", "executor").result, "BLOCKED");

  // N. A later try may not be satisfied by an earlier one's file — neither by
  // reusing the same sink nor by a leftover from a previous run of it.
  const again = createReportSink(root, "issue-147-attempt-01", "executor");
  assert.equal(again.path, sink.path, "the sink for one try is not stable within that try");
  assert.equal(readExecutorReport(root, "issue-147-attempt-01", "executor"), null, "a stale report survived sink creation");

  // And two tries are two sinks.
  const second = createReportSink(root, "issue-147-attempt-01/executor-2", "executor");
  assert.notEqual(second.path, sink.path, "two tries shared one handoff path");

  // The real root the dispatcher uses is outside the repository entirely.
  assert.ok(!/\/\.git(\/|$)/.test(reportSinkRoot()), "the dispatcher's handoff root is inside .git");
});

test("S2. L. the controller archives what the executor wrote into run history", () => {
  const root = mkdtempSync(join(tmpdir(), "mayhem-sink-"));
  const runs = mkdtempSync(join(tmpdir(), "mayhem-runs-"));
  const runId = "issue-147-attempt-01";
  const sink = createReportSink(root, runId, "executor");
  writeFileSync(sink.path, '{ "result": "BLOCKED", "trailing": true }');

  const archived = archiveReport(root, runId, "executor", runs);
  assert.ok(archived, "nothing was archived");
  assert.equal(readFileSync(archived, "utf8"), '{ "result": "BLOCKED", "trailing": true }', "the archive is not the raw report");
  assert.ok(archived.startsWith(runs), "the archive did not land in the controller's run history");

  // A file that would not parse is archived too: the durable record is what the
  // executor actually wrote, which is exactly what a person debugging needs.
  writeFileSync(sink.path, "{ not json");
  assert.equal(readFileSync(archiveReport(root, runId, "executor", runs), "utf8"), "{ not json");

  // Nothing written is nothing archived, rather than an empty file that reads
  // like a report nobody can parse.
  const empty = mkdtempSync(join(tmpdir(), "mayhem-sink-"));
  createReportSink(empty, runId, "executor");
  assert.equal(archiveReport(empty, runId, "executor", runs), null);
});

test("S3. I + K + M. a runtime that refuses to write under .git still completes the run", async () => {
  // Attempt 15's second executor: it did the work, then could not write its
  // mandatory output because the path was inside the repository's .git, and
  // exited 0. The authority rule was right and stays; the sink was wrong.
  const sinks = [];
  const io = makeIo({
    available: ALL_FOUR,
    createReportSink: (runId) => {
      const path = `/handoff/${runId}/report-executor.json`;
      sinks.push({ runId, path });
      return { dir: `/handoff/${runId}`, path };
    },
    readReport: (runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      // The runtime writes only where its policy allows it to.
      const path = sinks.find((s) => s.runId === runId)?.path ?? "";
      return /\/\.git\//.test(path) ? null : GOOD_FIX;
    },
  });
  const out = await dispatchIssue(147, io);

  // K. It wrote its report and the run concluded normally.
  assert.equal(sinks.length, 1, "the sink was not created once per try");
  assert.ok(!/\/\.git\//.test(sinks[0].path), "the executor was handed a path inside .git");
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [true]);
  assert.equal(out.result.result, "VERIFIED");
  // The path it was given is the path named in its packet, not a second guess.
  const packet = io.spawned.find((x) => x.role === "executor").argv.join(" ");
  assert.ok(packet.includes(sinks[0].path), "the executor's packet names a different path than the sink");
  // And it is granted, not merely named. A runtime told to write somewhere it
  // has no access to exits clean having written nothing — which is the failure
  // this whole change is about, arrived at by a different road.
  const executorLaunch = config.routing.executionMechanisms["claude-code-cli"].launch.executor;
  assert.ok(executorLaunch.includes("{reportDir}"), "the executor's launch grants no access to its report sink");
  assert.ok(!executorLaunch.includes("{runDir}"), "the executor is still granted the .git run directory instead");
  assert.deepEqual(
    launchArgv({
      mechanism: config.routing.executionMechanisms["claude-code-cli"],
      role: "executor",
      model: "opus",
      prompt: "p",
      sessionDir: "/s",
      workspace: "/w",
      runDir: "/state/runs/a1",
      reportDir: "/handoff/a1",
    }).filter((t, i, all) => t === "/handoff/a1" || all[i + 1] === "/handoff/a1"),
    ["--add-dir", "/handoff/a1"],
  );
});

test("S4. M + O + P + Q. each try gets its own sink, and the authority rule is untouched", async () => {
  // M. Two tries, two sinks, and the second is not satisfied by the first.
  const sinks = [];
  const io = makeIo({
    available: ALL_FOUR,
    createReportSink: (runId) => {
      const path = `/handoff/${runId}/report-executor.json`;
      sinks.push({ runId, path });
      return { dir: `/handoff/${runId}`, path };
    },
    readReport: (runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      // O + Q. The first executor exits clean having written nothing at its own
      // sink — a JSON object on its stdout is not a substitute and there is no
      // path by which one could be.
      return sinks.findIndex((s) => s.runId === runId) === 0 ? null : GOOD_FIX;
    },
  });
  const out = await dispatchIssue(147, io);

  assert.equal(sinks.length, 2, "the rerouted executor reused the first one's handoff");
  assert.notEqual(sinks[0].path, sinks[1].path);
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [false, true]);
  assert.match(out.result.executorAttempts[0].reason, /missing-required-report/);
  assert.equal(out.result.result, "VERIFIED");
  // R. One worktree, and the reviewer is not the executor that produced it.
  const executors = io.spawned.filter((x) => x.role === "executor");
  assert.equal(new Set(executors.map((x) => x.cwd)).size, 1);
  const reviewers = io.spawned.filter((x) => x.role === "reviewer").map((x) => x.account);
  assert.ok(!reviewers.includes(executors.at(-1).account), "the rerouted executor reviewed its own work");
});

// --- N. the report file is the only report -------------------------------

// What a runtime prints is whatever the model chose to print: drafts, worked
// examples, the shape it is reasoning about rather than the answer it is
// asserting. A report read out of that is a claim nobody made.
const STDOUT_LOOKALIKES = {
  FIX_PROPOSED: {
    result: "FIX_PROPOSED",
    behavioralRed: "round counter reports 0 where the contract requires 4 — observed at overlay/src/scoring/index.ts:88",
    commitSha: COMMIT,
    tests: ["overlay/src/scoring/__tests__/geometry.test.ts"],
  },
  NEEDS_EVIDENCE: { result: "NEEDS_EVIDENCE", evidenceRequest: EVIDENCE_REQUEST },
  BLOCKED: { result: "BLOCKED", blocker: VALID_BLOCKER },
};

test("N1. no part of the dispatcher reads a lifecycle report out of captured output", () => {
  // A + B + C, at the seam where the fallback lived. The rule is structural
  // because a behavioural test can only ever cover the shapes someone thought
  // of, and the failure was that *any* object printed to stdout would do.
  const dispatcher = source("dispatch-github-issue.mjs");
  assert.ok(
    !/lastJsonObject/.test(dispatcher),
    "the dispatcher still scrapes a JSON object out of a runtime's output",
  );
  assert.ok(
    !/captured/.test(dispatcher),
    "the dispatcher still keeps captured output where a report is read from",
  );
  // And it reads through the one module that owns the rule. Asserted because
  // the suite injects readReport everywhere, so the real wiring is exercised by
  // nothing else — a dispatcher that referenced an identifier it never imported
  // would pass every behavioural test here and crash on the first real run.
  const reportImport = dispatcher.match(/import \{([^}]*)\} from "\.\/run\/report\.mjs";/);
  assert.ok(reportImport, "the dispatcher does not import from run/report.mjs at all");
  for (const name of ["archiveReport", "createReportSink", "readExecutorReport", "reportSinkRoot"]) {
    assert.match(reportImport[1], new RegExp(`\\b${name}\\b`), `the dispatcher no longer imports ${name}`);
  }
  assert.match(dispatcher, /readReport: \(runId, role\) => readExecutorReport\(handoffRoot, runId, role\)/);
  // And the handoff root is not the state directory: a path under .git is a
  // path a runtime is entitled to refuse, which is what Attempt 15 did.
  assert.match(dispatcher, /const handoffRoot = reportSinkRoot\(\);/);
  assert.ok(
    !/reportSinkRoot\([^)]*stateDir/.test(dispatcher) && !/join\(stateDir, "handoff"\)/.test(dispatcher),
    "the executor handoff was put back under the controller's .git state directory",
  );
  // The reviewer's verdict is a different thing and stays where it is: it is
  // read from the reviewer's own stdout precisely so that nothing on disk in
  // the executor's run directory can stand in for it.
  assert.match(source("run/attempt.mjs"), /lastJsonObject\(answer\?\.stdout\)\?\.verdict/);
});

test("N2. the authoritative executor report is the report file, and nothing else", () => {
  const root = mkdtempSync(join(tmpdir(), "mayhem-report-"));
  const runId = "issue-147-attempt-01";
  mkdirSync(join(root, runId), { recursive: true });

  // A + B + C. Nothing was written, so there is no report — whatever the
  // runtime may have printed while getting there.
  for (const [what, blob] of Object.entries(STDOUT_LOOKALIKES)) {
    assert.equal(
      readExecutorReport(root, runId, "executor"),
      null,
      `a ${what} report appeared with no report file on disk`,
    );
    // The blob is well-formed and would pass the contract if it ever arrived.
    assert.doesNotThrow(() => normalizeExecutorReport(blob, { fingerprint: FINGERPRINT, role: "executor" }));
  }

  // D + E. A real report file is returned exactly as written.
  writeFileSync(join(root, runId, "report-executor.json"), JSON.stringify(STDOUT_LOOKALIKES.BLOCKED));
  assert.deepEqual(readExecutorReport(root, runId, "executor"), STDOUT_LOOKALIKES.BLOCKED);

  // A file that is not a report is not a report. It does not fall through to
  // anything: an executor that wrote rubbish did not write an answer.
  writeFileSync(join(root, runId, "report-executor.json"), "{ this is not json");
  assert.equal(readExecutorReport(root, runId, "executor"), null, "an unparseable report file produced a report");

  // And a reviewer is never read from the executor's run directory at all.
  assert.throws(() => readExecutorReport(root, runId, "reviewer"), /reviewer/);
});

test("N3. G + I. an executor that exits clean and writes nothing is rerouted, not interrupted", async () => {
  // Nothing interrupted this run: the runtime started, did whatever it did, and
  // returned 0. It declined the protocol, which is executor-incomplete work.
  const reports = [null, GOOD_FIX];
  const io = makeIo({
    available: ALL_FOUR,
    readReport: (_runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      return reports.length > 1 ? reports.shift() : reports[0];
    },
  });
  const out = await dispatchIssue(147, io);

  const executors = io.spawned.filter((x) => x.role === "executor");
  assert.equal(executors.length, 2, "a clean exit with no report ended the run instead of rerouting");
  assert.notEqual(executors[1].account, executors[0].account);
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [false, true]);
  assert.match(out.result.executorAttempts[0].reason, /missing-required-report/);
  assert.notEqual(out.result.result, "INTERRUPTED", "a clean exit was recorded as an interruption");

  // I. One workspace, one worktree, everything already committed on it kept.
  assert.equal(new Set(executors.map((x) => x.cwd)).size, 1, "the reroute moved the candidate workspace");
  assert.equal(executors[0].cwd, out.result.workspace);
  assert.equal(out.result.commitEvidence.ok, true, "the accumulated commit evidence was discarded");
  assert.equal(out.result.result, "VERIFIED");
});

test("N4. H. with no alternate, a clean exit with no report fails closed", async () => {
  const io = makeIo({ readReport: () => null });
  const out = await dispatchIssue(147, io);

  assert.equal(out.result.result, "INVALID_DISPOSITION");
  assert.notEqual(out.result.result, "INTERRUPTED", "an executor protocol failure borrowed the controller's word");
  assert.equal(out.result.nextStatus, LABELS.needsHuman);
  assert.notEqual(out.result.nextStatus, LABELS.blocked);
  assert.notEqual(out.result.nextStatus, LABELS.needsEvidence);
  assert.equal(out.result.blocker, null, "an obstacle nobody hit was fabricated");
  assert.equal(out.result.evidenceRequest, null, "an evidence requirement nobody established was fabricated");
  assert.equal(out.result.autonomousExecution.state, "exhausted");
  assert.match(out.result.autonomousExecution.reason, /missing-required-report/);
  assert.equal(io.spawned.filter((x) => x.role === "executor").length, 1);
});

test("N5. F. a runtime that was actually interrupted is still the controller's INTERRUPTED", async () => {
  // The distinction the split exists for. Same absent report, different fact
  // about the execution: this one did not reach its own exit.
  for (const [what, answer] of [
    ["killed", { status: null, signal: "SIGKILL", stdout: "", stderr: "" }],
    ["crashed", { status: 134, signal: null, stdout: "", stderr: "abort" }],
  ]) {
    const io = makeIo({
      readReport: () => null,
      spawn: (argv, opts) => {
        io.order.push(`launch:${opts.role ?? "gate"}`);
        io.spawned.push({ argv, ...opts });
        if (opts.role === "executor") return answer;
        if (opts.role === "gate-authority") return realAuthority(argv[2]);
        return runtimeAnswer(argv, opts);
      },
    });
    const out = await dispatchIssue(147, io);
    assert.equal(out.result.result, "INTERRUPTED", `a ${what} runtime was not recorded as interrupted`);
    assert.equal(out.result.nextStatus, LABELS.needsHuman);
    assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [true], `a ${what} runtime was refused`);
    assert.equal(io.spawned.filter((x) => x.role === "executor").length, 1, `a ${what} runtime was rerouted`);
    assert.equal(out.result.autonomousExecution, null, `a ${what} runtime was recorded as exhausted autonomy`);
  }
});

test("N6. D. a clean exit that did write its report is untouched", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [true]);
  assert.equal(io.spawned.filter((x) => x.role === "executor").length, 1, "a complete run was rerouted");
  assert.equal(out.result.result, "VERIFIED");
  assert.equal(out.result.commitSha, COMMIT);
});

// --- C. a commit claim is checked before the disposition is accepted -------

// Issue #48 attempt 14, as it actually happened. The candidate worktree really
// was at 3ba2b37ecdc1eae6…, git's own abbreviation of it really is its first
// seven characters, and the executor really did write those seven followed by
// thirty-three it made up. Nothing here is about that issue: what the fixture
// pins is the shape — a sha that looks right, shares the prefix a human would
// recognise, and names no object.
const REAL_HEAD = "3ba2b37ecdc1eae66ed6111ce6562bc5df85d105";
const FABRICATED = "3ba2b37a2acec297808d21572912fbe6be0283f8";
const committing = (sha) => ({
  head: BASE,
  dirty: false,
  commits: [BASE, sha],
  descendants: [sha],
  afterExecutor: sha,
});
const claiming = (...shas) => {
  const queue = [...shas];
  return (_runId, role) => {
    if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
    const sha = queue.length > 1 ? queue.shift() : queue[0];
    return {
      result: "FIX_PROPOSED",
      behavioralRed:
        "geometry round counter reports 0 where the contract requires 4 — observed at overlay/src/scoring/index.ts:88",
      commitSha: sha,
      tests: ["overlay/src/scoring/__tests__/geometry.test.ts"],
    };
  };
};

test("C1. a fabricated expansion of a real short hash is not a fix, and does not land as one", async () => {
  // The regression. The report is impeccable everywhere the controller cannot
  // check it — a real behavioral RED, a well-formed 40-hex sha, the right first
  // seven characters — and names no commit. Recording that as FIX_PROPOSED
  // writes a fix that does not exist into the ledger a human later trusts.
  const io = makeIo({
    available: ALL_FOUR,
    repo: committing(REAL_HEAD),
    readReport: claiming(FABRICATED, REAL_HEAD),
  });
  const out = await dispatchIssue(147, io);

  const executors = io.spawned.filter((x) => x.role === "executor");
  assert.equal(executors.length, 2, "an unverifiable commit claim was not rerouted");
  assert.notEqual(executors[1].account, executors[0].account, "the refused executor was immediately reselected");
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [false, true]);
  assert.match(out.result.executorAttempts[0].reason, /commit-not-found/, "the refusal does not name the evidence code");
  assert.match(out.result.executorAttempts[0].reason, new RegExp(FABRICATED), "the refusal does not name the claimed sha");

  // The same workspace, with everything already committed on it.
  assert.equal(new Set(executors.map((x) => x.cwd)).size, 1, "the reroute moved the candidate workspace");
  assert.equal(executors[0].cwd, out.result.workspace);

  // And the run concluded on a commit git actually produced.
  assert.equal(out.result.commitSha, REAL_HEAD);
  assert.equal(out.result.commitEvidence.ok, true);
  assert.equal(out.result.result, "VERIFIED");
});

test("C2. with no alternate, an unverifiable commit claim fails closed and invents nothing", async () => {
  // Two accounts, one of which must review. The honest record is that the
  // executor did not deliver — not that a fix exists which git cannot find.
  const io = makeIo({ repo: committing(REAL_HEAD), readReport: claiming(FABRICATED) });
  const out = await dispatchIssue(147, io);

  assert.notEqual(out.result.result, "FIX_PROPOSED", "a commit git refused still concluded as a proposed fix");
  assert.equal(out.result.result, "INVALID_DISPOSITION");
  assert.equal(out.result.nextStatus, LABELS.needsHuman);
  assert.notEqual(out.result.nextStatus, LABELS.blocked);
  assert.notEqual(out.result.nextStatus, LABELS.needsEvidence);
  assert.equal(out.result.blocker, null, "an obstacle nobody hit was fabricated");
  assert.equal(out.result.evidenceRequest, null, "an evidence requirement nobody established was fabricated");
  assert.equal(out.result.autonomousExecution.state, "exhausted");

  // The mismatch is surfaced rather than buried in a run file.
  assert.equal(out.result.commitEvidence.ok, false);
  assert.equal(out.result.commitEvidence.code, "commit-not-found");
  const body = io.gh.comments.at(-1).body;
  assert.match(body, /COMMIT_CLAIM_REFUSED=/);
  assert.match(body, new RegExp(`${FABRICATED}`));
});

test("C3. the claim and the observation are both kept, and only one of them decides", async () => {
  const io = makeIo({ repo: committing(REAL_HEAD), readReport: claiming(FABRICATED) });
  const out = await dispatchIssue(147, io);

  // A. What the executor said is preserved exactly, and marked for what it is.
  assert.equal(out.result.executorClaimedCommitSha, FABRICATED, "the executor's claim was silently normalized away");
  // B. What git said is the only thing the lifecycle used.
  assert.equal(out.result.controllerObservedCommitSha, null, "a sha git never resolved was recorded as observed");
  assert.equal(out.result.commitSha, null, "an unverified claim was recorded in the authoritative field");
  const body = io.gh.comments.at(-1).body;
  assert.match(body, /COMMIT=- \(UNVERIFIED/, "an unverifiable claim was rendered as though it were a commit");

  const good = makeIo({ repo: committing(REAL_HEAD), readReport: claiming(REAL_HEAD) });
  const ok = await dispatchIssue(147, good);
  assert.equal(ok.result.executorClaimedCommitSha, REAL_HEAD);
  assert.equal(ok.result.controllerObservedCommitSha, REAL_HEAD, "git's own object id was not recorded");
  assert.equal(ok.result.commitSha, REAL_HEAD);
});

test("C4. every way a commit claim can fail refuses the disposition, not just the level", async () => {
  // A–F of the contract, each through the whole lifecycle. The shared assertion
  // is the one attempt 14 broke: whatever else happens, the run does not
  // conclude FIX_PROPOSED on a commit the controller could not establish.
  const cases = [
    ["B. a sha naming no object", { repo: committing(REAL_HEAD), readReport: claiming("d".repeat(40)) }, "commit-not-found"],
    ["C. a fabricated expansion of a real prefix", { repo: committing(REAL_HEAD), readReport: claiming(FABRICATED) }, "commit-not-found"],
    [
      "D. a real commit from somewhere else in the object store",
      {
        repo: { head: BASE, dirty: false, commits: [BASE, "a".repeat(40)], descendants: [], afterExecutor: "a".repeat(40) },
        readReport: claiming("a".repeat(40)),
      },
      "commit-not-descended",
    ],
    ["E. the untouched base, with nothing committed on top", { repo: { head: BASE, dirty: false, commits: [BASE], descendants: [], afterExecutor: BASE }, readReport: claiming(BASE) }, "commit-is-starting-head"],
    ["F. a worktree carrying uncommitted changes", { repo: { ...committing(COMMIT), dirty: true }, readReport: claiming(COMMIT) }, "worktree-dirty"],
  ];
  for (const [what, over, code] of cases) {
    const io = makeIo(over);
    const out = await dispatchIssue(147, io);
    assert.equal(out.result.commitEvidence.code, code, `${what} produced ${out.result.commitEvidence.code}`);
    assert.notEqual(out.result.result, "FIX_PROPOSED", `${what} still concluded FIX_PROPOSED`);
    assert.ok(!["VERIFIED", "GATE_PASSED"].includes(out.result.result), `${what} concluded ${out.result.result}`);
    assert.equal(out.result.nextStatus, LABELS.needsHuman);
    assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [false], `${what} was accepted`);
    assert.equal(out.result.commitSha, null, `${what} left a commit sha in the authoritative field`);
    // G. Nobody was asked to review a commit that could not be established.
    assert.equal(io.spawned.filter((x) => x.role === "reviewer").length, 0, `${what} reached a reviewer`);
  }
});

test("C5. A + H. a real commit is accepted, reviewed and concluded exactly as before", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.ok, true);
  assert.equal(out.result.commitSha, COMMIT, "the verified commit is not git's own object id");
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [true]);
  assert.equal(io.spawned.filter((x) => x.role === "executor").length, 1, "a valid commit claim was rerouted");
  assert.equal(io.spawned.filter((x) => x.role === "reviewer").length, 1, "the reviewer stopped running on valid work");
  assert.equal(out.result.result, "VERIFIED");
  assert.equal(out.result.nextStatus, LABELS.verified);
});

test("C6. the canonical object id comes from git, never from the report", async () => {
  // The rule beneath the regression: no part of a commit id may be supplied by
  // the thing being judged. A repository that resolves the claimed object to a
  // different id is refused rather than quietly followed or quietly ignored.
  const io = makeIo({
    git: (argv) => {
      const a = argv[0] === "-C" ? argv.slice(2) : argv;
      if (a[0] === "rev-parse" && /\^\{commit\}$/.test(String(a.at(-1)))) {
        return { status: 0, stdout: `${REAL_HEAD}\n`, stderr: "" };
      }
      return defaultGit(argv, { head: COMMIT, dirty: false, commits: [BASE, COMMIT], descendants: [COMMIT] });
    },
  });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.ok, false);
  assert.equal(out.result.commitEvidence.code, "commit-id-mismatch");
  assert.notEqual(out.result.result, "FIX_PROPOSED");

  // And every check after the resolution is asked about git's id, not the
  // report's — so a report cannot steer the ancestry question at all.
  const asked = [];
  verifyCommitEvidence({
    reportedSha: COMMIT,
    startingHead: BASE,
    workspace: "/w",
    git: (argv) => {
      const a = argv[0] === "-C" ? argv.slice(2) : argv;
      asked.push(a.join(" "));
      if (a[0] === "rev-parse" && a.at(-1) === "HEAD") return { status: 0, stdout: `${COMMIT}\n` };
      if (a[0] === "rev-parse") return { status: 0, stdout: `${COMMIT}\n` };
      if (a[0] === "diff") return { status: 0, stdout: "src/x.ts\n" };
      return { status: 0, stdout: "" };
    },
  });
  assert.ok(
    asked.some((c) => c.startsWith("rev-parse") && c.includes("^{commit}")),
    "the canonical object id was never asked of git",
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

// A report that parses and is then refused: the executor answered, and the
// answer describes its own unfinished investigation rather than any boundary.
// This is the Issue #48 / Attempt-12 shape.
const gaveUpAs = (result) => (_runId, role) => {
  if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
  return result;
};
const UNFINISHED = { result: "NEEDS_EVIDENCE", notes: "need to know which call corrupts the state" };
const GOOD_FIX = {
  result: "FIX_PROPOSED",
  behavioralRed: "geometry round counter reports 0 where the contract requires 4 — observed at overlay/src/scoring/index.ts:88",
  commitSha: COMMIT,
  tests: ["overlay/src/scoring/__tests__/geometry.test.ts"],
};
const ALL_FOUR = ["CLAUDE_A", "CLAUDE_B", "GPT_A", "GPT_B"];

test("V5b. a refused disposition is rerouted to another executor, not billed to the operator", async () => {
  // C + D. The first executor answered with its own unfinished investigation.
  // Nobody outside the run owes anything for that, so the next eligible
  // executor gets the same task before any human is asked.
  const reports = [UNFINISHED, GOOD_FIX];
  const seen = [];
  const io = makeIo({
    available: ALL_FOUR,
    readReport: (runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      seen.push(runId);
      return reports.shift() ?? GOOD_FIX;
    },
  });
  const out = await dispatchIssue(147, io);

  const executors = io.spawned.filter((x) => x.role === "executor");
  assert.equal(executors.length, 2, "the refused disposition was not rerouted to a second executor");
  // D. The account whose disposition was rejected does not get handed it again
  // while another eligible one exists.
  assert.notEqual(executors[1].account, executors[0].account, "the rejected executor was immediately reselected");
  assert.deepEqual(
    out.result.executorAttempts.map((a) => a.accepted),
    [false, true],
    "the record does not show a refusal followed by an accepted answer",
  );
  assert.equal(out.result.executorAttempts[0].account, executors[0].account);
  assert.match(out.result.executorAttempts[0].reason, /evidence request/);

  // The run reached a real conclusion on the second executor's work.
  assert.equal(out.result.result, "VERIFIED");
  assert.equal(out.result.nextStatus, LABELS.verified);
  assert.equal(out.result.autonomousExecution, null, "a rerouted run that succeeded claimed exhaustion");

  // E. One workspace throughout: the reroute replaced who was writing, not what
  // had been written, and the second executor inherited the first's branch and
  // starting head rather than a fresh checkout.
  assert.equal(new Set(executors.map((x) => x.cwd)).size, 1, "the reroute moved the candidate workspace");
  assert.equal(executors[0].cwd, out.result.workspace);
  assert.equal(out.result.commitEvidence.ok, true, "the accumulated commit evidence was discarded by the reroute");
  assert.equal(out.result.gateResult, "PASS");

  // F. Single-writer ownership: one executor holds the workspace at a time, and
  // each try reports into its own directory so neither is judged on the other's
  // file. Exactly one worktree was created for the whole attempt.
  assert.equal(new Set(seen).size, 2, "both executors reported through the same run directory");
  assert.equal(seen[0], out.result.runId, "the first try moved off the attempt's own run directory");
  const added = io.gitCalls.filter((a) => a[0] === "worktree" && a[1] === "add" && !a.includes("--detach"));
  assert.equal(added.length, 1, "the reroute created a second candidate worktree");
});

test("V5c. reviewer independence survives a reroute", async () => {
  // An alternate executor may be the account that was reviewing. If the crew is
  // not re-planned together, the reroute quietly makes a candidate its own
  // examiner — the exact thing the review protocol exists to prevent.
  const reports = [UNFINISHED, GOOD_FIX];
  const io = makeIo({
    available: ALL_FOUR,
    readReport: (_runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      return reports.shift() ?? GOOD_FIX;
    },
  });
  const out = await dispatchIssue(147, io);
  const executor = io.spawned.filter((x) => x.role === "executor").at(-1).account;
  const reviewers = io.spawned.filter((x) => x.role === "reviewer").map((x) => x.account);
  assert.ok(reviewers.length >= 1, "no reviewer ran after the reroute");
  assert.ok(!reviewers.includes(executor), "the rerouted executor reviewed its own work");
  assert.equal(out.result.primaryAccount, executor, "the record names an executor that did not produce the answer");
  assert.ok(!out.result.reviewerAccount.split(",").includes(executor), "the record files the executor as its own reviewer");
});

test("V5d. with no alternate executor the run fails closed and claims no evidence", async () => {
  // I. Two accounts, one of which must review: there is no second eligible
  // executor. The honest record is that autonomous execution ran out — not that
  // a human owes a fact nobody ever established was missing.
  const io = makeIo({ readReport: gaveUpAs(UNFINISHED) });
  const out = await dispatchIssue(147, io);

  assert.equal(out.result.result, "INVALID_DISPOSITION", "exhausted autonomous execution was recorded as something else");
  assert.equal(out.result.disposition, "needs-human");
  assert.equal(out.result.nextStatus, LABELS.needsHuman);
  assert.notEqual(out.result.nextStatus, LABELS.needsEvidence, "an executor's unfinished work was labelled as owed evidence");
  assert.deepEqual(io.gh.labelWrites.at(-1).add, [LABELS.needsHuman]);

  // Nothing was invented on the operator's behalf.
  assert.equal(out.result.evidenceRequest, null, "an external evidence requirement was fabricated");
  assert.equal(out.result.autonomousExecution.state, "exhausted");
  assert.deepEqual(out.result.autonomousExecution.tried, [out.result.primaryAccount]);
  const body = io.gh.comments.at(-1).body;
  assert.ok(!body.includes("EVIDENCE_NEEDED="), "the ledger billed the operator for evidence");
  assert.match(body, /AUTONOMOUS_EXECUTION=exhausted/);
  assert.match(body, /NO_EVIDENCE_CLAIMED=/);
  // Fail closed: one executor ran, and the run stopped rather than looping.
  assert.equal(io.spawned.filter((x) => x.role === "executor").length, 1);
});

test("V5e. a valid external request lands as owed evidence and is never redispatched", async () => {
  // G + H. A real boundary is not executor-incomplete work: there is nothing a
  // second executor could do about it. So it lands immediately, and repeating
  // the same request on a later attempt reroutes nothing — which is what keeps
  // a genuine external dependency from becoming an autonomous redispatch loop.
  for (const available of [undefined, ALL_FOUR]) {
    const io = makeIo({
      ...(available ? { available } : {}),
      readReport: gaveUpAs({ result: "NEEDS_EVIDENCE", evidenceRequest: EVIDENCE_REQUEST }),
    });
    const out = await dispatchIssue(147, io);
    assert.equal(out.result.result, "NEEDS_EVIDENCE");
    assert.equal(out.result.nextStatus, LABELS.needsEvidence);
    assert.equal(
      io.spawned.filter((x) => x.role === "executor").length,
      1,
      "a valid external evidence request was redispatched to another executor",
    );
    assert.equal(out.result.autonomousExecution, null, "a valid external request was recorded as exhaustion");
    assert.equal(out.result.executorAttempts.length, 1);
    const body = io.gh.comments.at(-1).body;
    assert.match(body, /EVIDENCE_NEEDED=external-human\/live-game: /);
    for (const [i, step] of EVIDENCE_REQUEST.protocol.entries()) {
      assert.ok(body.includes(`EVIDENCE_STEP_${i + 1}=${step}`), `the ledger dropped protocol step ${i + 1}`);
    }
  }
});

// Issue #48 / Attempt 13, verbatim in shape: a BLOCKED whose whole account of
// itself is prose, including a test claim the controller never observed.
const ATTEMPT_13 = {
  result: "BLOCKED",
  behavioralRed: "",
  evidenceRequest: null,
  tests: [],
  notes:
    "The pinned trace proves Tauri handler receipt -> generated async command first-poll delay, but source and " +
    "offline analysis do not identify an occupying production operation. Changing queue policy would be " +
    "speculative. cargo test: passed (117 unit, 28 integration); the overlay gate is blocked by pre-existing " +
    "Node/ES-target TypeScript errors.",
};

test("V5f. an unfinished investigation reported as BLOCKED is rerouted, not recorded as an obstacle", async () => {
  // C + D + E + F, through the same mechanism an invalid evidence request uses.
  const reports = [ATTEMPT_13, GOOD_FIX];
  const seen = [];
  const io = makeIo({
    available: ALL_FOUR,
    readReport: (runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      seen.push(runId);
      return reports.shift() ?? GOOD_FIX;
    },
  });
  const out = await dispatchIssue(147, io);

  const executors = io.spawned.filter((x) => x.role === "executor");
  assert.equal(executors.length, 2, "an unsupported BLOCKED was not rerouted");
  assert.notEqual(executors[1].account, executors[0].account, "the rejected executor was immediately reselected");
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [false, true]);
  assert.match(out.result.executorAttempts[0].reason, /BLOCKED without a usable blocker/);

  // It never became a stop on the ledger.
  assert.notEqual(out.result.nextStatus, LABELS.blocked, "an invalid blocker still reached status:blocked");
  assert.equal(out.result.result, "VERIFIED");
  assert.equal(out.result.blocker, null, "an obstacle was recorded for a run that hit none");

  // E + F: one workspace, one worktree, one writer at a time, separate reports.
  assert.equal(new Set(executors.map((x) => x.cwd)).size, 1, "the reroute moved the candidate workspace");
  assert.equal(executors[0].cwd, out.result.workspace);
  assert.equal(out.result.commitEvidence.ok, true, "accumulated evidence was discarded by the reroute");
  assert.equal(new Set(seen).size, 2, "both executors reported through the same run directory");
  const added = io.gitCalls.filter((a) => a[0] === "worktree" && a[1] === "add" && !a.includes("--detach"));
  assert.equal(added.length, 1, "the reroute created a second candidate worktree");

  // F: reviewer independence survived the reroute.
  const reviewers = io.spawned.filter((x) => x.role === "reviewer").map((x) => x.account);
  assert.ok(!reviewers.includes(executors.at(-1).account), "the rerouted executor reviewed its own work");
});

test("V5g. an unsupported BLOCKED with no alternate fails closed and invents nothing", async () => {
  // I. Neither a human obstacle nor a human evidence debt is fabricated.
  const io = makeIo({ readReport: gaveUpAs(ATTEMPT_13) });
  const out = await dispatchIssue(147, io);

  assert.equal(out.result.result, "INVALID_DISPOSITION");
  assert.equal(out.result.nextStatus, LABELS.needsHuman);
  assert.notEqual(out.result.nextStatus, LABELS.blocked, "unfinished work was recorded as a blocker");
  assert.notEqual(out.result.nextStatus, LABELS.needsEvidence, "unfinished work was recorded as owed evidence");
  assert.equal(out.result.blocker, null, "a human blocker was fabricated");
  assert.equal(out.result.evidenceRequest, null, "an evidence requirement was fabricated");
  assert.equal(out.result.autonomousExecution.state, "exhausted");
  const body = io.gh.comments.at(-1).body;
  assert.ok(!body.includes("BLOCKER_CONDITION="), "the ledger claimed an obstacle");
  assert.ok(!body.includes("EVIDENCE_NEEDED="), "the ledger billed the operator");
  assert.match(body, /AUTONOMOUS_EXECUTION=exhausted/);
});

test("V5h. a genuine obstacle still stops the run, and says how to clear it", async () => {
  // G, end to end: a real blocker is not rerouted round the account pool.
  const io = makeIo({
    available: ALL_FOUR,
    readReport: gaveUpAs({ result: "BLOCKED", blocker: VALID_BLOCKER }),
  });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.result, "BLOCKED");
  assert.equal(out.result.nextStatus, LABELS.blocked);
  assert.equal(io.spawned.filter((x) => x.role === "executor").length, 1, "a real obstacle was redispatched round the pool");
  assert.equal(out.result.blocker.blockedAction, "implement");
  const body = io.gh.comments.at(-1).body;
  assert.match(body, /BLOCKED_ACTION=implement \(upstream-missing\)/);
  assert.match(body, /BLOCKER_RECOVERY=/);
});

test("V5i. what the executor said is never recorded as what the controller saw", async () => {
  // J. Attempt 13 declared no tests and asserted in prose that 117 passed, on a
  // profile that does not run them. Prose reaches no ledger line, the counts
  // that do are labelled as claims, and the gate is labelled as observed.
  const io = makeIo({
    readReport: gaveUpAs({ ...GOOD_FIX, notes: "cargo test: passed (117 unit, 28 integration); everything is verified" }),
  });
  const out = await dispatchIssue(147, io);
  const body = io.gh.comments.at(-1).body;

  assert.ok(!body.includes("117"), "an executor's prose test claim reached the ledger");
  assert.ok(!body.includes("everything is verified"), "executor prose reached the ledger");
  assert.match(body, /TESTS\(executor-declared\)=1/);
  assert.match(body, /GATE\(controller-observed\)=PASS/);
  // The profile left suites unrun, so the declared tests are flagged as
  // something nothing controller-side stood behind.
  assert.match(body, /UNVERIFIED_CLAIM=1 declared test\(s\); this profile left web,overlay uncovered/);

  // And the prose did not elevate anything: the level still stops where the
  // evidence stops.
  assert.equal(out.result.completionLevel, "IMPLEMENTED");
  assert.deepEqual(out.result.gateCoverage.notCovered, ["web", "overlay"]);
});

test("V5j. an executor that declares itself interrupted is rerouted, not billed to a human", async () => {
  // A + B + C. The report parsed, so nothing interrupted this execution: it
  // stopped. That is executor-incomplete work and takes the same road every
  // other refused disposition takes.
  const reports = [{ result: "INTERRUPTED", notes: "I could not work it out" }, GOOD_FIX];
  const io = makeIo({
    available: ALL_FOUR,
    readReport: (_runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      return reports.shift() ?? GOOD_FIX;
    },
  });
  const out = await dispatchIssue(147, io);

  const executors = io.spawned.filter((x) => x.role === "executor");
  assert.equal(executors.length, 2, "an executor-written INTERRUPTED ended the run instead of rerouting");
  assert.notEqual(executors[1].account, executors[0].account, "the rejected executor was immediately reselected");
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [false, true]);

  // C. The same workspace, with everything already committed on it.
  assert.equal(new Set(executors.map((x) => x.cwd)).size, 1, "the reroute moved the candidate workspace");
  assert.equal(executors[0].cwd, out.result.workspace);

  // None of the three landings this is not.
  assert.equal(out.result.result, "VERIFIED");
  assert.equal(out.result.nextStatus, LABELS.verified);
  assert.notEqual(out.result.nextStatus, LABELS.blocked);
  assert.notEqual(out.result.nextStatus, LABELS.needsEvidence);
  assert.notEqual(out.result.nextStatus, LABELS.needsHuman);
  assert.equal(out.result.autonomousExecution, null, "a rerouted run that succeeded claimed exhaustion");
});

test("V5k. an execution the controller actually saw interrupted is still INTERRUPTED", async () => {
  // D. A runtime that did not reach its own exit. Nobody claimed anything, so
  // there is nothing to refuse and nothing to reroute to — the controller
  // records what it observed. (A runtime that exited cleanly and merely wrote
  // no report is a different fact, and N3 covers it: that one reroutes.)
  const io = makeIo({
    available: ALL_FOUR,
    readReport: (_runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      return null;
    },
    spawn: (argv, opts) => {
      io.order.push(`launch:${opts.role ?? "gate"}`);
      io.spawned.push({ argv, ...opts });
      if (opts.role === "executor") return { status: null, signal: "SIGKILL", stdout: "", stderr: "" };
      if (opts.role === "gate-authority") return realAuthority(argv[2]);
      return runtimeAnswer(argv, opts);
    },
  });
  const out = await dispatchIssue(147, io);

  assert.equal(out.result.result, "INTERRUPTED", "a genuinely interrupted execution lost its own word");
  assert.equal(out.result.nextStatus, LABELS.needsHuman);
  assert.equal(io.spawned.filter((x) => x.role === "executor").length, 1, "an interrupted runtime was rerouted as if it had refused");
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [true]);
  assert.equal(out.result.autonomousExecution, null, "an interrupted runtime was recorded as exhausted autonomy");
  assert.match(out.result.notes, /without a report/);
});

test("V5l. an executor-written interruption with no alternate fails closed", async () => {
  // E. Two accounts, one of which must review: there is no second eligible
  // executor. Exhausted autonomy is what that is, and it is not a debt.
  const io = makeIo({ readReport: gaveUpAs({ result: "INTERRUPTED", notes: "I could not work it out" }) });
  const out = await dispatchIssue(147, io);

  assert.equal(out.result.result, "INVALID_DISPOSITION");
  assert.equal(out.result.nextStatus, LABELS.needsHuman);
  assert.notEqual(out.result.nextStatus, LABELS.needsEvidence);
  assert.notEqual(out.result.nextStatus, LABELS.blocked);
  assert.equal(out.result.evidenceRequest, null, "an external evidence requirement was fabricated");
  assert.equal(out.result.blocker, null, "an obstacle nobody hit was recorded");
  assert.equal(out.result.autonomousExecution.state, "exhausted");
  assert.equal(io.spawned.filter((x) => x.role === "executor").length, 1);
});

test("V5m. a verification blocker caps the surface it names and no other", () => {
  // A. A blocked overlay checker cannot produce a clean full verification: the
  // run did not establish what it did not check.
  const proposed = normalizeExecutorReport(
    {
      result: "FIX_PROPOSED",
      behavioralRed: "round counter reports 0 where the contract requires 4 — observed at overlay/src/scoring/index.ts:88",
      commitSha: HEAD,
      verificationBlockers: [{ surface: "overlay gate", detail: "pre-existing Node/ES-target TypeScript errors unrelated to this change" }],
    },
    { fingerprint: FINGERPRINT, role: "executor" },
  );
  const base = { reported: proposed, gateResult: "PASS", reviewVerdicts: ["PASS"], reviewersRequired: 1, commitVerified: true };
  const whole = concludeRun({ ...base, gateComplete: true, gateSuites: ["harness", "web", "overlay", "skills", "rust"], verificationBlockers: proposed.verificationBlockers });
  assert.equal(whole.completionLevel, "IMPLEMENTED", "a run that could not check overlay claimed a complete offline proof");
  assert.ok(!whole.provenSurfaces.includes("overlay"), "a blocked surface was recorded as proven");

  // B. The blocker is about overlay. A Rust suite the controller ran itself is
  // an independent authority and keeps the proof it actually produced — an
  // unrelated unrunnable checker is not evidence against it.
  const scoped = concludeRun({ ...base, gateComplete: false, gateSuites: ["rust"], verificationBlockers: proposed.verificationBlockers });
  assert.deepEqual(scoped.provenSurfaces, ["rust"], "an unrelated overlay blocker erased a targeted offline proof on rust");

  // C. Name the surface the proof depends on and the proof goes with it.
  const relevant = normalizeExecutorReport(
    { ...proposed, verificationBlockers: [{ surface: "rust", detail: "cargo could not resolve the workspace in this runtime" }] },
    { fingerprint: FINGERPRINT, role: "executor" },
  );
  const gone = concludeRun({ ...base, reported: relevant, gateComplete: false, gateSuites: ["rust"], verificationBlockers: relevant.verificationBlockers });
  assert.deepEqual(gone.provenSurfaces, [], "a blocked rust checker still yielded a rust-dependent offline proof");

  // And the standing rules are untouched: a gate pass with no reviewer is
  // GATE_PASSED, never VERIFIED, and only suites the controller ran can appear.
  const alone = concludeRun({ ...base, reviewVerdicts: [], reviewersRequired: 0, gateComplete: false, gateSuites: ["rust"], verificationBlockers: [] });
  assert.equal(alone.result, "GATE_PASSED");
  assert.deepEqual(alone.provenSurfaces, ["rust"]);
  assert.deepEqual(
    concludeRun({ ...base, gateResult: "FAIL", gateSuites: ["rust"], verificationBlockers: [] }).provenSurfaces,
    [],
    "a failing gate left surfaces recorded as proven",
  );

  // Nor by a gate the candidate could have written. A scope is a claim about
  // what was established, so it inherits the gate's authority, not its output.
  assert.deepEqual(
    concludeRun({ ...base, gateAuthoritative: false, gateSuites: ["rust"], verificationBlockers: [] }).provenSurfaces,
    [],
    "a candidate-influenced examiner produced a scoped proof",
  );

  // D. Declared tests are still a claim. A surface the controller did not run
  // cannot be proven by an executor saying it ran something there.
  const declared = normalizeExecutorReport(
    { ...proposed, tests: ["overlay/src-tauri/tests/poll.rs"], verificationBlockers: [] },
    { fingerprint: FINGERPRINT, role: "executor" },
  );
  assert.deepEqual(
    concludeRun({ ...base, reported: declared, gateComplete: false, gateSuites: ["harness"], verificationBlockers: [] }).provenSurfaces,
    ["harness"],
    "an executor's declared tests added a surface the controller never ran",
  );
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
    createReportSink: (runId, role) => ({ dir: `/handoff/${runId}`, path: `/handoff/${runId}/report-${role}.json` }),
    archiveReport: () => null,
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
  const sinks = [];
  const archived = [];
  const processRecords = [];
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
    sinks,
    archived,
    createReportSink: over.createReportSink ?? ((runId, role) => {
      const path = `/handoff/${runId}/report-${role}.json`;
      sinks.push({ runId, path });
      return { dir: `/handoff/${runId}`, path };
    }),
    archiveReport: over.archiveReport ?? ((runId, role) => {
      archived.push(`${runId}/report-${role}.json`);
      return `/state/runs/${runId}/report-${role}.json`;
    }),
    // The fake models no filesystem, so it does not answer a question about
    // one: `null` is "not established", which is what the record then says.
    reportExists: over.reportExists ?? (() => null),
    processRecords,
    recordProcess: over.recordProcess ?? ((runId, role, payload) => {
      processRecords.push({ runId, role, ...payload });
      return `${runId}/process-${role}.json`;
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

test("J8. an authority declaration that could not be read is not a clean one", async () => {
  // Nothing a candidate does causes this — the declaration comes from the
  // trusted checkout. But an unanswered question is not a reassuring answer,
  // and silently reading it as "the examiner was untouched" would upgrade every
  // such run to a pass that advances on its own.
  const io = makeIo({ machine: { task_class: "T1" } });
  const inner = io.spawn;
  io.spawn = (argv, opts) => {
    if (opts.role === "gate-authority") {
      io.spawned.push({ argv, ...opts });
      return { status: 1, stdout: "", stderr: "gate.sh: not found", error: null };
    }
    return inner(argv, opts);
  };
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.gateResult, "PASS");
  assert.equal(out.result.gateAuthority, "unknown");
  assert.notEqual(out.result.result, "GATE_PASSED", "an unreadable declaration produced an authoritative pass");
  assert.equal(out.result.disposition, "needs-review");
});

// K. the runtime the gate ran in is not the candidate's either ---------------
//
// Tracked authority asks who wrote the checks. It cannot ask what executed
// them. npm, npx, cargo and python all resolve runners, libraries or cached
// results out of ignored state inside the workspace — state the executor can
// write and no commit diff can show. A pass produced that way is still evidence
// and is still recorded; it is not an authority, and it may not certify alone.

// Ignored runtime state the workspace is holding when the gate runs.
const withRuntimeState = (io, ...present) => {
  const inner = io.pathExists;
  const tail = (p) => String(p).replace(/\/+$/, "");
  io.pathExists = (p) => present.some((r) => tail(p).endsWith(tail(r))) || inner(p);
  return io;
};

test("K1. a gate whose checks ran out of ignored state is recorded, and is not an authority", async () => {
  const io = withRuntimeState(
    changing(makeIo({ machine: { task_class: "T1", gate_profile: "web" } }), ["src/lib/scoring/round.ts"]),
    "node_modules/",
  );
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true);
  // The evidence is kept: the suites ran and they passed.
  assert.equal(out.result.gateResult, "PASS", "a non-authoritative gate was not run, or its result was discarded");
  // Nothing in the diff touched the tests, so the tracked classification is clean.
  assert.deepEqual(out.result.gateAuthorityTouched, [], "the diff touched the declared examiner after all");
  // And yet the runner, the linter and every library under test came out of a
  // directory the executor can write and git cannot show.
  assert.equal(out.result.gateAuthority, "environment-influenced");
  assert.deepEqual(out.result.gateRuntimeInputs, ["node_modules/"]);
  assert.notEqual(out.result.result, "GATE_PASSED", "a gate run out of candidate-writable state certified itself");
  assert.equal(out.result.disposition, "needs-review");
});

test("K2. ignored state a profile does not consume does not demote it", async () => {
  // The default profile runs node --test over builtins and relative imports. A
  // node_modules sitting in the workspace is not one of its inputs, and
  // treating every ignored file as an input would make every profile
  // review-required for no reason anyone could point at.
  const io = withRuntimeState(
    changing(makeIo({ machine: { task_class: "T1" } }), ["src/lib/scoring/round.ts"]),
    "node_modules/",
    "overlay/src-tauri/target/",
  );
  const out = await dispatchIssue(147, io);
  assert.equal(out.dispatched, true);
  assert.deepEqual(out.result.gateRuntimeInputs, []);
  assert.equal(out.result.gateAuthority, "controller");
  assert.equal(out.result.result, "GATE_PASSED");
  assert.equal(out.result.disposition, "accepted");
});

test("K3. a profile that consumes ignored state is authoritative only when it is not there", async () => {
  const io = changing(makeIo({ machine: { task_class: "T1", gate_profile: "web" } }), ["src/lib/scoring/round.ts"]);
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.gateAuthority, "controller", "a workspace holding no declared runtime state was demoted anyway");
  assert.deepEqual(out.result.gateRuntimeInputs, []);
});

test("K4. an independent reviewer can still certify what the gate cannot", () => {
  const base = {
    reported: { result: "FIX_PROPOSED" },
    gateResult: "PASS",
    commitVerified: true,
    gateComplete: true,
    gateAuthoritative: false,
  };
  const out = concludeRun({ ...base, reviewersRequired: 1, reviewVerdicts: ["PASS"] });
  assert.equal(out.result, "VERIFIED", "a reviewer's pass was discarded because the gate was not an authority");
  assert.equal(out.disposition, "accepted");
});

test("K5. the runtime inventory lives in the gate, not in a second copy", () => {
  const named = /node_modules|src-tauri\/target|__pycache__/;
  for (const file of [
    "harness/run/attempt.mjs",
    "harness/github/dispatch.mjs",
    "harness/github/issue-contract.mjs",
    "harness/verify-task.sh",
  ]) {
    assert.doesNotMatch(
      readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8"),
      named,
      `${file} names a runtime path itself, so there are now two inventories to keep in step`,
    );
  }
});

test("K6. a profile that cannot certify alone is known before anything is executed", () => {
  const planned = (profile) =>
    classifyGatePreflight(spawnSync("bash", [VERIFY_TASK, profile, "--plan"], { encoding: "utf8" }), profile);
  assert.equal(planned("harness").ok, true);
  assert.equal(planned("harness").autonomous, true);
  assert.equal(planned("web").ok, true, "planning the web profile failed outright");
  assert.equal(planned("web").autonomous, false, "the plan claims a profile can certify itself out of ignored state");
});

// The brief the reviewer is handed. A reviewer told that a gate outranks its
// judgement will defer to it; that instruction is only true of a gate the
// controller can actually stand behind.

const brief = (over = {}) =>
  buildReviewBrief({
    issue: { number: 147 },
    task: { fingerprint: "f", spec: "s" },
    commitSha: COMMIT,
    startingHead: BASE,
    diff: "d",
    gateOutput: "GATE: PASS (profile=web)",
    criteria: config.policy.criteria,
    workspace: "/w",
    gateResult: "PASS",
    gateAuthority: "controller",
    ...over,
  });

test("K7. a gate the candidate's runtime produced is not described as outranking the reviewer", () => {
  for (const authority of ["environment-influenced", "candidate-influenced", "unknown"]) {
    const text = brief({ gateAuthority: authority });
    assert.doesNotMatch(
      text,
      /gate outranks your judgement/,
      `a ${authority} gate is described to the reviewer as outranking it`,
    );
    assert.match(text, /supplemental|does not outrank/i, `a ${authority} gate pass is not qualified at all`);
    assert.match(text, /independent/i, "the reviewer is not told to reach its own conclusion");
  }
});

test("K8. a controller-owned gate still outranks the reviewer, and its failure still dominates", () => {
  const passed = brief({ gateAuthority: "controller", gateResult: "PASS" });
  assert.match(passed, /gate outranks your judgement/, "trusted deterministic evidence was demoted");
  const failed = brief({ gateAuthority: "controller", gateResult: "FAIL", gateOutput: "GATE: FAIL (profile=web)" });
  assert.match(failed, /gate outranks your judgement/, "an objective failure stopped dominating reviewer preference");
});

// --- L. the executor is told the contract the controller enforces -----------
//
// Attempt 16. The workspace was resumed and its head was already the candidate
// this issue had produced. The controller had known since a9662dd that such a
// head is a reportable inherited candidate — but the instructions the executor
// was actually handed still said the opposite. The skill told it to confirm it
// was "at its BASE_SHA" and to stop if it was anywhere else; the packet told it
// a commit must descend from the head the attempt started at. So the executor
// read the workspace it had been given, found HEAD ahead of the base, and
// reported BLOCKED for it. The controller refused that BLOCKED and rerouted,
// which is right and does not help: the next executor was handed the same
// contradictory brief.
//
// A second policy is the defect. One rule is stated once — run/evidence.mjs
// enforces it, and these pin that the executor is told that rule and no other.

// Issue #48's real attempt-16 shapes. REAL_HEAD is the candidate the previous
// attempt left on the branch; the base stays where the issue pinned it.
const RESUMED_BASE = "d82d35c97bffa9c8b3749a402e8fce8cb7e9f52f";

// A bullet, a numbered step or a paragraph is one unit; a wrapped line is not a
// new one, and reading it as one is how the skill's own contradiction hid — its
// `BASE_SHA` and its `git rev-parse HEAD` sit on two lines of one sentence.
// This is not an English parser: it exists so a rule can be checked for saying
// which workspace it is about.
const sentences = (text) => {
  const units = [];
  let current = "";
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (line === "" || /^(?:[-*]\s|\d+\.\s|#|\||```)/.test(line)) {
      if (current) units.push(current);
      current = line;
    } else {
      current = current ? `${current} ${line}` : line;
    }
  }
  if (current) units.push(current);
  return units
    .flatMap((unit) => unit.split(/(?<=[.;])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
};

// A rule pinning the workspace head to the pinned base is true of a fresh
// workspace and false of a resumed one. Said without saying which, it is the
// instruction attempt 16 followed into a blocker that was not one.
const unqualifiedHeadIsBase = (text) =>
  sentences(text).filter(
    (s) =>
      /\bhead\b/i.test(s) &&
      /BASE_SHA|BASE_REF|RESOLVED_BASE_SHA|pinned base/.test(s) &&
      !/STARTING_HEAD|WORKSPACE_ACTION|resum|fresh|create|inherit/i.test(s),
  );

const SKILL = source("../.agents/skills/mayhem-task/SKILL.md");

const packetFor = (over = {}) =>
  buildPacket({
    issue: issue(),
    machine: machine(),
    task: {
      url: "https://github.test/issues/147",
      fingerprint: FINGERPRINT,
      taskClass: "T2",
      baseRef: "main",
      resolvedBaseSha: RESUMED_BASE,
      spec: "the defect",
      contextPaths: ["AGENTS.md"],
      gateProfile: "harness",
    },
    attemptId: "issue-48-attempt-16",
    workspace: "/w/issue-48",
    reportPath: "/handoff/issue-48-attempt-16/report-executor.json",
    workspaceAction: "resume",
    startingHead: REAL_HEAD,
    ...over,
  });

const resumedPacket = () => packetFor();
const freshPacket = () =>
  packetFor({ workspaceAction: "create", startingHead: RESUMED_BASE });

test("L1. A. a resumed attempt is not told to stop because its head is ahead of the base", () => {
  const packet = resumedPacket();
  // The facts the rule is conditioned on have to be in the packet at all.
  assert.match(packet, /^WORKSPACE_ACTION: resume$/m, "the packet does not say which kind of workspace this is");
  assert.match(packet, new RegExp(`^STARTING_HEAD: ${REAL_HEAD}$`, "m"), "the packet does not name the head it starts from");
  assert.match(packet, new RegExp(`^RESOLVED_BASE_SHA: ${RESUMED_BASE}$`, "m"), "the pinned base left the packet");
  // And the stale instruction is gone.
  assert.deepEqual(
    unqualifiedHeadIsBase(packet),
    [],
    "the packet still pins HEAD to the base without saying which workspace it means",
  );
  assert.match(
    packet,
    /ahead of[^.]*RESOLVED_BASE_SHA[^.]*(expected|not an obstacle|not a blocker)|not a (blocker|reason to stop)/i,
    "a resumed head ahead of the base is not stated to be the expected state",
  );
});

test("L2. B. a resumed packet says the inherited head may be reported without a new commit", () => {
  const packet = resumedPacket();
  assert.match(packet, /inherit/i, "the packet never mentions an inherited candidate");
  assert.match(
    packet,
    /candidate is STARTING_HEAD|STARTING_HEAD[^.]*already be[^.]*candidate|may already be this issue's candidate/i,
    "the packet does not say STARTING_HEAD may itself be the candidate",
  );
  assert.match(
    packet,
    /do not (manufacture|make|create)[^.]*(no-op|empty amend|commit)/i,
    "the packet does not forbid manufacturing a commit purely to move the sha",
  );
});

test("L3. C. a fresh workspace still carries its base invariant", () => {
  const packet = freshPacket();
  assert.match(packet, /^WORKSPACE_ACTION: create$/m);
  assert.match(packet, new RegExp(`^STARTING_HEAD: ${RESUMED_BASE}$`, "m"));
  // Stated, and stated as being about a fresh workspace.
  const fresh = sentences(packet).filter((s) => /fresh|create/i.test(s) && /RESOLVED_BASE_SHA|STARTING_HEAD/.test(s));
  assert.ok(fresh.length, "a fresh packet no longer says what its head must be");
  // And a fresh executor is not handed the resumed permission.
  assert.doesNotMatch(
    packet,
    /may already be this issue's candidate/i,
    "a fresh workspace was told its head may already be the candidate",
  );
  // The controller side of the same invariant is untouched: a fresh attempt
  // that names the untouched base has committed nothing, and still says so.
  assert.equal(
    evidenceFor({
      reportedSha: BASE,
      startingHead: BASE,
      resolvedBaseSha: BASE,
      head: BASE,
      commits: [BASE],
      descendants: { [BASE]: [BASE] },
    }).code,
    "commit-is-starting-head",
  );
});

test("L4. D. neither the skill nor a generated packet may pin HEAD to the base unconditionally", () => {
  for (const [what, text] of [
    ["the mayhem-task skill", SKILL],
    ["a resumed packet", resumedPacket()],
    ["a fresh packet", freshPacket()],
  ]) {
    assert.deepEqual(unqualifiedHeadIsBase(text), [], `${what} states an unconditional HEAD == base rule`);
  }
  // The skill has to condition on the workspace kind, not merely omit the rule.
  assert.match(SKILL, /WORKSPACE_ACTION/, "the skill does not read the workspace kind");
  assert.match(SKILL, /STARTING_HEAD/, "the skill does not check the head the packet named");
  assert.match(SKILL, /resum/i, "the skill says nothing about a resumed workspace");
  assert.match(SKILL, /never (silently )?(rebase|reset)|never a silent rebase/i, "the skill dropped the no-rebase rule");
});

test("L5. E. an executor that follows the resumed packet is accepted by the controller", () => {
  // The whole point of one rule stated once: what the packet permits is what
  // run/evidence.mjs accepts, on exactly the attempt-16 shape.
  const out = evidenceFor({
    reportedSha: REAL_HEAD,
    startingHead: REAL_HEAD,
    resolvedBaseSha: RESUMED_BASE,
    head: REAL_HEAD,
    commits: [RESUMED_BASE, REAL_HEAD],
    descendants: { [RESUMED_BASE]: [REAL_HEAD], [REAL_HEAD]: [REAL_HEAD] },
  });
  assert.equal(out.ok, true, `the packet permits what the controller refuses: ${out.code} — ${out.reason}`);
  assert.equal(out.candidateOrigin, "inherited");
  assert.equal(out.diffBase, RESUMED_BASE);
  assert.equal(out.attemptProducedCommitSha, null);
});

// A workspace an earlier attempt left behind, registered with git and sitting on
// the candidate it produced. `resumedAt` alone moves only the head; this is what
// makes the controller *plan* a resume, which is the fact the packet turns on.
const RESUMED_SLUG = slugFor(issue().title);
const RESUMED_PATH = `${WT_ROOT}/147-${RESUMED_SLUG}`;
const RESUMED_BRANCH = `issue/147-${RESUMED_SLUG}`;
const resumedWorkspace = (head) => {
  const io = makeIo({
    repo: resumedAt(head),
    readReport: reportingCommit(head),
    git: (argv) => {
      io.gitCalls.push(argv);
      const a = argv[0] === "-C" ? argv.slice(2) : argv;
      if (a[0] === "worktree" && a[1] === "list") {
        return {
          status: 0,
          stdout: worktrees([
            { path: MAIN, branch: "main" },
            { path: RESUMED_PATH, branch: RESUMED_BRANCH, head },
          ]),
          stderr: "",
        };
      }
      return defaultGit(argv, io.repo);
    },
  });
  return io;
};

test("L6. the controller hands the executor the workspace facts, not just the base", async () => {
  const io = resumedWorkspace(CANDIDATE);
  const out = await dispatchIssue(147, io);
  const packet = io.spawned.find((x) => x.role === "executor").argv.at(-1);

  assert.match(packet, /^WORKSPACE_ACTION: resume$/m, "the lifecycle did not tell the packet which workspace it planned");
  assert.match(packet, new RegExp(`^STARTING_HEAD: ${CANDIDATE}$`, "m"), "the lifecycle did not tell the packet where it starts");
  assert.equal(out.result.workspaceAction, "resume", "the fixture did not resume a workspace");
});

test("L7. F. validating an inherited candidate never re-baselines the task", async () => {
  const io = resumedWorkspace(CANDIDATE);
  const out = await dispatchIssue(147, io);

  // BASE_REF and the sha it resolved to are provenance. An attempt that
  // accepted a candidate ahead of them must leave both exactly where they were.
  assert.equal(out.result.baseRef, BASE, "the run rewrote the issue's base_ref");
  assert.equal(out.result.resolvedBaseSha, BASE, "the run re-baselined the issue onto its own candidate");
  assert.notEqual(out.result.resolvedBaseSha, CANDIDATE);
  assert.equal(out.result.startingHead, CANDIDATE);
  const packet = io.spawned.find((x) => x.role === "executor").argv.at(-1);
  assert.match(packet, new RegExp(`^RESOLVED_BASE_SHA: ${BASE}$`, "m"), "the executor was handed the candidate as its base");
  // And nothing moved a ref to make the two agree.
  assert.equal(
    io.gitCalls.filter((a) => a.includes("reset") || a.includes("rebase")).length,
    0,
    "the run reset or rebased a resumed workspace",
  );
});

test("L8. D. a rerouted try is not told to stop for a head its predecessor moved", async () => {
  // The same defect, one try later. A rerouted executor inherits the workspace
  // exactly as the refused one left it — including anything it committed — so a
  // packet that demands HEAD == STARTING_HEAD stops the second executor for
  // doing nothing wrong, on a workspace that was never resumed at all.
  const reports = [UNFINISHED, GOOD_FIX];
  const io = makeIo({
    available: ALL_FOUR,
    readReport: (runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output");
      return reports.shift() ?? GOOD_FIX;
    },
  });
  const out = await dispatchIssue(147, io);

  const packets = io.spawned.filter((x) => x.role === "executor").map((x) => x.argv.at(-1));
  assert.equal(packets.length, 2, "the refused disposition was not rerouted");
  // The first try is the first to touch this workspace, so the check is real.
  assert.match(packets[0], /`git rev-parse HEAD` must be it/, "the first try was not asked to confirm its head");
  // The second inherits it, and is told so rather than checked against it.
  assert.doesNotMatch(
    packets[1],
    /`git rev-parse HEAD` must be it|Confirm `git rev-parse HEAD` is STARTING_HEAD/,
    "a rerouted try was told to stop unless HEAD is still STARTING_HEAD",
  );
  assert.match(
    packets[1],
    /earlier executor[\s\S]{0,200}worked this attempt/i,
    "a rerouted try is not told an earlier executor already worked this workspace",
  );
  assert.deepEqual(unqualifiedHeadIsBase(packets[1]), [], "a rerouted packet pins HEAD to the base unconditionally");
  // And the rule the controller actually holds is unchanged by any of it.
  assert.equal(out.result.commitEvidence.ok, true);
});

// --- E. what the worktree was carrying, and whether the gate could see it ---
//
// Attempt 17. Both executors produced canonical commits at HEAD and exited
// normally; both were refused as worktree-dirty. The tracked diff was empty and
// the index was empty. Every path `git status` reported was an untracked
// evidence artifact left by attempts 02-16 under .codex/evidence/, .codex/gates/
// and debug-evidence/ — pinned manifests, live traces, red/green logs, gate
// logs, final diffs.
//
// The invariant the check exists for is real: the gate must have tested the
// candidate commit plus explicitly classified environment inputs, and nothing
// else. What was wrong was the question. "Is `git status` empty" answers a
// different one, and answers it wrongly in both directions — it refuses a
// workspace whose contamination the gate cannot reach, and it would accept a
// contaminated one whose artifacts happened to be committed.
//
// So the question becomes: can any of this reach the gate? That is not a
// property of a filename, and it is not the controller's to guess. The gate
// already declares what it reads; it now also declares the roots it cannot,
// and a root that collides with anything it does read is not honored.

const ATTEMPT_17_BASE = RESUMED_BASE;
const ATTEMPT_17_INHERITED = REAL_HEAD;
const ATTEMPT_17_CANDIDATE = "e41a2c2f80cee48afba2fc6f1f51f797858a9d29";

// Verbatim shape of what attempt 17's workspace was carrying: untracked
// directories, which is how git reports an untracked tree.
const INHERITED_EVIDENCE =
  "?? .codex/evidence/issue-48-attempt-02/\n" +
  "?? .codex/evidence/issue-48-attempt-16/\n" +
  "?? .codex/gates/issue-48-attempt-14/\n" +
  "?? debug-evidence/issue-48/\n";

// The gate's own declaration, run for real. The roots under test are whatever
// scripts/gate.sh says they are — a test that hard-coded them would be the
// second list this whole change exists to avoid.
const DECLARED = () => realAuthority("all").stdout ?? "";
const declaredRows = (kind) =>
  DECLARED()
    .split("\n")
    .map((line) => line.split("\t").map((c) => c?.trim()))
    .filter(([, k]) => k === kind);

const attempt17 = (over = {}) =>
  evidenceFor({
    reportedSha: ATTEMPT_17_CANDIDATE,
    startingHead: ATTEMPT_17_INHERITED,
    resolvedBaseSha: ATTEMPT_17_BASE,
    head: ATTEMPT_17_CANDIDATE,
    commits: [ATTEMPT_17_BASE, ATTEMPT_17_INHERITED, ATTEMPT_17_CANDIDATE],
    descendants: {
      [ATTEMPT_17_BASE]: [ATTEMPT_17_INHERITED, ATTEMPT_17_CANDIDATE],
      [ATTEMPT_17_INHERITED]: [ATTEMPT_17_CANDIDATE],
      [ATTEMPT_17_CANDIDATE]: [ATTEMPT_17_CANDIDATE],
    },
    status: INHERITED_EVIDENCE,
    declared: DECLARED(),
    ...over,
  });

test("E1. A. an inherited candidate is not refused for evidence the gate cannot reach", () => {
  // GPT_A's answer: claimed == observed == HEAD == the head it started from.
  const out = attempt17({ reportedSha: ATTEMPT_17_INHERITED, head: ATTEMPT_17_INHERITED });
  assert.equal(out.ok, true, `attempt 17's inherited candidate is still refused: ${out.code} — ${out.reason}`);
  assert.equal(out.candidateOrigin, "inherited");
  assert.equal(out.diffBase, ATTEMPT_17_BASE);
});

test("E2. B. a candidate produced this attempt is not refused for the same evidence", () => {
  // CLAUDE_A's answer, on the same workspace.
  const out = attempt17();
  assert.equal(out.ok, true, `attempt 17's produced candidate is still refused: ${out.code} — ${out.reason}`);
  assert.equal(out.candidateOrigin, "produced-this-attempt");
  assert.equal(out.attemptProducedCommitSha, ATTEMPT_17_CANDIDATE);
});

test("E3. 3. a workspace carrying evidence is recorded as carrying it, never as clean", () => {
  const out = attempt17();
  assert.equal(out.worktree.cleanForCandidate, true, "the candidate's own state was not established");
  // And the honest half: git status was not empty and the record says so.
  assert.equal(out.worktree.statusEmpty, false, "a workspace with four untracked trees was called literally clean");
  assert.equal(out.worktree.untrackedEvidenceCount, 4);
  assert.deepEqual(out.worktree.trackedModified, []);
  assert.deepEqual(out.worktree.stagedModified, []);
  assert.deepEqual(out.worktree.untrackedBlocking, []);
  assert.deepEqual(out.worktree.untrackedEvidence, [
    ".codex/evidence/issue-48-attempt-02/",
    ".codex/evidence/issue-48-attempt-16/",
    ".codex/gates/issue-48-attempt-14/",
    "debug-evidence/issue-48/",
  ]);
});

test("E4. C-E. an untracked source, rust or config input still refuses the candidate", () => {
  for (const [what, path] of [
    ["a web source file", "src/lib/scoring/foo.ts"],
    ["an overlay source file", "overlay/src/foo.ts"],
    ["a tauri source file", "overlay/src-tauri/src/foo.rs"],
    ["a package manifest", "package.json.new"],
    ["a build config", "vitest.config.local.ts"],
    ["a lockfile", "overlay/package-lock.json.orig"],
  ]) {
    const out = attempt17({ status: `${INHERITED_EVIDENCE}?? ${path}\n` });
    assert.equal(out.ok, false, `${what} was accepted as evidence-like`);
    assert.equal(out.code, "worktree-dirty");
    assert.deepEqual(out.worktree.untrackedBlocking, [path], `${what} was not named as the blocker`);
    assert.equal(out.worktree.cleanForCandidate, false);
  }
});

test("E5. F-G. staged and tracked-unstaged changes still refuse the candidate", () => {
  const staged = attempt17({ status: `${INHERITED_EVIDENCE}M  src/lib/scoring/index.ts\n` });
  assert.equal(staged.ok, false, "a staged production change was accepted");
  assert.deepEqual(staged.worktree.stagedModified, ["src/lib/scoring/index.ts"]);
  assert.deepEqual(staged.worktree.trackedModified, []);
  assert.match(staged.reason, /stage|index/i, "the reason does not name the blocking category");

  const unstaged = attempt17({ status: `${INHERITED_EVIDENCE} M src/lib/scoring/index.ts\n` });
  assert.equal(unstaged.ok, false, "a tracked unstaged change was accepted");
  assert.deepEqual(unstaged.worktree.trackedModified, ["src/lib/scoring/index.ts"]);
  assert.deepEqual(unstaged.worktree.stagedModified, []);
  assert.match(unstaged.reason, /track|uncommitted/i, "the reason does not name the blocking category");
});

test("E6. H. an untracked test the gate would discover still refuses the candidate", () => {
  for (const path of [
    "harness/test/planted.test.mjs",
    "src/lib/planted.test.ts",
    "overlay/src/planted.test.ts",
    ".codex/skills/test-league-augment-overlay/scripts/test_planted.py",
  ]) {
    const out = attempt17({ status: `${INHERITED_EVIDENCE}?? ${path}\n` });
    assert.equal(out.ok, false, `${path} would be discovered by the gate and was exempted`);
    assert.deepEqual(out.worktree.untrackedBlocking, [path]);
  }
});

test("E7. I. a declared root that collides with a gate input is not honored", () => {
  // The policy is a claim about reachability, so it is checked rather than
  // trusted. A root that contains something the gate actually reads exempts
  // nothing — including the case where the root is the whole of .codex/, whose
  // skills subtree the skills suite discovers its tests from.
  const wide = attempt17({
    declared: `${DECLARED()}\nharness\tevidence\t.codex/\n`.replace(/^(\w+)\tevidence\t/gm, "$1\tevidence\t"),
    status: "?? .codex/skills/test-league-augment-overlay/scripts/test_planted.py\n",
  });
  assert.equal(wide.ok, false, "a root containing the skills suite's own tests was honored");

  // And the file-level form: a path that sits under an honored root but is
  // itself something a suite reads is blocking wherever it sits.
  const inside = attempt17({ status: "?? .codex/evidence/round34/harness/test/planted.test.mjs\n" });
  assert.equal(inside.worktree.untrackedEvidence.length + inside.worktree.untrackedBlocking.length, 1);
});

test("E8. 1. the gate declares the roots it cannot reach, and they are the observed ones", () => {
  const rows = declaredRows("evidence");
  assert.ok(rows.length > 0, "scripts/gate.sh declares no non-input evidence roots");
  const roots = [...new Set(rows.map(([, , path]) => path))].sort();
  assert.deepEqual(roots, [".codex/evidence/", ".codex/gates/", "debug-evidence/"]);

  // Every suite the gate knows must declare a root before it is honored, so a
  // suite added later cannot inherit an exemption nobody checked for it.
  const suites = [...new Set(DECLARED().split("\n").map((l) => l.split("\t")[0]?.trim()).filter(Boolean))];
  for (const suite of suites) {
    const declaredHere = rows.filter(([s]) => s === suite).map(([, , path]) => path).sort();
    assert.deepEqual(declaredHere, roots, `suite ${suite} does not declare the evidence roots`);
  }

  // And the proof, mechanically: no path the gate says it reads lives inside a
  // declared root, and no declared root lives inside a path the gate reads.
  const inputs = [...declaredRows("tracked"), ...declaredRows("runtime")].map(([, , path]) => path);
  for (const root of roots) {
    for (const input of inputs) {
      const literal = input.split(/[*]/)[0];
      assert.ok(!input.startsWith(root), `the gate reads ${input}, which is inside the declared root ${root}`);
      assert.ok(!root.startsWith(literal) || literal === "", `the declared root ${root} is inside the gate input ${input}`);
    }
  }
});

test("E9. J-K. a rerouted try inherits permitted evidence but never untracked source", () => {
  // J. The first executor's diagnostic artifacts are not the second executor's
  // debt. K. An untracked source file it left behind is.
  const permitted = attempt17({
    status: `${INHERITED_EVIDENCE}?? .codex/gates/issue-48-attempt-17/red.log\n`,
    baseline: { untrackedEvidence: [".codex/evidence/issue-48-attempt-02/"] },
  });
  assert.equal(permitted.ok, true, `a rerouted try was refused for its predecessor's evidence: ${permitted.code}`);
  // Recorded in the order git reported them, which is git's own sort — the
  // artifact this try added is last because it was appended to the fixture.
  assert.deepEqual(permitted.worktree.delta.evidenceNewSinceBaseline, [
    ".codex/evidence/issue-48-attempt-16/",
    ".codex/gates/issue-48-attempt-14/",
    "debug-evidence/issue-48/",
    ".codex/gates/issue-48-attempt-17/red.log",
  ]);
  assert.deepEqual(permitted.worktree.delta.evidenceInherited, [".codex/evidence/issue-48-attempt-02/"]);

  const contaminated = attempt17({
    status: `${INHERITED_EVIDENCE}?? overlay/src/leftover.ts\n`,
    baseline: { untrackedBlocking: ["overlay/src/leftover.ts"] },
  });
  assert.equal(contaminated.ok, false, "a rerouted try inherited untracked source and was accepted");
  assert.deepEqual(contaminated.worktree.delta.blockingInherited, ["overlay/src/leftover.ts"]);
  assert.deepEqual(contaminated.worktree.delta.blockingNewSinceBaseline, []);

  // "This attempt found it here" and "this try produced it" are different
  // facts, and a rerouted try is exactly where they come apart.
  const thisTry = attempt17({
    status: `${INHERITED_EVIDENCE}?? .codex/gates/issue-48-attempt-17/red.log\n`,
    baseline: { untrackedEvidence: [".codex/evidence/issue-48-attempt-02/"] },
    tryBaseline: { untrackedEvidence: INHERITED_EVIDENCE.split("\n").filter(Boolean).map((l) => l.slice(3)) },
  });
  assert.deepEqual(thisTry.worktree.deltaThisTry.evidenceNewSinceBaseline, [
    ".codex/gates/issue-48-attempt-17/red.log",
  ]);
  assert.equal(thisTry.worktree.delta.evidenceNewSinceBaseline.length, 4, "the attempt-wide delta collapsed into the try's");
});

test("E13. L. the ledger line says what the workspace held without calling it clean", async () => {
  const io = makeIo({ repo: { status: INHERITED_EVIDENCE } });
  await dispatchIssue(147, io);
  const comment = io.gh.comments.at(-1)?.body ?? "";
  assert.match(comment, /^WORKTREE=clean-for-candidate=true untracked-evidence=4$/m, comment);

  const contaminated = makeIo({ repo: { status: `${INHERITED_EVIDENCE}?? overlay/src/leftover.ts\n` } });
  await dispatchIssue(147, contaminated);
  const refused = contaminated.gh.comments.at(-1)?.body ?? "";
  assert.match(refused, /^WORKTREE=clean-for-candidate=false .*untracked-blocking=1 \(overlay\/src\/leftover\.ts\)/m, refused);
});

test("E10. L. the record names the blocking category, not only that something was dirty", () => {
  const out = attempt17({ status: `${INHERITED_EVIDENCE}?? overlay/src/foo.ts\nM  src/a.ts\n M src/b.ts\n` });
  assert.equal(out.ok, false);
  assert.deepEqual(out.worktree.untrackedBlocking, ["overlay/src/foo.ts"]);
  assert.deepEqual(out.worktree.stagedModified, ["src/a.ts"]);
  assert.deepEqual(out.worktree.trackedModified, ["src/b.ts"]);
  assert.equal(out.worktree.untrackedEvidenceCount, 4);
  // The reason an operator reads has to say which of the three it was.
  assert.match(out.reason, /overlay\/src\/foo\.ts|untracked/, "the reason does not reach the blocking path");
});

test("E11. A. the whole lifecycle accepts attempt 17's workspace", async () => {
  // The same fix through the front door: a dispatch whose workspace carries
  // exactly attempt 17's contamination reaches a real conclusion.
  const io = makeIo({ repo: { status: INHERITED_EVIDENCE } });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.ok, true, `the lifecycle still refuses attempt 17: ${out.result.commitEvidence.code}`);
  assert.equal(out.result.commitEvidence.worktree.untrackedEvidenceCount, 4);
  assert.equal(out.result.commitEvidence.worktree.statusEmpty, false);
});

test("E12. C. the lifecycle still refuses a workspace carrying untracked source", async () => {
  const io = makeIo({ repo: { status: `${INHERITED_EVIDENCE}?? overlay/src/leftover.ts\n` } });
  const out = await dispatchIssue(147, io);
  assert.equal(out.result.commitEvidence.ok, false, "untracked source reached a passing commit evidence");
  assert.equal(out.result.commitEvidence.code, "worktree-dirty");
  assert.deepEqual(out.result.commitEvidence.worktree.untrackedBlocking, ["overlay/src/leftover.ts"]);
});

// --- D. the controller records how each executor process ended --------------
//
// Attempt 16's second try. CLAUDE_A exited 1 and wrote no report, so the
// controller — correctly — synthesized INTERRUPTED and said "executor exited 1
// without a report". That is a true sentence and an unactionable one: the run
// directory held the report that was never written and nothing else, so there
// was no stdout, no stderr, no launch line and no exit record to diagnose the 1
// from. The runtime's own account of what happened was echoed to a terminal
// that had already scrolled.
//
// Diagnostics are the controller's, not the executor's, and they change no
// authority: the report file remains the only place a claim can be made, and
// what a process printed remains evidence about the process rather than about
// the work.

const ended = (over) => ({ status: null, signal: null, stdout: "", stderr: "", error: null, ...over });

// One executor try that ended some particular way, with no report to show.
const runtimeThatEnded = (answer, over = {}) => {
  const io = makeIo({
    readReport: () => null,
    reportExists: () => false,
    spawn: (argv, opts) => {
      io.order.push(`launch:${opts.role ?? "gate"}`);
      io.spawned.push({ argv, ...opts });
      if (opts.role === "executor") return answer;
      if (opts.role === "gate-authority") return realAuthority(argv[2]);
      return runtimeAnswer(argv, opts);
    },
    ...over,
  });
  return io;
};

const diagnosticsOf = (record) => record.process;

test("D1. G. an executor that exits 1 with no report leaves an exit status and its stderr", async () => {
  const io = runtimeThatEnded(
    ended({ status: 1, stderr: "Error: session ended unexpectedly\n", stdout: "thinking…\n" }),
  );
  const out = await dispatchIssue(147, io);

  assert.equal(out.result.result, "INTERRUPTED", "the controller's own observation was weakened");
  assert.equal(io.processRecords.length, 1, "the try that died left no process diagnostic");
  const [record] = io.processRecords;
  const p = diagnosticsOf(record);
  assert.equal(p.didRun, true);
  assert.equal(p.exitStatus, 1, "the exit status the whole ask is about was not persisted");
  assert.equal(p.termination, "exit");
  assert.equal(p.signal, null);
  assert.equal(p.account, out.result.primaryAccount);
  assert.equal(p.execution, out.result.primaryExecution);
  assert.equal(p.runtime, out.result.primaryRuntime);
  assert.equal(p.cwd, out.result.workspace);
  assert.equal(p.report.presentAtExit, false, "the record does not say whether the required report was there");
  assert.match(p.report.path, /report-executor\.json$/);
  assert.ok(Number.isFinite(p.durationMs), "the record carries no duration");
  assert.match(record.stderr, /session ended unexpectedly/, "the runtime's own account of the failure was discarded");
  assert.match(record.stdout, /thinking/);

  // And the ledger points at it, so "exit 1" is something a person can open.
  assert.equal(out.result.executorAttempts[0].diagnostics, io.processRecords[0].runId + "/process-executor.json");
  const comment = io.gh.comments.at(-1).body;
  assert.match(comment, /EXECUTOR_PROCESS=/, "the issue comment does not reference the process diagnostic");
  assert.match(comment, /process-executor\.json/);
});

test("D2. H. a killed runtime records the signal that killed it", async () => {
  const io = runtimeThatEnded(ended({ status: null, signal: "SIGKILL" }));
  const out = await dispatchIssue(147, io);

  const p = diagnosticsOf(io.processRecords[0]);
  assert.equal(p.termination, "signal");
  assert.equal(p.signal, "SIGKILL");
  assert.equal(p.exitStatus, null, "a killed process was given an exit status it never had");
  assert.equal(p.didRun, false);
  assert.equal(out.result.result, "INTERRUPTED");
});

test("D3. I. a launch that never happened is not the launched program's verdict", async () => {
  const io = runtimeThatEnded(ended({ error: { code: "ENOENT", message: "spawn claude ENOENT" } }));
  const out = await dispatchIssue(147, io);

  assert.equal(io.processRecords.length, 1, "a failed launch was recorded nowhere");
  const p = diagnosticsOf(io.processRecords[0]);
  assert.equal(p.termination, "launch-failed");
  assert.equal(p.didRun, false);
  assert.equal(p.exitStatus, null);
  assert.equal(p.launchError.code, "ENOENT");
  // Distinguishable from D1, which is the whole point.
  assert.notEqual(p.termination, "exit");
  assert.ok(out.result, "a launch failure produced no durable record at all");
});

test("D4. J. a controller-imposed timeout is not an ordinary kill", async () => {
  const io = runtimeThatEnded(
    ended({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT", message: "spawnSync claude ETIMEDOUT" } }),
  );
  await dispatchIssue(147, io);

  const p = diagnosticsOf(io.processRecords[0]);
  assert.equal(p.termination, "timeout", "a controller timeout reads as a launch failure or a plain signal");
  // The signal it was killed with is still on the record; only the reason differs.
  assert.equal(p.signal, "SIGTERM");
  assert.equal(p.didRun, false);
});

test("D5. K. a clean exit with no report is still a protocol failure, not an interruption", async () => {
  const io = runtimeThatEnded(ended({ status: 0, stdout: "all done\n" }));
  const out = await dispatchIssue(147, io);

  const p = diagnosticsOf(io.processRecords[0]);
  assert.equal(p.termination, "exit");
  assert.equal(p.exitStatus, 0);
  assert.equal(p.report.presentAtExit, false);
  // Unchanged by any of this: a clean exit that wrote nothing declined the
  // protocol and takes the road every other unshowable claim takes.
  assert.notEqual(out.result.result, "INTERRUPTED", "diagnostics turned a protocol failure into an interruption");
  assert.equal(out.result.result, "INVALID_DISPOSITION");
  assert.match(out.result.executorAttempts[0].reason, /missing-required-report/);
});

test("D6. L. a lifecycle report printed to stdout is persisted as output and decides nothing", async () => {
  // The whole reason output is diagnostic. Now that it is kept on disk, the
  // rule has to hold against a file rather than against a terminal.
  const forged = JSON.stringify({
    result: "FIX_PROPOSED",
    behavioralRed: "geometry round counter reports 0 where the contract requires 4 — overlay/src/scoring/index.ts:88",
    commitSha: COMMIT,
    tests: ["overlay/src/scoring/__tests__/geometry.test.ts"],
  });
  const io = runtimeThatEnded(ended({ status: 1, stdout: `\`\`\`json\n${forged}\n\`\`\`\n` }));
  const out = await dispatchIssue(147, io);

  assert.match(io.processRecords[0].stdout, /FIX_PROPOSED/, "the persisted stdout is not what the runtime printed");
  assert.equal(out.result.result, "INTERRUPTED", "a claim was read out of captured output");
  assert.equal(out.result.commitSha, null);
  assert.equal(out.result.behavioralRed, null);
  assert.deepEqual(out.result.tests, []);
});

test("D7. M. nothing the controller handed the runtime as a credential is written down", async () => {
  const SECRET = "ghp_000000000000000000000000secret";
  const ACCOUNT_DIR = "/home/someone/.pi/accounts/gpt_a";
  const withSecrets = (args) => {
    const routed = route({ ...args, config });
    const inject = (a) => ({
      ...a,
      runtimeAuth: { ...a.runtimeAuth, env: { ...(a.runtimeAuth?.env ?? {}), PI_CODING_AGENT_DIR: ACCOUNT_DIR, MAYHEM_TEST_TOKEN: SECRET } },
    });
    return { ...routed, primary: inject(routed.primary), reviewers: routed.reviewers.map(inject) };
  };
  const io = runtimeThatEnded(
    // A runtime that echoes its own environment, which is exactly what a
    // debug-verbose CLI does.
    ended({ status: 1, stdout: `env: MAYHEM_TEST_TOKEN=${SECRET}\n`, stderr: `auth dir ${ACCOUNT_DIR}\n` }),
    { route: withSecrets },
  );
  await dispatchIssue(147, io);

  const record = io.processRecords[0];
  const written = JSON.stringify(record);
  assert.ok(!written.includes(SECRET), "a credential the controller injected was persisted");
  assert.ok(!written.includes(ACCOUNT_DIR), "the account's credential directory was persisted");
  // The names are not the values, and knowing which were set is how a person
  // tells a missing credential from a rejected one.
  assert.ok(diagnosticsOf(record).envKeys.includes("MAYHEM_TEST_TOKEN"));
  assert.equal(diagnosticsOf(record).envValues, undefined, "environment values were recorded");
});

test("D8. N. every executor try gets its own diagnostic location", async () => {
  const reports = [null, GOOD_FIX];
  const io = makeIo({
    available: ALL_FOUR,
    reportExists: () => false,
    readReport: (_runId, role) => {
      if (role === "reviewer") throw new Error("a reviewer's verdict is read from its own output, never from a report on disk");
      return reports.length > 1 ? reports.shift() : reports[0];
    },
  });
  const out = await dispatchIssue(147, io);

  assert.equal(io.processRecords.length, 2, "a rerouted try left no diagnostic of its own");
  const [first, second] = io.processRecords;
  assert.notEqual(first.runId, second.runId, "two tries shared one diagnostic location");
  assert.equal(first.runId, out.result.runId);
  assert.equal(second.runId, `${out.result.runId}/executor-2`);
  assert.notEqual(diagnosticsOf(first).account, diagnosticsOf(second).account, "both tries were filed under one account");
  assert.deepEqual(out.result.executorAttempts.map((a) => a.accepted), [false, true]);
});

test("D9. O. diagnostics are the executor's; the reviewer neither writes nor receives them", async () => {
  const io = makeIo();
  const out = await dispatchIssue(147, io);

  assert.ok(io.processRecords.length >= 1);
  assert.ok(io.processRecords.every((r) => r.role === "executor"), "a reviewer was made to keep a report-shaped record");
  // Routing and one-writer ownership are untouched.
  assert.equal(io.spawned.filter((x) => x.role === "executor").length, 1);
  assert.equal(out.result.result, "VERIFIED");
  // And no reviewer launch names a diagnostic path under the executor's run.
  for (const reviewer of io.spawned.filter((x) => x.role === "reviewer")) {
    for (const token of reviewer.argv) {
      assert.doesNotMatch(String(token), /process-executor/, "the reviewer was handed the executor's process record");
    }
  }
});

test("D10. the real dispatcher writes the record, the streams, and a relative identifier", () => {
  // The suite injects recordProcess everywhere, so the actual wiring is
  // exercised by nothing else — the same gap N1 closes for the report reader. A
  // dispatcher that named a helper it never imported, or wrote an absolute path
  // onto the ledger, would pass every behavioural test above.
  const dispatcher = source("dispatch-github-issue.mjs");
  const reportImport = dispatcher.match(/import \{([^}]*)\} from "\.\/run\/report\.mjs";/);
  assert.match(reportImport[1], /\bexecutorReportExists\b/, "the dispatcher cannot answer whether a report was written");
  assert.match(dispatcher, /reportExists: \(runId, role\) => executorReportExists\(handoffRoot, runId, role\)/);

  const writer = dispatcher.match(/recordProcess: \(runId, role, described\) => \{([\s\S]*?)\n {4}\},/);
  assert.ok(writer, "the dispatcher persists no process diagnostics at all");
  const body = writer[1];
  assert.match(body, /join\(runsDir, runId\)/, "diagnostics are not written under the try's own run directory");
  assert.match(body, /process-\$\{role\}\.json/);
  assert.match(body, /process-\$\{role\}\.stdout\.log/);
  assert.match(body, /process-\$\{role\}\.stderr\.log/);
  // What goes back to the ledger is relative to the runs directory: an absolute
  // path names the machine the run happened on.
  assert.match(body, /return join\(runId, `process-\$\{role\}\.json`\);/);
  assert.ok(!/runsDir, `process-/.test(body), "two tries would share one diagnostic file");
});

test("D11. the report-presence probe answers about the file, not about its contents", () => {
  const root = mkdtempSync(join(tmpdir(), "mayhem-presence-"));
  const runId = "issue-147-attempt-01";
  const sink = createReportSink(root, runId, "executor");

  assert.equal(executorReportExists(root, runId, "executor"), false, "an unwritten report was reported present");
  writeFileSync(sink.path, "");
  assert.equal(executorReportExists(root, runId, "executor"), false, "an empty file counted as a written report");
  // Present and unparseable is a different failure from never written, and the
  // point of recording presence is to tell them apart.
  writeFileSync(sink.path, "not json at all");
  assert.equal(executorReportExists(root, runId, "executor"), true);
  assert.equal(readExecutorReport(root, runId, "executor"), null, "rubbish became an answer");
  // A reviewer writes no report, so there is nothing here to ask about.
  assert.equal(executorReportExists(root, runId, "reviewer"), false);
});

test("D12. a diagnostics writer that fails does not cost the run its work", async () => {
  const io = makeIo({
    recordProcess: () => {
      throw new Error("ENOSPC: no space left on device, open '/state/runs/x/process-executor.json'");
    },
  });
  const out = await dispatchIssue(147, io);

  assert.equal(out.result.result, "VERIFIED", "bookkeeping outranked a git-verified commit and a passing gate");
  assert.equal(out.result.executorAttempts[0].diagnostics, null);
  assert.match(out.result.executorAttempts[0].diagnosticsError, /ENOSPC/);
  // And the failure it could not write down carries no path off this machine.
  assert.ok(!/\/state\/runs/.test(out.result.executorAttempts[0].diagnosticsError));
});
