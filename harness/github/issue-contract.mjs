// The GitHub issue contract: what makes an issue a dispatchable task record,
// and what makes an executor's report acceptable.
//
// GitHub is the durable ledger; this module is the reader. It owns no state,
// performs no I/O, and never calls a model: every decision here is a pure
// function of the issue text plus facts the caller supplies (the router's task
// classes, whether a ref resolves locally). Anything it cannot decide from
// those is a refusal, never a guess.

import { concludeAttempt } from "../run/attempt.mjs";

export class ContractError extends Error {}

export const SUPPORTED_SCHEMA = 1;

// A closed vocabulary. An executor that answers outside it has not answered.
export const RESULTS = ["FIX_PROPOSED", "NEEDS_EVIDENCE", "BLOCKED", "INTERRUPTED", "GATE_PASSED", "VERIFIED"];

// Results the run concludes from evidence the executor does not own, and which
// an executor therefore may not report about itself.
//
// GATE_PASSED and VERIFIED are deliberately different claims. GATE_PASSED says
// the requested deterministic profile passed on a mechanically verified commit
// — nothing more, and in particular nothing about the suites that profile did
// not run. VERIFIED additionally says the verification policy for this risk
// level was satisfied by an independent reviewer. Before this split every
// gate pass was recorded as VERIFIED, so a schema-1 record reading VERIFIED
// may mean either; schema 2 onward, it means only the second.
export const CONCLUDED_ONLY = ["GATE_PASSED", "VERIFIED"];

// Labels are state on the ledger, not a replacement for issue structure.
export const LABELS = {
  needsEvidence: "status:needs-evidence",
  ready: "status:ready-for-agent",
  working: "status:agent-working",
  needsReview: "status:needs-review",
  needsHuman: "status:needs-human",
  verified: "status:verified",
  blocked: "status:blocked",
};

const BLOCK = /<!--\s*mayhem-agent\b([\s\S]*?)-->/g;
const FIELD = /^([a-z][a-z0-9_]*)\s*:\s*(.*)$/;
const FINGERPRINT = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const SHA = /^[0-9a-f]{40}$/;

// A RED that only proves the scaffolding is incomplete proves nothing about
// the defect. These are the shapes that masquerade as reproduction.
const NOT_A_REPRODUCTION = [
  [/ERR_MODULE_NOT_FOUND|cannot find module|module not found|could not resolve/i, "the module under test does not exist yet"],
  [/\bSyntaxError\b|unexpected token/i, "a syntax error in new scaffolding"],
  [/\bENOENT\b|no such file or directory/i, "a missing file or fixture"],
  [/\bReferenceError\b|\bis not defined\b/i, "an undefined reference in new scaffolding"],
  [/\bImportError\b|\bModuleNotFoundError\b/i, "an unresolved import"],
];

export function parseMachineBlock(body) {
  const found = [...String(body ?? "").matchAll(BLOCK)];
  if (found.length === 0) return null;
  if (found.length > 1) {
    throw new ContractError(`issue carries ${found.length} mayhem-agent blocks; exactly one is the task record`);
  }
  const fields = {};
  for (const line of found[0][1].split("\n")) {
    const m = line.trim().match(FIELD);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

const has = (issue, label) => (issue?.labels ?? []).some((l) => (l.name ?? l) === label);
const no = (code, reason) => ({ ok: false, code, reason });

// Dispatch conditions, in the order that keeps the reason honest: a closed
// issue is closed whatever its labels still say, and an issue another
// dispatcher already claimed is claimed even if it is still labelled ready.
export function checkDispatchable(issue, { taskClasses, resolveRef, gateProfiles = null } = {}) {
  if (!issue) return no("no-issue", "no issue was read");
  if (issue.state !== "OPEN") return no("not-open", `issue is ${issue.state}, not OPEN`);
  if (has(issue, LABELS.working)) {
    return no("already-claimed", `issue carries ${LABELS.working}; another executor holds it`);
  }
  if (!has(issue, LABELS.ready)) return no("not-ready", `issue does not carry ${LABELS.ready}`);

  let machine;
  try {
    machine = parseMachineBlock(issue.body);
  } catch (err) {
    return no("ambiguous-machine-block", err.message);
  }
  if (!machine) return no("no-machine-block", "issue carries no <!-- mayhem-agent --> block");

  if (Number(machine.schema) !== SUPPORTED_SCHEMA) {
    return no("unsupported-schema", `schema ${JSON.stringify(machine.schema ?? null)} is not ${SUPPORTED_SCHEMA}`);
  }
  const fingerprint = (machine.fingerprint ?? "").trim();
  if (!fingerprint) return no("missing-fingerprint", "the machine block declares no fingerprint");
  if (!FINGERPRINT.test(fingerprint)) {
    return no("invalid-fingerprint", `fingerprint ${JSON.stringify(fingerprint)} is not a stable identifier`);
  }
  // V1 never infers a class with a model: the router's own table decides.
  const taskClass = (machine.task_class ?? "").trim();
  if (!taskClass || !taskClasses?.[taskClass]) {
    return no(
      "unknown-task-class",
      `task_class ${JSON.stringify(taskClass || null)} is not one of ${Object.keys(taskClasses ?? {}).join(", ")}`,
    );
  }
  const baseRef = (machine.base_ref ?? "").trim();
  const resolved = baseRef ? resolveRef(baseRef) : null;
  if (!resolved) return no("unresolved-base-ref", `base_ref ${JSON.stringify(baseRef || null)} does not resolve locally`);

  const gateProfile = (machine.gate_profile ?? "").trim() || null;
  if (gateProfile && gateProfiles && !gateProfiles.includes(gateProfile)) {
    return no("unknown-gate-profile", `gate_profile ${JSON.stringify(gateProfile)} is not a known profile`);
  }

  return {
    ok: true,
    machine: { ...machine, schema: SUPPORTED_SCHEMA, fingerprint, task_class: taskClass, base_ref: baseRef, gate_profile: gateProfile },
    resolvedBaseSha: resolved,
  };
}

// Exact equality, nothing else. A near-miss is a different defect until a human
// says otherwise; silently absorbing it is how one issue becomes a landfill.
export function findByFingerprint(openIssues, fingerprint) {
  const wanted = String(fingerprint ?? "").trim();
  if (!wanted) return null;
  for (const issue of openIssues ?? []) {
    let machine = null;
    try {
      machine = parseMachineBlock(issue.body);
    } catch {
      continue;
    }
    if ((machine?.fingerprint ?? "").trim() === wanted) return issue;
  }
  return null;
}

export function classifyBehavioralRed(text) {
  const red = String(text ?? "").trim();
  if (red.length < 20) return { valid: false, reason: "no reproduction was described" };
  for (const [pattern, reason] of NOT_A_REPRODUCTION) {
    if (pattern.test(red)) return { valid: false, reason: `${reason} — that is scaffolding, not behavior` };
  }
  return { valid: true, reason: null };
}

export function normalizeExecutorReport(raw, { fingerprint, role = "executor" } = {}) {
  if (!raw || typeof raw !== "object") throw new ContractError("executor produced no result object");
  if (typeof raw.result !== "string" || !RESULTS.includes(raw.result)) {
    throw new ContractError(
      `result ${JSON.stringify(raw.result ?? null)} is outside the vocabulary (${RESULTS.join(", ")})`,
    );
  }
  if (role === "executor" && CONCLUDED_ONLY.includes(raw.result)) {
    throw new ContractError(
      `an executor cannot mark its own work ${raw.result}; that is concluded from evidence it does not own`,
    );
  }

  const behavioralRed = typeof raw.behavioralRed === "string" ? raw.behavioralRed.trim() : "";
  if (raw.result === "FIX_PROPOSED") {
    const verdict = classifyBehavioralRed(behavioralRed);
    if (!verdict.valid) {
      throw new ContractError(`FIX_PROPOSED without a behavioral RED: ${verdict.reason}`);
    }
    if (!SHA.test(String(raw.commitSha ?? ""))) {
      throw new ContractError(`FIX_PROPOSED without a full commit sha (got ${JSON.stringify(raw.commitSha ?? null)})`);
    }
  }

  // A second failure mechanism found mid-slice is a new issue, never a wider
  // one. Re-using this issue's fingerprint for it IS the scope expansion.
  const newBugs = [];
  for (const bug of raw.newBugs ?? []) {
    const bugPrint = String(bug?.fingerprint ?? "").trim();
    if (!bugPrint || !FINGERPRINT.test(bugPrint)) {
      throw new ContractError(`NEW_BUG_DISCOVERED without a usable fingerprint (${JSON.stringify(bug?.fingerprint ?? null)})`);
    }
    if (bugPrint === fingerprint) {
      throw new ContractError(
        `NEW_BUG_DISCOVERED reuses this issue's fingerprint (${fingerprint}); a distinct mechanism needs a distinct issue`,
      );
    }
    if (!String(bug?.title ?? "").trim()) throw new ContractError("NEW_BUG_DISCOVERED without a title");
    newBugs.push({ fingerprint: bugPrint, title: String(bug.title).trim(), summary: String(bug.summary ?? "").trim() });
  }

  return {
    result: raw.result,
    fingerprint,
    behavioralRed: behavioralRed || null,
    commitSha: SHA.test(String(raw.commitSha ?? "")) ? raw.commitSha : null,
    tests: Array.isArray(raw.tests) ? raw.tests.map(String) : [],
    notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    newBugs,
  };
}

// The one place a generic attempt disposition becomes a state on this ledger.
// The lifecycle concludes what was established; GitHub decides what to call it.
export const STATUS_FOR_DISPOSITION = {
  accepted: LABELS.verified,
  "needs-review": LABELS.needsReview,
  "needs-human": LABELS.needsHuman,
  "needs-evidence": LABELS.needsEvidence,
  blocked: LABELS.blocked,
};

// Kept for callers that want the ledger status alongside the conclusion.
export function concludeRun(args) {
  const concluded = concludeAttempt(args);
  return { ...concluded, nextStatus: STATUS_FOR_DISPOSITION[concluded.disposition] };
}

const short = (sha) => (sha ? String(sha).slice(0, 12) : "-");

// Compact by policy: the issue is a ledger, not a log sink. Full evidence
// stays in the run's result JSON on the machine that produced it.
export function renderComment(result) {
  return [
    `RUN_ID=${result.runId}`,
    `EXECUTOR=${result.primaryAccount}`,
    `BASE=${short(result.resolvedBaseSha)}`,
    `RESULT=${result.result}`,
    ...(result.failureStage
      ? [`FAILED_AT=${result.failureStage} (${result.errorClass}: ${String(result.errorMessage ?? "").slice(0, 160)})`]
      : []),
    `RED=${result.behavioralRed ? "PASS" : "NONE"}`,
    `TESTS=${result.tests.length}`,
    `GATE=${result.gateResult} (${result.gateProfile})`,
    ...(result.gateCoverage?.notCovered?.length ? [`NOT_COVERED=${result.gateCoverage.notCovered.join(",")}`] : []),
    `REVIEW=${result.reviewVerdict ?? "NOT_REQUIRED"}${result.reviewerAccount ? ` by ${result.reviewerAccount}` : ""}`,
    `COMMIT=${short(result.commitSha)} ${result.commitEvidence?.ok ? "(git-verified)" : `(UNVERIFIED: ${result.commitEvidence?.code ?? "not checked"})`}`,
    ...(result.completionLevel ? [`LEVEL=${result.completionLevel}`] : []),
    `WORKSPACE=${result.workspace}`,
    `NEXT=${result.nextStatus}`,
    ...(result.newBugs?.length
      ? [`NEW_BUG_DISCOVERED=${result.newBugs.map((b) => b.fingerprint).join(",")} (file separately; not fixed here)`]
      : []),
  ].join("\n");
}

// The bounded packet an executor receives instead of a transcript. Everything
// it may do, and everything it may not, is stated here.
export function buildPacket({ issue, machine, task, attemptId, workspace, reportPath }) {
  return `# Issue ${issue.number} — ${issue.title}

RUN_ID: ${attemptId}
ISSUE_URL: ${task.url}
FINGERPRINT: ${task.fingerprint}
TASK_CLASS: ${task.taskClass}
BASE_REF: ${task.baseRef}
RESOLVED_BASE_SHA: ${task.resolvedBaseSha}
WORKTREE: ${workspace}

## ISSUE BODY (verbatim; the authoritative statement of the defect)

${task.spec}

## REQUIRED CONTEXT

${task.contextPaths.map((p) => `- ${p}`).join("\n")}

## ACCEPTANCE

1. Reproduce first. Produce a **behavioral RED**: an existing-behavior failure
   that violates this issue's acceptance contract. A missing module, an
   unwritten file, a scaffolding syntax error, or a missing fixture is NOT a
   behavioral RED. If you cannot establish reproduction, the result is
   NEEDS_EVIDENCE — "could not reproduce" never becomes a fix.
2. Make the RED go green with the smallest change that meets the contract.
3. Run the deterministic gate: \`bash harness/verify-task.sh ${task.gateProfile}\`.
4. Commit on this worktree's branch only.

## ALLOWED

- Read anything in the repository.
- Write inside ${workspace}.
- Create tests; modify in-scope code; commit on the issue branch.
- Run deterministic gates.
- Write the result JSON to ${reportPath}.

## FORBIDDEN

- merge, tag, push, or any change to a remote.
- Reading, printing, or storing credentials or secrets.
- Touching any other worktree, or the control worktree.
- Fixing an unrelated defect you happen to find. Scope growth is a stop.

## IF YOU FIND AN INDEPENDENT BUG

Do not fix it. Add it to the report as \`newBugs: [{fingerprint, title, summary}]\`
with its **own** fingerprint. Re-using ${task.fingerprint} is rejected.

## RETURN FORMAT — write exactly this JSON to ${reportPath}

\`\`\`json
{
  "result": "FIX_PROPOSED | NEEDS_EVIDENCE | BLOCKED | INTERRUPTED",
  "behavioralRed": "the observed contract violation, with file:line",
  "commitSha": "<40-hex sha of your commit, required for FIX_PROPOSED>",
  "tests": ["path/to/the/red/test"],
  "notes": "one or two sentences",
  "newBugs": []
}
\`\`\`

Your commitSha is checked against git: it must exist, descend from the head
this attempt started at, be the workspace head the gate ran on, and change at
least one file. Neither GATE_PASSED nor VERIFIED is yours to claim — both are
concluded from evidence you do not own.
`;
}

// The read-only reviewer brief. It deliberately carries no executor reasoning
// transcript — only the spec, the fixed-point diff, the gate output, and the
// invariants — per harness/config/verification-policy.json.
export function buildReviewBrief({ issue, task, commitSha, startingHead, diff, gateOutput, criteria, workspace }) {
  return `# Independent review — issue ${issue.number}

You are a READ-ONLY reviewer. ${workspace} is a detached checkout of the commit
under review, not the workspace that produced it; you may not modify it, and
you may not fix a finding you raise. You have not been given the executor's
reasoning, its session, or its worktree.

FINGERPRINT: ${task.fingerprint}
BASE: ${startingHead}
COMMIT UNDER REVIEW: ${commitSha} (existence and ancestry established by git)

## SPEC (the issue, verbatim)

${task.spec}

## FIXED-POINT DIFF

\`\`\`diff
${diff}
\`\`\`

## DETERMINISTIC GATE OUTPUT

\`\`\`
${gateOutput}
\`\`\`

## CRITERIA

${criteria.map((c) => `- ${c}`).join("\n")}

Each finding carries CLAIM / EVIDENCE / SEVERITY / CONFIDENCE / VIOLATED_INVARIANT.
"Looks good" is not a review. The deterministic gate outranks your judgement.

## RETURN FORMAT

You run read-only and can write nothing, so your verdict is your final output.
End your response with exactly this JSON object and nothing after it:

\`\`\`json
{ "verdict": "PASS | FAIL", "findings": [] }
\`\`\`
`;
}
