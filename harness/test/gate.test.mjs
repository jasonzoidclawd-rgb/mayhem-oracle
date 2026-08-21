import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// These tests exercise the command layer itself, so they never invoke the
// harness suite through it — that would re-enter this file recursively. Suite
// membership is proven with --plan; execution and exit-code propagation are
// proven against the rust suite with a stub `cargo` on PATH.

const repo = fileURLToPath(new URL("../../", import.meta.url));
const GATE = join(repo, "scripts/gate.sh");
const VERIFY = join(repo, "harness/verify-task.sh");
const source = (p) => readFileSync(join(repo, p), "utf8");

const bash = (script, args, env) =>
  spawnSync("bash", [script, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

const inventory = () => {
  const listed = bash(GATE, ["--list"]);
  assert.equal(listed.status, 0, `gate --list failed: ${listed.stderr}`);
  return listed.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, description] = line.split("\t");
      assert.ok(description && description.trim(), `suite ${name} has no description`);
      return name;
    });
};

const plan = (profile) => {
  const planned = bash(VERIFY, [profile, "--plan"]);
  assert.equal(planned.status, 0, `plan for ${profile} failed: ${planned.stderr}`);
  const suites = planned.stdout.match(/^SUITES: (.*)$/m);
  assert.ok(suites, `plan for ${profile} never named the suites it would run`);
  return { stdout: planned.stdout, suites: suites[1].trim().split(/\s+/) };
};

// A. one command layer -----------------------------------------------------

test("scripts/gate.sh owns the deterministic suite inventory", () => {
  assert.deepEqual(inventory().sort(), ["harness", "overlay", "rust", "skills", "web"]);
});

test("verify-task delegates execution instead of keeping a second command list", () => {
  const verify = source("harness/verify-task.sh");
  assert.match(verify, /scripts\/gate\.sh/, "verify-task does not delegate to the gate");
  for (const command of ["npm test", "npm run test", "npx eslint", "npx tsc", "cargo", "unittest", "node --test", "vitest"]) {
    assert.ok(
      !verify.includes(command),
      `verify-task still spells out "${command}" — that is the duplicate command list`,
    );
  }
  const gate = source("scripts/gate.sh");
  for (const command of ["npm test", "npx eslint", "npx tsc", "cargo test", "unittest", "node --test"]) {
    assert.ok(gate.includes(command), `the gate does not own "${command}"`);
  }
});

test("the gate is provider-neutral", () => {
  // Repository paths may name anything; the gate's vocabulary may not know who
  // asked. Strip paths first, then look for control-plane words.
  const gate = source("scripts/gate.sh").replace(/\.codex\S*/g, "<path>");
  for (const word of ["claude", "codex", "\\bpi\\b", "verifier", "routing", "effort", "account", "tier", "token", "model", "parallel"]) {
    assert.doesNotMatch(
      gate,
      new RegExp(word, "i"),
      `the gate mentions "${word}" — it must know how to verify and nothing about who asked`,
    );
  }
});

// B/C. rust is real, and its failure is not swallowed -----------------------

test("rust is a supported profile that runs cargo test in overlay/src-tauri", () => {
  assert.ok(inventory().includes("rust"), "rust is not a suite the gate knows");
  assert.ok(plan("rust").suites.includes("rust"), "the rust profile does not plan the rust suite");
});

test("a failing cargo test propagates out of the gate as a nonzero exit", () => {
  const stubDir = mkdtempSync(join(tmpdir(), "gate-stub-"));
  const log = join(stubDir, "invocation");
  const stub = join(stubDir, "cargo");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n%s\\n' "$PWD" "$*" > ${log}\nexit 101\n`);
  chmodSync(stub, 0o755);

  const gated = bash(GATE, ["rust"], { PATH: `${stubDir}:${process.env.PATH}` });
  const [cwd, args] = readFileSync(log, "utf8").split("\n");
  assert.ok(cwd.endsWith("overlay/src-tauri"), `cargo ran in ${cwd}`);
  assert.equal(args, "test");
  assert.notEqual(gated.status, 0, "a red cargo run reported a clean gate");
  assert.match(gated.stdout, /rust.*FAIL|FAIL.*rust/s);
});

// D/E. coverage is declared, never assumed ---------------------------------

test("the all profile covers every suite the gate knows, rust included", () => {
  const planned = plan("all");
  assert.deepEqual(planned.suites.sort(), inventory().sort());
  assert.ok(planned.suites.includes("rust"), "all claims full coverage without rust");
  assert.doesNotMatch(planned.stdout, /NOT COVERED/);
});

test("every profile names the profile and the suites it runs", () => {
  const known = inventory();
  for (const profile of ["harness", "web", "overlay", "skills", "rust", "all"]) {
    const planned = plan(profile);
    assert.match(planned.stdout, new RegExp(`^PROFILE: ${profile}$`, "m"));
    for (const suite of planned.suites) {
      assert.ok(known.includes(suite), `profile ${profile} plans unknown suite ${suite}`);
    }
  }
});

test("a narrow profile still names what it did not cover", () => {
  const planned = plan("harness");
  for (const uncovered of ["web", "overlay", "skills", "rust"]) {
    assert.match(planned.stdout, new RegExp(`NOT COVERED[\\s\\S]*- ${uncovered} `));
  }
});

// F/G. fail closed, and stay independent -----------------------------------

test("an unknown profile fails closed without running anything", () => {
  const bogus = bash(VERIFY, ["nonesuch"]);
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /unknown profile/);
  assert.doesNotMatch(bogus.stdout, /===/, "a rejected profile still executed a suite");
});

test("an unknown suite fails closed before any suite runs", () => {
  const bogus = bash(GATE, ["harness", "nonesuch"]);
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /unknown suite/);
  assert.doesNotMatch(bogus.stdout, /===/, "the gate ran a suite before rejecting the request");
});

test("harness verification runs independently of every product suite", () => {
  assert.deepEqual(plan("harness").suites, ["harness"]);
});

// H. the evaluator is not the subject ---------------------------------------
//
// A gate that lives in the checkout it judges is not an authority over it: the
// diff under test can rewrite the script that decides whether it passed. These
// prove the trusted copy stays in charge of *what a check is* while the given
// worktree supplies only *what is checked*.

// A throwaway worktree of this repository, sabotaged however the test needs.
const candidate = () => {
  const path = mkdtempSync(join(tmpdir(), "gate-candidate-"));
  const dir = join(path, "work");
  const added = spawnSync("git", ["worktree", "add", "--detach", "-q", dir, "HEAD"], { cwd: repo, encoding: "utf8" });
  assert.equal(added.status, 0, `could not create candidate worktree: ${added.stderr}`);
  return {
    dir,
    remove: () => spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: repo, encoding: "utf8" }),
  };
};

test("the gate judges the worktree it is given, not the one it lives in", () => {
  const subject = candidate();
  try {
    const stubDir = mkdtempSync(join(tmpdir(), "gate-stub-"));
    const log = join(stubDir, "invocation");
    const stub = join(stubDir, "cargo");
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$PWD" > ${log}\nexit 0\n`);
    chmodSync(stub, 0o755);

    const gated = bash(GATE, ["--worktree", subject.dir, "rust"], { PATH: `${stubDir}:${process.env.PATH}` });
    assert.equal(gated.status, 0, `gate failed: ${gated.stderr}`);
    const cwd = readFileSync(log, "utf8").trim();
    assert.ok(
      realpathSync(cwd).startsWith(realpathSync(subject.dir)),
      `the suite ran in ${cwd}, which is not inside the worktree the gate was given`,
    );
  } finally {
    subject.remove();
  }
});

test("a candidate copy of the gate cannot answer for the trusted one", () => {
  const subject = candidate();
  try {
    // The subject rewrites both halves of its own evaluator to always pass,
    // and breaks a real suite so an honest gate must fail.
    writeFileSync(join(subject.dir, "harness/verify-task.sh"), "#!/usr/bin/env bash\nprintf '\\nGATE: PASS\\n'\nexit 0\n");
    writeFileSync(join(subject.dir, "scripts/gate.sh"), "#!/usr/bin/env bash\nprintf '\\nGATE SUITES: PASS\\n'\nexit 0\n");

    const stubDir = mkdtempSync(join(tmpdir(), "gate-stub-"));
    const stub = join(stubDir, "cargo");
    writeFileSync(stub, "#!/bin/sh\nexit 101\n");
    chmodSync(stub, 0o755);

    const gated = bash(VERIFY, ["rust", "--worktree", subject.dir], { PATH: `${stubDir}:${process.env.PATH}` });
    assert.notEqual(gated.status, 0, "a candidate-supplied gate script manufactured a passing gate");
    assert.match(gated.stdout, /GATE: FAIL/);
  } finally {
    subject.remove();
  }
});

test("verify-task forwards the subject worktree instead of inferring it", () => {
  const subject = candidate();
  try {
    const stubDir = mkdtempSync(join(tmpdir(), "gate-stub-"));
    const log = join(stubDir, "invocation");
    const stub = join(stubDir, "cargo");
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$PWD" > ${log}\nexit 0\n`);
    chmodSync(stub, 0o755);

    const gated = bash(VERIFY, ["rust", "--worktree", subject.dir], { PATH: `${stubDir}:${process.env.PATH}` });
    assert.equal(gated.status, 0, `gate failed: ${gated.stderr}`);
    assert.ok(realpathSync(readFileSync(log, "utf8").trim()).startsWith(realpathSync(subject.dir)));
    assert.match(gated.stdout, /^WORKTREE: /m, "the gate never recorded which worktree it judged");
  } finally {
    subject.remove();
  }
});

test("the gate fails closed rather than guessing a subject", () => {
  const nowhere = mkdtempSync(join(tmpdir(), "gate-nogit-"));
  const guessed = spawnSync("bash", [GATE, "harness"], { cwd: nowhere, encoding: "utf8", env: { ...process.env } });
  assert.equal(guessed.status, 2, "the gate ran a suite without knowing what it was judging");
  assert.match(guessed.stderr, /worktree/i);

  const missing = bash(GATE, ["--worktree", join(nowhere, "absent"), "harness"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such worktree/);

  const bare = bash(GATE, ["--worktree"]);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /missing directory/);
});
