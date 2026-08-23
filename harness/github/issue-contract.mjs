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
export const RESULTS = ["FIX_PROPOSED", "NEEDS_EVIDENCE", "BLOCKED", "INTERRUPTED", "GATE_PASSED", "VERIFIED", "INVALID_DISPOSITION"];

// Results the run concludes from evidence the executor does not own, and which
// an executor therefore may not report about itself.
//
// GATE_PASSED and VERIFIED are deliberately different claims. GATE_PASSED says
// the requested deterministic profile passed on a mechanically verified commit
// — nothing more, and in particular nothing about the suites that profile did
// not run. VERIFIED additionally says the verification policy for this risk
// level was satisfied — by every reviewer it asked for, not merely by one of
// them. Before this split every gate pass was recorded as VERIFIED, so a
// schema-1 record reading VERIFIED may mean either; schema 2 onward, it means
// only the second.
//
// The split is visible in the comment's RESULT= line, which is where a human
// reads it. Both still map to the same `status:verified` label, because the
// label drives an existing ledger workflow and splitting it is a change to that
// workflow rather than to this vocabulary. Do not read the label as the
// distinction.
//
// INVALID_DISPOSITION joins them from the other end. It is what the controller
// concludes when no eligible executor produced an answer the contract accepts:
// the work is executor-incomplete, and saying so is not the executor's to say.
// It exists so that "the agent did not deliver" has a word of its own — reusing
// a human-blocked result for it is what let unfinished work read as a debt the
// operator owed.
//
// INTERRUPTED belongs to the controller for the same reason, arrived at from
// experience rather than from symmetry: it is the only result that owes nobody
// an explanation, so guarding NEEDS_EVIDENCE and BLOCKED left it as the last
// unguarded way to stop. An executor that got far enough to write a well-formed
// report was not interrupted — it stopped, which is a different fact. Whether an
// execution was interrupted is an observation about the runtime, and only the
// thing that ran the runtime can make it. So the word stays, and its owner
// changes; the controller synthesizes its own when it sees a runtime die.
export const CONCLUDED_ONLY = ["GATE_PASSED", "VERIFIED", "INVALID_DISPOSITION", "INTERRUPTED"];

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

// NEEDS_EVIDENCE is the only result that hands work back to a human: it moves
// the issue to status:needs-evidence, which says a person owes a fact before
// anyone can proceed. So it is a claim about a boundary outside the executor,
// never a report on how the executor's own investigation went.
//
// The rule exists because the other exits are guarded and this one was not.
// FIX_PROPOSED must carry a behavioral RED; BLOCKED and INTERRUPTED say the run
// stopped and claim nothing of anybody. That left NEEDS_EVIDENCE as the
// cheapest sentence in the vocabulary — an executor out of ideas could write it
// and the ledger would record the human as the blocker.
//
// The invariant is that obtaining the fact requires a boundary genuinely
// unavailable to the executor. What is closed is the *axis* that decides that —
// who or what holds the fact — not the vocabulary of boundaries. A real
// external condition must never be refused because nobody anticipated its noun,
// and a harness source change is not a reasonable price for one.
export const EXTERNAL_SOURCES = ["external-human", "external-system", "external-hardware"];

// Conditions seen often enough to be worth naming. These are a convenience and
// a source hint, never the world: externalCondition also takes any description
// concrete enough to act on, which is what keeps an unanticipated boundary
// representable without editing this file.
export const KNOWN_CONDITIONS = {
  "live-game": "external-human",
  "user-only-reproduction": "external-human",
  "credentials": "external-system",
  "account-state": "external-system",
  "production-system": "external-system",
  "physical-hardware": "external-hardware",
};

// The shapes that describe an unfinished investigation rather than a fact
// somebody could go and collect. Each of these is a real stop — the run ends
// and a human reads it — but the honest word for it is BLOCKED, not a bill sent
// to the operator. Screened on the named fact only: "no offline run reproduces
// it" is exactly what belongs in whyUnobtainable.
const NOT_A_MISSING_FACT = [
  [/\broot cause\b.{0,40}\b(not|unknown|unidentified|unclear)\b/i, "the root cause is not yet known"],
  [/\b(more|further|additional)\b.{0,30}\binvestigat/i, "the investigation is unfinished"],
  [/\binvestigation\b.{0,30}\b(required|needed|pending|continues)\b/i, "the investigation is unfinished"],
  [/\b(cannot|can't|could not|couldn't|unable to)\b.{0,40}\bRED\b/i, "no RED has been constructed yet"],
  [/\bneed(s|ed)? to know\b/i, "which mechanism is at fault is still unknown"],
  [/\b(unclear|not sure|unsure|unknown|do(es)? not know|don't know)\b.{0,40}\bwhich\b/i, "which mechanism is at fault is still unknown"],
  [/\b(could not|couldn't|cannot|can't|unable to)\b.{0,30}\breproduce\b/i, "reproduction failed"],
];

// A fact and an explanation each have to be a sentence, not a shrug; a protocol
// step has to be something a person can actually carry out.
const MIN_STATEMENT = 20;
const MIN_STEP = 10;

// BLOCKED is the other end of the same problem NEEDS_EVIDENCE had. Guarding the
// exit that bills a human moved the pressure to the exit that bills nobody: an
// executor that has run out of ideas can still say "blocked", and the ledger
// records a stop that looks like an external obstacle. So BLOCKED carries a
// claim too, and the claim is checkable.
//
// The engineering phases, broadly. An obstacle does not wait for the implement
// step to arrive: the account may be denied the log it has to read before it can
// investigate at all, and the toolchain a targeted regression needs may simply
// not exist in the image. Naming only the late phases made a real early
// obstacle unsayable, and an unsayable truth is its own pressure towards the
// wrong word.
//
// Checking is deliberately NOT among them, and no widening changes that. A gate
// you cannot run does not stop you investigating a defect, reproducing it,
// writing the repair, testing it or committing it — it stops you knowing
// whether you were right, which is what verificationBlockers records. That
// absence is the rule: it is what keeps a broken checker from ending
// engineering work. `test` here is the engineering act of exercising the
// change; the authority that decides whether the change is correct is the gate,
// and it is not in this list.
export const BLOCKED_ACTIONS = ["investigate", "reproduce", "implement", "test", "commit"];

// What puts the action outside this executor's reach, on the axis that decides
// whether anyone else could have done it. Closed for the same reason
// externalSource is closed, and paired the same way with a free-form condition:
// a real obstacle must not be refused for want of an anticipated noun.
export const BLOCKER_SOURCES = [
  "dependency-unavailable",
  "authorization-denied",
  "platform-unavailable",
  "upstream-missing",
  "infrastructure-failure",
];

// The shapes that describe an executor's own unfinished reasoning. Every one of
// them is a true sentence about the run and none of them is an obstacle: the
// work did not become impossible, it became hard. Screened on the blocker's own
// explanation, which is where an honest executor puts exactly this.
const NOT_A_BLOCKER = [
  [/\broot cause\b.{0,40}\b(not|unknown|unidentified|unclear)\b/i, "the root cause is not yet known"],
  [/\b(do|does|did|could|can|would)(\s+not|n't)\s+(identify|isolate|localis|localiz|pinpoint)/i, "the causal operation has not been identified"],
  [/\bnot (yet )?(identified|isolated|localised|localized|pinpointed)\b/i, "the causal operation has not been identified"],
  [/\b(multiple|several|competing|more than one|two or more)\b.{0,30}\bhypothes/i, "more than one hypothesis is still open"],
  [/\bhypothes\w+\b.{0,30}\bremain/i, "more than one hypothesis is still open"],
  [/\bspeculative\b|\bspeculation\b|\bguesswork\b/i, "the next change would be speculative"],
  [/\bout of ideas\b|\bexhausted (my|its|our) (ideas|options)\b/i, "the executor ran out of ideas"],
  [/\b(more|further|additional)\b.{0,40}\b(investigation|analysis|research)\b.{0,25}\b(needed|required|necessary|warranted)\b/i, "the investigation is unfinished"],
  [/\b(needs?|requires?|wants?)\b.{0,30}\b(more|further|additional|deeper)\b.{0,25}\b(investigation|analysis|research)\b/i, "the investigation is unfinished"],
  [/\b(cannot|can't|could not|couldn't|unable to)\b.{0,40}\bconstruct\b.{0,25}\bRED\b/i, "no RED has been constructed yet"],
  [/\bno\b.{0,25}\bRED\b.{0,30}\b(yet|so far|as yet)\b/i, "no RED has been constructed yet"],
];

// The surfaces that tell you whether work is correct, as opposed to the things
// you need in order to do it. A blocker here caps what the run may conclude; it
// does not stop the engineering.
//
// Named checking authorities only. The generic word "test" is deliberately
// absent: with `test` a phase an obstacle may genuinely land in, screening on it
// would refuse "the toolchain the targeted regression needs is not installed" —
// a real missing dependency — as if it were a red suite. The two are told apart
// by which noun the condition names, not by whether the word test appears in it.
// A missing compiler or build output stays sayable for the same reason.
const VERIFICATION_SURFACE = /\b(gate|typecheck|type-check|tsc|lint|eslint|clippy|CI)\b/i;

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

// The four clauses an evidence request has to clear, in the order that keeps
// the refusal honest: what fact is missing, why this executor's own means
// cannot reach it, which human-controlled condition gates it, and how somebody
// would go and collect it. Failing any one of them is not an evidence request.
export function classifyEvidenceRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return { valid: false, reason: "no evidence request was supplied" };
  }
  const text = (value) => (typeof value === "string" ? value.trim() : "");

  // 1. A specific missing fact — not an account of how the search went.
  const missingFact = text(request.missingFact);
  if (missingFact.length < MIN_STATEMENT) return { valid: false, reason: "no specific missing fact was named" };
  for (const [pattern, reason] of NOT_A_MISSING_FACT) {
    if (pattern.test(missingFact)) {
      return { valid: false, reason: `${reason} — that is the executor's own state, not a fact a human can collect` };
    }
  }

  // 2. Why repository inspection, source and history, an offline test,
  //    deterministic experimentation and static or runtime analysis all miss it.
  const whyUnobtainable = text(request.whyUnobtainable) || text(request.whyExecutorCannotAcquire);
  if (whyUnobtainable.length < MIN_STATEMENT) {
    return {
      valid: false,
      reason: "the request does not say why repository, source, offline-test or analysis cannot reach the fact",
    };
  }

  // 3. The boundary itself, on two axes. The condition is the concrete thing
  //    standing in the way and is free-form, because the point of the rule is
  //    that the fact is out of reach — not that its noun was foreseen. A
  //    recognized subtype is accepted as-is and also tells us the source.
  const externalCondition = text(request.externalCondition);
  const known = Object.hasOwn(KNOWN_CONDITIONS, externalCondition) ? KNOWN_CONDITIONS[externalCondition] : null;
  if (!externalCondition || (!known && externalCondition.length < MIN_STATEMENT)) {
    return {
      valid: false,
      reason: externalCondition
        ? `externalCondition ${JSON.stringify(externalCondition)} is neither a recognized condition (${Object.keys(KNOWN_CONDITIONS).join(", ")}) nor a description concrete enough to act on`
        : "the request names no external condition",
    };
  }
  // The closed axis: who or what holds the fact. Inferred when a recognized
  // condition already answers it, so the common case costs the executor nothing.
  const externalSource = text(request.externalSource) || known || "";
  if (!EXTERNAL_SOURCES.includes(externalSource)) {
    return {
      valid: false,
      reason: `externalSource ${JSON.stringify(externalSource || null)} is not one of ${EXTERNAL_SOURCES.join(", ")}`,
    };
  }

  // 4. A protocol concrete enough that the operator is not left designing one.
  const steps = Array.isArray(request.protocol)
    ? request.protocol
    : Array.isArray(request.collectionProtocol)
      ? request.collectionProtocol
      : null;
  const protocol = steps ? steps.map(text).filter(Boolean) : null;
  if (!protocol?.length) return { valid: false, reason: "the request supplies no evidence-collection protocol" };
  if (protocol.some((step) => step.length < MIN_STEP)) {
    return { valid: false, reason: "an evidence-collection protocol step is too thin to follow" };
  }

  return {
    valid: true,
    reason: null,
    request: { missingFact, whyUnobtainable, externalSource, externalCondition, protocol },
  };
}

// What a blocker has to establish: which requested engineering action stopped,
// the concrete thing standing in its way, who or what owns that thing, why this
// executor cannot get past it with the workspace and tools it has, and what
// would clear it. Same shape as an evidence request, and for the same reason —
// a result that claims something has to show it.
export function classifyBlocker(blocker) {
  if (!blocker || typeof blocker !== "object" || Array.isArray(blocker)) {
    return { valid: false, reason: "no blocker was supplied" };
  }
  const text = (value) => (typeof value === "string" ? value.trim() : "");

  // 1. Which engineering phase actually stopped. Checking is not one of them,
  //    so "I could not verify" can never arrive here as if it were "I could not
  //    work" — however early or late the phase it is filed under.
  const blockedAction = text(blocker.blockedAction);
  if (!BLOCKED_ACTIONS.includes(blockedAction)) {
    return {
      valid: false,
      reason: `blockedAction ${JSON.stringify(blockedAction || null)} is not one of ${BLOCKED_ACTIONS.join(", ")}` +
        "; a blocked gate is a verification blocker, which caps what the run concludes and does not stop the work",
    };
  }

  // 2. The obstacle itself, concrete enough that someone else could see it.
  const condition = text(blocker.condition);
  if (condition.length < MIN_STATEMENT) return { valid: false, reason: "the blocker names no concrete condition" };

  // A verification surface is not an execution obstacle whichever field it is
  // written into, and whichever phase it is filed under. Refused here with the
  // alternative named, because an executor that hits a broken checker still has
  // every engineering phase in front of it.
  const why = text(blocker.whyExecutorCannotProceed) || text(blocker.whyUnobtainable);
  for (const field of [condition, why]) {
    if (VERIFICATION_SURFACE.test(field)) {
      return {
        valid: false,
        reason:
          "this describes a verification surface, not an obstacle to the work; report it in verificationBlockers " +
          "and carry on with the action that is still executable",
        verificationOnly: true,
      };
    }
  }

  // 3. Who or what owns the obstacle, from the closed axis.
  const blockerSource = text(blocker.blockerSource) || text(blocker.source);
  if (!BLOCKER_SOURCES.includes(blockerSource)) {
    return {
      valid: false,
      reason: `blockerSource ${JSON.stringify(blockerSource || null)} is not one of ${BLOCKER_SOURCES.join(", ")}`,
    };
  }

  // 4. Why this executor cannot get past it — and not merely that it has not.
  if (why.length < MIN_STATEMENT) {
    return { valid: false, reason: "the blocker does not say why this executor cannot get past it" };
  }
  for (const [pattern, reason] of NOT_A_BLOCKER) {
    if (pattern.test(why) || pattern.test(condition)) {
      return { valid: false, reason: `${reason} — that is unfinished work, not an obstacle` };
    }
  }

  // 5. What would clear it, so the stop is actionable rather than terminal.
  const recovery = text(blocker.recovery);
  if (recovery.length < MIN_STEP) return { valid: false, reason: "the blocker says nothing about what would clear it" };

  return {
    valid: true,
    reason: null,
    blocker: { blockedAction, condition, blockerSource, whyExecutorCannotProceed: why, recovery },
  };
}

// Verification surfaces the executor could not run. These ride along with any
// result: they are a statement about what could not be checked, never about
// what could not be done, so they cap what the run may conclude and decide
// nothing about its disposition.
function normalizeVerificationBlockers(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((entry) => (typeof entry === "string" ? { surface: entry.trim(), detail: "" } : {
      surface: String(entry?.surface ?? "").trim(),
      detail: String(entry?.detail ?? "").trim(),
    }))
    .filter((entry) => entry.surface);
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
      `an executor cannot mark its own work ${raw.result}; that is concluded from evidence it does not own` +
        (raw.result === "INTERRUPTED"
          ? " — a report that parsed is an execution that was not interrupted, so say what actually stopped: BLOCKED with an obstacle, NEEDS_EVIDENCE with an external boundary, or FIX_PROPOSED with what was reached"
          : ""),
    );
  }

  // An evidence request is checked the way a behavioral RED is, and for the same
  // reason: the result claims something, so the claim has to be shown. An
  // executor that cannot clear these four clauses has not found an external
  // boundary — it has stopped, and BLOCKED is the word for that.
  let evidenceRequest = null;
  if (raw.result === "NEEDS_EVIDENCE") {
    const verdict = classifyEvidenceRequest(raw.evidenceRequest);
    if (!verdict.valid) {
      throw new ContractError(`NEEDS_EVIDENCE without a usable evidence request: ${verdict.reason}`);
    }
    evidenceRequest = verdict.request;
  }

  // BLOCKED is checked the way NEEDS_EVIDENCE is. An executor that cannot show
  // an obstacle has not hit one; it has stopped, and the run reroutes rather
  // than recording an obstacle nobody can act on.
  let blocker = null;
  if (raw.result === "BLOCKED") {
    const verdict = classifyBlocker(raw.blocker);
    if (!verdict.valid) {
      throw new ContractError(`BLOCKED without a usable blocker: ${verdict.reason}`);
    }
    blocker = verdict.blocker;
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
    evidenceRequest,
    blocker,
    verificationBlockers: normalizeVerificationBlockers(raw.verificationBlockers),
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
    // Declared, not observed: this is the count the executor wrote down. The
    // controller did not watch these run, and free text in the report never
    // becomes evidence — a report claiming "117 tests passed" while declaring
    // none, on a profile that did not cover that suite, is exactly the shape
    // this separation exists to keep legible.
    `TESTS(executor-declared)=${result.tests.length}`,
    `GATE(controller-observed)=${result.gateResult} (${result.gateProfile})`,
    ...(result.gateCoverage?.notCovered?.length ? [`NOT_COVERED=${result.gateCoverage.notCovered.join(",")}`] : []),
    // How many of the required reviewers actually passed, not just that someone
    // did: at risk 4 the policy asks for two, and "1/2 passed" must not read the
    // same as "2/2 passed" in the ledger a human later trusts.
    `REVIEW=${result.reviewVerdict ?? "NOT_REQUIRED"}${
      result.reviewersRequired
        ? ` (${(result.reviewVerdicts ?? []).filter((v) => v === "PASS").length}/${result.reviewersRequired} passed)`
        : ""
    }${result.reviewerAccount ? ` by ${result.reviewerAccount}` : ""}`,
    ...(result.reviewNote ? [`REVIEW_NOTE=${result.reviewNote}`] : []),
    `COMMIT=${short(result.commitSha)} ${result.commitEvidence?.ok ? "(git-verified)" : `(UNVERIFIED: ${result.commitEvidence?.code ?? "not checked"})`}`,
    // A commit claim the repository refused, named with the account that made
    // it. Without this the ledger shows an executor that simply did not deliver
    // and gives no way to tell that from a runtime that died — and the one fact
    // that distinguishes them, a sha git has never seen, is the one worth
    // reading. The claimed sha is printed in full on purpose: abbreviating it
    // is what the failure was made of.
    ...(result.executorAttempts ?? [])
      .filter((a) => a.commitEvidence && !a.commitEvidence.ok)
      .map(
        (a) =>
          `COMMIT_CLAIM_REFUSED=${a.account} claimed ${a.commitEvidence.claimedSha ?? "nothing"}; git says ${a.commitEvidence.code} — ${a.commitEvidence.reason}`,
      ),
    // What the workspace was carrying, whenever it was carrying anything. The
    // gate's claim is about the candidate commit, and this is the line that
    // keeps that claim from being read as "git status was empty" — it was not,
    // and a record that let a reader assume it was would be the same conflation
    // that refused two correct commits, facing the other way.
    ...(result.commitEvidence?.worktree && !result.commitEvidence.worktree.statusEmpty
      ? [
          `WORKTREE=clean-for-candidate=${result.commitEvidence.worktree.cleanForCandidate}` +
            ` untracked-evidence=${result.commitEvidence.worktree.untrackedEvidenceCount}` +
            [
              ["tracked", result.commitEvidence.worktree.trackedModified],
              ["staged", result.commitEvidence.worktree.stagedModified],
              ["untracked-blocking", result.commitEvidence.worktree.untrackedBlocking],
            ]
              .filter(([, paths]) => paths?.length)
              .map(([what, paths]) => ` ${what}=${paths.length} (${paths.slice(0, 3).join(", ")})`)
              .join(""),
        ]
      : []),
    ...(result.completionLevel ? [`LEVEL=${result.completionLevel}`] : []),
    `WORKSPACE=${result.workspace}`,
    `NEXT=${result.nextStatus}`,
    // NEEDS_EVIDENCE is the one result that asks a person for something, so the
    // ask travels with it. A human who has to open a run JSON on the executor's
    // machine to find out what they owe will not go and collect it.
    ...(result.evidenceRequest
      ? [
          `EVIDENCE_NEEDED=${result.evidenceRequest.externalSource}/${result.evidenceRequest.externalCondition}: ${result.evidenceRequest.missingFact}`,
          `EVIDENCE_UNREACHABLE_OFFLINE=${result.evidenceRequest.whyUnobtainable}`,
          ...result.evidenceRequest.protocol.map((step, i) => `EVIDENCE_STEP_${i + 1}=${step}`),
        ]
      : []),
    ...(result.tests?.length && result.gateCoverage?.notCovered?.length
      ? [
          `UNVERIFIED_CLAIM=${result.tests.length} declared test(s); this profile left ${result.gateCoverage.notCovered.join(",")} uncovered, so the controller did not run whatever falls there`,
        ]
      : []),
    // A blocker is a claim like any other, so the ledger carries the parts a
    // human would need to check it or clear it.
    ...(result.blocker
      ? [
          `BLOCKED_ACTION=${result.blocker.blockedAction} (${result.blocker.blockerSource})`,
          `BLOCKER_CONDITION=${result.blocker.condition}`,
          `BLOCKER_RECOVERY=${result.blocker.recovery}`,
        ]
      : []),
    // Recorded on any result: what could not be checked, which is never the
    // same statement as what could not be done.
    // What a blocker withheld, and what it did not. A checker nobody could run
    // says nothing about a suite the controller ran itself and watched pass, so
    // the scope that survives is named rather than left to be inferred from the
    // capped level — otherwise "IMPLEMENTED" reads as "nothing was established".
    ...(result.verificationBlockers?.length && result.provenSurfaces?.length
      ? [`PROVEN_SURFACES=${result.provenSurfaces.join(",")} (controller-observed, and unaffected by the blockers below)`]
      : []),
    ...(result.verificationBlockers?.length
      ? [
          `VERIFICATION_BLOCKED=${result.verificationBlockers.map((v) => v.surface).join(",")} (caps what this run may conclude; engineering was not blocked)`,
        ]
      : []),
    // How a runtime ended, and where to read the rest of it. "Executor exited 1
    // without a report" is true and unactionable on its own: the exit code, the
    // signal and everything the process printed used to live only in a terminal.
    // A try that ran to a clean exit and delivered stays quiet; every other one
    // says what happened and names the durable record of it.
    ...(result.executorAttempts ?? [])
      .filter((a) => a.process && (!a.accepted || a.process.termination !== "exit" || a.process.exitStatus !== 0))
      .map(
        (a) =>
          `EXECUTOR_PROCESS=${a.account} ${a.process.termination}` +
          `${a.process.exitStatus === null ? "" : ` status=${a.process.exitStatus}`}` +
          `${a.process.signal ? ` signal=${a.process.signal}` : ""}` +
          `${a.process.reportPresentAtExit === null ? "" : ` report=${a.process.reportPresentAtExit ? "written" : "absent"}`}` +
          `; diagnostics ${a.diagnostics ?? `not persisted (${a.diagnosticsError ?? "no writer"})`}`,
      ),
    ...(result.executorAttempts?.length > 1
      ? [`EXECUTORS_TRIED=${result.executorAttempts.map((a) => `${a.account}:${a.accepted ? "accepted" : "rejected"}`).join(",")}`]
      : []),
    ...(result.autonomousExecution?.state === "exhausted"
      ? [
          `AUTONOMOUS_EXECUTION=exhausted after ${result.autonomousExecution.tried.length} executor(s): ${result.autonomousExecution.reason}`,
          `NO_EVIDENCE_CLAIMED=this run establishes no external evidence requirement; it is executor-incomplete work`,
        ]
      : []),
    ...(result.newBugs?.length
      ? [`NEW_BUG_DISCOVERED=${result.newBugs.map((b) => b.fingerprint).join(",")} (file separately; not fixed here)`]
      : []),
  ].join("\n");
}

// Which workspace the executor was actually given, in the words it needs to act
// on. There is one rule about what a candidate may be and run/evidence.mjs
// enforces it; this states that same rule rather than a second one, because a
// second one drifts and then the executor is stopped by a contract the
// controller does not hold. WORKSPACE_ACTION is the fact both branches turn on.
//
// A rerouted try is the same question asked again. The workspace is handed on
// exactly as the refused executor left it — including anything it committed —
// so HEAD may be ahead of STARTING_HEAD for a reason that has nothing to do
// with resuming. Telling a second executor to stop unless HEAD is STARTING_HEAD
// would rebuild attempt 16's defect one try later.
const priorTrySection = (priorTries) =>
  priorTries > 0
    ? `

${priorTries === 1 ? "An earlier executor" : `${priorTries} earlier executors`} worked this attempt in this same workspace and did not
deliver an answer the contract accepts. Nothing they committed was discarded, so
HEAD may be ahead of STARTING_HEAD for that reason alone. That is expected —
inspect what is there. STARTING_HEAD remains the head this attempt began at and
the point a commit you make is measured from.`
    : "";

// The head-identity check belongs only to a try that is the first to touch this
// workspace. A rerouted try inherits whatever its predecessor committed, so
// demanding HEAD == STARTING_HEAD there stops an executor for doing nothing
// wrong.
const headIsStartingHead = (priorTries, sentence) =>
  priorTries > 0 ? "" : `${sentence}\n\n`;

const workspaceSection = (action, { startingHead, priorTries = 0 }) =>
  action === "resume"
    ? `## THE WORKSPACE YOU WERE GIVEN — resumed

This workspace was left behind by an earlier attempt at this issue, and
STARTING_HEAD is where that attempt left it:

    ${startingHead}

It may be ahead of RESOLVED_BASE_SHA, and that is the expected state of a
resumed workspace — not an obstacle, not a base mismatch, and not a reason to
stop. STARTING_HEAD may already be this issue's candidate: an earlier attempt's
commit, waiting to be inspected rather than replaced.

So inspect it before you decide anything. Read the diff from RESOLVED_BASE_SHA
to STARTING_HEAD and establish what it does. If it is the fix this issue asks
for, your job is to prove it, not to produce another one.

${headIsStartingHead(
  priorTries,
  "Confirm \`git rev-parse HEAD\` is STARTING_HEAD. If it is something else, this is\nnot the workspace the controller planned — stop and say so.",
)}Never rebase, reset or re-baseline: BASE_REF and RESOLVED_BASE_SHA are this
run's provenance and are not yours to move.${priorTrySection(priorTries)}`
    : `## THE WORKSPACE YOU WERE GIVEN — fresh

This is a fresh workspace, cut from RESOLVED_BASE_SHA, so STARTING_HEAD is that
base:

    ${startingHead}

${headIsStartingHead(
  priorTries,
  "\`git rev-parse HEAD\` must be it. If it is something else, this is not the\nworkspace the controller planned — stop and say so.",
)}A candidate here is a commit made after STARTING_HEAD.

Never rebase, reset or re-baseline: BASE_REF and RESOLVED_BASE_SHA are this
run's provenance and are not yours to move. If the work genuinely needs a
different base, stop and return — re-baselining means a new task.${priorTrySection(priorTries)}`;

// What a commitSha has to be, which depends on where the candidate came from
// and never on what the executor says about it. run/evidence.mjs decides this;
// the text below is that decision stated, not a copy of the algorithm.
const candidateSection = (action) =>
  action === "resume"
    ? `- **The candidate you inherited.** Where STARTING_HEAD is already this
  issue's candidate, that is the candidate: report that sha. It must descend
  from RESOLVED_BASE_SHA, differ from it, and change at least one file against
  it — the controller measures all three itself, against the pinned base,
  because that is the one point in this history your attempt did not choose.
- **Do not manufacture a commit to move the sha.** A no-op commit, an empty
  amend or an unrelated edit made only so HEAD differs from STARTING_HEAD is a
  worse record of what happened, not a better one, and it is not evidence.
- **A candidate you did make.** If you committed during this attempt, report
  that commit: it must descend from STARTING_HEAD and change a file against it.`
    : `- **The candidate you made.** It must descend from STARTING_HEAD and change
  at least one file against it. STARTING_HEAD is the untouched base here, so
  naming it claims a fix that is the base itself, and is refused.`;

// The bounded packet an executor receives instead of a transcript. Everything
// it may do, and everything it may not, is stated here.
export function buildPacket({
  issue,
  machine,
  task,
  attemptId,
  workspace,
  reportPath,
  // Defaulted to the stricter branch, so a caller that forgets to say produces a
  // fresh-workspace brief rather than a permission nobody granted. The lifecycle
  // always says; a test holds it to that.
  workspaceAction = "create",
  startingHead = null,
  priorTries = 0,
}) {
  const action = workspaceAction === "resume" ? "resume" : "create";
  const head = startingHead ?? task.resolvedBaseSha;
  return `# Issue ${issue.number} — ${issue.title}

RUN_ID: ${attemptId}
ISSUE_URL: ${task.url}
FINGERPRINT: ${task.fingerprint}
TASK_CLASS: ${task.taskClass}
BASE_REF: ${task.baseRef}
RESOLVED_BASE_SHA: ${task.resolvedBaseSha}
WORKSPACE_ACTION: ${action}
STARTING_HEAD: ${head}
WORKTREE: ${workspace}

${workspaceSection(action, { startingHead: head, priorTries })}

## ISSUE BODY (verbatim; the authoritative statement of the defect)

${task.spec}

## REQUIRED CONTEXT

${task.contextPaths.map((p) => `- ${p}`).join("\n")}

## ACCEPTANCE

1. Reproduce first. Produce a **behavioral RED**: an existing-behavior failure
   that violates this issue's acceptance contract. A missing module, an
   unwritten file, a scaffolding syntax error, or a missing fixture is NOT a
   behavioral RED. "Could not reproduce" never becomes a fix — and it does not
   become NEEDS_EVIDENCE either. See WHEN YOU CANNOT FINISH below.
2. Make the RED go green with the smallest change that meets the contract.
   Where STARTING_HEAD already carries that change, establishing that it does is
   this step, and no further commit is owed.
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

## WHEN YOU CANNOT FINISH

Being stuck is not a result. Each way of ending a run early is a claim, and each
one has to be shown.

**BLOCKED** — a requested action became impossible. Name which engineering
phase stopped (${BLOCKED_ACTIONS.join(", ")}), the concrete obstacle, who or what
owns it, why this worktree and these tools cannot get past it, and what would
clear it:

\`\`\`
blocker: {
  blockedAction: "${BLOCKED_ACTIONS.join(" | ")}",
  condition: "the concrete thing standing in the way",
  blockerSource: "${BLOCKER_SOURCES.join(" | ")}",
  whyExecutorCannotProceed: "why this workspace and these tools cannot get past it",
  recovery: "what would clear it"
}
\`\`\`

Checking is deliberately not one of the phases. A gate you cannot run does not
stop you investigating a defect, reproducing it, writing the repair, exercising
it or committing it — see VERIFICATION YOU COULD NOT RUN below. \`test\` here
means exercising the change; the authority that says whether it is correct is
the gate, and that is not a phase you can be blocked in.

These are **not** blockers: the root cause is unidentified, the causal operation
is unidentified, no RED yet, several hypotheses remain, more analysis is needed,
the next change would be speculative, you are out of ideas. Every one is true of
a run that is merely unfinished. Reporting one does not end the task — it hands
it to a different executor.

**NEEDS_EVIDENCE** — a specific fact you need is behind a boundary you cannot
cross. This result labels the issue as owing something from a *human*, so it is
only available when all four of these hold, and you must state each one:

1. \`missingFact\` — the specific fact that is missing. Not "the root cause", not
   "which operation causes it": the observation itself.
2. \`whyUnobtainable\` — why repository inspection, source and history, an
   offline test, deterministic experimentation, and static or runtime analysis
   each fail to reach it.
3. \`externalCondition\` — the concrete thing standing in the way, and
   \`externalSource\` — who or what holds the fact, one of
   ${EXTERNAL_SOURCES.join(", ")}. The condition is free-form: describe a real
   boundary in a sentence even if it is unlike anything listed here. These are
   recognized shorthands and imply their own source:
   ${Object.keys(KNOWN_CONDITIONS).join(", ")}.
4. \`protocol\` — the concrete steps someone would follow to collect it.

If you cannot fill all four, you are not waiting on evidence. A report that
claims NEEDS_EVIDENCE without them is refused, and the task is handed to a
different executor rather than to a person — so writing one does not end the
work, it only spends your turn at it.

**INTERRUPTED is not yours to report.** Whether your execution was interrupted
is an observation about the runtime, and the controller makes it — if your
process dies, it records that without your help. A report you wrote is an
execution that reached the point of answering, so writing INTERRUPTED into one is
refused and the task is handed to a different executor. If you are at the end of
what you can do, say what actually stopped: BLOCKED with an obstacle,
NEEDS_EVIDENCE with an external boundary, or FIX_PROPOSED with what you reached.

## VERIFICATION YOU COULD NOT RUN

A broken checking surface — the gate, a typecheck, a lint, a suite — caps what
this run may conclude. It does not stop the work, and it is not a blocker.
Record it alongside whatever result you actually reached, and carry on with the
action that is still executable:

\`\`\`
verificationBlockers: [{ surface: "overlay gate", detail: "pre-existing type errors unrelated to this change" }]
\`\`\`

Do not claim in prose that tests passed. \`tests\` is what you declare and the
gate is what the controller observes; free text is recorded as neither.

## IF YOU FIND AN INDEPENDENT BUG

Do not fix it. Add it to the report as \`newBugs: [{fingerprint, title, summary}]\`
with its **own** fingerprint. Re-using ${task.fingerprint} is rejected.

## RETURN FORMAT — write exactly this JSON to ${reportPath}

Writing that file is the only way to report anything. What you print to the
console is read by a person, never by the lifecycle: a report printed instead of
written is not a report, however well-formed. Exiting cleanly without writing
one is a protocol failure, and the task goes to a different executor.

\`\`\`json
{
  "result": "FIX_PROPOSED | NEEDS_EVIDENCE | BLOCKED",
  "behavioralRed": "the observed contract violation, with file:line",
  "commitSha": "<40-hex sha of your commit, required for FIX_PROPOSED>",
  "blocker": {
    "blockedAction": "<required for BLOCKED>",
    "condition": "the concrete obstacle",
    "blockerSource": "${BLOCKER_SOURCES.join(" | ")}",
    "whyExecutorCannotProceed": "why this workspace cannot get past it",
    "recovery": "what would clear it"
  },
  "verificationBlockers": [{ "surface": "a checker you could not run", "detail": "why" }],
  "evidenceRequest": {
    "missingFact": "<required for NEEDS_EVIDENCE>",
    "whyUnobtainable": "why no offline means reaches it",
    "externalSource": "${EXTERNAL_SOURCES.join(" | ")}",
    "externalCondition": "a recognized shorthand, or a concrete description",
    "protocol": ["step someone follows to collect it"]
  },
  "tests": ["path/to/the/red/test"],
  "notes": "one or two sentences",
  "newBugs": []
}
\`\`\`

Your commitSha is checked against git before your result is accepted at all. It
must exist, be the canonical object id git returns for it, and be the workspace
head the gate ran on. What it is measured *from* depends on where the candidate
came from, and the controller establishes that itself from what git shows:

${candidateSection(action)}

A claim that fails any of this is not a weaker FIX_PROPOSED — it is refused, and
the task goes to a different executor.

**Copy the sha; never complete one.** Run \`git rev-parse HEAD\` and paste all
forty characters of what it prints. \`git log --oneline\` and
\`git rev-parse --short\` give you seven, and the other thirty-three are not
yours to supply — a sha you finished from memory is well-formed, shares the
prefix a human recognises, and names nothing.

GATE_PASSED, VERIFIED and INTERRUPTED are none of them yours to claim — each is
concluded from evidence you do not own.
`;
}

// The read-only reviewer brief. It deliberately carries no executor reasoning
// transcript — only the spec, the fixed-point diff, the gate output, and the
// invariants — per harness/config/verification-policy.json.
// What the gate's result is worth to the reviewer, which is not the same
// question as what it says. "The gate outranks your judgement" is a true and
// load-bearing instruction about a gate the controller owns end to end: the
// runner, the suite list, the checks, and the tooling that executed them. Told
// the same thing about a gate the candidate's own diff or the candidate's own
// workspace shaped, a reviewer defers to the thing it was asked to check — so
// the sentence is earned per run rather than printed every time. A failing gate
// is never softened here, whoever owns it.
export function gateStanding(authority, gateResult) {
  const passed = gateResult === "PASS";
  if (authority === "controller") {
    return [
      "This gate is the controller's own: its runner, its suite list and its checks",
      "come from a trusted checkout rather than from the commit under review.",
      "The deterministic gate outranks your judgement" +
        (passed ? "." : ", and no finding of yours can turn a failing check into a passing one."),
    ].join("\n");
  }
  const why =
    {
      "candidate-influenced": "the commit under review changes the checks it ran",
      "environment-influenced":
        "its checks were executed by tooling resolved out of ignored state inside the\nworkspace that produced this commit, which no diff can show",
      unknown: "the controller could not establish what its result rests on",
    }[authority] ?? "the controller cannot stand behind what produced it";
  return [
    `This gate is NOT an authority over this change: ${why}.`,
    "Its output is supplemental observed evidence about what ran — it does not",
    "outrank your judgement, and you are the independent check on whether this",
    "change is correct." + (passed ? "" : " It also did not pass, and a failing check is not overturned by review."),
  ].join("\n");
}

export function buildReviewBrief({
  issue,
  task,
  commitSha,
  startingHead,
  diff,
  gateOutput,
  criteria,
  workspace,
  gateResult = null,
  gateAuthority = "unknown",
}) {
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

${gateStanding(gateAuthority, gateResult)}

## CRITERIA

${criteria.map((c) => `- ${c}`).join("\n")}

Each finding carries CLAIM / EVIDENCE / SEVERITY / CONFIDENCE / VIOLATED_INVARIANT.
"Looks good" is not a review.

## RETURN FORMAT

You run read-only and can write nothing, so your verdict is your final output.
End your response with exactly this JSON object and nothing after it:

\`\`\`json
{ "verdict": "PASS | FAIL", "findings": [] }
\`\`\`
`;
}
