# AGENTS.md — Mayhem Oracle

Operating rules for AI agents in this repository. Project context, contracts,
and the data pipeline live in `CLAUDE.md` — read it first; don't duplicate it.

## Working Rules

1. **Think before coding.** State assumptions that matter; present competing
   interpretations instead of silently picking one; say so when a simpler
   approach exists; ask only when ambiguity materially changes implementation.
2. **Simplicity first.** Minimum code that solves the task. No speculative
   features, abstractions for single-use code, or unrequested configurability.
3. **Surgical changes.** Touch only what the task requires; match existing
   style; mention unrelated dead code, don't delete it. Remove only orphans
   your own change created. Every changed line traces to the task.
4. **Goal-driven execution.** Define success criteria and verify them. For
   bugs, reproduce first. For scoring changes, write the red test first and
   mirror web + overlay together (the cross-parity suite enforces this).

## Verification Floor

Run the narrowest check that proves your change, then before handoff:

```bash
npm test
npx eslint src scripts
npm run build
(cd overlay && npm run build)   # overlay-touching changes
```

Report every skipped or blocked gate. Rust changes: release build + binary
timestamp (see CLAUDE.md). Verification evidence: use `/usr/bin/diff`,
`/usr/bin/grep`, `/usr/bin/wc` (rtk hook caveat).

Changes under `.codex/skills/` must pass that skill's own suite — the CI job
`validation-skill-tests` runs it, so a skill edit that breaks its tests now
fails CI like any other regression:

```bash
bash .codex/skills/test-league-augment-overlay/scripts/verify_workflow_cwd.sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s .codex/skills/test-league-augment-overlay/scripts -p 'test_*.py'
```

## The Deterministic Gate Comes First

```bash
bash harness/verify-task.sh            # all suites
bash harness/verify-task.sh <profile>  # harness | web | overlay | skills | rust | all
```

One command, not four remembered ones. It runs the Verification Floor above,
costs zero model tokens, and exits nonzero on any failure. Run it before asking
any model whether something is correct.

- A failing gate cannot be overruled by a higher-tier model, a higher effort
  level, or a majority of reviewers.
- Never derive correctness from a review when the gate can decide it.
- Never read a multi-megabyte runtime log into a model context. Grep it.
- A profile that does not cover a suite says so in its output. If you need a
  suite the gate does not yet run, add it to `scripts/gate.sh` — the one place
  a verification command is written down — and map it in
  `harness/verify-task.sh` before claiming the change is proven.

**"Passing" is three different claims. Never collapse them into "done":**

```
IMPLEMENTED     the source contains the intended mechanism
OFFLINE-PROVEN  a deterministic regression demonstrates it
LIVE-PROVEN     controlled live acceptance demonstrates it
```

Report them independently, and name the level you actually reached.


## Repository Safety

- Check `git status --short --branch` before editing; preserve unrelated
  changes; call out suspicious pre-existing modifications.
- Before overlay, data-ingest, or platform-roadmap work, read
  `docs/handoffs/current-github-context.md`,
  `docs/handoffs/overlay-current-state.md`, and
  `docs/plans/riot-api-bigquery-discovery.md` instead of rediscovering recent
  state from scratch.
- Never hand-edit `public/data/` (generated; curated fields are pipeline-owned).
- New user-facing copy goes through all five `messages/*.json` in one commit.
- Tag before risky overlay work; the overlay's working state is sacred.
- Snapshot before risky work: `bash scripts/checkpoint.sh` writes head,
  status, both diffs, and every untracked file to `~/Desktop/wt-snapshots/`.
  It never pushes, resets, or cleans; `--help` documents the opt-in commit.
- The daily data cron commits to `main` at 22:00 UTC — rebase before pushing;
  resolve data-file conflicts by regenerating, never by hand-merging JSON.

## Data Ladder & Anti-Scraping

Three disclosure layers, enforced at generation time
(`scripts/export_public_catalog.py`) and by
`src/lib/__tests__/public-data-boundary.test.ts`:

1. **Public/free** — sanitized catalogs in `public/data/` and `/api/v1/*`:
   readable summaries, champion tiers/win-rates, S-tier combo teaser
   (≤3/champion, name+tier only). Useful and SEO-friendly, never enough to
   cheaply reconstruct the member product.
2. **Member** — server-gated depth: pool construction, oracle scores and
   breakdowns, full combos incl. traps, decision APIs, overlay model manifest.
   Gate with `requireActiveEntitlement()` on the server; hiding UI is not a
   gate. Trial access is a bounded lease, never a durable entitlement.
3. **Internal** — `data/internal/`, calibration/model/telemetry artifacts,
   signing keys, BigQuery/R2 credentials. Never shipped to browsers, static
   payloads, or logs.

Never: add internal fields to public exports, loosen a forbidden-key list,
serve member depth from client-reachable static files, weaken entitlement or
consent gates, or overstate confidence/freshness. Any new public field is a
deliberate ladder decision — update the boundary test in the same change, and
ask the product owner if the field moves value down the ladder.

## Localization Is Data Architecture

Locale bugs are data-structure bugs first, UI-copy bugs second. Canonical IDs
(slugs, item ids) stay language-agnostic; display strings resolve per locale
via `src/lib/i18n/localized-name.ts` (suffix fields `name_zh_TW`, … populated
by `scripts/enrich_locale_names.py` and the augment pipeline).

- Every rendered name/description goes through the localized resolver. A raw
  `.name` / `.description` / `.wikiDescription` render is an
  English-persistence bug unless the string is verifiably locale-neutral.
- English fallback happens only inside the resolver (missing source
  translation) — never via hardcoded `en`/`en_US` in shared data paths, cache
  keys, static generation, API responses, or hydration.
- Content cached or generated per patch is also keyed by locale whenever it is
  locale-dependent.
- Locale lists live in `src/i18n/routing.ts` (web) and
  `scripts/enrich_locale_names.py` (pipeline) — do not add new hardcoded lists
  elsewhere. Expanding toward full Riot/Data Dragon coverage is a
  product-owner decision; prefer deriving locales from Data Dragon language
  metadata over growing hardcoded subsets, and don't make that harder.

## Update Pipeline Is Product Infrastructure

`scripts/update-data.sh` + `.github/workflows/update-data.yml` are a
reliability and moat boundary: publishing broken, stale, partial, or
locale-degraded data breaks the product even when app tests are green.

- Patch detection stays explicit and tested (`public/data/meta.json` patch +
  `scripts/check_data_freshness.py`); freshness or confidence shown to users
  must trace to that metadata.
- Validation gates run before publish; never bypass a gate to "quick fix" a
  page. Promotion is the git commit — never commit partial regeneration
  output; recover local failures via git, and curated fields flow only through
  the snapshot/restore steps.
- Locale enrichment (step 10b) is part of the refresh, not optional; a refresh
  that drops localized fields is a regression even if English pages look fine.
- Hardcoded patch numbers in workflows/scripts are bugs — read the patch from
  `meta.json` or fail loudly.

## Champion Pages: Editorial, Not Table Dumps

Target feel (aramgg-style blogpost, better than wiki references): fast public
page with a hero/quick-recommendation, concise "why this works" reasoning,
patch-freshness and confidence signals, clear trap warnings, related
champions/augments — with member-only interactive drilldowns layered beneath.
Prefer prose + cards over raw tables, mobile-first, locale-correct metadata.
Public pages build trust; they do not hand over member depth.

## Scope, Ownership, and Escalation

- There are no standing agent-owned zones. Handoff docs may mark files
  in-flight for one task; nothing in the repo is exempt from review or
  architecture scrutiny. When an instruction/handoff doc conflicts with code
  or git history, trust the repo and fix the doc.
- After changing agent instructions or crossing a subsystem boundary,
  re-review the affected slice end to end (generation → payload → UI → tests)
  instead of assuming a neighboring area is someone else's.
- Ask the product owner (concise question, options, a default) before:
  changing the public/member ladder, adding/removing locales, altering
  entitlement/trial semantics, adding public data surfaces, or any
  compliance-sensitive overlay behavior. Don't silently pick long-term product
  strategy.
- Route work by fit, not zone: crisp mechanical multi-file implementation →
  Codex; ambiguous product/architecture calls → orchestrating agent + product
  owner; risky or cross-cutting changes → independent second-model review
  (read-only prompt) before merge.

## Bounded Slices

Work the operator scopes as a slice — a stated goal, pinned evidence, and a
hard file cap — runs under `.claude/skills/slice-contract/SKILL.md`. That skill
is the contract, not a suggestion: evidence pinned to
`.codex/evidence/<slice>/` before work starts; every inherited claim, including
the prompt's own, re-verified against those pins before anything is built on
it; each phase report written to `.codex/gates/<slice>/` before the next phase
begins; red tests at the true seam, frozen by SHA-256 before implementation;
and exactly one of its four terminal states. Caps are hard — exceeding one, or
needing an unauthorized change category, is a PAUSED report with zero code
changes, never a self-granted scope.

## Multi-Agent Workflow

The orchestrator decomposes; subagents do focused work with exact context,
paths, constraints, and expected output. Avoid parallel edits to the same
files outside separate worktrees. Use `CO_WORKFLOW.md` packets for bounded
Claude/Codex handoffs; advisory output is input, not truth — the orchestrator
decides and records what was accepted or rejected. Keep advisory bounded to
real decision points (scoring/data API design, route architecture, final
review of non-trivial work); read-only prompts unless implementation authority
is explicitly assigned. Avoid recursive agent nesting.

## Model Routing and Effort

Route by capability tier, never by model name — names change, tiers do not.
The name-to-tier mapping, the account pool, and the task classes live in
`harness/config/routing.json`, so model churn never edits this file:

```bash
node harness/route.mjs route T2        # -> tier, account, model, effort, review
```

| Task class | Tier | Effort |
|---|---|---|
| T0 retrieval / mechanical | throughput | low |
| T1 bounded coding | balanced | medium |
| T2 difficult debugging | balanced, escalating to frontier | high |
| T3 concurrency / architecture / contradictory evidence | frontier | high |
| T4 disputed or release-critical decision | frontier, cross-provider | high |

**Default to medium effort.** Escalate on evidence — a failed hypothesis, a
deterministic contradiction, a concurrency ambiguity — never because a task
feels important. Importance raises *verification* rigor, not every agent's
reasoning effort. The two highest effort levels are never a default; the router
refuses them unless they are requested explicitly with one sentence of
justification.

**One executor per slice.** The router returns `defaultParallel: 1` for every
task class. A class's `maxParallel` is a ceiling, never a target: dispatching a
second concurrent agent requires a written answer to "what uncertainty does the
second one resolve?", recorded with the work. Splitting the account pool evenly
across concurrent executors leaves nothing for independent review, which is the
scarcer resource.

Only subscription-backed accounts are authorized, and authentication is not
usage: a runtime can sign in with a subscription credential and still bill per
token beyond the plan. Each account slot therefore declares the execution
mechanism it dispatches through, and only a mechanism that consumes the plan's
included usage is dispatchable. When no authorized mechanism is available the
router fails closed and names the setup gap; it never falls back to metered API
access, to usage beyond the plan, or to any other paid route. The mechanisms,
and the basis for each billing claim, live in `harness/config/routing.json`.

Public agent-evaluation results are a **routing prior, not an oracle**. They may
inform which provider handles a class of work; they never override a
deterministic gate or a reproduction. Two provider preferences in the config are
backed by non-overlapping measured intervals and are tagged with that basis;
everything else is quota balancing. Say which one you are doing rather than
dressing a scheduling choice as a quality claim. The evidence behind those
preferences, with its retrieval date, lives in
`docs/architecture/agent-harness.md`.

## Task Packets

Delegated work is reconstructible from a packet, not from conversation history.
A task packet is the `CO_WORKFLOW.md` handoff packet plus the fields an agent
needs to work in an isolated worktree: task class, base SHA, worktree, role,
relevant paths, invariants, graded known facts, open questions, acceptance
tests, do-not-touch paths, and a return format.

```bash
cp docs/task-packets/TEMPLATE.md docs/task-packets/<slice>.md
node harness/route.mjs validate-packet docs/task-packets/<slice>.md
```

A packet's base SHA is fixed for its life; re-baselining means a new packet.
Concurrent packets must name different worktrees. Prefer a fresh bounded
session over compaction when the old context is mostly irrelevant —
conversation history is disposable cache; source, tests, specs, ADRs, and
concise handoffs are the durable state.

## Review Independence

The review protocol is **Verifier-Lite**, defined in
`harness/config/verification-policy.json`.

- A reviewer is **read-only** and may not fix its own finding during the review
  pass.
- A reviewer never receives the executor's reasoning transcript — only the
  spec, the fixed-point diff, the invariants, and the gate output. Independent
  verification requires epistemic independence.
- Findings carry CLAIM / EVIDENCE / SEVERITY / CONFIDENCE / VIOLATED
  INVARIANT. "Looks good" is not a review.
- Reviewer count and cross-provider requirements follow the change's risk
  level, not its importance. The router assigns reviewer accounts and refuses
  to let an account review its own work.
- When choosing between two candidates, read them in both orders and report
  whether the conclusion survived the reversal.
- Verifier-Lite deliberately omits the logprob-derived continuous scoring that
  defines the published verification method it borrows its structure from;
  subscription authentication does not expose those logprobs. Do not describe
  it as that method.


## Review Gates

1. **Spec** — exactly the requested behavior; nothing missing, no scope creep.
2. **Quality** — simple, consistent, adequately tested; i18n, data freshness,
   and web/overlay parity handled.
3. **Integration** — tests/lint/build green; works with existing routes and
   data; scoring-twin boundary respected.

Do not proceed past a failed gate without fixing it or explicitly documenting
the deferral.

### ARAM Mayhem augment cardinality invariant

Do not equate four augment offer rounds with four final owned augments.

- There are exactly four offer-round owners.
- One round may produce multiple final augment results.
- Final ownership representations must support at least five entries.
- Transformation chains remain within their originating round.
- Never derive round progression from final augment inventory length.

Canonical contract:
`docs/specs/overlay-v1-product-contract.md`
