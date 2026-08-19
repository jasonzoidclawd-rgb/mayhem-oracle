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

test("harness skills satisfy the skill-discovery contract", () => {
  const dirs = readdirSync(new URL("../../.agents/skills", import.meta.url), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  assert.deepEqual(dirs.sort(), ["mayhem-review", "mayhem-task"]);
  for (const dir of dirs) {
    const fm = frontmatter(repo(`.agents/skills/${dir}/SKILL.md`));
    assert.equal(fm.name, dir, `${dir}: frontmatter name must match its directory`);
    assert.match(fm.name, /^[a-z0-9-]{1,64}$/);
    assert.ok(fm.description && fm.description.length <= 1024, `${dir}: description missing or too long`);
  }
});

test("the review skill cannot mutate a candidate worktree", () => {
  const fm = frontmatter(repo(".agents/skills/mayhem-review/SKILL.md"));
  const tools = fm["allowed-tools"].replace(/[[\]]/g, "").split(",").map((t) => t.trim()).filter(Boolean);
  assert.ok(tools.length > 0, "the reviewer must declare an explicit tool allowlist");
  for (const forbidden of ["write", "edit", "bash", "multiedit", "apply_patch"]) {
    assert.ok(!tools.includes(forbidden), `mayhem-review may not hold the ${forbidden} tool`);
  }
  assert.ok(tools.includes("read"));
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
