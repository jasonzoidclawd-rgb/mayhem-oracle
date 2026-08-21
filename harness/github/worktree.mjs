// Per-issue execution isolation, derived rather than configured.
//
// git still owns worktrees; this module only decides which one an issue gets
// and refuses the cases where git would happily do the wrong thing. It never
// discards work: an existing worktree for this issue is resumed exactly as the
// executor left it, and anything ambiguous is an error instead of a recovery.

import { basename, dirname, join } from "node:path";
import { slugFor } from "./issue-contract.mjs";

export class WorktreeError extends Error {}

export function parseWorktreeList(porcelain) {
  const entries = [];
  let current = null;
  for (const line of String(porcelain ?? "").split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9).trim(), head: null, branch: null };
      entries.push(current);
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice(5).trim();
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    }
  }
  return entries;
}

// Derived from the main worktree's own location, so no username, no home
// directory, and no absolute path is written down anywhere.
export function issuePaths(mainWorktree, number, slug) {
  const root = join(dirname(mainWorktree), `${basename(mainWorktree)}-worktrees`, "issues");
  return { path: join(root, `${number}-${slug}`), branch: `issue/${number}-${slug}` };
}

// `git worktree list` reports realised paths, so a worktree reached through a
// symlinked prefix (/tmp -> /private/tmp) is reported under a name that never
// string-matches the derived one. Comparing raw paths would miss an existing
// worktree and then refuse to create it — a resume that fails closed for no
// reason. Identity is therefore the realised path on both sides.
export function planIssueWorktree({ number, title, baseSha, mainWorktree, worktrees = [], branchExists, pathExists, dirty = false, realPath = (p) => p }) {
  const slug = slugFor(title);
  const { path, branch } = issuePaths(mainWorktree, number, slug);
  const same = (a, b) => a === b || realPath(a) === realPath(b);

  // The title-derived path is only a creation decoration. Once created, the
  // immutable issue number in the branch identifies its worktree across title
  // edits, so resume the registered path rather than deriving a second one.
  const issueBranchPrefix = `issue/${number}-`;
  const atExpectedPath = worktrees.find((w) => same(w.path, path));
  if (atExpectedPath && atExpectedPath.branch !== branch) {
    throw new WorktreeError(
      `${path} is a worktree of branch ${atExpectedPath.branch ?? "(detached)"}, not ${branch}; it belongs to another task`,
    );
  }
  const registered = atExpectedPath
    ?? worktrees.find((w) => w.branch?.startsWith(issueBranchPrefix));
  if (registered) {
    // Resume exactly as found. No git command at all, so there is no path by
    // which uncommitted work could be discarded.
    return { action: "resume", path: registered.path, branch: registered.branch, dirty: Boolean(dirty), git: [] };
  }

  if (pathExists(path)) {
    throw new WorktreeError(`${path} already exists but git does not know it as a worktree; refusing to write into it`);
  }
  const elsewhere = worktrees.find((w) => w.branch === branch);
  if (elsewhere) {
    throw new WorktreeError(`branch ${branch} is already checked out at ${elsewhere.path}`);
  }
  if (branchExists(branch)) {
    throw new WorktreeError(`branch ${branch} already exists; refusing to move another task's branch`);
  }

  return { action: "create", path, branch, dirty: false, git: [["worktree", "add", "-b", branch, path, baseSha]] };
}

export function applyWorktreePlan(plan, { git }) {
  for (const argv of plan.git) {
    const answer = git(argv);
    if (!answer || answer.status !== 0) {
      throw new WorktreeError(`git ${argv.join(" ")} exited ${answer?.status ?? "?"}: ${(answer?.stderr ?? "").trim()}`);
    }
  }
  return plan;
}
