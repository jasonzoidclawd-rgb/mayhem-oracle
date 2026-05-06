# 001 — Three-Card Augment Picker Multi-Agent Plan

> For Hermes: execute this plan with subagent-driven development. Use the RALPH loop from `AGENTS.md`. Use Claude Code and Codex as bounded read-only advisors at the decision points listed below.

Goal: Build the first MVP slice of an ARAM Mayhem draft/advisor workflow: select a champion, select a verified Mayhem selection round (level 3 / game start, 7, 11, or 15), select owned augments, enter exactly three offered augments, add manual reroll and shop-availability context, rank those offers with existing scoring logic, and show concise data-backed explanations.

Architecture: Add a small route-level feature using existing static JSON data and existing scoring utilities. Keep runtime logic local/client-side after server data load, but keep client payloads as slim as practical. Include bounded qualitative reroll EV and manual shop-availability timing; do not introduce a database, OCR, overlay integration, account system, or exhaustive/probabilistic reroll simulation in this slice.

Tech Stack: Next.js 15 App Router, TypeScript, React 19, Tailwind CSS v4, next-intl, static JSON from `public/data/`.

## Success Criteria

- A user can open the new advisor route and select:
  - one champion
  - one selection round: level 3 / game start, level 7, level 11, or level 15
  - zero or more owned augments
  - exactly three offered augments
  - reroll context: normal rerolls remaining, Golden Reroll availability where applicable, and already-seen rerolled offers if the user provides them
  - shop-availability timing: available now, delayed until shop access, Cheating recall available, or queued behind pending selections
- The UI ranks only when exactly three offered augments are selected.
- Ranking uses existing scoring utilities where possible instead of creating an unrelated duplicate model.
- Each ranked option shows 2-4 explanation bullets based only on score components or concrete metadata.
- Owned augment state affects same-set bonus/progress explanation when data supports it.
- The MVP includes qualitative reroll EV for normal rerolls and Golden Rerolls, without pretending to have exact probabilities when pool data is incomplete.
- Shop-availability timing is represented manually and reflected in output copy.
- Champion-specific Mayhem overrides can affect P0 scoring when materially relevant.
- Mode-rule effects use both curated metadata and clearly labeled inferred text-derived signals, with lower confidence for inference.
- No overlay, OCR, game-client, backend database, auth, or automation code is added.
- `npm test`, `npm run lint`, and `npm run build` pass or failures are documented with root cause and whether they pre-existed.

## Constraints

- Follow `AGENTS.md`, `CLAUDE.md`, and `CO_WORKFLOW.md`.
- Keep changes surgical.
- Preserve i18n routing.
- Use `@/i18n/navigation` for locale-aware internal links.
- Use the `advisor.*` i18n namespace for new visible strings.
- Add English source copy first. For non-English locales, use consistent placeholder translations only if the project already uses that pattern; otherwise copy English and mark as follow-up in the final summary.
- Do not hand-edit generated `public/data/*.json`.
- Do not refactor unrelated existing components.
- Do not attempt to fix pre-existing dirty worktree issues unless required for this feature.

## Advisory Cadence

Use read-only Claude Code and Codex advisory only at these points:

1. After Task 1 recon, before finalizing the ranking helper API.
2. After Task 4 UI recon, before finalizing route/component payload architecture.
3. During final review if implementation is non-trivial or verification fails.

Advisory output format:

```text
Advisor: Claude Code | Codex | skipped
Focus: scoring API | UI architecture | final review
Strengths:
Risks:
Recommended changes:
Accepted by orchestrator:
Rejected/deferred:
```

Do not blindly apply advisory output. The Hermes orchestrator decides what to accept.

## RALPH Loop

For each task:

1. Recon: inspect relevant files, current git status, existing patterns, and command health.
2. Ask / Assumptions: ask only if ambiguity changes implementation; otherwise state assumptions in the task result.
3. List: list smallest steps, affected files, and assigned owner.
4. Produce: implement the smallest working slice.
5. Harden: run targeted verification, then spec and quality review.

## Execution Matrix

| Task | Owner | Write Paths | Read Paths | Verification | Advisory |
| --- | --- | --- | --- | --- | --- |
| 0 Baseline | QA/Review | none | repo status, package scripts | status/test/lint/build baseline | no |
| 1 Scoring recon | Data/Scoring | none | scoring/data/page files | written summary | yes after task |
| 2 Ranking tests | Data/Scoring | `src/lib/__tests__/offered-ranking.test.ts` | `src/lib/scoring/*`, fixtures | targeted test fails first | no |
| 3 Ranking helper | Data/Scoring | `src/lib/scoring/offered-ranking.ts`, test file | scoring/data types | targeted test, `npm test` | yes before implementation if API uncertain |
| 4 UI recon | Frontend/i18n | none | pages/components/messages | written summary | yes after task |
| 5 Route shell | Frontend/i18n | advisor route/component/messages | existing route patterns | lint/build | no |
| 6 Selection UI | Frontend | `AdvisorClient.tsx` | existing client components | lint/build/manual checks | no |
| 7 Results UI | Frontend + Data/Scoring | `AdvisorClient.tsx`, messages if needed | ranking helper | test/lint/build | no |
| 8 Spec review | QA/Review | none | changed files | PASS/gaps | maybe |
| 9 Quality review | QA/Review | none | changed files | APPROVED/changes | maybe |
| 10 Integration | QA/Review | none | whole repo | status/test/lint/build/diff | yes only if failures |

## Task 0: Baseline Verification

Objective: Capture current repo state before implementation so later failures can be attributed correctly.

Commands:

```bash
git status --short --branch
npm test
npm run lint
npm run build
```

Deliverable:
- Summary of dirty worktree files relevant to this feature.
- Baseline pass/fail for each command.
- Any pre-existing failures with brief root-cause notes.

Rules:
- Do not modify files.
- If build is already red, implementation tasks must not silently claim they caused or fixed unrelated failures.

## Task 1: Recon Current Scoring and Data APIs

Objective: Identify the existing functions and data shapes needed to rank offered augments for one champion.

Files to inspect:
- `src/lib/scoring/oracle-score.ts`
- `src/lib/scoring/pool-orchestrator.ts`
- `src/lib/scoring/set-synergy.ts`
- `src/lib/types.ts`
- `overlay/src/scoring/*`
- `src/app/[locale]/champions/[slug]/page.tsx`
- `src/app/[locale]/augments/page.tsx`
- `public/data/champions.json`
- `public/data/augments.json`
- `public/data/combos.json`
- `public/data/pool-rules.json`
- `public/data/abilities.json`

Known pre-recon fact:
- The current web scoring export is `computeOracleScore` in `src/lib/scoring/oracle-score.ts`.
- Existing test convention is `src/lib/__tests__/*.test.ts`.
- Verified mode-rule context from the PRD/wiki:
  - selections occur at level 3 / game start, 7, 11, and 15
  - each screen offers exactly three augments
  - normal rerolls preserve tier
  - Golden Rerolls may upgrade one Silver/Gold offering by one tier
  - augment screens appear only when shop is enabled, and can be delayed or queued
  - two or more augments from the same set activates a set bonus
  - champion-specific overrides can materially change recommendations
  - curated mode-rule tags and inferred text-derived signals should be distinguished by provenance/confidence
  - do not invent unverified 3-piece or 4-piece set thresholds

Deliverable:
- Short written summary of:
  - champion type shape
  - augment type shape
  - scoring entry point to reuse
  - required inputs
  - fixture strategy for tests
  - whether set membership/progress data exists and where
  - whether reroll pool/tier data exists and where
  - whether champion override or mode-rule metadata exists and where
  - whether explanation components are available or need a small adapter
  - whether client payload should include full JSON or slim projected records
  - web-vs-overlay scoring divergence note: either no overlay behavior changes, or exact follow-up needed

Verification:
- No files modified.
- Summary includes exact file paths and function names.

Advisory:
- After the summary, consult Claude Code and Codex read-only on the proposed ranking helper API and fixture strategy.

## Task 2: Add Ranking Helper Tests

Objective: Define expected behavior for a minimal offered-augment ranking helper before implementing it.

Files:
- Create: `src/lib/__tests__/offered-ranking.test.ts`
- Referenced target: `src/lib/scoring/offered-ranking.ts`

Test cases:
- Ranks exactly three offered augments for a champion.
- Returns a safe empty result or explicit incomplete state when fewer than three offers are provided; choose one API behavior and document it.
- Handles duplicate offered augments deterministically.
- Provides deterministic tie-breaking.
- Owned augments can contribute same-set bonus/progress explanation when data exists; tests must not assume unverified 3-piece or 4-piece thresholds.
- Qualitative reroll EV distinguishes same-tier normal reroll from Golden Reroll upgrade opportunity.
- Reroll EV can return low confidence when pool data is incomplete, but must still cite concrete factors.
- Shop-availability status appears in output and changes timing copy without requiring game-client automation.
- Champion-specific mode overrides can affect score/reasons when concrete metadata supports them.
- Curated mode-rule signals and inferred text-derived signals are both supported, but inference is labeled lower confidence.
- Trap/synergy metadata produces an explanation only when existing score breakdown or concrete metadata supports it.
- Reasons are data-backed; no generic invented explanation text.

Command:

```bash
npm test -- src/lib/__tests__/offered-ranking.test.ts
```

Expected before implementation:
- New tests fail because helper does not exist or behavior is unimplemented.

## Task 3: Implement Minimal Ranking Helper

Objective: Implement a small reusable helper that ranks offered augments using existing scoring logic.

Files:
- Create: `src/lib/scoring/offered-ranking.ts`
- Modify as needed: `src/lib/__tests__/offered-ranking.test.ts`

Required API shape, unless Task 1 discovers a better existing pattern:

```ts
export function rankOfferedAugments(input: RankOfferedAugmentsInput): RankedOfferedAugment[]
```

Input should include:
- champion
- selectionRound: `level-3` / `level-7` / `level-11` / `level-15`
- offeredAugments as an exact-three tuple or guarded array
- ownedAugments
- combos if required by scoring
- ability profile if required by scoring
- pool rules if required by scoring
- screen tier
- reroll context: normal rerolls remaining, Golden Reroll availability for Silver/Gold screens, and already-seen rerolled offers when provided
- shopAvailability: `available-now` / `delayed-until-shop` / `cheating-recall` / `queued`
- optional curated mode-rule tags and inferred mode-rule signals with provenance/confidence

Output should include:
- augment
- rank
- score or score band
- reasons: string[]
- rerollEv: qualitative stance plus concrete factors and confidence
- shopTiming: visible status and timing copy
- flags only when supported by data, e.g. `avoid`, `sameSetBonus`, `setProgress`, `goldenRerollEligible`, `championOverride`, `curatedModeRule`, or `inferredModeRule`

Rules:
- Reuse `computeOracleScore` or the best existing scoring entry point found in Task 1.
- Do not duplicate the full Oracle Score model.
- Keep explanations deterministic and simple.
- Keep reroll EV qualitative; do not implement an exhaustive probability simulator unless existing pool data makes it trivial.
- Treat inferred text-derived mode-rule signals as lower confidence than curated tags.
- Avoid LLM-generated explanations in runtime code.
- If overlay scoring is not updated, explicitly document that this is a web-only helper and no overlay behavior changed.

Verification:

```bash
npm test -- src/lib/__tests__/offered-ranking.test.ts
npm test
```

## Task 4: Recon UI Patterns

Objective: Identify existing component patterns to reuse for the advisor route.

Files to inspect:
- `src/app/[locale]/champions/page.tsx`
- `src/components/champions/ChampionsIndex.tsx`
- `src/app/[locale]/augments/page.tsx`
- `src/components/augments/AugmentsClient.tsx`
- `src/components/ui/Navbar.tsx`
- `messages/en.json`
- `messages/zh-TW.json`
- `messages/zh-CN.json`
- `messages/ja.json`
- `messages/ko.json`

Deliverable:
- Short summary of reusable selectors/cards/styles.
- Proposed new route path: prefer `/advisor` unless existing naming suggests otherwise.
- Proposed client payload shape and whether it can be slimmed.
- List of `advisor.*` i18n keys needed.
- Manual accessibility checks for selector labels and keyboard use.

Verification:
- No files modified.

Advisory:
- After the summary, consult Claude Code and Codex read-only on UI route architecture and payload size risk.

## Task 5: Add Advisor Route Shell

Objective: Add a new route that loads static data and renders a client component shell.

Files:
- Create: `src/app/[locale]/advisor/page.tsx`
- Create: `src/components/advisor/AdvisorClient.tsx`
- Modify: `messages/en.json`, `messages/zh-TW.json`, `messages/zh-CN.json`, `messages/ja.json`, `messages/ko.json`
- Modify: `src/components/ui/Navbar.tsx` only if adding the nav link remains in scope after Task 4.

Route requirements:
- Load only the data needed for the first shell and upcoming ranking integration.
- Pass data into `AdvisorClient` in a shape decided by Task 4.
- Render title, short description, and empty selectors.
- Use `advisor.*` i18n keys.

Verification:

```bash
npm run lint
npm run build
```

## Task 6: Implement Champion and Augment Selection UI

Objective: Implement the minimum usable picker UI.

Files:
- Modify: `src/components/advisor/AdvisorClient.tsx`
- Modify: `messages/*.json` only if new visible strings are needed.

Requirements:
- Champion search/select.
- Owned augment multi-select.
- Three offered augment selectors.
- Reroll context controls for normal rerolls remaining, Golden Reroll availability where applicable, and optional already-seen rerolled offers.
- Shop-availability timing control with available-now, delayed-until-shop, Cheating recall, and queued states.
- Prevent duplicate offered augments where practical.
- Keep local state only.
- Use accessible labels.
- Keep mobile layout usable.

Verification:

```bash
npm run lint
npm run build
```

Manual checks:
- Route renders.
- Champion selection updates state.
- Owned augment selection updates state.
- Offered augment slots update state.
- Reroll controls update state and are clearly labeled.
- Shop-availability control updates state and is clearly labeled.
- Duplicate offered augment handling is visible and deterministic.
- Inputs have labels and are keyboard usable.
- Mobile layout is usable at narrow width.

## Task 7: Integrate Ranking Results UI

Objective: Connect selection state to `rankOfferedAugments` and show ranked results.

Files:
- Modify: `src/components/advisor/AdvisorClient.tsx`
- Modify: `messages/*.json` if new strings are added.

Requirements:
- Results appear only after champion and exactly three offered augments are selected.
- Include a simple selection-round control for level 3 / game start, 7, 11, and 15.
- Include screen tier and reroll context in the helper call.
- Show qualitative reroll EV for normal rerolls and Golden Rerolls, including at least one concrete factor and confidence.
- Show shop-availability timing status and avoid describing delayed/queued selections as immediately actionable.
- Before three offers are selected, show a clear incomplete-state message.
- Clearly mark rank 1-3.
- Show score or score band.
- Show reason bullets.
- Show same-set bonus/progress or owned-augment context only when supported by data.
- Show champion override, curated mode-rule, and inferred mode-rule labels only when supported by data or explicitly identified by deterministic inference.
- Empty states are clear.

Verification:

```bash
npm test
npm run lint
npm run build
```

Manual checks:
- Ranking changes when champion changes.
- Ranking changes when offered augments change.
- Owned augment state affects visible explanation only if helper supports it.
- Reroll EV copy changes when Golden Reroll availability or normal reroll count changes.
- Shop timing copy changes when availability status changes.
- No hardcoded English strings outside intentional fallback policy.

## Task 8: Spec Review

Objective: Verify implementation matches this plan exactly.

Reviewer checklist:
- New route exists and loads.
- User can select champion, selection round, owned augments, three offered augments, reroll context, and shop-availability timing.
- Existing scoring logic is reused.
- Results rank only after exactly three offered augments are selected.
- Reasons are deterministic and tied to score/data.
- Qualitative reroll EV is present and does not claim false precision.
- Shop timing is present and manual-only.
- Champion override / mode-rule labels have provenance and confidence.
- No overlay/OCR/database/auth scope creep.
- i18n strings use `advisor.*` keys.
- Tests cover ranking helper.
- Web-vs-overlay scoring divergence is documented if overlay is not touched.

Output:
- PASS or list of specific gaps.

## Task 9: Quality Review

Objective: Verify code quality and maintainability.

Reviewer checklist:
- Simple implementation.
- No unnecessary abstractions.
- No unrelated refactors.
- No duplicated scoring model.
- Reroll EV logic is bounded and understandable.
- Reasonable component size.
- Accessible form controls.
- Tests meaningful and not brittle.
- Dirty worktree respected.
- Client payload is not obviously excessive for this route.
- Hardcoded-string scan/review completed for advisor UI.

Output:
- Critical issues.
- Important issues.
- Minor issues.
- Verdict: APPROVED or REQUEST_CHANGES.

## Task 10: Final Integration Verification

Commands:

```bash
git status --short --branch
npm test
npm run lint
npm run build
git diff --stat
```

Deliverable:
- Summary of changed files.
- Verification results compared to Task 0 baseline.
- Advisory used, if any, and what recommendations were accepted/deferred.
- Known risks or follow-up tasks.

Advisory:
- If verification fails or implementation is larger than expected, run one final Claude Code and Codex read-only review before handoff.

## Explicit Non-Scope for This Plan

- OCR.
- Tauri overlay changes.
- Live Client API changes.
- Data scraper changes.
- Database or account system.
- Exhaustive/probabilistic reroll simulator beyond bounded qualitative EV guidance.
- Community submissions.
- Major design system refactor.
- Global navigation redesign beyond optionally adding one advisor link.
