// Mechanically established facts about what a run actually produced.
//
// A commit sha in an executor's report is a claim, not evidence: it is a
// string a model wrote, and a model that is confused, truncated, or simply
// wrong writes a well-formed 40-hex string just as readily as a correct one.
// Downstream, that string decides what gets reviewed, what gets labelled
// verified, and what a human later believes was proven. So nothing here trusts
// it. Every value this module returns is one git produced.
//
// It is deliberately source-neutral: no GitHub, no issue, no labels. It knows
// a starting point, a workspace, and a claim, and it answers what git says.

import { blockingReason, classifyWorktree, evidenceRoots, parseAuthority, worktreeDelta } from "./worktree.mjs";

const SHA = /^[0-9a-f]{40}$/;

// Fail closed, and name the specific thing that could not be established.
// "unverified" is one word for six different defects, and an operator reading
// the record needs to know which one happened.
const fail = (code, reason, over = {}) => ({
  ok: false,
  code,
  reason,
  observedSha: null,
  commitSha: null,
  head: null,
  startingHead: null,
  candidateOrigin: null,
  candidateSha: null,
  attemptProducedCommitSha: null,
  inheritedCandidateSha: null,
  diffBase: null,
  changedFiles: [],
  worktree: null,
  ...over,
});

// The claim rides on every answer, refusal included. A record that drops it
// cannot show what was refused, and "unverified" with no sha beside it is not
// something an operator can act on.
export function verifyCommitEvidence(args) {
  const claimedSha = typeof args?.reportedSha === "string" && args.reportedSha ? args.reportedSha : null;
  return { ...establishCommit(args), claimedSha };
}

function establishCommit({
  reportedSha,
  startingHead,
  resolvedBaseSha,
  workspace,
  git,
  declared = null,
  baseline = null,
  tryBaseline = null,
}) {
  const at = (argv) => git(["-C", workspace, ...argv]);
  const sha = String(reportedSha ?? "");

  if (!SHA.test(sha)) {
    return fail("commit-missing", `the report named no full commit sha (${JSON.stringify(reportedSha ?? null)})`, { startingHead });
  }
  if (!SHA.test(String(startingHead ?? ""))) {
    return fail("starting-head-unknown", "the run recorded no starting head to measure the result against");
  }

  // What the workspace actually is. Read first, because every check below is a
  // statement about the relationship between the claim and this.
  const headAnswer = at(["rev-parse", "HEAD"]);
  const head = headAnswer?.status === 0 ? (headAnswer.stdout ?? "").trim() : "";
  if (!SHA.test(head)) {
    return fail("head-unreadable", "the resulting HEAD could not be read from the workspace", { startingHead });
  }

  // Does the named object exist, and is it a commit?
  if (at(["cat-file", "-e", `${sha}^{commit}`])?.status !== 0) {
    return fail("commit-not-found", `${sha} is not a commit in this repository`, { startingHead, head });
  }

  // The canonical object id, asked of git rather than assumed from the claim.
  // No character of a commit id may be supplied by the thing being judged: a
  // model that has read `git rev-parse --short HEAD` knows the first seven and
  // can write thirty-three more that are well-formed, share the prefix a human
  // would recognise, and name nothing. Existence and identity are two questions,
  // and only the repository answers either. Everything below is asked about
  // git's answer, so a report cannot steer a single check that follows.
  const resolved = at(["rev-parse", `${sha}^{commit}`]);
  const observedSha = resolved?.status === 0 ? (resolved.stdout ?? "").trim() : "";
  if (!SHA.test(observedSha)) {
    return fail("commit-id-unreadable", `git could not resolve ${sha} to a canonical object id`, { startingHead, head });
  }
  if (observedSha !== sha) {
    return fail("commit-id-mismatch", `the report names ${sha}, which git resolves to ${observedSha}`, {
      startingHead,
      head,
      observedSha,
    });
  }

  // Is it the state that was gated? A report naming an earlier commit while
  // the workspace moved on describes work no deterministic gate ever ran on.
  if (head !== observedSha) {
    return fail("commit-not-head", `the report names ${observedSha} but the gated workspace is at ${head}`, {
      startingHead,
      head,
      observedSha,
    });
  }

  // Which candidate is this: one this attempt produced, or one it inherited?
  //
  // A resumed workspace starts at the previous attempt's commit, and an
  // executor sent to validate that candidate is supposed to report it. Reading
  // "the head I started from" as "nothing was committed" makes the only correct
  // answer unreportable, and pushes a truthful executor toward an empty amend
  // made purely to move the sha. So inheritance is allowed — and, being a claim
  // like any other, it is measured rather than believed. It is measured against
  // the pinned base, which is the one point in this history the attempt did not
  // choose, and every check below then runs against that point instead.
  const inherited = observedSha === startingHead;
  const base = String(resolvedBaseSha ?? "");
  let diffBase = startingHead;
  if (inherited) {
    if (!SHA.test(base)) {
      return fail("base-unknown", "an inherited candidate can only be measured against the pinned base, and none was recorded", {
        startingHead,
        head,
        observedSha,
      });
    }
    // Nothing was inherited: the workspace is sitting on the untouched base, so
    // naming it claims a fix that is the base itself. This is the case the rule
    // was always about.
    if (observedSha === base) {
      return fail("commit-is-starting-head", `${observedSha} is the head this attempt started from; nothing was committed`, {
        startingHead,
        head,
        observedSha,
      });
    }
    diffBase = base;
  }

  // Is it this issue's work, or someone else's commit that happens to exist?
  if (at(["merge-base", "--is-ancestor", diffBase, observedSha])?.status !== 0) {
    return fail("commit-not-descended", `${observedSha} does not descend from ${diffBase}`, {
      startingHead,
      head,
      observedSha,
    });
  }
  // Uncommitted changes mean the gate tested something the commit does not
  // contain, so a passing gate says nothing about the commit. A `status` that
  // could not be run has not established cleanliness, and an unanswered
  // question is not a clean answer.
  const status = at(["status", "--porcelain"]);
  if (status?.status !== 0) {
    return fail("cleanliness-unknown", "the workspace could not be checked for uncommitted changes", {
      startingHead,
      head,
      observedSha,
    });
  }
  // Which of what git reported could actually have reached the gate. Not
  // whether the string was empty: see run/worktree.mjs for why that proxy
  // refuses correct work and would accept contaminated work. With no gate
  // declaration nothing is exempt, so an unanswered question stays the
  // strictest answer rather than becoming a blanket permission.
  const roots = evidenceRoots(declared);
  const gate = parseAuthority(declared);
  const worktree = {
    ...classifyWorktree(status.stdout, {
      evidenceRoots: roots.honored,
      gateInputs: [...gate.tracked, ...gate.runtime],
    }),
    refusedEvidenceRoots: roots.refused,
  };
  // Two questions, asked separately because they have different answers on a
  // rerouted try. What this attempt found already here is not this executor's
  // doing; what appeared since this try started is.
  worktree.delta = worktreeDelta(worktree, baseline);
  worktree.deltaThisTry = worktreeDelta(worktree, tryBaseline ?? baseline);
  if (!worktree.cleanForCandidate) {
    return fail("worktree-dirty", blockingReason(worktree), {
      startingHead,
      head,
      observedSha,
      worktree,
    });
  }

  const changed = at(["diff", "--name-only", diffBase, observedSha]);
  if (changed?.status !== 0) {
    return fail("diff-unreadable", `the change from ${diffBase} to ${observedSha} could not be read`, {
      startingHead,
      head,
      observedSha,
      worktree,
    });
  }
  const changedFiles = (changed.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // A candidate that changes no file is not the fix it claims to be, whether it
  // was made here or inherited.
  if (changedFiles.length === 0) {
    return fail("commit-changes-nothing", `${observedSha} changes no file relative to ${diffBase}`, {
      startingHead,
      head,
      observedSha,
      worktree,
    });
  }

  return {
    ok: true,
    code: null,
    reason: null,
    observedSha,
    commitSha: observedSha,
    head,
    startingHead,
    // The lifecycle sha is git's, on both paths. "Inherited" changes which
    // point the candidate is measured from, never who establishes it.
    candidateOrigin: inherited ? "inherited" : "produced-this-attempt",
    candidateSha: observedSha,
    attemptProducedCommitSha: inherited ? null : observedSha,
    inheritedCandidateSha: inherited ? observedSha : null,
    diffBase,
    changedFiles,
    // Recorded on the way through, not only on refusal. "The gate tested this
    // commit" and "git status was empty" are two different claims, and a record
    // that prints only the first invites a reader to believe the second.
    worktree,
  };
}

// What a gate run actually covered, read out of the gate's own output rather
// than from a second copy of the suite list. A narrow profile that passes is
// not a proven change, and a record that stores only PASS cannot tell the
// difference. verify-task.sh already prints both facts; this only reads them.
export function parseGateCoverage(stdout, profile) {
  const text = String(stdout ?? "");
  const suites = (text.match(/^SUITES: (.*)$/m)?.[1] ?? "").trim().split(/\s+/).filter(Boolean);
  const block = text.split("NOT COVERED BY THIS PROFILE:")[1] ?? "";
  const notCovered = [...block.matchAll(/^\s*-\s+(\S+)/gm)].map((m) => m[1]);
  return { profile, suites, notCovered };
}
