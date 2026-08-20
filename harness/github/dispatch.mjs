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

// Raised when a run failed AND the attempt to hand the issue back also failed.
// It carries both facts, because reporting only one of them would either hide
// the defect or falsely claim the ledger is healthy.
export class DispatchRecoveryError extends Error {}

const DEFAULT_GATE_PROFILE = "harness";
const DEFAULT_CONTEXT = ["AGENTS.md", "CLAUDE.md", "harness/README.md", "docs/architecture/agent-harness.md"];
const RESULT_SCHEMA = 1;

const refuse = (code, reason) => ({ dispatched: false, code, reason, result: null });

// Durable evidence records what failed, never a stack trace and never anything
// token-shaped: a run's own error text is the one place a credential could
// leak into a file or an issue comment.
const TOKEN_SHAPES = [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, /\bsk-[A-Za-z0-9_-]{16,}\b/g];
function redact(text) {
  let clean = String(text ?? "");
  for (const shape of TOKEN_SHAPES) clean = clean.replace(shape, "[redacted]");
  return clean.slice(0, 500);
}

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

  const issue = io.gh.viewIssue(number);
  const runId = `issue-${number}-attempt-${String(io.nextAttempt ? io.nextAttempt(number) : 1).padStart(2, "0")}`;
  const reviewer = routed.reviewers[0] ?? null;

  // One mutable record, so the evidence a failed run leaves behind and the
  // result a finished run reports are the same object with the same schema.
  const record = {
    schema: RESULT_SCHEMA,
    issue: number,
    fingerprint,
    runId,
    taskClass: routed.taskClass,
    effort: routed.effort,
    baseRef: machine.base_ref,
    resolvedBaseSha,
    startingHead: null,
    worktree: null,
    branch: null,
    worktreeAction: null,
    primaryAccount: routed.primary.account,
    primaryExecution: routed.primary.execution,
    primaryRuntime: routed.primary.runtime,
    reviewerAccount: reviewer?.account ?? null,
    reviewerExecution: reviewer?.execution ?? null,
    behavioralRed: null,
    commitSha: null,
    tests: [],
    notes: "",
    newBugs: [],
    gateProfile,
    gateResult: null,
    reviewVerdict: null,
    result: null,
    nextStatus: null,
    failureStage: null,
    errorClass: null,
    errorMessage: null,
  };

  // Everything above this line is a read. From here the issue is ours, and
  // every exit below — including an unexpected one — has to hand it back.
  io.gh.setLabels(number, { add: [LABELS.working], remove: [LABELS.ready] });
  say(`${runId}: ${routed.primary.account} via ${routed.primary.execution}`);

  let stage = "worktree";
  try {
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
    record.worktree = plan.path;
    record.branch = plan.branch;
    record.worktreeAction = plan.action;

    stage = "base-head";
    record.startingHead = (io.git(["-C", plan.path, "rev-parse", "HEAD"]).stdout ?? "").trim() || resolvedBaseSha;

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

    stage = "executor-launch";
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
    stage = "executor-report";
    let reported;
    try {
      const raw = io.readReport(runId, "executor");
      reported = normalizeExecutorReport(
        raw ?? { result: "INTERRUPTED", notes: `executor exited ${launched?.status ?? "?"} without a report` },
        { fingerprint, role: "executor" },
      );
    } catch (err) {
      reported = normalizeExecutorReport(
        { result: "INTERRUPTED", notes: `report rejected: ${redact(err.message)}` },
        { fingerprint, role: "executor" },
      );
    }
    record.behavioralRed = reported.behavioralRed;
    record.commitSha = reported.commitSha;
    record.tests = reported.tests;
    record.notes = reported.notes;
    record.newBugs = reported.newBugs;

    stage = "gate";
    const gate = io.spawn(["bash", "harness/verify-task.sh", gateProfile], { cwd: plan.path, role: "gate" });
    record.gateResult = gate?.status === 0 ? "PASS" : "FAIL";

    stage = "review";
    if (reviewer && reported.result === "FIX_PROPOSED" && record.gateResult === "PASS") {
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
      record.reviewVerdict = verdict === "PASS" || verdict === "FAIL" ? verdict : "NO_REPORT";
    }

    stage = "conclude";
    const concluded = concludeRun({
      reported,
      gateResult: record.gateResult,
      reviewVerdict: record.reviewVerdict,
      reviewersRequired: routed.verification.reviewers,
    });
    record.result = concluded.result;
    record.nextStatus = concluded.nextStatus;

    // Durable machine-readable record first; only then tell the ledger.
    stage = "result-write";
    io.writeResult(runId, record);

    stage = "github-report";
    io.gh.comment(number, renderComment(record));
    io.gh.setLabels(number, { add: [record.nextStatus], remove: [LABELS.working] });
    say(`${runId}: ${record.result} → ${record.nextStatus}`);

    return { dispatched: true, code: "ran", reason: null, result: record };
  } catch (err) {
    return recoverClaim(err, { io, number, record, stage, say });
  }
}

// One deterministic recovery state, not a state machine. A claim this process
// took and could not finish is handed back as status:blocked, which says the
// run can be retried once the mechanical failure is fixed; status:needs-human
// is reserved for cases the dispatcher can actually establish need one, and a
// generic exception is not such a case. Each action is attempted exactly once:
// retrying here would turn a broken ledger into a broken ledger plus a loop.
//
// This covers failures inside the dispatcher's own control flow. It does NOT
// cover process death, SIGKILL, or power loss — those still strand the claim,
// and reconciling them needs a watchdog this deliberately does not build.
function recoverClaim(err, { io, number, record, stage, say }) {
  record.failureStage = stage;
  record.errorClass = err?.name ?? "Error";
  record.errorMessage = redact(err?.message ?? String(err));
  // Nothing concluded means the run was interrupted. Something that did
  // conclude keeps its conclusion — but an undelivered conclusion is not a
  // delivered one, so the issue still goes back as blocked either way.
  if (record.result === null) record.result = "INTERRUPTED";
  record.nextStatus = LABELS.blocked;

  const recovery = { result: "WRITTEN", labels: "RECOVERED", comment: "POSTED" };
  try {
    io.writeResult(record.runId, record);
  } catch (writeErr) {
    recovery.result = `FAILED: ${redact(writeErr.message)}`;
  }

  // The label matters more than the comment: an issue left at agent-working is
  // invisible, so it is repaired first and its failure is fatal.
  try {
    io.gh.setLabels(number, { add: [LABELS.blocked], remove: [LABELS.working] });
  } catch (labelErr) {
    const stranded = new DispatchRecoveryError(
      `issue ${number} failed at ${stage} (${record.errorClass}: ${record.errorMessage}) ` +
        `and could not be handed back: ${redact(labelErr.message)}. ` +
        `The issue is still ${LABELS.working} and needs a human.`,
    );
    stranded.recovered = false;
    stranded.cause = err;
    stranded.recoveryError = labelErr;
    stranded.result = record;
    stranded.recovery = { ...recovery, labels: `FAILED: ${redact(labelErr.message)}` };
    throw stranded;
  }

  try {
    io.gh.comment(number, renderComment(record));
  } catch (commentErr) {
    recovery.comment = `FAILED: ${redact(commentErr.message)}`;
  }

  say(`${record.runId}: ${record.result} → ${record.nextStatus} (recovered from ${stage})`);
  return { dispatched: true, code: "interrupted", reason: record.errorMessage, result: record, recovery };
}
