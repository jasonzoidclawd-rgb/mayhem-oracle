# Claude × Codex Split Strategy: Maximum Throughput, Maximum Polish

Companion to `2026-06-13-claude-codex-split-implementation.md` (the contract).
That document says **what** each agent builds. This one says **how we run the
split so neither agent ever waits on the other without producing value, and
where each agent spends its surplus capacity making the product feel
expensive**. Authored by Claude Code; Codex may annotate but milestone
ownership stays as locked in the implementation plan.

## 1. Why this split is the fast one

The ownership boundary was drawn along three fault lines, and that is the
entire efficiency argument:

1. **The parity boundary.** Everything that must be bit-identical twins
   (decision engine, scoring, overlay inference) lives on one side — Codex's.
   Parity bugs are the most expensive class of bug in this repo (budget 0,
   test-enforced), and now they can never be caused by a cross-agent edit.
2. **The toolchain boundary.** Codex holds Rust/Tauri/Vite/model-pipeline;
   Claude holds SQL/Next.js/Vercel/i18n. No shared lockfiles (root
   `package.json` is Claude's, overlay manifests and Cargo are Codex's), so the
   classic merge-conflict generators are structurally impossible.
3. **The secrets boundary.** Supabase service keys, R2 credentials, BigQuery
   service accounts, AdSense — all Claude-side. The engine stays a pure
   function with zero environment, which is also what makes it testable and
   overlay-portable for free.

Rule of thumb when new work appears mid-flight: *if it needs determinism, it's
Codex's; if it needs credentials or a viewport, it's Claude's.*

## 2. Critical path and how Claude stays off it

The dependency chain is `M0 → M1 → M3A → M4 → M5 → M6` — all Codex. Claude's
milestones (M2, M3B) hang off it. Two scheduling rules keep total wall-clock
equal to Codex's chain plus integration, instead of the naive sum:

**Rule A — Claude always has a contract-independent backlog.** Work that
depends on zero frozen contracts and can run while Codex is heads-down:

- Supabase project provisioning, auth wiring, migration drafts, RLS red tests
- Account / admin page shells, locale keys across all five `messages/*.json`
- AdSense consent manager + ad-slot components (public pages only)
- Grade visual-language design tokens (see §5) — delivered TO Codex for the
  overlay so web and overlay read identically
- Hosting decision spike for the AdSense/Vercel-Hobby conflict (see §6.5)

**Rule B — schemas freeze early, implementations land late.** The one place
Claude sits on the critical path is M3B → M4 (Codex's calibration pipeline
needs BigQuery table schemas). Fix: the BigQuery DDL for `matches`,
`participants`, `contributor_round_choices`, `quality_quarantine` is written
and frozen **as part of the Milestone 1 contract freeze** (it derives entirely
from `SafeMatchExport`, which is frozen then anyway). M4 design can then start
the moment M3A ends, regardless of where M3B stands.

### Wave plan (parallel lanes, not calendar promises)

| Wave | Codex lane (critical path) | Claude lane (parallel) |
| --- | --- | --- |
| 0 | M0 baseline + branch creation | Contract-independent backlog (Rule A) |
| 1 | M1 contracts + unified engine + data split | M2 schema/RLS/auth done red-first; UI shells |
| 2 | M3A collector + sanitizer | M2 completion against M1 handoff: protected APIs, Advisor, matrix |
| 3 | M4 calibration (against frozen BQ DDL) | M3B: device link, ingestion, referral, AdSense |
| 4 | M5 overlay (against M2 bootstrap API) | Polish pass (§5) + M5 API consumer review |
| 5 | M6 integration lead | M6 reviewer: Supabase/API/i18n conflicts, security+privacy checklist |

Estimated effort: Codex ~11–14 sessions, Claude ~8–10 sessions, ~70% of it
overlapped.

## 3. Handoff mechanics: artifacts, never conversation

Every handoff is a commit hash plus **fixtures**, recorded in
`docs/handoffs/<milestone>-<owner>.md` (template below). The receiving agent
pins the fixtures in its own test suite, so contract drift is caught by CI,
not by memory.

- M1 → M2: sample `DecisionContext`/`DecisionResult` JSON pairs (one per mode,
  one all-weak screen, one hard-trap case) + parity proof output.
- M2 → M5: HTTP transcripts for `/api/overlay/bootstrap` and
  `/api/overlay/game-session` (200 / 401 / 403 / trial-lease cases) + a
  fixture `ModelManifest` so M5 never blocks on M4.
- M3A → M3B: one real compressed batch file + upload headers + the sanitizer
  test evidence.
- M3B → M4: BigQuery DDL (already frozen at M1 per Rule B) + a loaded sample
  dataset export.

Handoff note template (hard cap one screen):

```markdown
# Handoff: M<N> <name> — <owner>
- Commit: <sha> on <branch>
- Fixtures: <paths>
- Verification: <commands + pass counts>
- Contract deltas since freeze: NONE | <list + both-agent sign-off>
- Open questions (max 3): ...
```

Standing conventions both agents already follow, now made explicit:

- Red test first per task; commit per logical unit with `[M<N>]` markers.
- Session ends with a one-line state update appended to the active handoff doc
  — the other agent reads that line, never the transcript.
- **Rehearsal merges**: after each wave, Codex spins a throwaway local merge of
  all completed branches and runs the full suite. M6 should be boring; any
  surprise there is a process failure logged in the handoff doc.
- Never edit the other agent's exclusive paths. If a change is needed there,
  write a failing test or a fixture demonstrating the need and hand it over.
- `public/data/patch-notes.json` stays untouched; nobody hand-edits generated
  data.

## 4. Where Codex's surplus goes: engine fanciness

Claude proposes, Codex disposes — these are the highest-leverage places for
depth on the engine side:

- **Reason codes that read like a coach**, not a debugger: every warning and
  reason in `DecisionResult` is a stable code the web/overlay render through
  i18n, with the signal magnitude attached (so UI can say "huge synergy" vs
  "slight synergy" without re-deriving).
- **Golden Reroll as a strategic stance** with its own explanation path —
  this is a feature no competitor surface has.
- **Round-value curves per augment archetype** (scaling / immediate / quest)
  exposed in the breakdown so the matrix UI can plot "value over rounds" per
  augment — the single fanciest member visual we can ship, and it costs the
  engine nothing extra.
- **Signed model packages with visible lineage**: `modelVersion` +
  `dataVersion` surfaced end-to-end, so the UI can render an "Oracle
  v26.12-r3" chip and a changelog diff between releases.
- Parity suite extended to grades, probabilities, warnings, reasons — the
  release-gate acceptance already requires it; doing it early makes every
  later wave cheaper.

## 5. Where Claude's surplus goes: product fanciness

The member product must *feel* like what it costs. Concrete polish ledger, in
priority order, all inside Claude-owned paths:

1. **Grade visual language**: one design-token set (color, icon, motion) for
   `hot/strong/steady/average/weak`, shipped as shared tokens; animated grade
   reveal on evaluate; identical semantics in the overlay (tokens handed to
   Codex in Wave 0).
2. **Advisor as a thumb app**: single-screen mobile flow, ≤3 taps from
   champion to verdict, sticky bottom action bar, optimistic re-evaluate on
   mode/round toggles, skeleton states — never a spinner-wall. Verified at
   375px first, desktop second.
3. **Champion matrix as an interactive heatmap**: 4 rounds × 3 rarities,
   tap-to-drill into the eligible pool with exclusion reasons — the
   "wow" screenshot for the landing page.
4. **Decision history with self-proof**: timeline of recommended vs picked vs
   outcome, confidence trend, and a "when you followed the oracle" delta —
   the retention feature that justifies renewal.
5. **Demo mode that sells**: curated static showcase on public pages (plan
   already sanctions curated examples) — full member UI rendered from frozen
   fixtures, watermarked "demo", zero live engine access.
6. **Perf and lighthouse budgets**: decision route does no DB work on the hot
   path beyond a cached entitlement check; public pages stay static/ISR;
   targets — API p95 < 300 ms, Lighthouse mobile ≥ 95 public / ≥ 90 member,
   CLS-safe reserved ad slots.
7. **SEO/share layer**: per-champion OG images, structured data, localized
   metadata across all five locales (key-parity test already enforces
   coverage).
8. **Account/admin that look staffed**: referral progress ring, device
   management with revoke, invite generator with QR + expiry, model-release
   status panel reading `model_releases`.

## 6. Default decisions (ratify by leaving them in this doc)

Proposed by Claude to keep kickoff unblocked; either agent may veto in the
M0/M1 handoff note, after which they are binding:

1. **Baseline**: merge `feat/26.12-scoring-rebuild` → `main`; M0 baselines
   `main`. Building a six-milestone platform off an unmerged feature branch
   is rebase debt with no upside.
2. **Shrinkage clamp applies to the prior, not the observed value** —
   clamping observed WR to 42–62 erases genuinely strong augments (a real 65%
   reads as 62). Same determinism, more signal.
3. **Free builds exclude `data/internal/`**: the overlay's build-time
   `sync-data` must source member pool data only via the signed model package
   path; M1's public-boundary guardrail test also asserts the free bundle.
4. **Scraper resilience folds into Task 1.3** (Codex, generated-data owner):
   ingest arammayhem's `search-index.json` for champion/combo data, keep
   aramgg.com as a cross-check for internal augment WR. Until telemetry has
   volume, internal WR is still single-sourced HTML — cheap insurance.
5. **AdSense hosting decision lands before Task 3B.3**: Vercel Hobby is
   licensed non-commercial; ads violate it. Decide by end of M2: move web
   hosting to a commercial-permitted free tier (e.g. Cloudflare Pages +
   Workers) or accept a paid Vercel plan. Claude runs this spike in Wave 0
   and records the recommendation in the M2 handoff.

## 7. Definition of "done well" (above the plan's acceptance bar)

- A cold reviewer can reconstruct every cross-agent decision from
  `docs/handoffs/` alone.
- M6 integration produces zero engine-side and zero web-side surprise
  failures (rehearsal merges did their job).
- The public site is demonstrably ToS-clean: no augment/Mayhem-item win rate
  anywhere in HTML, JSON, or bundles (guardrail test green), ads only on
  reference pages, consent-gated.
- A first-time mobile visitor can: read the database free → watch the demo →
  redeem an invite → run a real Advisor evaluation in under two minutes.
- The Riot review package writes itself from artifacts we already have:
  exploration/trap-avoidance framing, no automation, no hidden info, data
  minimization with 30-day raw retention — all evidenced by tests, not prose.
