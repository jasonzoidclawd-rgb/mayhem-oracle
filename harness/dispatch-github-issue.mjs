#!/usr/bin/env node
// Local dispatch entry point: the one place the GitHub adapter meets the real
// machine. Every effect the adapter needs — gh, git, subprocesses, files, the
// local lock — is constructed here and injected, so the adapter itself stays
// offline-testable.
//
//   node harness/dispatch-github-issue.mjs <issue> [--dry-run]
//                                                  [--available A,B] [--repo owner/name]
//
// It never pushes, merges, tags, or touches a remote beyond the gh reads and
// the one issue comment plus label transition it is explicitly asked to make.

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, route } from "./route.mjs";
import { createGh } from "./github/gh.mjs";
import { runProcess } from "./run/process.mjs";
import { dispatchIssue } from "./github/dispatch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_ROLES = new Set(["executor", "reviewer"]);

const git = (argv, cwd = HERE) => runProcess(["git", ...argv], { cwd });

function gitOrDie(argv) {
  const answer = git(argv);
  if (answer.status !== 0) throw new Error(`git ${argv.join(" ")} failed: ${(answer.stderr ?? "").trim()}`);
  return (answer.stdout ?? "").trim();
}

// Derived, never configured: no username and no absolute path is written down.
function repoFromOrigin() {
  const url = gitOrDie(["remote", "get-url", "origin"]);
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`cannot read owner/name out of origin (${url})`);
  return `${m[1]}/${m[2]}`;
}

function takeLock(dir, number) {
  const path = join(dir, `issue-${number}.lock`);
  try {
    mkdirSync(path, { recursive: false });
  } catch (err) {
    if (err.code === "EEXIST") return null;
    throw err;
  }
  writeFileSync(join(path, "pid"), `${process.pid}\n`);
  return { path, release: () => rmSync(path, { recursive: true, force: true }) };
}

function main(argv) {
  const number = Number(argv.find((a) => /^\d+$/.test(a)));
  if (!Number.isInteger(number) || number <= 0) {
    console.error("usage: dispatch-github-issue.mjs <issue-number> [--dry-run] [--available A,B] [--repo owner/name]");
    return 2;
  }
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? null : argv[i + 1];
  };

  const config = loadConfig(HERE);
  const repo = flag("repo") ?? repoFromOrigin();
  const commonDir = resolve(HERE, "..", gitOrDie(["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  // Two different directories, deliberately. mainWorktree is where git runs and
  // where issue worktrees are placed; harnessRoot is the checkout this
  // dispatcher — and therefore this gate — is actually running out of.
  const mainWorktree = dirname(commonDir);
  const harnessRoot = resolve(HERE, "..");
  const stateDir = join(commonDir, "mayhem-dispatch");
  const runsDir = join(stateDir, "runs");
  // A separate root, not a sibling name under runs/: the reviewer is given its
  // own directory, and that directory must not have the executor's next to it.
  const reviewsDir = join(stateDir, "reviews");
  const lockDir = join(stateDir, "locks");
  mkdirSync(runsDir, { recursive: true });
  mkdirSync(reviewsDir, { recursive: true });
  mkdirSync(lockDir, { recursive: true });

  const captured = new Map();
  const io = {
    config,
    route: (args) => route({ ...args, config }),
    available: flag("available")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
    dryRun: argv.includes("--dry-run"),
    mainWorktree,
    harnessRoot,
    runsDir,
    reviewsDir,
    gh: createGh({
      repo,
      run: (args, options = {}) => runProcess(["gh", ...args], { input: options.input, maxBuffer: 32 * 1024 * 1024 }),
    }),
    git: (args) => git(args, mainWorktree),
    exists: (path) => existsSync(path),
    pathExists: (path) => existsSync(path),
    realPath: (path) => {
      try {
        return realpathSync.native(path);
      } catch {
        return path;
      }
    },
    probe: ({ command, env }) => {
      const answer = runProcess(command, { env: env ?? {} });
      if (answer.status !== 0 && !answer.stdout) {
        throw new Error((answer.stderr || answer.error?.message || "no output").trim());
      }
      return JSON.parse(answer.stdout);
    },
    spawn: (args, { cwd, env = {}, role, runDir } = {}) => {
      // The executor writes its report into the run directory, so that
      // directory has to exist before the runtime starts.
      if (AGENT_ROLES.has(role) && runDir) mkdirSync(runDir, { recursive: true });
      // Returned, never thrown: a launch that never happened is a fact about
      // the result, and only the caller knows what it means for what it asked.
      const answer = runProcess(args, { cwd, env });
      if (AGENT_ROLES.has(role)) {
        captured.set(role, answer.stdout ?? "");
        if (answer.stdout) process.stdout.write(answer.stdout);
        if (answer.stderr) process.stderr.write(answer.stderr);
      }
      return answer;
    },
    // A reviewer runs hard read-only and can write nothing at all, so its
    // verdict is read from what it printed. An executor writes a file; the
    // same fallback covers one that did not.
    readReport: (runId, role) => {
      const path = join(runsDir, runId, `report-${role}.json`);
      if (existsSync(path)) {
        try {
          return JSON.parse(readFileSync(path, "utf8"));
        } catch {
          /* fall through to what the runtime printed */
        }
      }
      return lastJsonObject(captured.get(role) ?? "");
    },
    writeResult: (runId, result) => {
      const dir = join(runsDir, runId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
      console.log(`result: ${join(dir, "result.json")}`);
    },
    nextAttempt: (issue) => {
      const prefix = `issue-${issue}-attempt-`;
      const seen = existsSync(runsDir) ? readdirSync(runsDir).filter((d) => d.startsWith(prefix)) : [];
      return seen.length + 1;
    },
    lock: (issue) => takeLock(lockDir, issue),
    log: (line) => console.log(line),
  };

  return dispatchIssue(number, io).then((outcome) => {
    if (outcome.dispatched) {
      console.log(`RESULT=${outcome.result.result}  NEXT=${outcome.result.nextStatus}  WORKTREE=${outcome.result.worktree}`);
      if (outcome.result.failureStage) {
        console.error(`FAILED_AT=${outcome.result.failureStage} (${outcome.result.errorClass}: ${outcome.result.errorMessage})`);
      }
      // Never let a partial recovery read as a clean one.
      if (outcome.recovery) {
        console.error(`RECOVERY result=${outcome.recovery.result} labels=${outcome.recovery.labels} comment=${outcome.recovery.comment}`);
      }
      const incomplete =
        outcome.recovery && Object.values(outcome.recovery).some((s) => String(s).startsWith("FAILED"));
      if (incomplete) return 1;
      return outcome.result.result === "BLOCKED" || outcome.result.result === "INTERRUPTED" ? 1 : 0;
    }
    console.log(`NOT DISPATCHED (${outcome.code}): ${outcome.reason}`);
    if (outcome.preview) console.log(JSON.stringify(outcome.preview, null, 2));
    return outcome.code === "dry-run" ? 0 : 1;
  });
}

// The last JSON object a runtime printed, preferring a fenced block. Returns
// null rather than guessing when nothing parses.
function lastJsonObject(text) {
  const fenced = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const block of fenced.reverse()) {
    try {
      return JSON.parse(block);
    } catch {
      /* try the next one */
    }
  }
  const close = String(text).lastIndexOf("}");
  if (close === -1) return null;
  const opens = [];
  for (let i = 0; i < close; i += 1) if (text[i] === "{") opens.push(i);
  for (const open of opens.slice(-20).reverse()) {
    try {
      return JSON.parse(text.slice(open, close + 1));
    } catch {
      /* try an earlier brace */
    }
  }
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`ERROR: ${err.message}`);
      process.exit(1);
    });
}
