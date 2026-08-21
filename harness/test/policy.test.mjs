import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { loadConfig } from "../route.mjs";

const config = loadConfig();
const { policy } = config;
const repo = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("risk levels 0-4 exist and escalate monotonically", () => {
  const levels = ["0", "1", "2", "3", "4"];
  assert.deepEqual(Object.keys(policy.riskLevels).sort(), levels);
  let previous = -1;
  for (const level of levels) {
    const spec = policy.riskLevels[level];
    assert.equal(spec.deterministic, true, `risk ${level} must always run the deterministic gate`);
    assert.ok(spec.reviewers >= previous, `risk ${level} reviews less than risk ${Number(level) - 1}`);
    previous = spec.reviewers;
  }
  assert.equal(policy.riskLevels["0"].reviewers, 0);
  assert.equal(policy.riskLevels["3"].crossProvider, true);
  assert.equal(policy.riskLevels["4"].reviewers, 2);
  assert.equal(policy.riskLevels["4"].reversedAB, true);
});

test("the verifier is read-only and epistemically independent", () => {
  assert.equal(policy.verifier.readOnly, true);
  assert.equal(policy.verifier.mayFixOwnFinding, false);
  assert.equal(policy.deterministicGateOutranksVerifier, true);
  const never = policy.verifier.neverReceives.join(" ").toLowerCase();
  assert.match(never, /reasoning transcript/);
  assert.match(never, /write access/);
  assert.ok(!policy.verifier.receives.some((r) => /transcript/i.test(r)));
});

test("Verifier-Lite never claims to implement the published method", () => {
  assert.equal(policy.protocol, "Verifier-Lite");
  assert.match(policy.notAnImplementationOf.blockingConstraint, /logprob/i);
  assert.ok(policy.excluded.some((x) => /logprob/i.test(x)));
  assert.ok(!policy.adopted.some((x) => /logprob/i.test(x)));
  for (const file of ["AGENTS.md", ".agents/skills/mayhem-review/SKILL.md"]) {
    const text = repo(file);
    if (/verifier-lite/i.test(text)) {
      assert.doesNotMatch(
        text,
        /implement(s|ation of)?\s+(the\s+)?LLM-as-a-Verifier/i,
        `${file} describes Verifier-Lite as an implementation of the paper`,
      );
    }
  }
});

test("findings and criteria are fixed vocabularies", () => {
  assert.deepEqual(policy.findingFields, ["CLAIM", "EVIDENCE", "SEVERITY", "CONFIDENCE", "VIOLATED_INVARIANT"]);
  assert.equal(policy.criteria.length, 9);
  for (const criterion of policy.criteria) assert.match(criterion, /^[A-Z_]+$/);
  assert.deepEqual(policy.completionLevels, ["IMPLEMENTED", "OFFLINE-PROVEN", "LIVE-PROVEN"]);
});

// --- skills --------------------------------------------------------------

const frontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, "SKILL.md has no frontmatter");
  return Object.fromEntries(
    m[1]
      .split("\n")
      .filter((l) => /^[a-z-]+:/.test(l))
      .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]),
  );
};

// Every skill this repository owns, wherever its runtime looks for it. Adding
// a valid skill must not require editing an assertion that has nothing to do
// with it, so this discovers rather than enumerates — and then names the few
// skills the harness actually depends on, which is a different claim.
const SKILL_ROOTS = [".agents/skills", ".claude/skills", ".codex/skills"];

const repoSkills = () =>
  SKILL_ROOTS.flatMap((root) => {
    let entries = [];
    try {
      entries = readdirSync(new URL(`../../${root}`, import.meta.url), { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((d) => d.isDirectory()).map((d) => ({ root, name: d.name, path: `${root}/${d.name}/SKILL.md` }));
  });

test("every repository skill satisfies the discovery contract", () => {
  const skills = repoSkills();
  assert.ok(skills.length >= 3, "no skills were discovered; the roots moved");
  for (const skill of skills) {
    const fm = frontmatter(repo(skill.path));
    assert.equal(fm.name, skill.name, `${skill.path}: frontmatter name must match its directory`);
    assert.match(fm.name, /^[a-z0-9-]{1,64}$/);
    assert.ok(fm.description && fm.description.length <= 1024, `${skill.path}: description missing or too long`);
  }
});

test("the skills the harness depends on are present", () => {
  // Named individually, because these three are load-bearing: the dispatcher
  // hands the first to every executor, the policy tests assert on the second,
  // and the operator contract is the third.
  const found = new Set(repoSkills().map((s) => `${s.root}/${s.name}`));
  for (const required of [
    ".agents/skills/mayhem-task",
    ".agents/skills/mayhem-review",
    ".claude/skills/slice-contract",
  ]) {
    assert.ok(found.has(required), `${required} is missing`);
  }
});

test("no skill or instruction file keeps a suite inventory of its own", () => {
  // scripts/gate.sh is the one place a verification command is written down.
  // A document that lists suites is a second inventory, and a second inventory
  // drifts: AGENTS.md, CLAUDE.md and slice-contract each carried one, and all
  // three had already diverged from gate.sh and from each other. A block that
  // names the canonical entry point is delegation, not a second list.
  const canonical = /verify-task\.sh|gate\.sh/;
  const suiteCommand = /^\s*(npm (test|run (test|build))|npx (eslint|vitest|tsc)|cargo (test|fmt|check))\b/m;
  const documents = [...repoSkills().map((s) => s.path), "AGENTS.md", "CLAUDE.md"];
  for (const path of documents) {
    const text = repo(path);
    for (const block of [...text.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map((m) => m[1])) {
      if (canonical.test(block)) continue;
      assert.doesNotMatch(
        block,
        suiteCommand,
        `${path} runs a suite directly; delegate to harness/verify-task.sh instead`,
      );
    }
  }
});

test("a review skill cannot mutate a candidate worktree", () => {
  // Any skill whose job is verification, not just the one named today.
  const reviewSkills = repoSkills().filter((s) => /review|verif/i.test(s.name));
  assert.ok(reviewSkills.length >= 1, "no review skill was discovered");
  for (const skill of reviewSkills) {
    const fm = frontmatter(repo(skill.path));
    const tools = (fm["allowed-tools"] ?? "").replace(/[[\]]/g, "").split(",").map((t) => t.trim()).filter(Boolean);
    assert.ok(tools.length > 0, `${skill.name} must declare an explicit tool allowlist`);
    for (const forbidden of ["write", "edit", "bash", "multiedit", "apply_patch"]) {
      assert.ok(!tools.includes(forbidden), `${skill.name} may not hold the ${forbidden} tool`);
    }
    assert.ok(tools.includes("read"), `${skill.name} must be able to read`);
  }
});

// --- instruction-file hygiene -------------------------------------------

test("AGENTS.md carries no volatile state", () => {
  const agents = repo("AGENTS.md");
  assert.doesNotMatch(agents, /\b(opus|sonnet|haiku|fable|gpt-\d|kimi|grok|gemini)\b/i, "names a model");
  assert.doesNotMatch(agents, /\b\d{2,}\s*\/\s*\d{2,}\b/, "carries a test count");
  assert.doesNotMatch(agents, /\b[\d,]{3,}\s+(tests|assertions)\b/i, "carries a test count");
  assert.doesNotMatch(agents, /arena\.ai|leaderboard|net improvement|bash recovery/i, "carries a leaderboard snapshot");
  assert.doesNotMatch(agents, /\bhasExtraUsageEnabled\b|\bpid\b\s*[:=]/i, "carries machine state");
  // It must still point at where those things do live.
  assert.match(agents, /harness\/config\/routing\.json/);
  assert.match(agents, /harness\/verify-task\.sh/);
});

test("CLAUDE.md is not machine-rewritten with volatile state", () => {
  const claude = repo("CLAUDE.md");
  assert.doesNotMatch(claude, /<!-- STATE:(START|END) -->/, "the post-commit STATE block is back");
  assert.doesNotMatch(claude, /Tests passing: `\d+`/, "carries a test count");
  const updater = repo("scripts/update-state.sh");
  assert.doesNotMatch(updater, /CLAUDE\.md/, "update-state.sh still rewrites an always-loaded instruction file");
});
