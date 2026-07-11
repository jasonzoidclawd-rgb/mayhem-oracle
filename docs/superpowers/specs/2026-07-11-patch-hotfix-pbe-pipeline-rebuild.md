# Patch/Hotfix Pipeline Rebuild — CDragon Structured Diffs + PBE Preview

> **Spec for Codex `/goal` execution, with a Claude verification gate after every step.**
> Status: **APPROVED** (brainstormed 2026-07-11).
> Branch: `feat/patch-hotfix-pbe-pipeline`. Owner: **Codex implements; Claude gates each step.**
> Run: open this repo in Codex, `/goal` against §7 below, execute steps **in order**, stop at
> each Claude gate.

---

## 1. Goal (one sentence)

Replace prose-scraping as the structural source of truth for "what changed" with a
CommunityDragon structured-data diff engine spanning **augments, champions, and items**,
run against both the **`latest`** (live) and **`pbe`** (pre-release) branches, so the
`/patch-notes` page updates truthfully whenever the live game data changes and gains a
**preview lane no competitor currently ships** — what's landing before it goes live.

---

## 2. Findings (shared research — the *why*)

### 2.1 The current pipeline's fragility is structural, not incidental
`scripts/scrape_patch_notes.py` (1,183 lines) regex-parses the official
`leagueoflegends.com` patch-notes HTML article per locale to derive structured change
records — entity links, "kind" (added/removed/nerf/buff), section mapping. Git history on
this file is a sequence of fixes to that structure breaking: entity-link resolution
(`#14`, `#15`), deterministic added/removed/fixed classification, locale-name stability.
Each fix patches a symptom of parsing prose English as if it were data. This is the "roundtrips
of trying to fix a broken design" — parsing prose can't be made robust, only patched repeatedly.

### 2.2 A better pattern already exists in this codebase — generalize it, don't invent it
`scripts/scrape_mayhem_augments_cdragon.py` was built for exactly this reason, stated in its
own docstring: *"Riot does NOT publish ARAM: Mayhem server-side hotfixes... on the English
patch-notes page... the scraper that reads `...-patch-X-Y-notes` pages is structurally blind
to them. The authoritative first-hand source is the live game data, mirrored by
CommunityDragon."* It snapshots CDragon's `cherry-augments.json` + stringtable, commits the
snapshot, and diffs it against the previously committed snapshot to emit hotfix events —
independent of Riot's prose entirely. **This is the pattern to extend to champions and items,
not a new design to invent.**

### 2.3 PBE is live right now and costs nothing extra to fetch
Verified 2026-07-11: `raw.communitydragon.org/pbe/...` currently serves patch **16.14**
while `/latest/...` serves **16.13** — PBE is one full patch cycle ahead of live, right now.
All three entity endpoints used by this spec return `200` on the `pbe` branch with the same
shapes as `latest` (`cherry-augments.json`, `champion-summary.json`, `items.json`). Fetching
preview data is the same code with a different base URL — no new integration to build.

### 2.4 Champion ability data diffs at *better* precision than prose ever gave us
CDragon's per-champion detail JSON (`.../champions/<id>.json`) exposes numeric per-ability
fields: `cost`, `cooldown`, `range`, `costCoefficients`, `cooldownCoefficients`,
`coefficients`, `effectAmounts`. A diff on these fields can report "Q cooldown 8s → 7s" —
this is a precision upgrade over the scraped English sentence, not a fallback for when prose
parsing fails.

### 2.5 ARAMGG's own patch/hotfix method is not the thing to copy structurally
Independent competitor research (2026-07-10) found ARAMGG's `/new-augments` route updates
in place with **no patch-addressable archive**, and its sitemap `lastmod` timestamps lagged
its own visible data by 2–4 days. wasfun's existing `/patch-notes/[patch]` archive (patch-
addressable, five structured historical pages) is already a real structural advantage over
ARAMGG — this rebuild keeps and re-feeds it, it does not discard it.

### 2.6 The your.gg cue — adopt the presentation, correct the "hard to scrape" premise
your.gg's champion list reads as alive: day-to-day movement implying win-rate change without
necessarily exposing every raw number per request. That *presentation* principle is worth
adopting for both lanes of the rebuilt page (§6). The premise that your.gg's data layer is
"hard to scrape" needs a correction, though: prior research (2026-06-30 duel, this project)
reverse-engineered your.gg's real backend
(`api.your.gg/{region}/api/augment-guides/aram-mayhem?mode=Aram`) in a single session — a
plain, unauthenticated JSON API at an undocumented path, returning a full 256-augment dataset
with real `winRate`/`pickRate`/`games`. What made it non-trivial was **obscurity** (nobody
had guessed the endpoint), not real access control. Obscurity is not a design to rely on.
This project already has a stronger mechanism — the public/member/internal disclosure ladder
enforced by `public-data-boundary.test.ts` — and §6 uses that instead of hoping nobody finds
the JSON.

### 2.7 Champion win-rate day-by-day tier ranking is a different subsystem
The literal your.gg feature (champion tier movement implying win-rate change) is powered by
match telemetry (currently `arammayhem.com` scrape), not CDragon game-content diffs. It
belongs to the existing dashboard/tier-list pipeline, not this one. §4 scopes it out
explicitly so this spec doesn't quietly grow into a second project.

---

## 3. Authority model (decided)

- **Per-entity, per-branch CDragon snapshot is the source of truth for "what changed."**
  Three entity types (augment, champion, item) × two branches (`latest`, `pbe`) = six
  lineages, one shared diff engine.
- **Riot's official prose patch-notes article is demoted to metadata + narrative only:**
  patch title, release date, canonical URL, and an optional top-level blurb. It is never
  parsed for structural per-entity change data again.
- **PBE-branch data never reaches public catalogs consumed by scoring/Advisor.** Preview is
  display-only, in its own export, with the same "unknown telemetry, not a real 0%"
  treatment already established for newly-pooled live augments
  (`docs/patch-26-12-engine-impact.md`).
- **The historical archive (`/patch-notes/[patch]`) stays** — same URL contract — re-pointed
  at the new unified diff-event schema instead of scraped HTML sections.

---

## 4. Scope

**In scope:**
- Generalize the existing augment diff engine into a shared module parameterized by entity
  extractor (augment / champion / item) and branch (`latest` / `pbe`).
- Champion extractor: ability cost/cooldown/range/coefficients/effectAmounts + base stats.
- Item extractor: cost, stats, mythic passive, active effects.
- `pbe` branch fetch/diff/snapshot lineage for all three entity types.
- Reconciliation: PBE preview entries that land in `latest` are marked landed and dropped
  from "upcoming"; entries that persist across a configured number of cycles without landing
  age out.
- Rebuild `/patch-notes`: **Live** lane (existing URL contract, better data) + **Coming in
  PBE** lane (new).
- Extend `public-data-boundary.test.ts` to forbid PBE-sourced fields in scoring-facing
  catalogs.
- Day-by-day freshness/movement presentation on both lanes (§6).

**Out of scope (explicit — revisit later, not silently dropped):**
- PBE/patch badges on individual champion/augment/item detail pages — deferred per product
  owner's call during brainstorming; natural fast-follow once this pipeline is proven.
- Any use of PBE data in live scoring or Advisor recommendations.
- Champion win-rate day-by-day tier-list ranking (§2.7) — a separate, already-existing
  subsystem. If the tier list should adopt the same freshness/movement treatment, that's a
  follow-up spec against its own (arammayhem-sourced) pipeline, not this one.

---

## 5. Target schema

Unified event record — used by both `latest`-lineage patch/hotfix events and `pbe`-lineage
preview events, across all three entity types:

```json
{
  "entity_type": "augment | champion | item",
  "slug": "string",
  "names": { "en": "...", "zh-tw": "...", "zh-cn": "...", "ja-jp": "...", "ko-kr": "..." },
  "branch": "latest | pbe",
  "change_kind": "added | removed | numeric | text | rarity",
  "fields_changed": ["cooldown", "tooltip"],
  "before": {},
  "after": {},
  "detected_at": "ISO-8601 timestamp",
  "source_patch_label": "26.13 | pbe-cycle-16.14.7942794",
  "landed": false
}
```

- **Snapshots** (committed): `data/internal/cdragon-<entity>-<branch>.json`, one per lineage
  (six files).
- **Event archives** (internal): `data/internal/patch-events.json` (`latest`-lineage, takes
  over the structural role of today's `patch-notes.json`) and `data/internal/pbe-preview.json`
  (`pbe`-lineage).
- **Public exports:** `public/data/patch-notes.json` (sanitized `latest`-lineage, same
  patch-addressable shape the frontend already consumes) and `public/data/pbe-preview.json`
  (new — bounded to the *current open* PBE cycle's active, unreconciled entries; no full
  historical dump — see §6).

---

## 6. Presentation & anti-scraping (the your.gg cue, §2.6)

- **Adopt the feel, not the exposure.** Both lanes should read as alive: "new since your last
  visit" / days-since-detected badges, and a visible landed-transition when a PBE entry ships
  to `latest` (`detected_at` + `landed` already carry what's needed — no extra fields).
- **Public boundary, not obscurity.** `public/data/pbe-preview.json` exports only the current
  open PBE cycle's unreconciled entries — not the six committed snapshot lineages, not
  historical cycles. Full history stays `data/internal/` only, same pattern as everything
  else on the disclosure ladder. This is the actual protection; an undiscoverable endpoint is
  not (§2.6).
- **Not this spec:** champion tier-list day-by-day win-rate movement (§2.7) — flagged as a
  candidate follow-up, not built here.

---

## 7. Execution plan — goal-driven steps

**Precondition — clean tree.** Codex runs in a dedicated worktree on `feat/patch-hotfix-pbe-
pipeline`, branched from `main`. This spec's own worktree was branched clean at `302d176`;
confirm the same before Step 0.

Codex executes **in order**. Each step: **commit → stop at the Claude gate** (post
verification evidence to `docs/handoffs/patch-hotfix-pbe-progress.md`) → proceed only on
Claude approval.

**Step 0 — Baseline.** Confirm branch, run the full gate (`npm test`, `eslint`, `build`),
record current augment-hotfix-detector output on today's committed CDragon snapshot as the
regression fixture for Step 1.
*Success:* baseline suite green, fixture captured. *Claude gate:* confirm baseline.

**Step 1 — Extract the shared diff engine.** Refactor `scrape_mayhem_augments_cdragon.py`'s
snapshot/diff/event logic into a reusable module taking an entity extractor + branch as
parameters. Augments must keep working unchanged.
*Success:* augment hotfix output is byte-for-byte equivalent to the Step 0 fixture, on the
same input, post-refactor. *Claude gate:* diff the before/after output directly — zero
tolerance for silent behavior change in the one working path.

**Step 2 — Champion + item extractors, `latest` branch.** Add extractors for champion
ability fields (§2.4) and item fields (cost/stats/mythic passive), wired into the shared
engine against `latest`. Resolve the `effectAmounts`/`coefficients` positional-array-to-
named-effect mapping (these arrays are index-based, not named — must map via `mDataValues`/
tooltip templates already used elsewhere in scoring, or every champion diff will be noisy).
*Success:* run against a fixture pair (current live snapshot vs. a snapshot from the last
known champion balance change) and confirm the diff reproduces that change as a readable
structured record. *Claude gate:* review sample output for at least 3 real recent changes
(1 champion ability, 1 item, 1 augment) — must be legible, not just "field X changed."

**Step 3 — `pbe` branch lineage.** Add `pbe`-branch fetch/snapshot/diff for all three entity
types, using the same extractors, into a separate lineage and event archive
(`pbe-preview.json`). Detect branch discontinuity (PBE version regresses vs. last snapshot)
and start a fresh lineage instead of emitting spurious removals.
*Success:* simulated CDragon fetch failure fails soft (keeps last committed snapshot, skips
the run, doesn't touch the live event archive); simulated PBE reset does not emit bogus
removal events. *Claude gate.*

**Step 4 — Reconciliation.** Match landed `latest` events against open `pbe-preview` entries
(mark `landed: true`, drop from "upcoming"); age out entries that persist past a configured
number of PBE cycles without landing.
*Success:* fixture test — entry created in PBE cycle N, appears in `latest` at cycle N+2 →
marked landed; entry absent after the configured max cycles → aged out. *Claude gate.*

**Step 5 — Rebuild `/patch-notes`.** Rebuild `PatchNotesView`/`PatchCard`/`HotfixNotes`
against the new unified schema. Add the "Coming in PBE" lane per §6. Keep the
`/patch-notes/[patch]` URL contract unchanged. Trim `scrape_patch_notes.py` to
title/date/canonical-link extraction only — remove the now-dead structural parsing (section
mapping, kind classification, entity-link resolution).
*Success:* existing patch URLs still resolve; new preview lane renders with freshness/landed
indicators; `public-data-boundary.test.ts` extended and green (no PBE-sourced field reaches a
scoring-facing catalog); grep confirms no remaining consumer of the removed prose-parsing
fields. *Claude gate.*

**Step 6 — Cron cadence.** Add a more frequent PBE-branch check (proposal: every 6h,
matching the existing Patch Detect cadence already planned in the wasfun-vs-aramgg checklist)
alongside the existing daily `latest`-branch cadence, with no duplicate-run races against
`update-data.sh`.
*Success:* workflow change reviewed; a dry run shows both cadences completing without
collision. *Claude gate.*

**Step 7 — Final verification + handoff.** Full gate (`npm test`, `eslint`,
`npm run build`, overlay build). Refresh `CLAUDE.md` STATE via `scripts/update-state.sh`
(never hand-edited). Write the handoff note.
*Success:* whole gate green; STATE refreshed via script; handoff written. *Claude gate:*
Claude independently re-verifies and performs any push — `main` remains the human gate.

---

## 8. Definition of done

- [ ] Champions and items have the same structural hotfix-detection guarantee augments
      already had — verified against at least one real historical example per entity type.
- [ ] `/patch-notes` renders Live + Coming in PBE, both fed by structured diffs; zero
      remaining dependency on parsing Riot's prose article for structure.
- [ ] PBE-sourced data never reaches a scoring-facing public catalog — enforced by a test,
      not just by convention.
- [ ] Reconciliation correctly lands and ages out preview entries (fixture-tested).
- [ ] `/patch-notes/[patch]` historical URLs unchanged and still resolve.
- [ ] Full gate green: `npm test`, `npx eslint src scripts`, `npm run build`,
      `(cd overlay && npm run build)`.
- [ ] `CLAUDE.md` STATE refreshed via `scripts/update-state.sh`.

---

## 9. Collaboration protocol (Claude involved each step)

- Codex runs `/goal` against this spec on `feat/patch-hotfix-pbe-pipeline`, executing §7 **in
  order**.
- After **each** step Codex **commits** and **stops**, posting that step's verification
  evidence to `docs/handoffs/patch-hotfix-pbe-progress.md`.
- **Claude independently re-verifies** each step's success criterion (re-runs the commands,
  reviews the diff) and either approves or returns it with specific corrections. Codex
  proceeds **only on Claude approval**.
- **Claude sign-off is mandatory** for Step 2's sample-output review (data-truth judgment,
  not mechanics) and Step 5's boundary-test extension.
- **Codex never pushes to `main`.** Final push stays Claude's; merging to `main` stays the
  human gate.

---

## 10. Constraints & hazards

- **PBE is not a monotonic timeline.** Riot can reset/rebase the PBE branch from a fresh live
  base at the start of a new cycle. Step 3 must treat a version regression as a new lineage,
  not a rollback to diff against.
- **Positional effect arrays are the real risk in Step 2.** `effectAmounts`/`coefficients`
  are index-based; without correct index→named-effect mapping, champion diffs will be noisy
  false positives on nearly every patch. This is the step most likely to need a second pass —
  budget for it.
- **Public-data boundary is sacred**, same as the rest of this project: PBE preview and full
  snapshot history stay internal; only the current open cycle's bounded window is public
  (§6). Enforced by test, not documentation.
- **Don't let §6's bounded public window become the whole feature's value proposition** — the
  point is truthful freshness, not manufactured scarcity.
- **Don't silently expand into the two out-of-scope items in §4** (detail-page badges,
  tier-list movement) mid-implementation — if either turns out to be trivial once the engine
  exists, flag it as a follow-up spec rather than folding it in here.

---

## 11. Verification commands

```bash
npm test
npx eslint src scripts
npm run build
(cd overlay && npm run build)

# CDragon branch reachability (already confirmed 2026-07-11, re-check before Step 3)
curl -s -o /dev/null -w "%{http_code}\n" \
  https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json
curl -s https://raw.communitydragon.org/pbe/content-metadata.json
curl -s https://raw.communitydragon.org/latest/content-metadata.json

# public boundary — must stay green, extended in Step 5
npx vitest run src/lib/__tests__/public-data-boundary.test.ts
```

---

## 12. Sources (canonical references)

- `scripts/scrape_mayhem_augments_cdragon.py` — the existing diff-engine pattern being
  generalized (source of §2.2).
- `scripts/scrape_patch_notes.py` — the prose scraper being demoted (source of §2.1).
- `docs/patch-26-12-engine-impact.md` — prior precedent for PBE-preview handling and
  "unknown telemetry, not real 0%" treatment (§3).
- Independent competitor research, 2026-07-10 (ARAMGG patch/hotfix method findings, §2.5).
- your.gg backend research, 2026-06-30 (this project) — `api.your.gg/{region}/api/
  augment-guides/aram-mayhem?mode=Aram` reverse-engineered in one session (§2.6).
- CommunityDragon `latest`/`pbe` branch reachability check, 2026-07-11 (§2.3, §11).
- `docs/reviews/2026-07-02-architecture-review.md` (B2) — per-page canonical/metadata gap,
  relevant to the Step 5 page rebuild.
