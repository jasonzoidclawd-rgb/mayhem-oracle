import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { route, loadConfig, RoutingError } from "../route.mjs";
import { launchArgv } from "../run/attempt.mjs";

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

test("parallelism defaults to one executor; the cap is a ceiling, not a target", () => {
  assert.equal(config.routing.defaultParallel, 1);
  for (const taskClass of CLASSES) {
    const r = route({ taskClass, available: ALL_FOUR, config });
    assert.equal(r.defaultParallel, 1, `${taskClass} dispatches more than one executor by default`);
    assert.ok(
      r.maxParallel >= r.defaultParallel,
      `${taskClass} caps below the default, making the default undispatchable`,
    );
  }
  // A ceiling nobody can read is an invitation. The rule that governs exceeding
  // it has to live where an executing agent already looks.
  const agents = readFileSync(new URL("../../AGENTS.md", import.meta.url), "utf8");
  assert.match(agents, /one executor per slice/i, "AGENTS.md does not state the default");
  assert.match(agents, /ceiling, never a target/i, "AGENTS.md does not say the cap is not a target");
});

// --- execution mechanism vs. authentication ------------------------------
//
// Subscription authentication is not subscription usage. A runtime can hold a
// Claude Pro credential and still bill per token as extra usage, which is the
// exact route the first dry-routing run resolved to and called compliant.

const meteredAnthropic = () => {
  const c = structuredClone(config);
  for (const id of ["CLAUDE_A", "CLAUDE_B"]) {
    c.routing.accounts[id].execution = "pi-anthropic-oauth";
  }
  return c;
};

test("every declared execution mechanism states whether it consumes plan-included usage", () => {
  const mechanisms = config.routing.executionMechanisms;
  assert.ok(mechanisms, "routing.json declares no execution mechanisms");
  for (const [id, m] of Object.entries(mechanisms)) {
    assert.equal(
      typeof m.consumesPlanIncludedUsage,
      "boolean",
      `${id} does not say whether it consumes the plan's included usage`,
    );
    assert.ok(m.basis && m.basis.trim(), `${id} states no basis for its billing claim`);
  }
  // The fact that made the dry route wrong, pinned as data.
  assert.equal(mechanisms["pi-anthropic-oauth"].consumesPlanIncludedUsage, false);
  assert.match(mechanisms["pi-anthropic-oauth"].basis, /extra usage|per token/i);

  for (const [id, account] of Object.entries(config.routing.accounts)) {
    const mechanism = mechanisms[account.execution];
    assert.ok(mechanism, `${id} declares no known execution mechanism`);
    assert.equal(mechanism.provider, account.provider, `${id}: mechanism provider mismatch`);
    assert.equal(
      mechanism.consumesPlanIncludedUsage,
      true,
      `${id} is configured to execute through a metered mechanism`,
    );
  }
});

test("Pi Anthropic OAuth is not a compliant CLAUDE_A mechanism, and fails closed", () => {
  const c = meteredAnthropic();
  // T0 carries no reviewer requirement, so the refusal is observably the
  // billing rule and not a review-pool shortfall.
  try {
    route({ taskClass: "T0", available: ["CLAUDE_A"], config: c });
    assert.fail("expected a routing error; a metered mechanism was dispatched");
  } catch (err) {
    assert.ok(err instanceof RoutingError);
    assert.match(err.message, /pi-anthropic-oauth/);
    assert.match(err.message, /NOT authorized/);
    assert.doesNotMatch(err.message, /api[_ -]?key|credits|pay.?as.?you.?go/i);
  }
  assert.equal(c.routing.billing.apiBillingAuthorized, false);
  assert.equal(c.routing.billing.usageCreditFallbackAuthorized, false);
});

test("an Anthropic-preferring route is undispatchable when only metered Anthropic execution exists", () => {
  // The observed defect: T3, risk 3, primary CLAUDE_A, dispatched through Pi's
  // Anthropic provider and reported subscription-compliant.
  const c = meteredAnthropic();
  try {
    route({ taskClass: "T3", tag: "native-concurrency", available: ALL_FOUR, config: c });
    assert.fail("expected a routing error");
  } catch (err) {
    assert.ok(err instanceof RoutingError);
    assert.doesNotMatch(err.message, /api[_ -]?key|credits|pay.?as.?you.?go/i);
  }
  // ...and no route, from any class, silently substitutes a metered mechanism.
  for (const taskClass of CLASSES) {
    let r;
    try {
      r = route({ taskClass, available: ALL_FOUR, config: c });
    } catch (err) {
      assert.ok(err instanceof RoutingError);
      continue;
    }
    for (const a of [r.primary, ...r.reviewers]) {
      assert.equal(
        c.routing.executionMechanisms[a.execution].consumesPlanIncludedUsage,
        true,
        `${taskClass} dispatched ${a.account} through metered ${a.execution}`,
      );
    }
  }
});

test("Pi's OpenAI Codex ChatGPT OAuth stays eligible for the GPT slots", () => {
  const r = route({ taskClass: "T1", available: ["GPT_A"], config });
  assert.equal(r.primary.account, "GPT_A");
  assert.equal(r.primary.auth, "subscription");
  const mechanism = config.routing.executionMechanisms[r.primary.execution];
  assert.equal(mechanism.runtime, "pi");
  assert.equal(mechanism.provider, "openai");
  assert.equal(mechanism.consumesPlanIncludedUsage, true);
});

test("every route names the execution mechanism instead of leaving it to the dispatcher", () => {
  for (const taskClass of CLASSES) {
    const r = route({ taskClass, available: ALL_FOUR, config });
    for (const a of [r.primary, ...r.reviewers]) {
      const mechanism = config.routing.executionMechanisms[a.execution];
      assert.ok(mechanism, `${taskClass}: ${a.account} was dispatched with no named mechanism`);
      assert.equal(a.runtime, mechanism.runtime);
      assert.equal(mechanism.consumesPlanIncludedUsage, true);
    }
  }
});

test("an account with no declared mechanism is not dispatchable", () => {
  const c = structuredClone(config);
  delete c.routing.accounts.GPT_A.execution;
  assert.throws(() => route({ taskClass: "T0", available: ["GPT_A"], config: c }), RoutingError);
});

// --- reviewer configuration isolation ------------------------------------
//
// The candidate checkout is subject data. It must not also be reviewer
// configuration. A reviewer runs in a detached checkout of the executor's own
// commit, so whatever its runtime auto-discovers from that working directory —
// CLAUDE.md, AGENTS.md, project skills, hooks in .claude/settings.json — is
// content the executor wrote, configuring the process that judges it. The
// reviewer must still be able to READ those files: a task whose purpose is to
// edit the project instructions has to be reviewable. What it must not do is
// load them as its own authority.
//
// Each runtime refuses them in its own vocabulary, and a flag from one is
// meaningless to the other. What a flag disables is a property of the runtime,
// established against the installed CLI and recorded in the mechanism's own
// `basis`; these tests pin the launch that carries it.
const PROJECT_CONFIG_ISOLATION = {
  claude: ["--safe-mode"],
  pi: ["--no-context-files", "--no-skills"],
};
const EVERY_ISOLATION_FLAG = Object.values(PROJECT_CONFIG_ISOLATION).flat();

const launchesOf = (mechanism) =>
  Object.entries(mechanism.launch ?? {}).filter(([, argv]) => Array.isArray(argv));

test("every reviewer is launched with project-local config discovery disabled", () => {
  let checked = 0;
  for (const [id, mechanism] of Object.entries(config.routing.executionMechanisms)) {
    const reviewer = mechanism.launch?.reviewer;
    if (!Array.isArray(reviewer)) continue;
    const required = PROJECT_CONFIG_ISOLATION[reviewer[0]];
    assert.ok(required, `${id} reviews through ${reviewer[0]}, whose isolation flags nothing here declares`);
    for (const flag of required) {
      assert.ok(reviewer.includes(flag), `${id} reviews with the candidate's own project configuration loaded (no ${flag})`);
    }
    checked += 1;
  }
  assert.ok(checked >= 2, `only ${checked} reviewer launches were checked`);
});

test("an executor keeps the project instructions a reviewer refuses", () => {
  // An executor works inside the project and needs its instructions — the
  // packet names them deliberately. The isolation is reviewer-only.
  for (const [id, mechanism] of Object.entries(config.routing.executionMechanisms)) {
    const executor = mechanism.launch?.executor;
    if (!Array.isArray(executor)) continue;
    for (const flag of EVERY_ISOLATION_FLAG) {
      assert.ok(!executor.includes(flag), `${id} strips project instructions from its executor, not just its reviewer`);
    }
  }
});

test("one runtime's launch flag never leaks into another", () => {
  for (const [id, mechanism] of Object.entries(config.routing.executionMechanisms)) {
    for (const [role, argv] of launchesOf(mechanism)) {
      for (const [runtime, flags] of Object.entries(PROJECT_CONFIG_ISOLATION)) {
        if (argv[0] === runtime) continue;
        for (const flag of flags) {
          assert.ok(!argv.includes(flag), `${id} passes ${runtime}'s ${flag} to ${argv[0]} in its ${role} launch`);
        }
      }
    }
  }
});

test("the reviewer isolation a mechanism declares survives rendering", () => {
  // Config is not the launch; the rendered argv is. Proven here rather than
  // inferred, with no placeholder left unsubstituted either way.
  for (const [id, mechanism] of Object.entries(config.routing.executionMechanisms)) {
    if (!Array.isArray(mechanism.launch?.reviewer)) continue;
    const render = (role, prompt) =>
      launchArgv({
        mechanism,
        role,
        model: "a-model",
        effort: "high",
        authProvider: mechanism.authProvider,
        prompt,
        sessionDir: "/s",
        workspace: "/w",
        runDir: "/r",
        reportDir: "/handoff",
      });
    const reviewer = render("reviewer", "BRIEF");
    for (const flag of PROJECT_CONFIG_ISOLATION[mechanism.launch.reviewer[0]]) {
      assert.ok(reviewer.includes(flag), `${id} rendered a reviewer launch without ${flag}: ${JSON.stringify(reviewer)}`);
    }
    assert.ok(!reviewer.some((a) => /[{}]/.test(a)), `unsubstituted placeholder in ${JSON.stringify(reviewer)}`);
    for (const flag of EVERY_ISOLATION_FLAG) {
      assert.ok(!render("executor", "PACKET").includes(flag), `${id} rendered an executor launch carrying ${flag}`);
    }
  }
});
