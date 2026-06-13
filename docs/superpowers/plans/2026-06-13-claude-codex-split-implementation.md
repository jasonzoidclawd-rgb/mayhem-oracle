# Mayhem Oracle Membership Decision Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mobile-first membership decision platform, privacy-bounded LCU data pipeline, and Windows/macOS member overlay built around competitive guidance, playstyle exploration, and hard-trap avoidance.

**Architecture:** Codex owns the pure decision engine, parity, desktop collector, model pipeline, overlay, and final integration. Claude Code owns Supabase membership, protected web APIs, mobile web UX, telemetry ingestion backend, and AdSense. Shared contracts are frozen by Codex before parallel work begins; neither agent edits the other agent's owned paths outside the final integration branch.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, next-intl, Supabase Auth/Postgres/RLS, Cloudflare R2, BigQuery, Tauri 2, Rust, Vite, GitHub Actions, Vercel, Google AdSense.

---

## Locked Product Decisions

- The free website is a feature-rich, ad-supported reference database.
  - Public: champion win rate, rank, pick rate, champion/ability/augment/item facts, patch notes, and factual tags.
  - Not public: augment win rate, Mayhem-item win rate, arbitrary decision results, full champion pools, ranking weights, or score breakdowns.
- All decision features require an active entitlement:
  - Advisor
  - full champion-specific augment pools
  - round-specific priorities and conditional probabilities
  - skill/item synergy details
  - decision history and feedback
  - member overlay
- Membership v1 is manually granted through Supabase invite codes and admin controls. Payment integration is out of scope.
- The engine has two modes:
  - `competitive`: default; favors reliable, immediate, lower-variance value.
  - `exploration`: favors unusual synergies, champion identity, and high-ceiling playstyles.
- Both modes always surface hard incompatibility warnings.
- Recommendation grades are `hot`, `strong`, `steady`, `average`, and `weak`, with localized display copy supplied by the existing i18n system.
- Grades compare an augment against the champion's current eligible pool for the same rarity and current state. They do not compare across rarities or only against the three visible offers.
- Patch 26.12 Trait/Set bonuses are not part of the live decision model.
- The free collector and member overlay launch together on Windows and macOS.
- Collector consent is blocking: declining consent disables both collection and overlay.
- Local snowball collection runs only outside an active game and exports at most 100 Mayhem matches per device per day.
- Uploaded data is allowlisted and de-identified before leaving the device. Full LCU responses, Riot IDs, PUUIDs, names, chat, and full screenshots are never uploaded.
- Safe raw exports are stored in R2 for 30 days. Long-term de-identified events are stored in BigQuery.
- Referral trial access is bound to Google account plus device and grants three game credits. A credit is consumed only when the game exceeds eight minutes.
- Model updates are generated offline, manually approved, signed, versioned, and reversible.
- The overlay performs local inference from a signed model package but must verify entitlement on every app start and every game start.

## Agent Ownership and Branches

| Workstream | Owner | Branch | Exclusive write paths |
| --- | --- | --- | --- |
| Contracts and decision engine | Codex | `codex/decision-engine-foundation` | `src/lib/decision/**`, `src/lib/contracts/**`, shared scoring files, decision/parity tests |
| Membership and web product | Claude Code | `claude/web-membership-platform` | `supabase/**`, `src/lib/entitlements/**`, `src/app/api/**`, locale pages, web components, messages, root web config |
| LCU collector and safe export | Codex | `codex/lcu-collector` | `overlay/src-tauri/**`, `overlay/src/collector/**`, collector tests |
| Telemetry backend and ads | Claude Code | `claude/telemetry-backend-ads` | telemetry API/backend modules, Supabase telemetry metadata, public ad/consent components, GitHub ingestion workflow |
| Model calibration and overlay | Codex | `codex/model-overlay` | `scripts/model/**`, model tests, `overlay/src/**`, overlay package/config |
| Final integration | Codex lead, Claude review | `codex/platform-integration` | integration conflict resolution and cross-system fixes only |

### Coordination Rules

- Preserve the unrelated existing modification to `public/data/patch-notes.json`.
- Do not hand-edit generated files under `public/data/`.
- Claude Code must not edit `src/lib/decision/**`, shared scoring modules, or overlay files.
- Codex must not edit Supabase migrations, web API routes, web components, messages, or root web configuration before integration.
- Root `package.json` and `package-lock.json` are Claude-owned. Overlay package manifests and Cargo files are Codex-owned.
- Codex owns `scripts/update-data.sh`, generated-data scripts, `.github/workflows/update-data.yml`, and the internal/public data split. Claude owns `.github/workflows/ingest-telemetry.yml`.
- Contract changes after the Milestone 1 handoff require a written handoff note and approval from both agents.
- Each workstream must finish with a scoped commit and verification evidence before handoff.

### Branch Dependency Order

- Create `codex/decision-engine-foundation`, `claude/web-membership-platform`, and `codex/lcu-collector` from the verified baseline.
- Before implementation, both downstream branches cherry-pick the completed Milestone 1 contract/engine commit.
- Create `claude/telemetry-backend-ads` from the completed Web membership branch.
- Create `codex/model-overlay` from the completed collector branch, then cherry-pick its approved backend/model contract dependencies.
- Create `codex/platform-integration` only after all five workstream commits are ready.

## Frozen Shared Contracts

Codex creates these contracts first. Claude Code consumes them without changing their shapes.

```ts
export type DecisionMode = "competitive" | "exploration";
export type DecisionGrade = "hot" | "strong" | "steady" | "average" | "weak";
export type AugmentRound = 1 | 2 | 3 | 4;
export type AugmentRarity = "silver" | "gold" | "prismatic";

export interface DecisionContext {
  championSlug: string;
  round: AugmentRound;
  screenRarity: AugmentRarity;
  mode: DecisionMode;
  ownedAugmentSlugs: string[];
  currentItemIds: string[];
  plannedItemIds: string[];
  offeredAugmentSlugs?: string[];
  seenOfferSlugs?: string[];
  rerollsRemaining: number;
  goldenRerollAvailable: boolean;
}

export interface DecisionCandidateResult {
  augmentSlug: string;
  grade: DecisionGrade;
  score: number;
  percentile: number;
  probability: {
    initialThree: number;
    withNormalRerolls: number;
  };
  warnings: string[];
  reasons: string[];
  confidence: "high" | "medium" | "low";
  breakdown: Record<string, number>;
}

export interface DecisionResult {
  modelVersion: string;
  context: DecisionContext;
  poolSize: number;
  candidates: DecisionCandidateResult[];
  reroll: {
    stance: "keep" | "consider" | "reroll" | "golden-reroll";
    reasons: string[];
  };
}
```

```ts
export interface SafeMatchExport {
  schemaVersion: 1;
  gameHash: string;
  patch: string;
  queueId: 2400;
  durationSeconds: number;
  collectedAt: string;
  source: "owned-history" | "snowball";
  participants: Array<{
    slot: string;
    team: 100 | 200;
    championSlug: string;
    augmentSlugs: string[];
    itemIds: string[];
    won: boolean;
    stats: {
      kills: number;
      deaths: number;
      assists: number;
      damageToChampions: number;
    };
  }>;
  contributorRounds?: Array<{
    round: 1 | 2 | 3 | 4;
    offeredAugmentSlugs: string[];
    selectedAugmentSlug?: string;
    ocrConfidence: number;
  }>;
}
```

```ts
export interface ModelManifest {
  modelVersion: string;
  engineVersion: string;
  dataVersion: string;
  createdAt: string;
  configSha256: string;
  signature: string;
}
```

## Milestone 0: Baseline and Handoff Setup

**Owner:** Codex

**Files:**
- Create: `docs/handoffs/platform-baseline.md`
- Read: `CLAUDE.md`, `AGENTS.md`, `CO_WORKFLOW.md`

- [ ] Record branch, dirty files, current commit, current test count, and current Web/overlay build status.
- [ ] Run:

```bash
git status --short --branch
npm test
npm run lint
npm run build
(cd overlay && npm run build)
python3 scripts/test_classify_augments.py
bash scripts/test-state.sh
git diff --check
```

- [ ] Record failures as pre-existing or newly introduced. Do not modify `public/data/patch-notes.json`.
- [ ] Create the three initial branches listed in the branch dependency order from the same verified base commit.
- [ ] Commit only the baseline handoff document:

```bash
git add docs/handoffs/platform-baseline.md
git commit -m "docs: record membership platform baseline"
```

**Definition of done:** Both agents start from the same base commit and have a written verification baseline.

## Milestone 1: Contracts and Unified Decision Engine

**Owner:** Codex

**Files:**
- Create: `src/lib/contracts/decision.ts`
- Create: `src/lib/contracts/telemetry.ts`
- Create: `src/lib/contracts/model.ts`
- Create: `src/lib/decision/evaluate.ts`
- Create: `src/lib/decision/model-config.ts`
- Create: `src/lib/decision/round-value.ts`
- Create: `src/lib/decision/grade.ts`
- Create: `src/lib/data/internal-loader.ts`
- Create: `scripts/export_public_catalog.py`
- Modify: `src/lib/scoring/pool-orchestrator.ts`
- Modify: `src/lib/scoring/oracle-score.ts`
- Modify: generated-data scripts and `.github/workflows/update-data.yml`
- Test: `src/lib/__tests__/decision-engine.test.ts`
- Test: `src/lib/__tests__/public-data-boundary.test.ts`
- Test: `src/lib/__tests__/cross-parity.test.ts`
- Test: `src/lib/__tests__/overlay-scoring-parity.test.ts`

### Task 1.1: Add Red Contract and Grade Tests

- [x] Write failing tests that prove:
  - only same-rarity eligible augments form the comparison pool
  - three visible offers can all be `average` or `weak`
  - hard-incompatible augments are always `weak` and carry warnings
  - competitive and exploration modes can rank the same eligible augments differently
  - Patch 26.12 decisions contain no Trait/Set bonus
- [x] Use these grade bands over descending same-pool percentile:

```ts
export const GRADE_BANDS = {
  hot: [0, 0.1],
  strong: [0.1, 0.3],
  steady: [0.3, 0.6],
  average: [0.6, 0.85],
  weak: [0.85, 1],
} as const;
```

- [x] Run:

```bash
npx vitest run src/lib/__tests__/decision-engine.test.ts
```

Expected: FAIL because the unified decision engine does not exist.

### Task 1.2: Implement the v1 Decision Model

- [x] Implement the pure `evaluateDecision(context, data, modelConfig): DecisionResult` boundary.
- [x] Keep observed augment telemetry internal and bounded. Never return augment win rate from the decision contract.
- [x] Replace direct augment-win-rate scoring with deterministic shrinkage:

```ts
const confidence =
  augment.win_rate == null ? 0 :
  augment.flags?.lifecycle === "added" ? 0.35 :
  0.75;
const boundedPrior = Math.max(42, Math.min(62, rarityPrior));
const observed = augment.win_rate ?? boundedPrior;
const baseQuality = confidence * observed + (1 - confidence) * boundedPrior;
```

- [x] Compute `rarityPrior` as the median non-null win rate of active augments in the same rarity.
- [x] Group signals without double-counting:
  - `reliability`: shrunk base quality and telemetry confidence
  - `synergy`: combo, mechanical interaction, ability fit, and item synergy
  - `novelty`: system-breaker and high-ceiling positive interaction signals
  - `penalties`: hard conflicts, traps, and mismatches
- [x] Use the existing Oracle dimensions as inputs, remove dead Trait/Set effects, and add versioned v1 modifiers:

```ts
export const ROUND_VALUE = {
  scaling: { 1: 6, 2: 3, 3: 0, 4: -6 },
  immediate: { 1: 0, 2: 1, 3: 3, 4: 5 },
  neutral: { 1: 0, 2: 0, 3: 0, 4: 0 },
} as const;

export const MODE_MULTIPLIERS = {
  competitive: { reliability: 1.2, synergy: 1.0, novelty: 0.0 },
  exploration: { reliability: 0.7, synergy: 1.2, novelty: 1.0 },
} as const;

export const ITEM_VALUE = {
  currentSynergy: 4,
  plannedSynergy: 2,
  currentCap: 8,
  plannedCap: 4,
  hardConflict: -15,
} as const;
```

- [x] Calculate initial-three and normal-reroll probabilities from the residual same-rarity pool. Exclude removed/disabled augments, hard-ineligible augments, owned augments, mutually exclusive augments, and already-seen offers.
- [x] Treat Golden Reroll as a separate stance and explanation, never as normal same-rarity probability.
- [x] Return deterministic reason codes and warnings generated from the same signals used in scoring.

### Task 1.3: Split Internal and Public Data

- [x] Move decision-only generated fields into server-only runtime data under `data/internal/`.
- [x] Keep public catalog files under `public/data/`, but strip:
  - augment win rate
  - Mayhem-item win rate
  - model weights
  - complete computed champion pools
- [x] Keep public champion win rate, rank, and pick rate.
- [x] Make `scripts/export_public_catalog.py` the only writer of sanitized public catalog output.
- [x] Update the daily data workflow to regenerate internal data first, then export sanitized public catalogs.
- [x] Keep free overlay data sync on sanitized public catalogs; reserve internal decision data for the signed member model package.
- [x] Add a guardrail that fails if forbidden fields appear in public JSON.

### Task 1.4: Close Web/Overlay Parity

- [x] Mirror any still-duplicated scoring changes in overlay scoring modules.
- [x] Extend parity tests to compare:
  - eligible pool
  - score and grade
  - conditional probability
  - warnings and reasons
- [x] Run:

```bash
npx vitest run src/lib/__tests__/decision-engine.test.ts src/lib/__tests__/public-data-boundary.test.ts src/lib/__tests__/cross-parity.test.ts src/lib/__tests__/overlay-scoring-parity.test.ts
npm test
npm run lint
npm run build
(cd overlay && npm run build)
```

- [x] Commit:

```bash
git add src/lib/contracts src/lib/decision src/lib/data/internal-loader.ts src/lib/scoring src/lib/__tests__ overlay/src/scoring overlay/scripts scripts .github/workflows/update-data.yml data public/data
git commit -m "feat(decision): add unified round-aware decision engine"
```

**Handoff to Claude Code:** Commit hash, frozen contract files, sample `DecisionContext`/`DecisionResult`, targeted test output, and parity proof.

## Milestone 2: Membership, Protected APIs, and Mobile Web Product

**Owner:** Claude Code

**Dependency:** Milestone 1 handoff commit

**Files:**
- Create: `supabase/migrations/20260613_membership_platform.sql`
- Create: `src/lib/entitlements/server.ts`
- Create: `src/lib/entitlements/admin.ts`
- Create: `src/app/api/decision/evaluate/route.ts`
- Create: `src/app/api/decision/champion-matrix/route.ts`
- Create: `src/app/api/overlay/bootstrap/route.ts`
- Create: `src/app/api/overlay/game-session/route.ts`
- Create: `src/app/api/invites/redeem/route.ts`
- Create: `src/app/api/admin/entitlements/route.ts`
- Create: `src/app/[locale]/account/page.tsx`
- Create: `src/app/[locale]/admin/page.tsx`
- Modify: `src/app/[locale]/advisor/page.tsx`
- Modify: `src/components/advisor/AdvisorClient.tsx`
- Modify: `src/app/[locale]/champions/[slug]/page.tsx`
- Modify: `src/components/champions/PoolConstructionSection.tsx`
- Modify: `messages/*.json`
- Test: `src/lib/__tests__/entitlements.test.ts`
- Test: `src/lib/__tests__/decision-api.test.ts`

### Task 2.1: Add Membership Schema and RLS

- [x] Add tables:
  - `profiles`
  - `entitlements`
  - `invite_codes`
  - `invite_redemptions`
  - `devices`
  - `decision_sessions`
  - `decision_feedback`
  - `model_releases`
  - `referral_progress`
- [x] Store invite codes as hashes, not plaintext.
- [x] Give invite codes a fixed kind:
  - `member` grants a dated manual entitlement
  - `trial` grants three game credits exactly once per Google-account-plus-device combination
- [x] Use `auth.users.id` as the account key.
- [x] Use `app_metadata.role = 'admin'` for administrator authorization.
- [x] RLS rules:
  - users can read their own profile, entitlement, devices, sessions, feedback, and referral progress
  - users cannot grant or extend entitlements
  - only service-role/admin routes can create invite codes, update entitlements, and publish model releases
- [x] Add tests proving free users cannot access member rows or grant themselves access.

### Task 2.2: Protect Decision APIs

- [x] Implement `requireActiveEntitlement()` and use it in both decision routes.
- [x] `POST /api/decision/evaluate` accepts `DecisionContext`, calls the frozen pure engine, records the model version and decision session, and returns the full `DecisionResult`.
- [x] `POST /api/decision/champion-matrix` returns all four rounds grouped by rarity for one champion and one mode.
- [x] `GET /api/overlay/bootstrap` verifies entitlement or an active trial-game lease and returns the active model manifest, immutable package URL, signature, and expiry.
- [x] `POST /api/overlay/game-session` reserves a trial credit at game start and returns a game-scoped lease. Active members receive a lease without consuming credits.
- [x] Return:
  - `401` when unauthenticated
  - `403` when authenticated without an active entitlement
  - `400` for invalid contexts
- [x] Do not add a public arbitrary-decision endpoint. Public demos must use curated static examples.
- [x] Add request rate limiting keyed by authenticated user.

### Task 2.3: Build the Member Web Experience

- [ ] Make Advisor a mobile-first member tool with:
  - champion
  - competitive/exploration mode
  - round
  - screen rarity
  - owned augments
  - current items
  - planned items
  - three offers
  - normal and Golden Reroll state
- [ ] Render grade, probability, hard warnings, reasons, confidence, and reroll stance.
- [x] Make the champion page member section a four-round by three-rarity matrix using the same API.
- [ ] Add account page for entitlement, invite redemption, device status, history, and feedback.
- [ ] Add admin page for invite-code creation, entitlement grant/revoke, and model-release status.
- [ ] Keep full pool data and weights out of unauthenticated/non-member server responses and client bundles.
- [ ] Update public reference pages to consume only sanitized public catalogs and remove all augment/Mayhem-item win-rate rendering.
- [ ] Verify layouts at 375px, 768px, and 1440px widths.

### Task 2.4: Verify and Commit

```bash
npx vitest run src/lib/__tests__/entitlements.test.ts src/lib/__tests__/decision-api.test.ts
npm test
npm run lint
npm run build
git diff --check
```

```bash
git add supabase src/lib/entitlements src/app/api src/app/'[locale]' src/components messages package.json package-lock.json
git commit -m "feat(web): add member decision platform"
```

**Handoff to Codex:** Decision API examples, entitlement helper contract, database migration, and Web verification output.

## Milestone 3A: LCU Collector and Safe Export

**Owner:** Codex

**Dependency:** Frozen telemetry contract from Milestone 1

**Files:**
- Create: `overlay/src-tauri/src/collector.rs`
- Create: `overlay/src-tauri/src/sanitize.rs`
- Create: `overlay/src-tauri/src/upload_queue.rs`
- Create: `overlay/src/collector/CollectorStatus.tsx`
- Modify: `overlay/src-tauri/src/lib.rs`
- Modify: `overlay/src/App.tsx`
- Modify: `overlay/src-tauri/Cargo.toml`
- Test: Rust unit tests colocated with collector modules

### Task 3A.1: Add Red Sanitization Tests

- [ ] Create fixtures containing Riot IDs, PUUIDs, names, chat-like strings, unrelated queue IDs, and valid Mayhem match detail.
- [ ] Prove sanitizer output contains only `SafeMatchExport` fields.
- [ ] Prove participant slots are random per match and cannot track a player across matches.
- [ ] Prove non-2400 queues are rejected.
- [ ] Prove the 100-match daily limit and active-game pause behavior.

### Task 3A.2: Implement Collector

- [ ] Add first-run blocking consent stored locally.
- [ ] Poll LCU gameflow and never snowball while a game is active.
- [ ] Start from contributor-owned recent Mayhem matches, then snowball locally through match participants until the daily 100-export limit.
- [ ] Sanitize before writing to the upload queue.
- [ ] Keep full LCU responses in memory only; never persist or upload them.
- [ ] Capture contributor round offers from OCR. Mark a selected round only when the selected final augment can be matched unambiguously; otherwise omit `selectedAugmentSlug`.
- [ ] Add pause/resume/progress controls to the free collector UI.
- [ ] Queue compressed batches locally and retry with exponential backoff.

### Task 3A.3: Cross-Platform Verification

- [ ] Verify lockfile discovery, idle detection, collection, sanitization, queueing, and retry behavior on Windows and macOS.
- [ ] Run:

```bash
(cd overlay/src-tauri && cargo test)
(cd overlay/src-tauri && cargo check)
(cd overlay && npm run build)
```

- [ ] Commit:

```bash
git add overlay/src-tauri overlay/src/collector overlay/src/App.tsx overlay/package.json overlay/package-lock.json
git commit -m "feat(collector): add de-identified Mayhem match exporter"
```

**Handoff to Claude Code:** Compressed batch fixture, upload headers, schema version, retry semantics, and sanitizer test evidence.

## Milestone 3B: Telemetry Backend, Referral, and AdSense

**Owner:** Claude Code

**Dependency:** Milestone 3A batch fixture and Milestone 2 membership schema

**Files:**
- Create: `src/app/api/device/code/route.ts`
- Create: `src/app/api/device/link/route.ts`
- Create: `src/app/api/telemetry/upload/route.ts`
- Create: `src/lib/telemetry/validate.ts`
- Create: `src/lib/telemetry/r2.ts`
- Create: `scripts/telemetry/load_bigquery.ts`
- Create: `.github/workflows/ingest-telemetry.yml`
- Create: `src/components/ads/AdSlot.tsx`
- Create: `src/components/ads/ConsentManager.tsx`
- Modify: public reference pages and locale layout
- Create: `supabase/migrations/20260614_telemetry_platform.sql`

### Task 3B.1: Build Device Linking and Upload Ingestion

- [x] Device-code flow:
  - collector requests a short-lived code
  - signed-in website user approves the code
  - server stores a revocable device token hash
- [x] Upload endpoint requirements:
  - authenticated device token
  - compressed batch maximum 5 MB
  - schema version `1`
  - queue `2400`
  - server re-validates the allowlist
  - duplicate `gameHash` values are accepted idempotently but not stored twice
- [x] Write accepted compressed batches to R2 using a date/device partition.
- [x] Store only batch metadata and ingestion status in Supabase.
- [x] Configure R2 lifecycle deletion after 30 days.

### Task 3B.2: Load Long-Term Events into BigQuery

- [x] Nightly GitHub workflow reads unprocessed R2 batches and writes:
  - `matches`
  - `participants`
  - `contributor_round_choices`
  - `quality_quarantine`
- [x] Quarantine matches shorter than eight minutes, invalid patch/schema records, and ambiguous OCR round data.
- [x] Grant three trial-game credits exactly once per Google-account-plus-device combination when a valid referral code is redeemed.
- [x] Reserve one credit when a trial user starts a game, consume it only after the game exceeds eight minutes, and release the reservation when the game ends before eight minutes.
- [x] Finalize the reserved credit from an accepted contributor-owned telemetry match with the same `gameHash`; expire abandoned reservations after 24 hours without granting an active lease.
- [x] While a trial-game lease is active, allow member decision APIs and overlay recommendations for that game only.

### Task 3B.3: Launch AdSense on Public Reference Pages

- [ ] Add Google AdSense and consent management to public reference pages only.
- [ ] Never render ads on Advisor, account, admin, authentication, or member decision sections.
- [ ] Reserve mobile-safe ad-slot height to prevent layout shift.
- [ ] Add privacy/data-use copy describing AdSense, collector consent, R2 30-day retention, and BigQuery long-term de-identified data.
- [ ] Verify no ad script loads before required consent in applicable regions.

### Task 3B.4: Verify and Commit

```bash
npx vitest run src/lib/__tests__/entitlements.test.ts src/lib/__tests__/decision-api.test.ts
npm test
npm run lint
npm run build
git diff --check
```

```bash
git add src/app/api/device src/app/api/telemetry src/lib/telemetry scripts/telemetry .github/workflows/ingest-telemetry.yml src/components/ads src/app/'[locale]' supabase package.json package-lock.json
git commit -m "feat(platform): add telemetry ingestion referral and ads"
```

**Handoff to Codex:** Device/bootstrap API contract, telemetry acceptance evidence, BigQuery schemas, and trial-entitlement behavior.

## Milestone 4: Offline Calibration and Signed Model Releases

**Owner:** Codex

**Dependency:** BigQuery schemas and model-release table

**Files:**
- Create: `scripts/model/export_training_data.py`
- Create: `scripts/model/calibrate.py`
- Create: `scripts/model/evaluate.py`
- Create: `scripts/model/package_model.py`
- Create: `scripts/model/approve_release.py`
- Create: `scripts/model/tests/**`
- Create: `.github/workflows/build-model-candidate.yml`

- [ ] Export only approved BigQuery fields.
- [ ] Use contributor round choices to calibrate round effects.
- [ ] Use snowball final-state data only for final augment/item/champion associations and outcomes.
- [ ] Exclude quarantined and sub-eight-minute matches.
- [ ] Produce a candidate report containing:
  - sample counts by patch/champion/augment/round
  - calibration changes from the active model
  - competitive and exploration ranking stability
  - trap-warning regressions
  - parity fixture results
- [ ] Require manual approval before release.
- [ ] Sign model packages with Ed25519. Store the private key only in deployment secrets; embed the public key in the overlay.
- [ ] Publish immutable model packages to R2 and update `model_releases` only after approval.
- [ ] Keep the previous model immediately available for rollback.
- [ ] Commit:

```bash
git add scripts/model .github/workflows/build-model-candidate.yml
git commit -m "feat(model): add governed calibration and signed releases"
```

## Milestone 5: Member Overlay

**Owner:** Codex

**Dependencies:** Membership bootstrap API, signed model package, collector

**Files:**
- Create: `overlay/src/auth/**`
- Create: `overlay/src/model/**`
- Create: `overlay/src/components/CoachPanel.tsx`
- Modify: `overlay/src/App.tsx`
- Modify: `overlay/src/App.css`
- Modify: `overlay/src-tauri/src/lib.rs`
- Modify: `overlay/src-tauri/Cargo.toml`
- Test: `src/lib/__tests__/overlay-decision-parity.test.ts`
- Test: Rust model-signature and entitlement tests

- [ ] On app start, verify entitlement online before enabling overlay recommendations.
- [ ] On every game start, verify entitlement again.
- [ ] If verification fails, keep the free collector running and hide all member recommendation UI.
- [ ] Download the active model package, verify its Ed25519 signature, and run local inference.
- [ ] Keep the existing click-through card overlay and show:
  - localized grade
  - hard warning
  - conditional probability
  - active mode
- [ ] Add a keyboard-toggle coach panel showing reasons, skill/item/round interactions, confidence, and competitive/exploration switch.
- [ ] Do not automate input or display augment win rate.
- [ ] Populate `pickedAugments` from confirmed contributor round selections instead of only resetting it.
- [ ] Prove overlay results match Web engine fixtures exactly.
- [ ] Verify Windows and macOS packaging, permissions, OCR, entitlement checks, and model signature failure behavior.
- [ ] Commit:

```bash
git add overlay src/lib/__tests__/overlay-decision-parity.test.ts
git commit -m "feat(overlay): add member coach and signed local inference"
```

## Milestone 6: Codex-Led Integration and Release Gate

**Owner:** Codex lead, Claude Code reviewer

**Branch:** `codex/platform-integration`

- [ ] Merge in this order:
  1. decision engine foundation
  2. membership/web platform
  3. collector
  4. telemetry backend/ads
  5. model/overlay
- [ ] Codex resolves contract/parity/overlay conflicts. Claude Code resolves Supabase/API/UI/i18n conflicts.
- [ ] Confirm `public/data/patch-notes.json` remains the user's unrelated change.
- [ ] Run full verification:

```bash
npm test
npm run lint
npm run build
(cd overlay && npm run build)
(cd overlay/src-tauri && cargo test)
(cd overlay/src-tauri && cargo check)
python3 scripts/test_classify_augments.py
bash scripts/test-state.sh
git diff --check
```

- [ ] Perform security/privacy review:
  - non-members cannot retrieve decision outputs
  - collector cannot upload forbidden identity fields
  - invite codes and device tokens are hashed
  - admin and service-role operations are server-only
  - model package rejects invalid signatures
- [ ] Perform product review:
  - competitive is the default mode
  - exploration mode changes value weighting without disabling traps
  - public pages show champion stats but not augment/Mayhem-item win rates
  - AdSense appears only on approved public pages
  - mobile layouts work at 375px
- [ ] Prepare Riot registration/review material describing:
  - decision guidance and exploration goals
  - hard-trap avoidance
  - no automated input
  - no hidden-information exposure
  - no public augment win rates
  - collector data minimization and retention
- [ ] Keep public member-overlay release gated until the Riot review package has been submitted and its result recorded.

## Release Acceptance Criteria

- Web and overlay produce identical pools, grades, probabilities, warnings, and reasons for shared fixtures.
- `divergedChampions` remains `0`.
- A non-member cannot retrieve arbitrary recommendations or complete decision data.
- A member can use Advisor and champion matrices on mobile and desktop.
- Collector exports are provably de-identified before upload and stop at 100 matches per device per day.
- R2 safe exports expire after 30 days; BigQuery contains only approved long-term fields.
- Referral grants exactly three trial-game credits; each credit is consumed only by a game longer than eight minutes.
- Candidate model changes require manual approval and can be rolled back.
- Overlay recommendations require online entitlement verification at app start and game start.
- Windows and macOS collector/overlay builds pass.
- Full repository verification passes without overwriting unrelated worktree changes.
