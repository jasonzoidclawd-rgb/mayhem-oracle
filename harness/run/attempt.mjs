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

import { parseGateCoverage, verifyCommitEvidence } from "./evidence.mjs";
import { didRun } from "./process.mjs";
import { applyWorkspacePlan, parseWorktreeList, planWorkspace, reviewPaths } from "./workspace.mjs";

export class AttemptError extends Error {}

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

// Does this file fall under one of the declared authority paths? A trailing
// slash is a directory prefix; `*` matches within one segment and `**` spans
// them, so a suite whose tests sit beside its sources can still name just the
// tests. Anything else is matched literally.
const quote = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function matchesAuthority(file, paths) {
  return (paths ?? []).some((path) => {
    if (path.endsWith("/")) return file.startsWith(path);
    if (!path.includes("*")) return file === path;
    const pattern = quote(path)
      // `/**/` spans zero or more directories, so src/**/*.test.* has to match
      // src/x.test.ts as readily as src/lib/x.test.ts.
      .replace(/\\\*\\\*\//g, "\u0000")
      .replace(/\\\*\\\*/g, "\u0001")
      .replace(/\\\*/g, "[^/]*")
      .replace(/\u0000/g, "(?:.*/)?")
      .replace(/\u0001/g, ".*");
    return new RegExp(`^${pattern}$`).test(file);
  });
}

// Which of the changed files decide what this profile's PASS means. The trusted
// gate declares them per suite because it is already the one place a suite is
// defined; asking it keeps the answer from drifting into a second list here.
export function authorityTouched(changedFiles, declared) {
  const paths = String(declared ?? "")
    .split("\n")
    .map((line) => line.split("\t")[1]?.trim())
    .filter(Boolean);
  return (changedFiles ?? []).filter((file) => matchesAuthority(file, paths));
}

// Operator-facing text. A launch failure's message can carry the absolute path
// it tried, which names the machine; one line, no paths, capped.
export const detail = (text) =>
  String(text ?? "")
    .trim()
    .split("\n")[0]
    .replace(/(^|\s)\/\S+/g, "$1<path>")
    .slice(0, 200);

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
export function launchArgv({ mechanism, role, model, effort, authProvider, prompt, sessionDir, workspace, runDir }) {
  const template = mechanism?.launch?.[role];
  if (!Array.isArray(template) || template.length === 0) {
    throw new AttemptError(`execution mechanism declares no ${role} launch argv; it cannot be started by guesswork`);
  }
  const values = { model, effort, authProvider, prompt, sessionDir, worktree: workspace, runDir };
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
  gateAuthoritative = true,
}) {
  const at = (result, disposition, completionLevel = null) => ({ result, disposition, completionLevel });

  if (reported.result !== "FIX_PROPOSED") {
    const disposition = { NEEDS_EVIDENCE: "needs-evidence", BLOCKED: "blocked", INTERRUPTED: "needs-human" }[reported.result];
    // Only results an executor may actually report reach here; a concluded-only
    // one arriving means the report contract was bypassed, and guessing a
    // disposition for it would write an undefined state onto the caller's ledger.
    if (!disposition) throw new AttemptError(`${reported.result} is concluded, not reported; it has no reported-result disposition`);
    return at(reported.result, disposition);
  }
  // A commit git could not establish is not work anyone can accept, however
  // green the gate looks: the gate did not necessarily run on it.
  if (!commitVerified) return at("FIX_PROPOSED", "needs-human");
  if (gateResult !== "PASS") return at("FIX_PROPOSED", "needs-human", "IMPLEMENTED");
  // A profile that skipped suites did not prove the change offline, however
  // green the suites it did run came back. The default profile skips most of
  // them, so treating any PASS as OFFLINE-PROVEN overstates nearly every run.
  const proven = gateComplete ? "OFFLINE-PROVEN" : "IMPLEMENTED";
  const verdicts = reviewVerdicts ?? [];
  if (reviewersRequired > 0) {
    // One dissent is enough; agreement has to be unanimous and complete. Risk 4
    // asks for two independent reviewers, and one PASS is half an answer — it
    // must not be recorded in the same word as the whole one.
    if (verdicts.includes("FAIL")) return at("FIX_PROPOSED", "needs-human", "IMPLEMENTED");
    const passed = verdicts.filter((v) => v === "PASS").length;
    if (passed >= reviewersRequired) return at("VERIFIED", "accepted", proven);
    return at("FIX_PROPOSED", "needs-review", "IMPLEMENTED");
  }
  // The gate passed on a verified commit and this risk level requires no
  // reviewer. That is precisely what was proven, and it is not verification.
  //
  // Unless the candidate edited the checks that produced the pass. Then nobody
  // independent has said anything about this change at all, and the one thing
  // standing behind it was written by the thing it is standing behind.
  if (!gateAuthoritative) return at("FIX_PROPOSED", "needs-review", "IMPLEMENTED");
  return at("GATE_PASSED", "accepted", proven);
}

// Run one attempt at one task.
//
//   task  { id, identity: {kind, id, slug}, title, spec, taskClass,
//           resolvedBaseSha, gateProfile, contextPaths, fingerprint }
//   plan  { effort, primary, reviewers, verification, mechanismOf }
//   io    { git, spawn, readReport, mainWorktree, harnessRoot, runsDir,
//           reviewsDir, pathExists, realPath, buildPacket, buildReviewBrief }
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
  const reviewers = plan.reviewers ?? [];
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
    reviewVerdicts: [],
    reviewNote: null,
    behavioralRed: null,
    commitSha: null,
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

    // Two run directories, so nothing handed to the reviewer names the
    // executor's. Whether they are siblings on disk is the caller's choice and
    // is not what makes this safe: assertReviewerIsolation below is.
    const executorRunDir = `${io.runsDir}/${attemptId}`;
    const reviewRunDir = `${io.reviewsDir ?? `${io.runsDir}-reviews`}/${attemptId}`;
    const start = (assignment, role, prompt, { cwd, runDir }) => {
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
      return mustHaveRun(io.spawn(argv, options), `the ${role} runtime`);
    };

    stage = "executor-launch";
    const launched = start(
      plan.primary,
      "executor",
      io.buildPacket({
        task,
        attemptId,
        workspace: workspacePlan.path,
        reportPath: `${executorRunDir}/report-executor.json`,
      }),
      { cwd: workspacePlan.path, runDir: executorRunDir },
    );

    // An unreadable or contract-violating report is an INTERRUPTED attempt,
    // never a fix: the record says the attempt happened and why it did not count.
    stage = "executor-report";
    let reported;
    try {
      const raw = io.readReport(attemptId, "executor");
      reported = io.normalizeReport(raw ?? { result: "INTERRUPTED", notes: `executor exited ${launched?.status ?? "?"} without a report` });
    } catch (err) {
      reported = io.normalizeReport({ result: "INTERRUPTED", notes: `report rejected: ${detail(err.message)}` });
    }
    attempt.behavioralRed = reported.behavioralRed;
    attempt.commitSha = reported.commitSha;
    attempt.tests = reported.tests;
    attempt.notes = reported.notes;
    attempt.newBugs = reported.newBugs;

    // Before the gate, because a workspace that is dirty or not at the reported
    // commit makes the gate's verdict a statement about something else.
    stage = "commit-evidence";
    const evidence =
      reported.result === "FIX_PROPOSED"
        ? verifyCommitEvidence({
            reportedSha: reported.commitSha,
            startingHead: attempt.startingHead,
            workspace: workspacePlan.path,
            git: io.git,
          })
        : null;
    attempt.commitEvidence = evidence;
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
    const declared = io.spawn(
      gateArgv({ harnessRoot: io.harnessRoot, profile: task.gateProfile, authority: true }),
      { cwd: io.harnessRoot, role: "gate-authority" },
    );
    // A declaration that did not arrive establishes nothing. Reading silence as
    // "the examiner was untouched" would make every failed lookup an upgrade,
    // so an unanswered question stays unanswered and does not advance alone.
    if (declared?.status !== 0 || !(declared.stdout ?? "").trim()) {
      attempt.gateAuthority = "unknown";
      attempt.gateAuthorityTouched = [];
    } else {
      attempt.gateAuthorityTouched = authorityTouched(attempt.changedFiles, declared.stdout);
      attempt.gateAuthority = attempt.gateAuthorityTouched.length ? "candidate-influenced" : "controller";
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
          const diff = (io.git(["-C", review.path, "diff", evidence.startingHead, evidence.commitSha]).stdout ?? "").slice(0, 60000);
          for (const [index, reviewer] of reviewers.entries()) {
            const answer = start(
              reviewer,
              "reviewer",
              io.buildReviewBrief({
                task,
                commitSha: evidence.commitSha,
                startingHead: evidence.startingHead,
                workspace: review.path,
                diff,
                gateOutput: `${gate?.stdout ?? ""}${gate?.stderr ?? ""}`.slice(-4000),
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
      gateAuthoritative: attempt.gateAuthority === "controller",
    });
    attempt.result = concluded.result;
    attempt.disposition = concluded.disposition;
    attempt.completionLevel = concluded.completionLevel;
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
    return new RegExp(`^PROFILE: ${profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(result.stdout)
      ? { ok: true }
      : failed("the gate exited 0 without planning the profile");
  }
  if (result.status === 127 || CANNOT_LAUNCH.test(result.stderr)) {
    return launchFailed(detail(result.stderr) || "the gate script was not found");
  }
  if (REJECTED_PROFILE.test(result.stderr)) {
    return { ok: false, code: "unknown-gate-profile", reason: `the gate rejected profile ${profile}` };
  }
  return failed(`the gate exited ${result.status}`);
}
