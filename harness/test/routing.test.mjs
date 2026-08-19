import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { route, loadConfig, RoutingError } from "../route.mjs";

const config = loadConfig();
const CLASSES = Object.keys(config.routing.taskClasses);
const ALL_FOUR = ["CLAUDE_A", "CLAUDE_B", "GPT_A", "GPT_B"];

test("every task class routes under the full 2+2 pool", () => {
  for (const taskClass of CLASSES) {
    const r = route({ taskClass, available: ALL_FOUR, config });
    assert.equal(r.taskClass, taskClass);
    assert.ok(r.primary.model, `${taskClass} produced no model`);
  }
});

test("unknown task class fails closed", () => {
  assert.throws(() => route({ taskClass: "T9", config }), RoutingError);
  assert.throws(() => route({ taskClass: undefined, config }), RoutingError);
  assert.throws(() => route({ taskClass: "", config }), RoutingError);
});

test("no task class defaults to xhigh or max", () => {
  for (const taskClass of CLASSES) {
    const r = route({ taskClass, available: ALL_FOUR, config });
    assert.ok(
      !["xhigh", "max"].includes(r.effort),
      `${taskClass} silently defaulted to ${r.effort}`,
    );
  }
  for (const spec of Object.values(config.routing.taskClasses)) {
    assert.ok(!["xhigh", "max"].includes(spec.effort));
  }
});

test("xhigh and max require an explicit request AND a justification", () => {
  for (const effort of ["xhigh", "max"]) {
    assert.throws(
      () => route({ taskClass: "T4", available: ALL_FOUR, effort, config }),
      /justification/,
      `${effort} was accepted without justification`,
    );
    assert.throws(
      () => route({ taskClass: "T4", available: ALL_FOUR, effort, justification: "   ", config }),
      /justification/,
    );
    const ok = route({
      taskClass: "T4",
      available: ALL_FOUR,
      effort,
      justification: "release baseline arbitration; high failed to separate the candidates",
      config,
    });
    assert.equal(ok.effort, effort);
    assert.match(ok.notes.join(" "), /escalated to/);
  }
});

test("an unknown effort is rejected rather than passed through", () => {
  assert.throws(
    () => route({ taskClass: "T1", available: ALL_FOUR, effort: "ultra", justification: "x", config }),
    /unknown effort/,
  );
});

test("quota exhaustion routes NEW work to another authorized resource", () => {
  const first = route({ taskClass: "T1", available: ALL_FOUR, config });
  const rerouted = route({
    taskClass: "T1",
    available: ALL_FOUR,
    exhausted: [first.primary.account],
    config,
  });
  assert.notEqual(rerouted.primary.account, first.primary.account);
  assert.equal(rerouted.primary.auth, "subscription");
});

test("exhausting every account fails closed and never offers paid API access", () => {
  try {
    route({ taskClass: "T1", available: ALL_FOUR, exhausted: ALL_FOUR, config });
    assert.fail("expected a routing error");
  } catch (err) {
    assert.ok(err instanceof RoutingError);
    assert.match(err.message, /NOT authorized/);
    assert.doesNotMatch(err.message, /api[_ -]?key|credits|pay.?as.?you.?go/i);
  }
});

test("a missing account does not silently enable a paid fallback", () => {
  // Only CLAUDE_A authenticated: work still routes, on subscription auth only.
  const r = route({ taskClass: "T1", available: ["CLAUDE_A"], config });
  assert.equal(r.primary.account, "CLAUDE_A");
  assert.equal(r.primary.auth, "subscription");
  assert.equal(config.routing.billing.apiBillingAuthorized, false);
  assert.equal(config.routing.billing.usageCreditFallbackAuthorized, false);
  assert.deepEqual(config.routing.billing.authorizedAuth, ["subscription"]);
  for (const account of Object.values(config.routing.accounts)) {
    assert.equal(account.auth, "subscription");
  }
});

test("cross-provider risk levels get an independent reviewer of the other provider", () => {
  for (const taskClass of CLASSES) {
    const r = route({ taskClass, available: ALL_FOUR, config });
    assert.equal(r.reviewers.length, r.verification.reviewers);
    const ids = new Set([r.primary.account, ...r.reviewers.map((x) => x.account)]);
    assert.equal(ids.size, 1 + r.reviewers.length, `${taskClass} reused an account as its own reviewer`);
    for (const reviewer of r.reviewers) assert.equal(reviewer.readOnly, true);
    if (r.verification.crossProvider) {
      assert.ok(
        r.reviewers.some((x) => x.provider !== r.primary.provider),
        `${taskClass} claims cross-provider review but every reviewer shares the executor's provider`,
      );
    }
  }
});

test("too few authorized accounts fails closed instead of reviewing itself", () => {
  // Today's real state: 1 Claude + 1 GPT. Risk 4 needs two independent reviewers.
  assert.throws(
    () => route({ taskClass: "T4", available: ["CLAUDE_A", "GPT_A"], config }),
    /independent reviewer/,
  );
  const withPool = route({ taskClass: "T4", available: ALL_FOUR, config });
  assert.equal(withPool.reviewers.length, 2);
});

test("an evidence-backed provider preference is applied, and labelled when it cannot be", () => {
  const preferred = route({ taskClass: "T3", tag: "native-concurrency", available: ALL_FOUR, config });
  assert.equal(preferred.primary.provider, "anthropic");
  assert.match(preferred.notes.join(" "), /arena-bash-recovery-disjoint-ci/);

  // T0 carries no reviewer requirement, so the preferred-provider fallback is
  // observable on its own rather than masked by a cross-provider shortfall.
  const unavailable = route({
    taskClass: "T0",
    tag: "git-archaeology",
    available: ALL_FOUR,
    exhausted: ["CLAUDE_A", "CLAUDE_B"],
    config,
  });
  assert.equal(unavailable.primary.provider, "openai");
  assert.match(unavailable.notes.join(" "), /quota-balancing.*not a quality claim/);
  assert.throws(() => route({ taskClass: "T3", tag: "nope", available: ALL_FOUR, config }), /unknown preference tag/);
});

test("the tier mapping can change without editing AGENTS.md or any code", () => {
  const before = route({ taskClass: "T1", available: ["CLAUDE_A"], config });
  const swapped = structuredClone(config);
  swapped.routing.tiers.BALANCED.anthropic.model = "some-future-model-9";
  const after = route({ taskClass: "T1", available: ["CLAUDE_A"], config: swapped });
  assert.equal(after.primary.model, "some-future-model-9");
  assert.notEqual(after.primary.model, before.primary.model);

  // ...and AGENTS.md must not name models, so it cannot go stale with them.
  const agents = readFileSync(new URL("../../AGENTS.md", import.meta.url), "utf8");
  assert.doesNotMatch(
    agents,
    /\b(opus|sonnet|haiku|fable|gpt-\d|kimi|grok|gemini)\b/i,
    "AGENTS.md names a specific model; routing must live in harness/config/routing.json",
  );
});

test("every effort the harness can emit is a level Pi accepts", () => {
  // pi --thinking <level>: off, minimal, low, medium, high, xhigh, max
  const piLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  for (const effort of config.routing.effortLadder) assert.ok(piLevels.includes(effort));
});
