// Local dispatch of one GitHub issue.
//
// Division of authority, unchanged by this file:
//   GitHub        durable bug ledger — issue state is the record
//   route()       routing authority — which slot executes, which reviews
//   git worktree  execution isolation
//   verify-task   deterministic gate, which outranks any reviewer
//   the executor  disposable; it holds no authority at all
//
// This adapter therefore contains no slot names, no vendor names, and no
// mechanism ids. It reads the issue, asks the router, and interprets the
// mechanism the router already named. Every effect — gh, git, subprocess,
// filesystem, lock — is injected, so the whole flow is testable offline.

import { checkAccountAuth } from "../route.mjs";
import {
  LABELS,
  buildPacket,
  buildReviewBrief,
  checkDispatchable,
  concludeRun,
  findByFingerprint,
  normalizeExecutorReport,
  renderComment,
} from "./issue-contract.mjs";
import { applyWorktreePlan, parseWorktreeList, planIssueWorktree } from "./worktree.mjs";

export class DispatchError extends Error {}

const DEFAULT_GATE_PROFILE = "harness";
const DEFAULT_CONTEXT = ["AGENTS.md", "CLAUDE.md", "harness/README.md", "docs/architecture/agent-harness.md"];
const RESULT_SCHEMA = 1;

const refuse = (code, reason) => ({ dispatched: false, code, reason, result: null });

// The launch line is data the mechanism declares, not syntax invented here.
export function launchArgv({ mechanism, role, model, effort, authProvider, prompt, sessionDir, worktree, runDir }) {
  const template = mechanism?.launch?.[role];
  if (!Array.isArray(template) || template.length === 0) {
    throw new DispatchError(`execution mechanism declares no ${role} launch argv; it cannot be started by guesswork`);
  }
  const values = { model, effort, authProvider, prompt, sessionDir, worktree, runDir };
  return template.map((token) =>
    token.replace(/\{(\w+)\}/g, (_, key) => {
      const value = values[key];
      if (value === undefined || value === null || value === "") {
        throw new DispatchError(`launch template needs {${key}}, which this route did not supply`);
      }
      return String(value);
    }),
  );
}

export async function dispatchIssue(number, io) {
  // The local lock guards two processes on one machine. GitHub remains the
  // durable claim; this is a race guard and nothing stronger.
  const lease = io.lock(number);
  if (!lease) return refuse("locked", `another local dispatcher already holds issue ${number}`);
  try {
    return await runDispatch(number, io);
  } finally {
    lease.release?.();
  }
}

async function runDispatch(number, io) {
  const { config } = io;
  const taskClasses = config.routing.taskClasses;
  const say = io.log ?? (() => {});

  const resolveRef = (ref) => {
    const answer = io.git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return answer?.status === 0 ? (answer.stdout ?? "").trim() || null : null;
  };
  const readIssue = () => checkDispatchable(io.gh.viewIssue(number), { taskClasses, resolveRef });

  const first = readIssue();
  if (!first.ok) return refuse(first.code, first.reason);
  const { machine, resolvedBaseSha } = first;
  const fingerprint = machine.fingerprint;

  const known = io.gh.repoLabels();
  const missing = Object.values(LABELS).filter((label) => !known.includes(label));
  if (missing.length) {
    return refuse("missing-label", `repository has no ${missing.join(", ")} — create the status labels before dispatching`);
  }

  // Exact fingerprint equality decides identity. A distinct mechanism is a
  // distinct issue, and an issue that duplicates an older one is not worked.
  const canonical = findByFingerprint(io.gh.listOpenIssues(), fingerprint);
  if (canonical && canonical.number !== number) {
    return refuse("duplicate-fingerprint", `fingerprint ${fingerprint} already belongs to open issue #${canonical.number}`);
  }

  let routed;
  try {
    routed = io.route({ taskClass: machine.task_class, available: io.available ?? null });
  } catch (err) {
    return refuse("unroutable", err.message);
  }
  const crew = [routed.primary, ...routed.reviewers];

  // Readiness is proved per routed slot, against that slot's own context. A
  // slot that is not ready blocks the run; the harness never substitutes a
  // mechanism whose execution is billed beyond the plan.
  for (const assignment of crew) {
    if (!assignment.runtimeAuth?.readinessCommand) continue;
    const answer = checkAccountAuth(assignment, { exists: io.exists, probe: io.probe });
    if (!answer.ready) return refuse("blocked", `${assignment.account} is not ready: ${answer.reason}`);
  }

  // Re-read immediately before claiming: everything above took time, and the
  // ledger may have moved under us.
  const again = readIssue();
  if (!again.ok) return refuse(again.code, again.reason);
  if (again.machine.fingerprint !== fingerprint) {
    return refuse("issue-changed", `fingerprint changed to ${again.machine.fingerprint} while routing`);
  }

  const gateProfile = machine.gate_profile ?? DEFAULT_GATE_PROFILE;
  const planned = io.spawn(["bash", "harness/verify-task.sh", gateProfile, "--plan"], {
    cwd: io.mainWorktree,
    role: "gate-plan",
  });
  if (planned?.status !== 0) return refuse("unknown-gate-profile", `the gate rejected profile ${gateProfile}`);

  // A dry run stops here, one step short of the first mutation: everything
  // above is a read, so it proves parsing and routing against the real ledger
  // without claiming an issue or starting anything.
  if (io.dryRun) {
    return {
      dispatched: false,
      code: "dry-run",
      reason: `issue ${number} is dispatchable`,
      result: null,
      preview: {
        taskClass: routed.taskClass,
        fingerprint,
        resolvedBaseSha,
        gateProfile,
        primaryAccount: routed.primary.account,
        primaryExecution: routed.primary.execution,
        reviewerAccount: routed.reviewers[0]?.account ?? null,
        reviewersRequired: routed.verification.reviewers,
      },
    };
  }

  io.gh.setLabels(number, { add: [LABELS.working], remove: [LABELS.ready] });
  const issue = io.gh.viewIssue(number);
  const runId = `issue-${number}-attempt-${String(io.nextAttempt ? io.nextAttempt(number) : 1).padStart(2, "0")}`;
  say(`${runId}: ${routed.primary.account} via ${routed.primary.execution}`);

  const plan = applyWorktreePlan(
    planIssueWorktree({
      number,
      title: issue.title,
      baseSha: resolvedBaseSha,
      mainWorktree: io.mainWorktree,
      worktrees: parseWorktreeList(io.git(["worktree", "list", "--porcelain"]).stdout),
      branchExists: (branch) => io.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])?.status === 0,
      pathExists: io.pathExists ?? io.exists,
      realPath: io.realPath,
      dirty: false,
    }),
    { git: io.git },
  );
  const startingHead = (io.git(["-C", plan.path, "rev-parse", "HEAD"]).stdout ?? "").trim() || resolvedBaseSha;

  const mechanismOf = (assignment) => config.routing.executionMechanisms[assignment.execution];
  const runDir = `${io.runsDir}/${runId}`;
  const reportPath = (role) => `${runDir}/report-${role}.json`;
  const start = (assignment, role, prompt) =>
    io.spawn(
      launchArgv({
        mechanism: mechanismOf(assignment),
        role,
        model: assignment.model,
        effort: routed.effort,
        authProvider: assignment.runtimeAuth?.provider,
        prompt,
        sessionDir: `${runDir}/session-${role}`,
        worktree: plan.path,
        runDir,
      }),
      { cwd: plan.path, env: assignment.runtimeAuth?.env ?? {}, role, account: assignment.account, runId, runDir },
    );

  const launched = start(
    routed.primary,
    "executor",
    buildPacket({
      issue,
      machine,
      resolvedBaseSha,
      worktree: plan.path,
      runId,
      taskClass: routed.taskClass,
      gateProfile,
      reportPath: reportPath("executor"),
      contextPaths: machine.context_paths ? machine.context_paths.split(",").map((s) => s.trim()) : DEFAULT_CONTEXT,
    }),
  );

  // An unreadable or contract-violating report is an INTERRUPTED run, never a
  // fix: the ledger records that the attempt happened and why it did not count.
  let reported;
  try {
    const raw = io.readReport(runId, "executor");
    reported = normalizeExecutorReport(
      raw ?? { result: "INTERRUPTED", notes: `executor exited ${launched?.status ?? "?"} without a report` },
      { fingerprint, role: "executor" },
    );
  } catch (err) {
    reported = normalizeExecutorReport(
      { result: "INTERRUPTED", notes: `report rejected: ${err.message}` },
      { fingerprint, role: "executor" },
    );
  }

  const gate = io.spawn(["bash", "harness/verify-task.sh", gateProfile], { cwd: plan.path, role: "gate" });
  const gateResult = gate?.status === 0 ? "PASS" : "FAIL";

  const reviewer = routed.reviewers[0] ?? null;
  let reviewVerdict = null;
  if (reviewer && reported.result === "FIX_PROPOSED" && gateResult === "PASS") {
    start(
      reviewer,
      "reviewer",
      buildReviewBrief({
        issue,
        machine,
        resolvedBaseSha,
        worktree: plan.path,
        diff: (io.git(["-C", plan.path, "diff", resolvedBaseSha]).stdout ?? "").slice(0, 60000),
        gateOutput: `${gate?.stdout ?? ""}${gate?.stderr ?? ""}`.slice(-4000),
        criteria: config.policy.criteria,
      }),
    );
    const verdict = io.readReport(runId, "reviewer")?.verdict;
    reviewVerdict = verdict === "PASS" || verdict === "FAIL" ? verdict : "NO_REPORT";
  }

  const concluded = concludeRun({
    reported,
    gateResult,
    reviewVerdict,
    reviewersRequired: routed.verification.reviewers,
  });

  const result = {
    schema: RESULT_SCHEMA,
    issue: number,
    fingerprint,
    runId,
    taskClass: routed.taskClass,
    effort: routed.effort,
    baseRef: machine.base_ref,
    resolvedBaseSha,
    startingHead,
    worktree: plan.path,
    branch: plan.branch,
    worktreeAction: plan.action,
    primaryAccount: routed.primary.account,
    primaryExecution: routed.primary.execution,
    primaryRuntime: routed.primary.runtime,
    reviewerAccount: reviewer?.account ?? null,
    reviewerExecution: reviewer?.execution ?? null,
    behavioralRed: reported.behavioralRed,
    commitSha: reported.commitSha,
    tests: reported.tests,
    notes: reported.notes,
    newBugs: reported.newBugs,
    gateProfile,
    gateResult,
    reviewVerdict,
    result: concluded.result,
    nextStatus: concluded.nextStatus,
  };

  // Durable machine-readable record first; only then tell the ledger.
  io.writeResult(runId, result);
  io.gh.comment(number, renderComment(result));
  io.gh.setLabels(number, { add: [result.nextStatus], remove: [LABELS.working] });
  say(`${runId}: ${result.result} → ${result.nextStatus}`);

  return { dispatched: true, code: "ran", reason: null, result };
}
