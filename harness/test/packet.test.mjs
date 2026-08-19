import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig, validatePacket, checkPacketSet } from "../route.mjs";

const config = loadConfig();
const TEMPLATE = readFileSync(new URL("../../docs/task-packets/TEMPLATE.md", import.meta.url), "utf8");

const parse = (text) => validatePacket(text, config);
const packet = (name, overrides = {}) => {
  const { fields } = parse(TEMPLATE);
  return { name, fields: { ...fields, ...overrides } };
};

test("the shipped template validates", () => {
  const { errors, fields } = parse(TEMPLATE);
  assert.deepEqual(errors, []);
  assert.equal(fields.TASK_CLASS, "T1");
  assert.equal(fields.ROLE, "executor");
});

test("the schema requires every field the delegation contract names", () => {
  for (const field of [
    "TASK", "BASE_SHA", "WORKTREE", "ROLE", "SPEC", "RELEVANT PATHS",
    "INVARIANTS", "KNOWN FACTS", "OPEN QUESTIONS", "ACCEPTANCE TESTS",
    "DO NOT TOUCH", "RETURN FORMAT",
  ]) {
    assert.ok(config.schema.requiredFields.includes(field), `schema is missing ${field}`);
  }
});

test("a missing or empty section fails validation", () => {
  const withoutSpec = TEMPLATE.replace(/^## SPEC$/m, "## SPEC_REMOVED");
  assert.match(parse(withoutSpec).errors.join("\n"), /missing section: ## SPEC/);

  const emptied = TEMPLATE.replace(/^## TASK$[\s\S]*?(?=^## TASK_CLASS$)/m, "## TASK\n\n");
  assert.match(parse(emptied).errors.join("\n"), /empty section: ## TASK/);
});

test("a task stays bound to a full base SHA", () => {
  const short = TEMPLATE.replace(/^4eb271b79826877e5fce0cfa7ad4e24b01cb6d71$/m, "4eb271b");
  assert.match(parse(short).errors.join("\n"), /BASE_SHA must match/);

  const branch = TEMPLATE.replace(/^4eb271b79826877e5fce0cfa7ad4e24b01cb6d71$/m, "feat/overlay-tier-card");
  assert.match(parse(branch).errors.join("\n"), /BASE_SHA must match/);
});

test("unknown task classes and roles are rejected at the packet boundary too", () => {
  const badClass = TEMPLATE.replace(/^T1$/m, "T9");
  assert.match(parse(badClass).errors.join("\n"), /TASK_CLASS must be one of/);

  const badRole = TEMPLATE.replace(/^executor$/m, "overseer");
  assert.match(parse(badRole).errors.join("\n"), /ROLE must be one of/);
});

test("parallel executors must receive different worktrees", () => {
  const shared = [
    packet("a.md", { WORKTREE: "/tmp/wt-one" }),
    packet("b.md", { WORKTREE: "/tmp/wt-one" }),
  ];
  assert.match(checkPacketSet(shared).join("\n"), /both claim worktree/);
  assert.match(checkPacketSet(shared).join("\n"), /separate worktrees/);

  const separate = [
    packet("a.md", { WORKTREE: "/tmp/wt-one" }),
    packet("b.md", { WORKTREE: "/tmp/wt-two" }),
  ];
  assert.deepEqual(checkPacketSet(separate), []);
});

test("a verifier is never handed the executor's worktree", () => {
  const overlap = [
    packet("exec.md", { WORKTREE: "/tmp/wt-one", ROLE: "executor" }),
    packet("review.md", { WORKTREE: "/tmp/wt-one", ROLE: "verifier" }),
  ];
  assert.match(checkPacketSet(overlap).join("\n"), /verifier must never be given the executor's worktree/);
});
