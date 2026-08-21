import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, route } from "../route.mjs";
import { LABELS } from "../github/issue-contract.mjs";
import { runProcess } from "../run/process.mjs";
import { dispatchIssue } from "../github/dispatch.mjs";

// The gate preflight, proved through the production process adapter.
//
// Every other dispatch test injects a fake spawn that answers whatever the
// implementation expects, so none of them can see what happens when the real
// `bash harness/verify-task.sh <profile> --plan` runs somewhere it cannot.
// These tests run that real command through the real runProcess normalization,
// varying only the directory it runs in — which is exactly what the live
// issue-47 dry-run varied.

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const config = loadConfig();
const BASE = "ea90daf8b548fb55ee6ee8460de3591580f74893";
const FINGERPRINT = "harness:worktree-identity:mutable-issue-title";

// A directory that exists and is a git repository, but carries no harness —
// the shape of a main checkout sitting on a branch the harness never landed on.
const harnessless = () => mkdtempSync(join(tmpdir(), "no-harness-"));

const machine = (over = {}) => {
  const fields = { schema: 1, fingerprint: FINGERPRINT, task_class: "T1", base_ref: BASE, ...over };
  return `<!-- mayhem-agent\n${Object.entries(fields).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join("\n")}\n-->`;
};

const issue = (over = {}) => ({
  number: 47,
  title: "Dispatcher derives the worktree from a mutable issue title",
  state: "OPEN",
  url: "https://github.com/example/example/issues/47",
  labels: [{ name: "bug" }, { name: LABELS.ready }],
  body: `## Summary\n\nprose\n\n${machine(over)}\n`,
});

// Production wiring for everything the preflight touches: the spawn adapter is
// the real one, and the command it runs is the real gate. Only GitHub, git and
// the lock are faked, because a test must not reach the network or the ledger.
function io({ mainWorktree, harnessRoot, gateProfile = null }) {
  const spawns = [];
  return {
    spawns,
    config,
    route: (args) => route({ ...args, config }),
    available: ["CLAUDE_A", "GPT_A"],
    dryRun: true,
    mainWorktree,
    harnessRoot,
    runsDir: join(mainWorktree, "runs"),
    gh: {
      viewIssue: () => issue(gateProfile ? { gate_profile: gateProfile } : {}),
      listOpenIssues: () => [issue(gateProfile ? { gate_profile: gateProfile } : {})],
      repoLabels: () => Object.values(LABELS),
      setLabels: () => { throw new Error("a dry run must never write a label"); },
      comment: () => { throw new Error("a dry run must never comment"); },
    },
    git: (argv) => (argv[0] === "rev-parse" ? { status: 0, stdout: `${BASE}\n`, stderr: "" } : { status: 0, stdout: "", stderr: "" }),
    exists: () => true,
    pathExists: () => false,
    realPath: (p) => p,
    probe: ({ command }) => {
      const i = command.indexOf("--provider");
      return { status: "ready", provider: i === -1 ? null : command[i + 1], authType: "oauth" };
    },
    // The production adapter itself, observed but not replaced.
    spawn: (argv, options = {}) => {
      const result = runProcess(argv, options);
      spawns.push({ argv, cwd: options.cwd, result });
      return result;
    },
    readReport: () => null,
    writeResult: () => { throw new Error("a dry run must never write a result"); },
    nextAttempt: () => 1,
    lock: (n) => ({ n, release: () => {} }),
    log: () => {},
  };
}

// --- the live failure ------------------------------------------------------

test("a known profile is accepted when the harness checkout is where the harness lives", async () => {
  // Exactly the live shape: the main checkout carries no harness, but the
  // dispatcher is running out of one that does.
  const built = io({ mainWorktree: harnessless(), harnessRoot: REPO });
  const outcome = await dispatchIssue(47, built);

  assert.equal(
    outcome.code,
    "dry-run",
    `a valid harness profile was refused as ${outcome.code}: ${outcome.reason}`,
  );
  assert.equal(outcome.preview.gateProfile, "harness");

  const preflight = built.spawns.find((s) => s.argv.includes("--plan"));
  assert.ok(preflight, "the preflight never ran the real gate");
  // Absolute, and out of the dispatcher's own checkout: a relative path here
  // would resolve against whatever the cwd happened to be.
  assert.deepEqual(preflight.argv, ["bash", join(REPO, "harness/verify-task.sh"), "harness", "--plan"]);
  assert.equal(preflight.result.status, 0, `the real gate plan exited ${preflight.result.status}`);
  assert.match(preflight.result.stdout, /^PROFILE: harness$/m);
});

// --- the distinction the live failure destroyed ----------------------------

test("a gate that cannot be launched is not reported as an unknown profile", async () => {
  const nowhere = harnessless();
  const built = io({ mainWorktree: nowhere, harnessRoot: nowhere });
  const outcome = await dispatchIssue(47, built);

  assert.equal(outcome.dispatched, false);
  assert.notEqual(
    outcome.code,
    "unknown-gate-profile",
    "a script that was never found was reported as the gate's own verdict",
  );
  assert.equal(outcome.code, "gate-preflight-launch-failed");

  const preflight = built.spawns.find((s) => s.argv.includes("--plan"));
  assert.equal(preflight.result.status, 127, "this is not the launch failure the live dry-run hit");
  assert.match(preflight.result.stderr, /No such file or directory/);
});

test("a cwd that does not exist is a launch failure, not a profile verdict", async () => {
  const built = io({ mainWorktree: "/nonexistent-dispatch-cwd", harnessRoot: "/nonexistent-dispatch-cwd" });
  const outcome = await dispatchIssue(47, built);

  assert.equal(outcome.code, "gate-preflight-launch-failed");
  const preflight = built.spawns.find((s) => s.argv.includes("--plan"));
  assert.equal(preflight.result.status, null);
  assert.equal(preflight.result.error.code, "ENOENT");
});

// --- the authority is still verify-task ------------------------------------

test("a genuinely unknown profile is still rejected by the real gate", async () => {
  const built = io({ mainWorktree: harnessless(), harnessRoot: REPO, gateProfile: "nonesuch" });
  const outcome = await dispatchIssue(47, built);

  assert.equal(outcome.dispatched, false);
  assert.equal(outcome.code, "unknown-gate-profile");

  // Proof it was verify-task that refused, not a list kept inside the dispatcher.
  const preflight = built.spawns.find((s) => s.argv.includes("--plan"));
  assert.equal(preflight.result.status, 2);
  assert.match(preflight.result.stderr, /^unknown profile: nonesuch$/m);
});

test("the dispatcher keeps no profile list of its own", () => {
  const dispatch = runProcess(["cat", "harness/github/dispatch.mjs"], { cwd: REPO }).stdout;
  for (const profile of ["web", "overlay", "skills", "rust", "all"]) {
    assert.ok(
      !new RegExp(`["']${profile}["']`).test(dispatch),
      `dispatch.mjs names profile "${profile}" — verify-task is the profile authority`,
    );
  }
});
