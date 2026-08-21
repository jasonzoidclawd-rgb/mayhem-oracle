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

const SHA = /^[0-9a-f]{40}$/;

// Fail closed, and name the specific thing that could not be established.
// "unverified" is one word for six different defects, and an operator reading
// the record needs to know which one happened.
const fail = (code, reason, over = {}) => ({
  ok: false,
  code,
  reason,
  commitSha: null,
  head: null,
  startingHead: null,
  changedFiles: [],
  ...over,
});

export function verifyCommitEvidence({ reportedSha, startingHead, workspace, git }) {
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
  // Is it this run's work, or someone else's commit that happens to exist?
  if (at(["merge-base", "--is-ancestor", startingHead, sha])?.status !== 0) {
    return fail("commit-not-descended", `${sha} does not descend from ${startingHead}`, { startingHead, head });
  }
  // Is it the state that was gated? A report naming an earlier commit while
  // the workspace moved on describes work no deterministic gate ever ran on.
  if (head !== sha) {
    return fail("commit-not-head", `the report names ${sha} but the gated workspace is at ${head}`, { startingHead, head });
  }
  // A commit that is the starting head is not a commit this attempt made: the
  // executor reported a fix and committed nothing.
  if (sha === startingHead) {
    return fail("commit-is-starting-head", `${sha} is the head this attempt started from; nothing was committed`, {
      startingHead,
      head,
    });
  }
  // Uncommitted changes mean the gate tested something the commit does not
  // contain, so a passing gate says nothing about the commit. A `status` that
  // could not be run has not established cleanliness, and an unanswered
  // question is not a clean answer.
  const status = at(["status", "--porcelain"]);
  if (status?.status !== 0) {
    return fail("cleanliness-unknown", "the workspace could not be checked for uncommitted changes", { startingHead, head });
  }
  if ((status.stdout ?? "").trim()) {
    return fail("worktree-dirty", "the workspace carries uncommitted changes, so the gate did not test this commit", {
      startingHead,
      head,
    });
  }

  const changed = at(["diff", "--name-only", startingHead, sha]);
  if (changed?.status !== 0) {
    return fail("diff-unreadable", `the change from ${startingHead} to ${sha} could not be read`, { startingHead, head });
  }
  const changedFiles = (changed.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // A commit that changes no file is not the fix it claims to be.
  if (changedFiles.length === 0) {
    return fail("commit-changes-nothing", `${sha} changes no file relative to ${startingHead}`, { startingHead, head });
  }

  return {
    ok: true,
    code: null,
    reason: null,
    commitSha: sha,
    head,
    startingHead,
    changedFiles,
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
