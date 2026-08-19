#!/usr/bin/env node
// Mayhem Oracle harness — routing policy and task-packet validation.
//
// Pure functions over static configuration. This module owns NO mutable state:
// quota exhaustion and local auth are passed in by the caller, never persisted
// here. When Pi is installed it supplies those arguments; until then the
// operator does. See docs/architecture/agent-harness.md.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadConfig(dir = HERE) {
  return {
    routing: JSON.parse(readFileSync(join(dir, "config/routing.json"), "utf8")),
    policy: JSON.parse(readFileSync(join(dir, "config/verification-policy.json"), "utf8")),
    schema: JSON.parse(readFileSync(join(dir, "schemas/task-packet.schema.json"), "utf8")),
  };
}

export class RoutingError extends Error {}

// --- routing -------------------------------------------------------------

function mechanismOf(routing, id, account) {
  const mechanism = routing.executionMechanisms?.[account.execution];
  if (!mechanism) {
    throw new RoutingError(
      `account ${id} declares no known execution mechanism (${JSON.stringify(account.execution ?? null)}); ` +
        "an account is dispatchable only through a mechanism whose billing is declared in harness/config/routing.json",
    );
  }
  return { id: account.execution, ...mechanism };
}

export function route({
  taskClass,
  tag = null,
  exhausted = [],
  available = null,
  effort = null,
  justification = null,
  config = loadConfig(),
} = {}) {
  const { routing, policy } = config;
  const spec = routing.taskClasses[taskClass];
  if (!spec) {
    throw new RoutingError(
      `unknown task class ${JSON.stringify(taskClass)}; known: ${Object.keys(routing.taskClasses).join(", ")}`,
    );
  }

  const notes = [];
  const chosenEffort = effort ?? spec.effort;
  if (!routing.effortLadder.includes(chosenEffort)) {
    throw new RoutingError(`unknown effort ${JSON.stringify(chosenEffort)}`);
  }
  if (routing.effortRequiringJustification.includes(chosenEffort)) {
    if (effort === null) {
      throw new RoutingError(
        `effort ${chosenEffort} is never a default; it must be requested explicitly`,
      );
    }
    if (!justification || !justification.trim()) {
      throw new RoutingError(
        `effort ${chosenEffort} requires one sentence of justification`,
      );
    }
    notes.push(`escalated to ${chosenEffort}: ${justification.trim()}`);
  }

  const authed = new Set(
    available ??
      Object.entries(routing.accounts)
        .filter(([, a]) => a.authStatus === "authenticated")
        .map(([id]) => id),
  );
  const out = new Set(exhausted);
  // Subscription authentication is not subscription usage: a runtime can hold a
  // plan credential and still bill per token. Only a mechanism that consumes the
  // plan's included usage is dispatchable, and an undeclared one never is.
  const usable = [];
  const metered = [];
  for (const [id, a] of Object.entries(routing.accounts)) {
    if (!authed.has(id) || out.has(id)) continue;
    const mechanism = mechanismOf(routing, id, a);
    if (mechanism.consumesPlanIncludedUsage) usable.push({ id, ...a, mechanism });
    else metered.push(`${id} executes through ${mechanism.id}, which is billed beyond the plan`);
  }

  if (usable.length === 0) {
    throw new RoutingError(
      "no authorized subscription resource is available. " +
        (metered.length ? `${metered.join("; ")}. ` : "") +
        "Authenticate another account from the 2+2 pool (CLAUDE_A/CLAUDE_B/GPT_A/GPT_B) or wait for quota to reset. " +
        "API billing and usage-credit fallback are NOT authorized.",
    );
  }

  const preference = tag
    ? routing.providerPreferences.find((p) => p.tag === tag)
    : null;
  if (tag && !preference) throw new RoutingError(`unknown preference tag ${JSON.stringify(tag)}`);

  const order = spec.preferAccounts ?? Object.keys(routing.accounts);
  const ranked = [...usable].sort(
    (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
  );

  let pool = ranked;
  if (preference) {
    const preferred = ranked.filter((a) => a.provider === preference.provider);
    if (preferred.length > 0) {
      pool = preferred;
      notes.push(`provider preference ${preference.provider} (${preference.basis})`);
    } else {
      notes.push(
        `provider preference ${preference.provider} unavailable; quota-balancing to another authorized account, not a quality claim`,
      );
    }
  }

  const tier = spec.tier;
  const primary = pool[0];
  const assignment = (acct) => {
    const t = routing.tiers[tier]?.[acct.provider];
    if (!t) throw new RoutingError(`tier ${tier} has no mapping for provider ${acct.provider}`);
    return {
      account: acct.id,
      provider: acct.provider,
      model: t.model,
      alternates: t.alternates ?? [],
      auth: acct.auth,
      execution: acct.mechanism.id,
      runtime: acct.mechanism.runtime,
    };
  };

  const verification = policy.riskLevels[String(spec.risk)];
  if (!verification) throw new RoutingError(`no verification policy for risk ${spec.risk}`);

  const result = {
    taskClass,
    label: spec.label,
    tier,
    escalateTier: spec.escalateTier ?? null,
    effort: chosenEffort,
    risk: spec.risk,
    defaultParallel: routing.defaultParallel,
    maxParallel: spec.maxParallel,
    primary: assignment(primary),
    verification,
    reviewers: [],
    notes,
  };

  // Independent review is an account requirement, not a prompt: a reviewer is
  // never the executor, and a cross-provider reviewer is never the executor's
  // provider. Too few authorized accounts fails closed with the setup gap
  // named — it never falls back to paid API access.
  const taken = new Set([primary.id]);
  for (let i = 0; i < verification.reviewers; i += 1) {
    const crossFirst = i === 0 && verification.crossProvider;
    const candidate =
      ranked.find(
        (a) =>
          !taken.has(a.id) && (!crossFirst || a.provider !== primary.provider),
      ) ?? null;
    if (!candidate) {
      throw new RoutingError(
        `risk ${spec.risk} requires ${verification.reviewers} independent reviewer(s)` +
          (verification.crossProvider ? " including a cross-provider one" : "") +
          `; only ${ranked.length} authorized account(s) available (executor ${primary.id}). ` +
          "Authenticate another account from the 2+2 pool. API billing is NOT authorized.",
      );
    }
    taken.add(candidate.id);
    result.reviewers.push({ ...assignment(candidate), readOnly: true });
  }

  for (const a of [result.primary, ...result.reviewers]) {
    if (a.auth !== "subscription") {
      throw new RoutingError("routed to a non-subscription resource; refusing");
    }
    if (!routing.executionMechanisms[a.execution]?.consumesPlanIncludedUsage) {
      throw new RoutingError(
        `routed ${a.account} through ${a.execution}, which does not consume the plan's included usage; refusing`,
      );
    }
  }
  return result;
}

// --- task packets --------------------------------------------------------

export function parsePacket(text, schema) {
  const re = new RegExp(schema.headingPattern);
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  const fields = {};
  let current = null;
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (m) {
      current = m[1];
      fields[current] = [];
    } else if (current) {
      fields[current].push(line);
    }
  }
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, v.join("\n").trim()]),
  );
}

export function validatePacket(text, { schema } = loadConfig()) {
  const fields = parsePacket(text, schema);
  const errors = [];
  for (const required of schema.requiredFields) {
    if (!(required in fields)) errors.push(`missing section: ## ${required}`);
    else if (!fields[required]) errors.push(`empty section: ## ${required}`);
  }
  for (const [field, rule] of Object.entries(schema.constraints)) {
    if (fields[field] === undefined) continue;
    // Constrained fields are scalars: the value is the first non-empty line.
    const value = fields[field].split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
      errors.push(`${field} must match ${rule.pattern} (got ${JSON.stringify(value)})`);
    }
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push(`${field} must be one of ${rule.enum.join(", ")} (got ${JSON.stringify(value)})`);
    }
  }
  return { fields, errors };
}

export function checkPacketSet(packets) {
  // packets: [{name, fields}]
  const errors = [];
  const byWorktree = new Map();
  for (const p of packets) {
    const wt = p.fields.WORKTREE;
    if (!wt) continue;
    if (byWorktree.has(wt)) {
      const other = byWorktree.get(wt);
      const roles = [p.fields.ROLE, other.fields.ROLE];
      errors.push(
        `${p.name} and ${other.name} both claim worktree ${wt}` +
          (roles.includes("verifier")
            ? " — a verifier must never be given the executor's worktree"
            : " — concurrent executors need separate worktrees"),
      );
    } else {
      byWorktree.set(wt, p);
    }
  }
  return errors;
}

// --- cli -----------------------------------------------------------------

function flag(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const config = loadConfig();
  if (cmd === "route") {
    const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);
    const result = route({
      taskClass: rest[0],
      tag: flag(rest, "tag"),
      exhausted: list(flag(rest, "exhausted")) ?? [],
      available: list(flag(rest, "available")),
      effort: flag(rest, "effort"),
      justification: flag(rest, "justify"),
      config,
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (cmd === "validate-packet") {
    if (rest.length === 0) throw new RoutingError("usage: validate-packet <packet.md>...");
    const parsed = [];
    let failed = false;
    for (const file of rest) {
      const { fields, errors } = validatePacket(readFileSync(resolve(file), "utf8"), config);
      parsed.push({ name: file, fields });
      if (errors.length) {
        failed = true;
        console.error(`FAIL ${file}`);
        for (const e of errors) console.error(`  - ${e}`);
      } else {
        console.log(`OK   ${file}  [${fields.TASK_CLASS} ${fields.ROLE} @ ${fields.BASE_SHA.slice(0, 7)}]`);
      }
    }
    const setErrors = checkPacketSet(parsed);
    for (const e of setErrors) console.error(`  - ${e}`);
    return failed || setErrors.length ? 1 : 0;
  }
  console.error("usage: route.mjs route <T0|T1|T2|T3|T4> [--tag t] [--exhausted A,B] [--available A,B] [--effort e --justify \"...\"]");
  console.error("       route.mjs validate-packet <packet.md>...");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}
