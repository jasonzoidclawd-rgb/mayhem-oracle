import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAuthority } from "../run/attempt.mjs";

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

// I. what a suite's PASS is made of ----------------------------------------
//
// A trusted runner still reads its checks out of the workspace it judges, so
// the gate must be able to say which paths decide what its PASS means. The
// declaration lives beside the suite command, so there is still one inventory.

// One inventory, two kinds of row: `tracked` names the files a diff can show a
// change to, `runtime` names the ignored state the suite's tooling consumes
// anyway. Both come out of scripts/gate.sh, beside the command they describe.
const authorityRows = (args = []) => {
  const listed = bash(GATE, ["--authority", ...args]);
  assert.equal(listed.status, 0, `gate --authority failed: ${listed.stderr}`);
  return listed.stdout.split("\n").filter(Boolean).map((line) => {
    const row = line.split("\t");
    assert.equal(row.length, 3, `malformed authority row: ${row.join("|")}`);
    return { suite: row[0], kind: row[1], path: row[2] };
  });
};

const authority = (args = []) => authorityRows(args).filter((r) => r.kind === "tracked");

test("every suite declares the paths that decide what its PASS means", () => {
  for (const suite of inventory()) {
    const declared = authority([suite]);
    assert.ok(declared.length, `suite ${suite} declares no acceptance authority`);
    for (const { suite: name } of declared) assert.equal(name, suite, `${suite} declared authority for ${name}`);
  }
});

test("a suite's declared authority covers the checks it actually runs", () => {
  const gate = source("scripts/gate.sh");
  // The harness suite runs node --test over harness/test, so that is its
  // authority; if the command moves, this stops matching.
  assert.match(gate, /node --test harness\/test\//);
  assert.ok(
    authority(["harness"]).some(({ path }) => path === "harness/test/"),
    "the harness suite does not claim the directory its own tests live in",
  );
  // Rust unit tests are #[cfg(test)] modules inside the sources, so the sources
  // are part of that suite's authority and the declaration has to admit it.
  assert.ok(
    authority(["rust"]).some(({ path }) => path === "overlay/src-tauri/src/"),
    "the rust suite hides that its tests live inside the files it is judging",
  );
});

test("verify-task reports the acceptance authority of a whole profile", () => {
  const declared = bash(VERIFY, ["skills", "--authority"]);
  assert.equal(declared.status, 0, declared.stderr);
  const suites = new Set(declared.stdout.split("\n").filter(Boolean).map((l) => l.split("\t")[0]));
  assert.deepEqual([...suites].sort(), ["harness", "skills"], "the profile's authority is not its suites' authority");
  assert.doesNotMatch(declared.stdout, /===/, "reporting the authority ran a suite");
});

test("a declared authority path matches something that actually exists", () => {
  // A declaration naming a directory the repository does not have is worse than
  // no declaration: it reads as coverage and silently classifies every change to
  // that suite's real tests as untouched examiner.
  const tracked = spawnSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const { suite, path } of authority([])) {
    // A prefix or a glob is a claim about how the repository is laid out, so it
    // has to match something. An exact filename may be preventive — .npmrc is
    // declared because a candidate could add one, not because one is there.
    if (!path.endsWith("/") && !path.includes("*")) continue;
    const matched = tracked.filter((file) => matchesAuthority(file, [path]));
    assert.ok(matched.length, `${suite} declares ${path}, which matches no tracked file`);
  }
});

test("a suite's declaration covers every check that suite runs", () => {
  const tracked = spawnSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const declaredFor = (suite) => authority([suite]).map((r) => r.path);
  const covers = (suite, files) => {
    const missed = files.filter((f) => !matchesAuthority(f, declaredFor(suite)));
    assert.deepEqual(missed, [], `${suite} runs these checks but does not declare them`);
  };
  covers("harness", tracked.filter((f) => f.startsWith("harness/test/")));
  covers("web", tracked.filter((f) => f.startsWith("src/") && /\.test\./.test(f)));
  covers("overlay", tracked.filter((f) => f.startsWith("overlay/src/") && /\.test\./.test(f)));
  covers("rust", tracked.filter((f) => f.startsWith("overlay/src-tauri/tests/")));
});

// K. what the checks were executed by --------------------------------------
//
// Tracked authority answers who wrote the checks. It cannot answer what ran
// them. A suite that shells out to a dependency tree resolves its runner, its
// libraries, and sometimes its cached results out of ignored state the
// candidate can write and no diff can show — so the inventory has to name that
// state too, beside the command, for the same reason the tracked paths are.

const runtimeFor = (suite) => authorityRows([suite]).filter((r) => r.kind === "runtime").map((r) => r.path);

test("the inventory declares runtime inputs as well as tracked ones", () => {
  const rows = authorityRows([]);
  for (const row of rows) {
    assert.ok(
      row.kind === "tracked" || row.kind === "runtime",
      `authority row for ${row.suite} declares no kind: ${JSON.stringify(row)}`,
    );
    assert.ok(row.path, `authority row for ${row.suite} declares no path`);
  }
  assert.ok(rows.some((r) => r.kind === "runtime"), "no suite admits to consuming any ignored runtime state");
  assert.ok(rows.some((r) => r.kind === "tracked"), "the tracked declarations were lost");
});

test("a declared runtime path is one Git cannot show a change to", () => {
  // The whole point of the kind is that these are invisible to the commit
  // evidence. A path Git tracks belongs in the tracked declaration instead:
  // classifying it as runtime would demote a profile that a diff already covers.
  for (const { suite, path } of authorityRows([]).filter((r) => r.kind === "runtime")) {
    const asDir = path.endsWith("/") ? path : `${path}/`;
    const ignored = spawnSync("git", ["check-ignore", "-q", asDir], { cwd: repo });
    assert.equal(ignored.status, 0, `${suite} declares ${path} as runtime state, but git can see changes to it`);
  }
});

test("every suite that shells out to a dependency tree declares it", () => {
  const gate = source("scripts/gate.sh");
  // npm and npx resolve the test runner, the linter, and every library under
  // test out of node_modules; the gate never installs one, so whatever is there
  // when it runs is whatever the workspace already had.
  assert.match(gate, /run "web unit" npm test/);
  assert.match(gate, /run "eslint" npx eslint/);
  assert.deepEqual(runtimeFor("web"), ["node_modules/"]);
  assert.match(gate, /cd overlay && npm run test/);
  assert.deepEqual(runtimeFor("overlay"), ["overlay/node_modules/"]);
  // cargo runs the compiled artifact already in target/ whenever its fingerprint
  // says the sources have not moved — it does not re-derive the binary it runs.
  assert.match(gate, /cd overlay\/src-tauri && cargo test/);
  assert.deepEqual(runtimeFor("rust"), ["overlay/src-tauri/target/"]);
  // python loads __pycache__ bytecode in preference to compiling the source
  // beside it, and PYTHONDONTWRITEBYTECODE stops it writing, never reading.
  assert.match(gate, /python3 -m unittest discover/);
  assert.deepEqual(runtimeFor("skills"), [".codex/skills/test-league-augment-overlay/scripts/__pycache__/"]);
});

test("the harness suite declares no runtime input because it resolves none", () => {
  assert.deepEqual(runtimeFor("harness"), [], "the harness suite claims to need ignored state");
  // Node consults node_modules only for a bare specifier. Every module the
  // harness suite loads is a builtin or a relative path, so there is no
  // dependency tree for a candidate to write into. This is the whole proof, so
  // it is asserted over the files rather than described in a comment.
  const files = spawnSync("git", ["ls-files", "harness"], { cwd: repo, encoding: "utf8" })
    .stdout.split("\n")
    .filter((f) => f.endsWith(".mjs"));
  assert.ok(files.length > 5, "found no harness sources to check");
  for (const file of files) {
    for (const [, specifier] of source(file).matchAll(/^import [^"']*["']([^"']+)["']/gm)) {
      assert.ok(
        specifier.startsWith("node:") || specifier.startsWith("."),
        `${file} imports ${specifier}, which node resolves through node_modules`,
      );
    }
  }
});

test("a profile's plan says whether it can be an authority at all", () => {
  // Known before anything is executed: a profile whose checks run out of
  // ignored state cannot certify on its own no matter how it exits, and an
  // operator should learn that from the plan rather than from the record.
  assert.match(plan("harness").stdout, /^RUNTIME AUTHORITY: none$/m);
  const web = plan("web").stdout;
  assert.match(web, /^RUNTIME AUTHORITY: .*node_modules\//m);
  assert.doesNotMatch(web, /^RUNTIME AUTHORITY: none$/m);
});

test("a suite that runs out of a dependency tree declares what fills it", () => {
  // A lockfile is not a dependency: it is the tracked instruction that decides
  // which runner and which libraries end up in the ignored tree beside it.
  // Leaving it out declares the tree while leaving the thing that determines
  // its contents classified as ordinary subject matter.
  const LOCKS = /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock)$/;
  const tracked = spawnSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const suite of inventory()) {
    const declared = authority([suite]).map((r) => r.path);
    for (const path of runtimeFor(suite)) {
      const beside = path.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
      const locks = tracked.filter(
        (f) => f.split("/").slice(0, -1).join("/") === beside && LOCKS.test(f.split("/").pop()),
      );
      for (const lock of locks) {
        assert.ok(
          matchesAuthority(lock, declared),
          `${suite} runs out of ${path} but does not declare ${lock}, which decides what is in it`,
        );
      }
    }
  }
});

test("the scripts a suite runs out of the workspace are part of what its PASS means", () => {
  // These tests execute the workspace's own scripts/gate.sh and
  // harness/verify-task.sh and then assert how they behaved. That makes those
  // two files the examiner every bit as much as this file is: a diff that
  // rewrites them decides the outcome of the checks that are meant to be
  // judging it, while a declaration listing only harness/test/ reports the
  // examiner as untouched.
  const declared = authority(["harness"]).map((r) => r.path);
  const suite = source("harness/test/gate.test.mjs");
  for (const script of ["scripts/gate.sh", "harness/verify-task.sh"]) {
    assert.ok(suite.includes(script), `the harness suite no longer runs ${script}; this test is stale`);
    assert.ok(
      matchesAuthority(script, declared),
      `the harness suite runs ${script} and asserts on it, but does not declare it`,
    );
  }
});
