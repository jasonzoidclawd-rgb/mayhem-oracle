// One execution of one Task, from one declared base, inside one isolated
// workspace.
//
//   Task     the authoritative requested work — what, from where, proven how
//   Attempt  what actually happened when it was executed once
//
// Nothing here knows where the Task came from. There is no gh, no issue, no
// label, and no comment: a caller that can produce a Task and interpret an
// Attempt can use this lifecycle, and the GitHub adapter is one such caller
// rather than the owner. Every effect — git, subprocess, filesystem — is
// injected, so the whole lifecycle is testable offline.
//
// The order below is the argument. The workspace is established before
// anything runs in it; the executor's claim is checked against git before the
// gate's verdict is attributed to it; the gate runs before a reviewer is asked
// to spend judgement on it; and the reviewer works on a fixed checkout of a
// commit that has already been verified, never on the workspace that produced
// it.

import { describeExecution, detail } from "./diagnostics.mjs";
import { parseGateCoverage, verifyCommitEvidence } from "./evidence.mjs";
import { classifyWorktree, evidenceRoots, matchesAuthority, parseAuthority } from "./worktree.mjs";
import { didRun } from "./process.mjs";
import { applyWorkspacePlan, parseWorktreeList, planWorkspace, reviewPaths } from "./workspace.mjs";

export class AttemptError extends Error {}

// How a runtime stopped, in the terms the process contract already draws: a
// launch that never happened, a kernel that killed it, and a program that ran
// and exited nonzero are three different facts, and "exited ?" reports all
// three as the third.
const howItEnded = (launched) =>
  launched?.error
    ? `could not be launched (${launched.error.code ?? "unknown"})`
    : launched?.signal
      ? `was killed by ${launched.signal}`
      : `exited ${launched?.status ?? "?"}`;

// A result nobody reported. The controller reaches these from what it observed
// of the execution itself, so they carry no claim of any kind: no RED, no
// evidence request, no obstacle, no commit and nothing declared. Built here
// rather than read out of a file, because a report is where an executor makes
// claims and these are not the executor's to make.
const controllerResult = (fingerprint, result, notes) => ({
  result,
  fingerprint,
  behavioralRed: null,
  evidenceRequest: null,
  blocker: null,
  verificationBlockers: [],
  commitSha: null,
  tests: [],
  notes,
  newBugs: [],
});

// 2: git evidence, gate coverage and completion level are recorded, and a gate
// pass with no independent reviewer concludes GATE_PASSED rather than VERIFIED.
// A schema-1 record's VERIFIED may mean either; a schema-2 one may not.
export const ATTEMPT_SCHEMA = 2;

// The gate is the authority every other verdict is measured against, so it is
// loaded from the controller's own checkout and *pointed at* the workspace it
// must judge. Resolving `harness/verify-task.sh` relatively against the
// candidate's directory let the subject supply its own evaluator: a diff that
// rewrote that script — or scripts/gate.sh underneath it — decided what PASS
// meant for itself. Absolute path in, subject as an argument, and no trusted
// root is a refusal rather than a fallback.
const GATE_SCRIPT = "harness/verify-task.sh";

export function gateArgv({ harnessRoot, profile, worktree = null, plan = false, authority = false }) {
  if (!harnessRoot) {
    throw new AttemptError("no trusted harness checkout was given to run the gate from");
  }
  const argv = ["bash", `${String(harnessRoot).replace(/\/+$/, "")}/${GATE_SCRIPT}`, profile];
  if (worktree) argv.push("--worktree", worktree);
  if (plan) argv.push("--plan");
  if (authority) argv.push("--authority");
  return argv;
}

// The gate's declared path policy — which files decide what a PASS means, which
// ignored trees execute it, and which roots it cannot reach at all. Defined in
// run/worktree.mjs beside the classification that needs it most, and re-exported
// here because this module's callers already ask for it.
export { matchesAuthority, parseAuthority };

// Which of the changed files decide what this profile's PASS means.
export function authorityTouched(changedFiles, declared) {
  const paths = parseAuthority(declared).tracked;
  return (changedFiles ?? []).filter((file) => matchesAuthority(file, paths));
}

// Which of the declared runtime inputs the workspace was actually holding when
// the gate ran. Presence is the whole question and it is answered by a stat:
// what is inside one of these trees is not knowable from a commit, and reading
// it would be answering a question the record cannot honestly ask.
export function runtimeInputs(declared, { workspace, pathExists }) {
  if (!workspace || typeof pathExists !== "function") return parseAuthority(declared).runtime;
  const at = String(workspace).replace(/\/+$/, "");
  return parseAuthority(declared).runtime.filter((path) => pathExists(`${at}/${path.replace(/\/+$/, "")}`));
}

// Operator-facing text, defined beside the diagnostics that need it most and
// re-exported here because this module's callers already ask for it.
export { detail };

// A subprocess that never launched has reported nothing, so its result may not
// be read as one.
export function mustHaveRun(result, what) {
  if (result?.error) throw new AttemptError(`${what} could not be started: ${detail(result.error.message)}`);
  return result;
}

// Placeholders whose value is opaque content the process reads, as opposed to
// a capability it holds. Rendering is a 1:1 map over the template, so a token's
// position says which of the two it produced.
const CONTENT_PLACEHOLDERS = ["prompt"];
const CONTENT_TOKEN = new Set(CONTENT_PLACEHOLDERS.map((name) => `{${name}}`));
const MENTIONS_CONTENT = new RegExp(`\\{(?:${CONTENT_PLACEHOLDERS.join("|")})\\}`);

// The launch line is data the mechanism declares, not syntax invented here.
export function launchArgv({ mechanism, role, model, effort, authProvider, prompt, sessionDir, workspace, runDir, reportDir }) {
  const template = mechanism?.launch?.[role];
  if (!Array.isArray(template) || template.length === 0) {
    throw new AttemptError(`execution mechanism declares no ${role} launch argv; it cannot be started by guesswork`);
  }
  const values = { model, effort, authProvider, prompt, sessionDir, worktree: workspace, runDir, reportDir };
  return template.map((token) =>
    token.replace(/\{(\w+)\}/g, (_, key) => {
      const value = values[key];
      if (value === undefined || value === null || value === "") {
        throw new AttemptError(`launch template needs {${key}}, which this route did not supply`);
      }
      return String(value);
    }),
  );
}

// The reviewer must not be able to reach the executor's state, and a brief that
// politely says so is not a mechanism — the argv, the cwd and the run directory
// are. A reviewer whose working directory is the workspace it is reviewing has
// write access to its own subject; one handed the executor's run directory can
// read the report and session it is supposed to be independent of. Both are
// refused here, before the process starts, so the isolation cannot be lost by
// editing prose.
//
// What it inspects is the launch's capability-bearing fields, not its content.
// The review brief quotes the fixed-point diff, so it may legitimately contain
// any string in the repository — including the executor's own worktree path.
// Scanning it answers "what was the reviewer told", which is not the question,
// and answering it wrongly is expensive: this throws at stage=review, where the
// caller recovers the issue as INTERRUPTED and discards a git-verified commit
// and a passing gate. `template` is the mechanism's own launch line, whose
// positions separate the two; with none supplied every argv entry is treated as
// capability-bearing, which is the stricter reading.
export function assertReviewerIsolation({ argv, template = null, cwd, runDir = null, env, executor, realPath = (p) => p }) {
  // Compare realised paths. git reports the path it resolved, while these roots
  // are derived from the configured main worktree, so a symlinked prefix
  // (/tmp -> /private/tmp) makes two names for one directory compare unequal —
  // and an isolation check that silently passes is worse than none.
  const norm = (path) => String(realPath(String(path ?? "")) ?? "").replace(/\/+$/, "");
  const inside = (path, root) => path === root || path.startsWith(`${root}/`);

  // A literal flag and a rendered {sessionDir} are both part of the launch; a
  // rendered {prompt} is the payload. A token that is neither — content spliced
  // into a control argument — cannot be told apart at all, and refusing the
  // template says so instead of picking one of the two wrong answers.
  const launchArgs = (argv ?? []).filter((_, index) => {
    if (!Array.isArray(template)) return true;
    const slot = template[index];
    if (slot === undefined) return true;
    if (CONTENT_TOKEN.has(slot)) return false;
    if (MENTIONS_CONTENT.test(slot)) {
      throw new AttemptError(
        `the reviewer launch template mixes the brief into the control argument ${slot}; ` +
          "content and capability cannot be told apart inside one token",
      );
    }
    return true;
  });

  for (const raw of [executor?.workspace, executor?.runDir].filter(Boolean)) {
    const root = norm(raw);
    if (!root) continue;
    if (inside(norm(cwd), root)) {
      throw new AttemptError(`the reviewer would run inside the executor's ${raw}; a verifier does not work in the workspace it verifies`);
    }
    // Where the reviewer's own state is placed is a capability whether or not
    // the launch template happens to pass it through: the caller creates it.
    if (runDir && inside(norm(runDir), root)) {
      throw new AttemptError(`the reviewer's run directory is inside the executor's ${raw}; a verifier does not keep its state there`);
    }
    // Either spelling of the root is a leak, so both are refused.
    const names = (value) => String(value).includes(root) || String(value).includes(String(raw));
    for (const token of launchArgs) {
      if (names(token)) {
        throw new AttemptError(`the reviewer launch names the executor's ${raw}; a verifier is not handed the executor's state`);
      }
    }
    // The environment is part of the launch. A root passed through env reaches
    // the reviewer exactly as well as one passed through argv, and env is where
    // a launcher is likeliest to forward state without meaning to.
    for (const [key, value] of Object.entries(env ?? {})) {
      if (names(value)) {
        throw new AttemptError(`the reviewer's ${key} names the executor's ${raw}; a verifier is not handed the executor's state`);
      }
    }
  }
}

// The last JSON object a runtime printed, preferring a fenced block. Returns
// null rather than guessing when nothing parses.
export function lastJsonObject(text) {
  const source = String(text ?? "");
  for (const block of [...source.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]).reverse()) {
    try {
      return JSON.parse(block);
    } catch {
      /* try the next one */
    }
  }
  const close = source.lastIndexOf("}");
  if (close === -1) return null;
  const opens = [];
  for (let i = 0; i < close; i += 1) if (source[i] === "{") opens.push(i);
  for (const open of opens.slice(-20).reverse()) {
    try {
      return JSON.parse(source.slice(open, close + 1));
    } catch {
      /* try an earlier brace */
    }
  }
  return null;
}

// What the attempt established, in a vocabulary with no ledger in it. The
// caller maps a disposition onto whatever its own source calls that state.
export const DISPOSITIONS = ["accepted", "needs-review", "needs-human", "needs-evidence", "blocked"];

// The verdict is assembled from evidence the executor does not own: git, the
// deterministic gate and, where the risk level requires one, an independent
// reviewer. A failing gate is never overruled here.
//
// The completion level says how far the proof got, and stops where the
// evidence stops. LIVE-PROVEN is never concluded here: no gate profile
// establishes live behaviour, so nothing in this file may claim it.
export function concludeAttempt({
  reported,
  gateResult,
  reviewVerdicts = [],
  reviewersRequired = 0,
  commitVerified = false,
  gateComplete = false,
  gateSuites = [],
  gateAuthoritative = true,
  verificationBlockers = [],
}) {
  const at = (result, disposition, completionLevel = null, provenSurfaces = []) => ({
    result,
    disposition,
    completionLevel,
    provenSurfaces,
  });

  if (reported.result !== "FIX_PROPOSED") {
    // INVALID_DISPOSITION is concluded here, never reported: it is what is left
    // when every eligible executor has been tried and none produced an answer
    // the contract accepts. It lands needs-human because a person genuinely has
    // to look — but as executor-incomplete work, which is a different sentence
    // from "the operator owes a fact", and must never be spelled the same way.
    const disposition = {
      NEEDS_EVIDENCE: "needs-evidence",
      BLOCKED: "blocked",
      INTERRUPTED: "needs-human",
      INVALID_DISPOSITION: "needs-human",
    }[reported.result];
    // Everything above is either reportable or concluded by this controller.
    // Anything else arriving means the report contract was bypassed, and
    // guessing a disposition for it would write an undefined state onto the
    // caller's ledger.
    if (!disposition) throw new AttemptError(`${reported.result} is concluded, not reported; it has no reported-result disposition`);
    return at(reported.result, disposition);
  }
  // A commit git could not establish is not work anyone can accept, however
  // green the gate looks: the gate did not necessarily run on it, and the claim
  // itself is unsupported. Recording it as FIX_PROPOSED wrote a fix that does
  // not exist into the ledger — the disposition is invalid, not merely capped.
  // The lifecycle refuses this before it ever gets here; this is the same rule
  // for a caller that concluded without going through it.
  if (!commitVerified) return at("INVALID_DISPOSITION", "needs-human");
  if (gateResult !== "PASS") return at("FIX_PROPOSED", "needs-human", "IMPLEMENTED");
  // A profile that skipped suites did not prove the change offline, however
  // green the suites it did run came back. The default profile skips most of
  // them, so treating any PASS as OFFLINE-PROVEN overstates nearly every run.
  // A surface the executor could not run is a hole in the proof even when every
  // suite that did run came back green. It caps what may be claimed; it never
  // decides the disposition, because not being able to check the work is not
  // the same as not having done it.
  //
  // A verification blocker caps what depends on the surface it names, and
  // nothing else. Treating any blocker as a cap on everything erased proof the
  // controller had actually produced: an overlay checker nobody could run says
  // nothing whatever about a Rust suite this controller ran itself and watched
  // pass, and answering "unrunnable overlay" with "then nothing is proven" is
  // false in the direction that discards evidence. So the scope is recorded
  // explicitly — the suites the controller ran, less the ones a blocker names.
  //
  // The whole-run word stays strict: OFFLINE-PROVEN means every suite ran and
  // nothing was left unchecked, so any blocker at all withholds it. What
  // survives a blocker is the scoped proof, never the unqualified claim. And
  // provenSurfaces can only ever contain suites the gate actually ran, so
  // coverage the controller did not produce still cannot be claimed — by an
  // executor's declared tests least of all.
  const named = new Set(
    verificationBlockers
      .flatMap((v) => String(v?.surface ?? v ?? "").toLowerCase().split(/[^a-z0-9]+/))
      .filter(Boolean),
  );
  // And nothing is proven by an examiner the candidate could have edited. A
  // scope is still a claim about what was established, so it inherits the gate's
  // authority rather than merely its output.
  const provenSurfaces = gateAuthoritative
    ? gateSuites.filter((suite) => !named.has(String(suite).toLowerCase()))
    : [];
  const proven = gateComplete && verificationBlockers.length === 0 ? "OFFLINE-PROVEN" : "IMPLEMENTED";
  const verdicts = reviewVerdicts ?? [];
  if (reviewersRequired > 0) {
    // One dissent is enough; agreement has to be unanimous and complete. Risk 4
    // asks for two independent reviewers, and one PASS is half an answer — it
    // must not be recorded in the same word as the whole one.
    if (verdicts.includes("FAIL")) return at("FIX_PROPOSED", "needs-human", "IMPLEMENTED", provenSurfaces);
    const passed = verdicts.filter((v) => v === "PASS").length;
    if (passed >= reviewersRequired) return at("VERIFIED", "accepted", proven, provenSurfaces);
    return at("FIX_PROPOSED", "needs-review", "IMPLEMENTED", provenSurfaces);
  }
  // The gate passed on a verified commit and this risk level requires no
  // reviewer. That is precisely what was proven, and it is not verification.
  //
  // Unless the candidate edited the checks that produced the pass. Then nobody
  // independent has said anything about this change at all, and the one thing
  // standing behind it was written by the thing it is standing behind.
  if (!gateAuthoritative) return at("FIX_PROPOSED", "needs-review", "IMPLEMENTED", provenSurfaces);
  return at("GATE_PASSED", "accepted", proven, provenSurfaces);
}

// Run one attempt at one task.
//
//   task  { id, identity: {kind, id, slug}, title, spec, taskClass,
//           resolvedBaseSha, gateProfile, contextPaths, fingerprint }
//   plan  { effort, primary, reviewers, verification, mechanismOf }
//   io    { git, spawn, createReportSink, readReport, archiveReport,
//           mainWorktree, harnessRoot, runsDir, reviewsDir, pathExists,
//           realPath, buildPacket, buildReviewBrief }
//
// harnessRoot is the trusted checkout the gate is loaded from, and it is not
// interchangeable with mainWorktree: mainWorktree is where candidate worktrees
// are placed, so it is where the subject lives.
//
// The two builders are injected because the wording of a packet is the
// caller's business; their shape is not. On failure the thrown error carries
// `.stage` and `.attempt`, so a caller that took a claim can record exactly how
// far the attempt got before handing that claim back.
export async function runAttempt(task, plan, io) {
  // Every reviewer the policy asked for, not the first of them.
  let reviewers = plan.reviewers ?? [];
  const attemptId = task.attemptId;
  const attempt = {
    schema: ATTEMPT_SCHEMA,
    attemptId,
    taskId: task.id,
    fingerprint: task.fingerprint,
    taskClass: task.taskClass,
    effort: plan.effort,
    baseRef: task.baseRef,
    resolvedBaseSha: task.resolvedBaseSha,
    startingHead: null,
    workspace: null,
    branch: null,
    workspaceAction: null,
    reviewWorkspace: null,
    primaryAccount: plan.primary.account,
    primaryExecution: plan.primary.execution,
    primaryRuntime: plan.primary.runtime,
    reviewerAccount: reviewers.map((r) => r.account).join(",") || null,
    reviewerExecution: reviewers.map((r) => r.execution).join(",") || null,
    reviewersRequired: plan.verification.reviewers,
    executorAttempts: [],
    autonomousExecution: null,
    reviewVerdicts: [],
    reviewNote: null,
    behavioralRed: null,
    evidenceRequest: null,
    blocker: null,
    verificationBlockers: [],
    provenSurfaces: [],
    commitSha: null,
    candidateOrigin: null,
    candidateSha: null,
    attemptProducedCommitSha: null,
    inheritedCandidateSha: null,
    executorClaimedCommitSha: null,
    controllerObservedCommitSha: null,
    commitEvidence: null,
    changedFiles: [],
    tests: [],
    notes: "",
    newBugs: [],
    gateProfile: task.gateProfile,
    gateAuthorityRevision: null,
    gateWorkspace: null,
    gateAuthority: null,
    gateAuthorityTouched: [],
    gateRuntimeInputs: [],
    gateResult: null,
    gateCoverage: null,
    reviewVerdict: null,
    result: null,
    disposition: null,
    completionLevel: null,
    failureStage: null,
  };

  let stage = "workspace";
  try {
    const workspacePlan = applyWorkspacePlan(
      planWorkspace({
        identity: task.identity,
        baseSha: task.resolvedBaseSha,
        mainWorktree: io.mainWorktree,
        worktrees: parseWorktreeList(io.git(["worktree", "list", "--porcelain"]).stdout),
        branchExists: (branch) => io.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])?.status === 0,
        pathExists: io.pathExists ?? io.exists,
        realPath: io.realPath,
        dirty: false,
      }),
      { git: io.git },
    );
    attempt.workspace = workspacePlan.path;
    attempt.branch = workspacePlan.branch;
    attempt.workspaceAction = workspacePlan.action;

    stage = "base-head";
    attempt.startingHead =
      (io.git(["-C", workspacePlan.path, "rev-parse", "HEAD"]).stdout ?? "").trim() || task.resolvedBaseSha;

    // What the gate says it reads, and what it says it cannot reach. Asked once,
    // here, because it is a property of the trusted checkout and the profile —
    // neither of which changes across a reroute — and because the answer is
    // needed before the first executor runs, not only after the gate has. A
    // declaration that did not arrive establishes nothing: it leaves every
    // untracked path blocking, which is the strict reading, and leaves the
    // gate's own authority "unknown" below exactly as it did before.
    stage = "gate-authority";
    const declaredGate = io.spawn(
      gateArgv({ harnessRoot: io.harnessRoot, profile: task.gateProfile, authority: true }),
      { cwd: io.harnessRoot, role: "gate-authority" },
    );
    const declared =
      declaredGate?.status === 0 && (declaredGate.stdout ?? "").trim() ? declaredGate.stdout : null;
    attempt.gateEvidenceRoots = evidenceRoots(declared);

    // What the workspace was already carrying before any executor of this
    // attempt touched it. A resumed worktree arrives holding sixteen attempts'
    // worth of artifacts, and "this executor left an untracked source file" is a
    // different fact from "one did, nine attempts ago". The rule does not change
    // with the answer — see run/worktree.mjs — but the record has to be able to
    // tell them apart, so the baseline is taken before it can be disturbed.
    stage = "worktree-baseline";
    const baselineStatus = io.git(["-C", workspacePlan.path, "status", "--porcelain"]);
    const gatePaths = parseAuthority(declared);
    attempt.worktreeBaseline =
      baselineStatus?.status === 0
        ? classifyWorktree(baselineStatus.stdout, {
            evidenceRoots: attempt.gateEvidenceRoots.honored,
            gateInputs: [...gatePaths.tracked, ...gatePaths.runtime],
          })
        : null;

    // Two run directories, so nothing handed to the reviewer names the
    // executor's. Whether they are siblings on disk is the caller's choice and
    // is not what makes this safe: assertReviewerIsolation below is. The first
    // is the isolation root for every executor try, which all write inside it,
    // so a reviewer kept out of it is kept out of all of them.
    const executorRunDir = `${io.runsDir}/${attemptId}`;
    const reviewRunDir = `${io.reviewsDir ?? `${io.runsDir}-reviews`}/${attemptId}`;
    const now = io.now ?? (() => Date.now());
    // Started, and described. The controller is the only thing that can say how
    // a runtime ended, so it keeps the launch line, the streams and the clock
    // in one place rather than reading them back out of a verdict.
    const launch = (assignment, role, prompt, { cwd, runDir, reportDir = null }) => {
      const mechanism = plan.mechanismOf(assignment);
      const argv = launchArgv({
        mechanism,
        role,
        model: assignment.model,
        effort: plan.effort,
        authProvider: assignment.runtimeAuth?.provider,
        prompt,
        sessionDir: `${runDir}/session-${role}`,
        workspace: cwd,
        runDir,
        // Granted separately from runDir because it is somewhere else on
        // purpose. A runtime told to write a file it was never given access to
        // is a runtime that will exit clean having written nothing.
        reportDir,
      });
      const env = assignment.runtimeAuth?.env ?? {};
      if (role === "reviewer") {
        assertReviewerIsolation({
          argv,
          template: mechanism?.launch?.[role],
          cwd,
          runDir,
          env,
          executor: { workspace: workspacePlan.path, runDir: executorRunDir },
          realPath: io.realPath,
        });
      }
      const options = { cwd, env, role, account: assignment.account, runId: attemptId, runDir };
      const startedAt = now();
      const result = io.spawn(argv, options);
      return {
        result,
        assignment,
        role,
        cwd,
        argv,
        env,
        template: mechanism?.launch?.[role] ?? null,
        startedAt,
        endedAt: now(),
      };
    };
    // A launch that never happened has reported nothing, so for every role but
    // the executor it stops the attempt where it stands. The executor's own
    // launch is described before that judgement is made — a launch failure is
    // exactly the case the diagnostics exist for.
    const start = (assignment, role, prompt, options) =>
      mustHaveRun(launch(assignment, role, prompt, options).result, `the ${role} runtime`);

    // What the controller saw of one executor try. It is written whatever
    // happened, including a launch that never happened, and a failure to write
    // it never costs the run: bookkeeping does not outrank work.
    const describe = (started, { runId, reportPresentAtExit }) => {
      const described = describeExecution({
        role: started.role,
        runId,
        account: started.assignment.account,
        execution: started.assignment.execution,
        runtime: started.assignment.runtime,
        model: started.assignment.model ?? null,
        effort: plan.effort,
        cwd: started.cwd,
        argv: started.argv,
        template: started.template,
        env: started.env,
        result: started.result,
        startedAt: started.startedAt,
        endedAt: started.endedAt,
        reportPath: `${runId}/report-${started.role}.json`,
        reportPresentAtExit,
      });
      try {
        return { ...described, path: io.recordProcess?.(runId, started.role, described) ?? null, error: null };
      } catch (err) {
        return { ...described, path: null, error: detail(err.message) };
      }
    };

    // A report the contract rejects means this executor did not deliver a usable
    // answer. That is executor-incomplete work — not a fact anyone outside the
    // run owes — so the next eligible executor gets the same workspace before a
    // human is asked for anything.
    //
    // The loop replaces who is writing, never what has been written: the
    // worktree, its branch, its starting head and everything already committed
    // on it are established above and are not touched here. One executor holds
    // it at a time, in sequence, so single-writer ownership is exactly what it
    // was with one executor.
    let executor = plan.primary;
    const tried = [];
    let reported = null;
    let rejection = null;

    for (;;) {
      attempt.primaryAccount = executor.account;
      attempt.primaryExecution = executor.execution;
      attempt.primaryRuntime = executor.runtime;
      attempt.reviewerAccount = reviewers.map((r) => r.account).join(",") || null;
      attempt.reviewerExecution = reviewers.map((r) => r.execution).join(",") || null;

      // Each try reports into its own directory. Sharing one would let a
      // rerouted executor that wrote nothing be judged on the previous
      // executor's file — the run would read the refusal twice and blame the
      // wrong account. The first try keeps the original path.
      const tryRunId = tried.length === 0 ? attemptId : `${attemptId}/executor-${tried.length + 1}`;
      const tryRunDir = `${io.runsDir}/${tryRunId}`;

      // Where this try's answer will be written, established before the turn
      // is spent. The mandatory report used to be due inside the repository's
      // own `.git`, and a runtime whose policy forbids writing there did the
      // work, found nowhere to put it, and exited clean — which the lifecycle
      // reads, correctly, as an executor that did not answer. The rule was
      // right and the address was wrong. Creating the sink here also proves it
      // writable now, when that costs a file operation rather than a turn.
      stage = "report-sink";
      const sink = io.createReportSink(tryRunId, "executor");

      // What this try found the workspace holding, before it ran. The attempt
      // baseline says what nobody in this attempt is answerable for; this says
      // what nobody in this *try* is. On the first try they are the same
      // snapshot taken twice, which costs one `git status` and keeps the record
      // from having to explain a missing field.
      stage = "worktree-try-baseline";
      const tryStatus = io.git(["-C", workspacePlan.path, "status", "--porcelain"]);
      const tryBaseline =
        tryStatus?.status === 0
          ? classifyWorktree(tryStatus.stdout, {
              evidenceRoots: attempt.gateEvidenceRoots.honored,
              gateInputs: [...gatePaths.tracked, ...gatePaths.runtime],
            })
          : null;

      stage = "executor-launch";
      const started = launch(
        executor,
        "executor",
        io.buildPacket({
          task,
          attemptId,
          workspace: workspacePlan.path,
          reportPath: sink.path,
          // What kind of workspace this is, and where it starts. A resumed
          // workspace legitimately starts ahead of the pinned base — it may
          // start *at* this issue's candidate — and an executor told only the
          // base reads that as a mismatch it has to stop for.
          workspaceAction: workspacePlan.action,
          startingHead: attempt.startingHead,
          // How many executors already worked this attempt here. A rerouted
          // try inherits the workspace exactly as the refused one left it, so
          // its head may be ahead of STARTING_HEAD for a reason that has
          // nothing to do with resuming — and being told to stop for it would
          // be the same defect one try later.
          priorTries: tried.length,
        }),
        { cwd: workspacePlan.path, runDir: tryRunDir, reportDir: sink.dir },
      );
      const launched = started.result;

      // Written before anything is concluded from how it ended, so a launch
      // that never happened — which stops the attempt two lines below — is as
      // diagnosable as a program that ran and exited 1.
      stage = "executor-diagnostics";
      const diagnosed = describe(started, {
        runId: tryRunId,
        reportPresentAtExit: io.reportExists ? io.reportExists(tryRunId, "executor") : null,
      });
      stage = "executor-launch";
      mustHaveRun(launched, "the executor runtime");

      // A report that parsed says the execution ran to the point of answering,
      // so whatever it says, it was not interrupted; if the contract refuses
      // it, that is the refusal this loop exists for.
      //
      // No report is two different facts, and they must not be spelled the same
      // way. A runtime that never reached its own exit — killed, or dead on a
      // nonzero abnormal termination — was interrupted, and that is the
      // controller's observation to make. A runtime that ran to a clean exit
      // and wrote nothing was not interrupted by anything: it was handed the
      // report path in its packet and declined the protocol. That is
      // executor-incomplete work, and it takes the road every other unshowable
      // claim takes. Spelling it INTERRUPTED gave a protocol failure the one
      // word that owes nobody an explanation, and stopped the run instead of
      // rerouting it.
      stage = "executor-report";
      let candidate = null;
      try {
        const raw = io.readReport(tryRunId, "executor");
        if (raw) {
          candidate = io.normalizeReport(raw);
        } else if (didRun(launched) && launched.status === 0) {
          rejection = `missing-required-report: the executor exited 0 without writing report-executor.json`;
        } else {
          candidate = controllerResult(
            task.fingerprint,
            "INTERRUPTED",
            `executor ${howItEnded(launched)} without a report` +
              (diagnosed.path ? `; process diagnostics at ${diagnosed.path}` : ""),
          );
        }
      } catch (err) {
        rejection = detail(err.message);
      }
      // Run history belongs to the controller, so the controller is what writes
      // it — and it keeps the raw bytes whether or not they parsed, because a
      // file that is not a report is exactly the file a person debugging this
      // needs to see.
      stage = "report-archive";
      io.archiveReport(tryRunId, "executor");

      // FIX_PROPOSED is a claim about the repository, and the repository is the
      // controller's to read. An executor cannot make a commit exist by naming
      // it, so the claim is checked here — as part of whether the disposition
      // is accepted at all, not afterwards as a cap on what it may conclude.
      //
      // Afterwards was the bug. The contract can check that a sha is
      // well-formed; only git can check that it is real, and asking git after
      // the answer had already been accepted meant a fix nobody committed
      // reached the ledger as a proposed fix with the refusal filed beside it.
      // A claim the repository refuses is not a weaker result: it is not a
      // result, and it takes the road every other unshowable claim takes.
      let evidence = null;
      if (candidate?.result === "FIX_PROPOSED") {
        stage = "commit-evidence";
        evidence = verifyCommitEvidence({
          reportedSha: candidate.commitSha,
          startingHead: attempt.startingHead,
          // A resumed workspace starts at the previous attempt's candidate, so
          // "this attempt committed nothing" and "there is no candidate" are
          // different facts. The pinned base is what tells them apart.
          resolvedBaseSha: task.resolvedBaseSha,
          workspace: workspacePlan.path,
          git: io.git,
          // Which of what git reports could have reached the gate, and what was
          // already here before this attempt started.
          declared,
          baseline: attempt.worktreeBaseline,
          tryBaseline,
        });
        attempt.commitEvidence = evidence;
        if (!evidence.ok) {
          rejection = detail(`the reported commit could not be established: ${evidence.code} — ${evidence.reason}`);
          candidate = null;
        }
        stage = "executor-report";
      }

      tried.push(executor.account);
      attempt.executorAttempts.push({
        account: executor.account,
        execution: executor.execution,
        accepted: candidate !== null,
        reason: candidate ? null : rejection,
        commitEvidence: evidence,
        // How the runtime ended, and where the rest of it was kept. The summary
        // rides on the record so a ledger line can be rendered without opening
        // the file; the file is where the streams are.
        process: {
          didRun: diagnosed.process.didRun,
          termination: diagnosed.process.termination,
          exitStatus: diagnosed.process.exitStatus,
          signal: diagnosed.process.signal,
          durationMs: diagnosed.process.durationMs,
          reportPresentAtExit: diagnosed.process.report.presentAtExit,
        },
        diagnostics: diagnosed.path,
        diagnosticsError: diagnosed.error,
      });
      if (candidate) {
        reported = candidate;
        break;
      }

      const next = plan.reroute?.(tried) ?? null;
      // Fail closed on anything that is not a fresh, eligible, ready crew: a
      // reroute that cannot name one is exhaustion, and exhaustion is recorded
      // as what it is rather than dressed up as a missing external fact.
      if (!next?.ok || !next.primary || tried.includes(next.primary.account)) {
        attempt.autonomousExecution = {
          state: "exhausted",
          tried: [...tried],
          reason: next?.reason ? `${rejection}; ${next.reason}` : rejection,
        };
        break;
      }
      executor = next.primary;
      // Re-planned together, because an alternate executor drawn from the pool
      // may be the account that was reviewing. A reviewer that is also the
      // executor is not an independent check, and no reroute may create one.
      reviewers = next.reviewers ?? [];
    }

    if (!reported) {
      // Concluded by the controller, never reported: no executor said this.
      reported = controllerResult(
        task.fingerprint,
        "INVALID_DISPOSITION",
        `no eligible executor produced a valid disposition after ${tried.length}: ${attempt.autonomousExecution?.reason ?? rejection}`,
      );
    }
    attempt.behavioralRed = reported.behavioralRed;
    attempt.evidenceRequest = reported.evidenceRequest;
    attempt.blocker = reported.blocker;
    attempt.verificationBlockers = reported.verificationBlockers ?? [];
    attempt.tests = reported.tests;
    attempt.notes = reported.notes;
    attempt.newBugs = reported.newBugs;

    // Three separate facts, kept separate. What the executor said, what git
    // said about it, and which of the two the rest of the lifecycle is allowed
    // to use. Collapsing them is how a string a model wrote came to be filed as
    // the commit a run produced; only the last of them is authoritative, and it
    // is null until git has established it.
    const evidence = attempt.commitEvidence;
    attempt.executorClaimedCommitSha = evidence?.claimedSha ?? null;
    attempt.controllerObservedCommitSha = evidence?.observedSha ?? null;
    attempt.commitSha = evidence?.ok ? evidence.commitSha : null;
    // And where the candidate came from, which a later reader cannot recover
    // from the sha alone: an attempt that validated an inherited candidate and
    // one that produced its own leave the same commit id behind.
    attempt.candidateOrigin = evidence?.ok ? evidence.candidateOrigin : null;
    attempt.candidateSha = evidence?.ok ? evidence.candidateSha : null;
    attempt.attemptProducedCommitSha = evidence?.ok ? evidence.attemptProducedCommitSha : null;
    attempt.inheritedCandidateSha = evidence?.ok ? evidence.inheritedCandidateSha : null;
    attempt.changedFiles = evidence?.changedFiles ?? [];

    stage = "gate";
    // Which definition of PASS ran, and over what. Both are read off the run
    // rather than assumed, so a record can answer "whose gate was that?".
    attempt.gateAuthorityRevision =
      (io.git(["-C", io.harnessRoot ?? ".", "rev-parse", "HEAD"])?.stdout ?? "").trim() || null;
    attempt.gateWorkspace = workspacePlan.path;
    const gate = mustHaveRun(
      io.spawn(
        gateArgv({ harnessRoot: io.harnessRoot, profile: task.gateProfile, worktree: workspacePlan.path }),
        { cwd: io.harnessRoot, role: "gate" },
      ),
      "the gate",
    );
    attempt.gateResult = gate.status === 0 ? "PASS" : "FAIL";
    attempt.gateCoverage = parseGateCoverage(gate.stdout, task.gateProfile);

    // A trusted runner still reads its checks out of the workspace it judges,
    // so running it is not the whole of independence: a diff that edits those
    // checks decides what its own PASS means. The run is kept either way — the
    // candidate's tests are evidence — but evidence is not authority, and a
    // pass produced this way may not advance the ledger on its own.
    // A declaration that did not arrive establishes nothing. Reading silence as
    // "the examiner was untouched" would make every failed lookup an upgrade,
    // so an unanswered question stays unanswered and does not advance alone.
    if (declared === null) {
      attempt.gateAuthority = "unknown";
      attempt.gateAuthorityTouched = [];
      attempt.gateRuntimeInputs = [];
    } else {
      attempt.gateAuthorityTouched = authorityTouched(attempt.changedFiles, declared);
      // A trusted runner reading trusted checks still executed them with
      // whatever the workspace was already holding. npm resolves its runner and
      // every library under test from a dependency tree, cargo re-runs a
      // compiled artifact it considers fresh, python prefers cached bytecode to
      // the source beside it — the executor can write all of it and no diff can
      // show it. The gate declares which of those trees each suite consumes;
      // this only asks whether they were there. A pass produced over one is an
      // observation rather than a finding: kept, recorded, and not permitted to
      // certify on its own.
      attempt.gateRuntimeInputs = runtimeInputs(declared, {
        workspace: workspacePlan.path,
        pathExists: io.pathExists,
      });
      attempt.gateAuthority = attempt.gateAuthorityTouched.length
        ? "candidate-influenced"
        : attempt.gateRuntimeInputs.length
          ? "environment-influenced"
          : "controller";
    }

    stage = "review";
    if (reviewers.length && evidence?.ok && attempt.gateResult === "PASS") {
      // A detached checkout of the commit git established, so the reviewer's
      // subject is fixed, is not the executor's mutable workspace, and cannot
      // move under it while it reads.
      const review = reviewPaths(io.mainWorktree, attemptId);
      const added = io.git(["worktree", "add", "--detach", review.path, evidence.commitSha]);
      if (!added || added.status !== 0) {
        // A review that could not be set up is a review that did not happen.
        // Throwing here would throw away a git-verified commit and a passing
        // gate and record the attempt as INTERRUPTED — a worse account of the
        // run than "nobody reviewed it", and one that loses real evidence.
        attempt.reviewNote = `the review workspace could not be created: ${detail(added?.stderr) || `git exited ${added?.status ?? "?"}`}`;
        attempt.reviewVerdicts = reviewers.map(() => "NO_REPORT");
      } else {
        attempt.reviewWorkspace = review.path;
        try {
          // Measured from whatever the candidate is a change to. For an
          // inherited candidate that is the pinned base; diffing it against the
          // head this attempt started from is diffing it against itself, and
          // would hand the reviewer nothing to review.
          const diff = (io.git(["-C", review.path, "diff", evidence.diffBase, evidence.commitSha]).stdout ?? "").slice(0, 60000);
          for (const [index, reviewer] of reviewers.entries()) {
            const answer = start(
              reviewer,
              "reviewer",
              io.buildReviewBrief({
                task,
                commitSha: evidence.commitSha,
                startingHead: evidence.diffBase,
                workspace: review.path,
                diff,
                gateOutput: `${gate?.stdout ?? ""}${gate?.stderr ?? ""}`.slice(-4000),
                // Not decoration: "the gate outranks you" is only true of a gate
                // the controller can stand behind, and a reviewer told it about
                // any other one defers to the candidate's own runtime.
                gateResult: attempt.gateResult,
                gateAuthority: attempt.gateAuthority,
              }),
              // Its own run directory, so two reviewers do not share a session.
              { cwd: review.path, runDir: `${reviewRunDir}/${index}` },
            );
            // The verdict is read from what this reviewer's own process printed.
            // A reviewer is launched read-only and writes nothing, so a
            // report-reviewer.json on disk could only have been put there by
            // something that is not the reviewer — and the executor is the one
            // process with write access to that tree.
            const verdict = lastJsonObject(answer?.stdout)?.verdict;
            attempt.reviewVerdicts.push(verdict === "PASS" || verdict === "FAIL" ? verdict : "NO_REPORT");
          }
        } finally {
          // A leaked review checkout is untidy; failing the attempt over it
          // would discard verdicts that were already reached.
          io.git(["worktree", "remove", "--force", review.path]);
        }
      }
      attempt.reviewVerdict = attempt.reviewVerdicts.join("+") || null;
    }

    stage = "conclude";
    const concluded = concludeAttempt({
      reported,
      gateResult: attempt.gateResult,
      reviewVerdicts: attempt.reviewVerdicts,
      reviewersRequired: plan.verification.reviewers,
      commitVerified: Boolean(evidence?.ok),
      gateComplete: (attempt.gateCoverage?.notCovered?.length ?? 0) === 0,
      gateSuites: attempt.gateCoverage?.suites ?? [],
      gateAuthoritative: attempt.gateAuthority === "controller",
      verificationBlockers: attempt.verificationBlockers,
    });
    attempt.result = concluded.result;
    attempt.disposition = concluded.disposition;
    attempt.completionLevel = concluded.completionLevel;
    attempt.provenSurfaces = concluded.provenSurfaces;
    return attempt;
  } catch (err) {
    attempt.failureStage = stage;
    err.stage = stage;
    err.attempt = attempt;
    throw err;
  }
}

// The gate preflight, which establishes that the requested profile exists and
// that the gate itself can run — before anything is claimed or started.
//
// verify-task.sh is the profile authority, and it can only exercise that
// authority if it ran. A script that was never found, a directory that does not
// exist, and a profile the gate refused are three different facts about a run,
// and reading `status` alone reports all three as the third one. Each cause
// gets its own code, and anything unrecognised fails closed.
const CANNOT_LAUNCH = /No such file or directory|command not found|Permission denied|cannot execute/i;
const REJECTED_PROFILE = /^unknown profile:/m;


export function classifyGatePreflight(result, profile) {
  const launchFailed = (why) => ({
    ok: false,
    code: "gate-preflight-launch-failed",
    reason: `the gate could not be started to plan profile ${profile}: ${why}`,
  });
  const failed = (why) => ({ ok: false, code: "gate-preflight-failed", reason: `${why} while planning profile ${profile}` });

  if (result?.error) return launchFailed(detail(result.error.message) || result.error.code || "the launch failed");
  if (!didRun(result)) {
    return result?.signal ? failed(`the gate was killed by ${result.signal}`) : launchFailed("the gate never ran");
  }
  if (result.status === 0) {
    // Proof it was this gate that answered, not something else exiting clean.
    if (!new RegExp(`^PROFILE: ${profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(result.stdout)) {
      return failed("the gate exited 0 without planning the profile");
    }
    // Known before the executor is launched: a profile whose checks are run by
    // ignored state inside the workspace cannot certify its own subject however
    // it exits. A plan that does not say is not a plan that said none.
    return { ok: true, autonomous: /^RUNTIME AUTHORITY: none$/m.test(result.stdout) };
  }
  if (result.status === 127 || CANNOT_LAUNCH.test(result.stderr)) {
    return launchFailed(detail(result.stderr) || "the gate script was not found");
  }
  if (REJECTED_PROFILE.test(result.stderr)) {
    return { ok: false, code: "unknown-gate-profile", reason: `the gate rejected profile ${profile}` };
  }
  return failed(`the gate exited ${result.status}`);
}
