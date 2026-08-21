// The GitHub adapter for the attempt lifecycle.
//
// Division of authority, unchanged by this file:
//   GitHub        durable bug ledger — issue state is the record
//   route()       routing authority — which slot executes, which reviews
//   runAttempt()  the execution lifecycle — workspace, gate, evidence, review
//   verify-task   deterministic gate, which outranks any reviewer
//   the executor  disposable; it holds no authority at all
//
// The dependency direction is one way. This file reads an issue, builds a Task,
// claims it, hands that Task to runAttempt(), and reports the Attempt back onto
// the ledger. runAttempt() knows nothing about any of that: it never sees gh,
// an issue number, or a label. Everything GitHub-shaped — argv for gh, the
// machine block, fingerprint dedupe, labels, comments, the claim and the
// hand-back — lives here and nowhere below.

import { checkAccountAuth } from "../route.mjs";
import {
  AttemptError,
  classifyGatePreflight,
  gatePlanArgv,
  runAttempt,
} from "../run/attempt.mjs";
import { slugFor } from "../run/workspace.mjs";
import {
  LABELS,
  STATUS_FOR_DISPOSITION,
  buildPacket,
  buildReviewBrief,
  checkDispatchable,
  findByFingerprint,
  normalizeExecutorReport,
  renderComment,
} from "./issue-contract.mjs";

export class DispatchError extends Error {}

// Raised when a run failed AND the attempt to hand the issue back also failed.
// It carries both facts, because reporting only one of them would either hide
// the defect or falsely claim the ledger is healthy.
export class DispatchRecoveryError extends Error {}

const DEFAULT_GATE_PROFILE = "harness";
// Stable repository instruction, plus the procedure for the role — and nothing
// operator-level. harness/README.md and docs/architecture/agent-harness.md are
// dispatcher documentation: an executor fixing a defect in its own workspace
// needs neither, and CLAUDE.md already says to load the latter only when the
// task is about the harness itself. An issue that genuinely is about the
// harness says so in its own context_paths.
//
// The skill is named by path rather than left to discovery: the executor runs
// as a fresh process in a worktree, and a skill it is told to find is a skill
// it may not load.
const DEFAULT_CONTEXT = ["AGENTS.md", "CLAUDE.md", ".agents/skills/mayhem-task/SKILL.md"];

// The fields every derivation above the claim is made from: the route reads
// task_class, the gate preflight reads gate_profile, dedupe and the report
// contract read fingerprint, and the workspace is cut from base_ref. If one of
// them moves between the read that fed those derivations and the claim, they
// describe work the ledger no longer asks for. Everything else in the machine
// block — context_paths among them — feeds nothing above and is simply taken
// from the validated snapshot.
//
// What base_ref *resolves to* is deliberately not on this list. Nothing above
// the claim is derived from the sha, so a branch that advanced while routing
// invalidates nothing: the run is cut from the newer base it just validated.
// Refusing there would stop every dispatch that raced a push, and buy nothing.
const TASK_CONTRACT = ["fingerprint", "task_class", "base_ref", "gate_profile"];

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

// One GitHub issue, read as the authoritative statement of the work. Identity
// is the immutable issue number; the slug is decoration from a title a human
// may edit at any moment, and never decides anything.
function taskFromIssue({ issue, machine, resolvedBaseSha, taskClass, attemptId }) {
  return {
    id: `github-issue-${issue.number}`,
    attemptId,
    identity: { kind: "issue", id: issue.number, slug: slugFor(issue.title) },
    title: issue.title,
    url: issue.url,
    spec: issue.body,
    fingerprint: machine.fingerprint,
    taskClass,
    baseRef: machine.base_ref,
    resolvedBaseSha,
    gateProfile: machine.gate_profile ?? DEFAULT_GATE_PROFILE,
    contextPaths: machine.context_paths ? machine.context_paths.split(",").map((s) => s.trim()) : DEFAULT_CONTEXT,
  };
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
  // The snapshot checkDispatchable actually validated is kept, not discarded:
  // the body an executor is handed as the spec has to be the body that was
  // approved, and a later re-read is a different issue nobody checked.
  const readIssue = () => {
    const issue = io.gh.viewIssue(number);
    return { ...checkDispatchable(issue, { taskClasses, resolveRef }), issue };
  };

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
  // ledger may have moved under us. This snapshot is the Task from here on, so
  // what runs is the version that was validated — but the route above was
  // decided from the first one, and the gate preflight below is planned from
  // it, so a contract that moved has invalidated both and the run starts over.
  const again = readIssue();
  if (!again.ok) return refuse(again.code, again.reason);
  const moved = TASK_CONTRACT.filter((field) => again.machine[field] !== machine[field]);
  if (moved.length) {
    return refuse("issue-changed", `${moved.join(", ")} changed while routing`);
  }

  // Proved against the checkout this dispatcher is running out of, not
  // io.mainWorktree: that one is where issue worktrees are placed and where git
  // runs, and it can sit on any branch — including one that carries no harness
  // at all, where every profile looks rejected.
  const gateProfile = again.machine.gate_profile ?? DEFAULT_GATE_PROFILE;
  const preflight = classifyGatePreflight(
    io.spawn(gatePlanArgv(gateProfile), { cwd: io.harnessRoot, role: "gate-plan" }),
    gateProfile,
  );
  if (!preflight.ok) return refuse(preflight.code, preflight.reason);

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

  // One snapshot, validated, and nothing read again: the spec, the title the
  // slug is cut from, and the machine block are all `again`.
  const { issue, machine: contract } = again;
  const runId = `issue-${number}-attempt-${String(io.nextAttempt ? io.nextAttempt(number) : 1).padStart(2, "0")}`;
  const task = taskFromIssue({
    issue,
    machine: contract,
    resolvedBaseSha: again.resolvedBaseSha,
    taskClass: routed.taskClass,
    attemptId: runId,
  });

  // The execution plan the router already decided, plus the one lookup that
  // turns an assignment into the argv template it declares.
  const plan = {
    effort: routed.effort,
    primary: routed.primary,
    reviewers: routed.reviewers,
    verification: routed.verification,
    mechanismOf: (assignment) => config.routing.executionMechanisms[assignment.execution],
  };

  // Wording is this adapter's business; the lifecycle only needs the shape.
  const attemptIo = {
    ...io,
    normalizeReport: (raw) => normalizeExecutorReport(raw, { fingerprint, role: "executor" }),
    buildPacket: (args) => buildPacket({ ...args, issue, machine: contract }),
    buildReviewBrief: (args) => buildReviewBrief({ ...args, issue, machine: contract, criteria: config.policy.criteria }),
  };

  // Everything above this line is a read. From here the issue is ours, and
  // every exit below — including an unexpected one — has to hand it back.
  io.gh.setLabels(number, { add: [LABELS.working], remove: [LABELS.ready] });
  say(`${runId}: ${routed.primary.account} via ${routed.primary.execution}`);

  let stage = "attempt";
  let record = { issue: number, runId, nextStatus: null, result: null, errorClass: null, errorMessage: null };
  try {
    record = { ...record, ...(await runAttempt(task, plan, attemptIo)) };
    record.issue = number;
    record.runId = runId;
    record.nextStatus = STATUS_FOR_DISPOSITION[record.disposition];
    if (!record.nextStatus) throw new DispatchError(`the attempt concluded ${record.disposition}, which is not a ledger status`);

    // Durable machine-readable record first; only then tell the ledger.
    stage = "result-write";
    io.writeResult(runId, record);

    stage = "github-report";
    io.gh.comment(number, renderComment(record));
    io.gh.setLabels(number, { add: [record.nextStatus], remove: [LABELS.working] });
    say(`${runId}: ${record.result} → ${record.nextStatus}`);

    return { dispatched: true, code: "ran", reason: null, result: record };
  } catch (err) {
    // Whatever the attempt established before it failed is still evidence.
    record = { ...record, ...(err.attempt ?? {}), issue: number, runId };
    return recoverClaim(err, { io, number, record, stage: err.stage ?? stage, say });
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
  // Nothing concluded means the attempt was interrupted. Something that did
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

export { AttemptError, classifyGatePreflight };
