// Per-task execution isolation, derived rather than configured.
//
// git still owns worktrees; this module only decides which one a task gets and
// refuses the cases where git would happily do the wrong thing. It never
// discards work: an existing workspace for this task is resumed exactly as the
// executor left it, and anything ambiguous is an error instead of a recovery.
//
// It knows nothing about where a task came from. Identity is a small value:
//
//   { kind, id, slug }
//
//   kind  what sort of task this is — names the directory and branch prefix
//   id    immutable within that kind; this and kind alone decide identity
//   slug  presentation only, from a title that may be edited at any time
//
// The split is the point. A GitHub issue renamed after work started still
// resolves to the workspace its number already owns.

import { basename, dirname, join } from "node:path";

export class WorkspaceError extends Error {}

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

// Bounded, and never cut mid-word: a branch named ...-async-transpor reads as
// corruption rather than as a shortened title.
export function slugFor(title, limit = 48) {
  const words = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean);
  const kept = [];
  for (const word of words) {
    if (kept.length && [...kept, word].join("-").length > limit) break;
    kept.push(word);
  }
  return kept.join("-").slice(0, limit) || "task";
}

// Derived from the main worktree's own location, so no username, no home
// directory, and no absolute path is written down anywhere.
export function workspacePaths(mainWorktree, { kind, id, slug }) {
  const root = join(dirname(mainWorktree), `${basename(mainWorktree)}-worktrees`, `${kind}s`);
  return { path: join(root, `${id}-${slug}`), branch: `${kind}/${id}-${slug}` };
}

// A reviewer's workspace, derived the same way but under its own root. It holds
// a detached checkout of the commit under review and is removed when the review
// ends, so it is named by the attempt rather than by the task.
export function reviewPaths(mainWorktree, attemptId) {
  const root = join(dirname(mainWorktree), `${basename(mainWorktree)}-worktrees`, "reviews");
  return { path: join(root, attemptId) };
}

// `git worktree list` reports realised paths, so a worktree reached through a
// symlinked prefix (/tmp -> /private/tmp) is reported under a name that never
// string-matches the derived one. Comparing raw paths would miss an existing
// worktree and then refuse to create it — a resume that fails closed for no
// reason. Identity is therefore the realised path on both sides.
export function planWorkspace({ identity, baseSha, mainWorktree, worktrees = [], branchExists, pathExists, dirty = false, realPath = (p) => p }) {
  const { path, branch } = workspacePaths(mainWorktree, identity);
  const same = (a, b) => a === b || realPath(a) === realPath(b);

  // The slug-derived path is only a creation decoration. Once created, the
  // immutable kind+id in the branch identifies its workspace across title
  // edits, so resume the registered path rather than deriving a second one.
  const branchPrefix = `${identity.kind}/${identity.id}-`;
  const atExpectedPath = worktrees.find((w) => same(w.path, path));
  if (atExpectedPath && atExpectedPath.branch !== branch) {
    throw new WorkspaceError(
      `${path} is a worktree of branch ${atExpectedPath.branch ?? "(detached)"}, not ${branch}; it belongs to another task`,
    );
  }
  const registered = atExpectedPath
    ?? worktrees.find((w) => w.branch?.startsWith(branchPrefix));
  if (registered) {
    // Resume exactly as found. No git command at all, so there is no path by
    // which uncommitted work could be discarded.
    return { action: "resume", path: registered.path, branch: registered.branch, dirty: Boolean(dirty), git: [] };
  }

  if (pathExists(path)) {
    throw new WorkspaceError(`${path} already exists but git does not know it as a worktree; refusing to write into it`);
  }
  const elsewhere = worktrees.find((w) => w.branch === branch);
  if (elsewhere) {
    throw new WorkspaceError(`branch ${branch} is already checked out at ${elsewhere.path}`);
  }
  if (branchExists(branch)) {
    throw new WorkspaceError(`branch ${branch} already exists; refusing to move another task's branch`);
  }

  return { action: "create", path, branch, dirty: false, git: [["worktree", "add", "-b", branch, path, baseSha]] };
}

export function applyWorkspacePlan(plan, { git }) {
  for (const argv of plan.git) {
    const answer = git(argv);
    if (!answer || answer.status !== 0) {
      throw new WorkspaceError(`git ${argv.join(" ")} exited ${answer?.status ?? "?"}: ${(answer?.stderr ?? "").trim()}`);
    }
  }
  return plan;
}
