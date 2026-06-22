# Augment Data Re-sourcing — Phase 1: CDragon-Canonical Truth

> **Spec for Codex `/goal` execution, with a Claude verification gate after every step.**
> Status: **APPROVED** (brainstormed & approved 2026-06-22). This is **Phase 1 of 4**.
> Branch: `feat/augment-truth-resourcing`. Owner: **Codex implements; Claude gates each step.**
> Run: open this repo in Codex, `/goal` against §6 + §7 below, execute steps **in order**, stop at each Claude gate.

---

## 1. Goal (one sentence)

Make the live game (CommunityDragon) the **canonical source of truth** for augment
identity, existence, rarity, icons, locale names, effect text, and exact numbers;
**demote arammayhem to an isolated `win_rate`-only feed**; keep the LoL Wiki as the
readable-effect/Notes source — so our augment data matches the live game **up to any
hotfix** and is no longer founded on a competitor's scrape.

---

## 2. Findings (shared research — the *why*)

### 2.1 Current pipeline makes arammayhem the source of truth
`scripts/update-data.sh` order: **step 2** `scrape_arammayhem.py` *creates* the augment
list and sets **name, rarity, icon (arammayhem-hosted URL), win_rate**. The wiki only runs
later as **enrichment** (step 6 → `wikiDescription`). CommunityDragon runs after that for
**hotfix detection** (steps 8b/8c, `scrape_mayhem_augments_cdragon.py` +
`apply_cdragon_mayhem_augments.py`) and currently only *patches fields on slugs that already
exist*. So the thing we want demoted is the foundation; the two better sources are already
wired in but subordinate.

### 2.2 Win-rate reality (decision: keep arammayhem as an isolated win_rate feed)
- **No official win-rate source exists.** Riot blocks the Mayhem queue (`queueId 2400`) from
  `match-v5` / `spectator-v5` *by policy* (DevRel: "working as intended"; the stated reason is
  to stop win-rate aggregators). The official Tencent/QQ 26.12 patch page (§2.6) also has **no**
  win rates. Confirmed three ways.
- **arammayhem almost certainly crowdsources from users' local clients (LCU)** — the only
  surface exposing Mayhem match data. Their win rate is an opaque crowdsourced sample; our scrape
  of it covers **185 / 256** augments, centered ~51% (39.8–67.1), refreshed daily.
- **"Our own" win rate = telemetry** (the membership pivot's M3A LCU collector → M3B backend →
  BigQuery), already built but dormant (needs members + the live-game gate). **Separate
  initiative, out of scope here.**
- Therefore win_rate is **orthogonal** to augment *definitions*. This project leaves it flowing
  from arammayhem but **isolated behind a clean boundary** so the telemetry feed can replace it
  with a one-line swap later.

### 2.3 Divergence is real and large (quantified 2026-06-22)
Matching our `data/internal/augments.json` (256) against CDragon's Mayhem roster (170):
- **Slug join is broken** — only **125/256** match by slug, because CDragon slugifies
  differently (`adapt` ↔ `a-d-a-pt`, `back-to-basics` ↔ `backto-basics`).
- **By normalized name: 163 match.**
- **93 augments are in our data but NOT in the live game**: 25 legitimately removed (tombstones),
  but **36 `lifecycle=added` + 32 `lifecycle=active`** that CDragon doesn't have — naming variants
  plus the arammayhem inflation/staleness we no longer trust.
- **7 are in CDragon but missing from us** — ≥3 are `Quest:`-prefix naming mismatches
  (we store `Quest: Steel Your Heart`, CDragon `Steel Your Heart`).

### 2.4 CDragon endpoints (the structured official sources)
- **Roster + identity + rarity + icon:**
  `plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`
  → per augment: `id`, `augmentNameId` (e.g. `ARAM_ADAPt`), `nameTRA`, `augmentSmallIconPath`,
  `rarity` (`kSilver`/`kGold`/`kPrismatic`). 637 total Arena augments; **~170 are `ARAM_`-prefixed = Mayhem**.
- **Effect text + EXACT NUMBERS + icons:** `cdragon/arena/en_us.json`
  → per augment: `apiName`, `desc`, `tooltip`, **`dataValues`** + **`calculations`** (real numeric
  arrays per level, e.g. `QuestThreshold:[10,…]`, `ArmorMRPerHat:[8,…]`), `iconLarge`, `iconSmall`,
  `rarity`. 228 entries (Arena `cherry_` + Mayhem `kiwi_`). **This is where the official exact
  numbers live, structured and always-current — Phase 3's hard part becomes a freebie.**
- **Tooltips by locale:** `game/<locale>/data/menu/<locale>/lol.stringtable.json`, keys
  `kiwi_*` (Mayhem-specific, preferred) / `cherry_*` (Arena shared). Already indexed by
  `scrape_mayhem_augments_cdragon.py`.
- **Locale names:** the `arena/<locale>.json` and `cherry-augments` per-locale files cover our
  five locales — `en` (default), `zh_cn`, `zh_tw`, `ja`, `ko` (all HTTP 200 verified).

### 2.5 Identity is the core challenge
Four id schemes must be reconciled: CDragon **`augmentNameId`** (`ARAM_ADAPt`, the canonical key)
· CDragon arena **`apiName`** · our **`slug`** (`adapt`) · wiki **display name** · arammayhem
entries. Plus systematic `Quest:`-prefix and capitalization mismatches. **Identity resolution +
cross-source join is the heart of Phase 1.**

### 2.6 Official Tencent/QQ 26.12 page = validation reference
`https://lol.qq.com/gicp/news/410/37088140.html#n3` — official Riot/Tencent **26.12 patch notes**
(our exact patch). Section #n3 = 魔改大乱斗强化符文 (Mayhem augments): official effects, the **exact
before→after numbers**, and an **offensive/defensive/utility category** grouping. **No win rates.**
That category taxonomy is **not** in CDragon's structured data (looks editorial). Role: **official
gold-standard for the Phase 2 audit**, and the **source for an optional official `category` field
in Phase 3**. Not a pipeline source (point-in-time prose, won't auto-update next patch).

---

## 3. Authority model (decided)

| Field | Canonical source |
|---|---|
| `augmentId` (identity) | **CDragon** `augmentNameId` |
| existence (active set) | **CDragon** roster |
| `rarity` | **CDragon** |
| `icon` | **CDragon** (`iconLarge`/`iconSmall` asset URL) |
| locale names (`name_*`) | **CDragon** per-locale |
| exact numbers (`dataValues`/`calculations`) | **CDragon** |
| canonical effect tooltip | **CDragon** |
| readable display effect text (`wikiDescription`) | **Wiki** |
| `win_rate` | **arammayhem** — isolated feed; telemetry later |
| official validation / `category` | **Tencent 26.12** (reference; category optional P3) |

**Precedence on conflict:** CDragon wins existence/rarity. Wiki-only augments are **flagged for
review, never auto-added or dropped**. arammayhem provenance is permitted for **`win_rate` only** —
nothing else.

---

## 4. Scope

**In scope (Phase 1):** re-source identity/existence/rarity/icons/locale-names/effect-text/numbers
to CDragon (+ wiki for display text); isolate arammayhem → `win_rate` feed; produce a reconciliation
report; add guard tests; integrate into the pipeline; preserve no-key reproducibility and the
public-data boundary.

**Out of scope (future phases, each its own spec→plan):**
- **P2 Reconcile & guard** — audit the flagged divergences against Tencent 26.12 + wiki, correct
  them, lock alignment so it can't drift.
- **P3 Richness** — surface gameplay Notes/interactions, "currently disabled" status, and the
  exact numeric values (already captured in P1) into schema/UI; optional official `category` field.
- **P4 Presentation** — render augment pages in the wiki's clean format.
- **Win-rate independence** (telemetry M3A/M3B activation) — separate initiative, gated on members.

---

## 5. Target schema (`data/internal/augments.json`)

- **Add** `augmentId` — CDragon `augmentNameId` (canonical join key). Keep `slug` (URLs / back-compat).
- `rarity` ← CDragon. `icon` ← CDragon canonical asset URL (replaces arammayhem URL).
  `name_zh_CN/zh_TW/ja/ko` ← CDragon per-locale. `wikiDescription` ← wiki, keyed by `augmentId`.
- `win_rate` ← arammayhem feed (**may be null**; null is valid and handled by scoring).
- **Capture now, surface in P3:** raw `dataValues`/`calculations` (internal only).
- `flags.lifecycle` existence reflects CDragon roster (`active` iff in CDragon; else
  `removed`/history). Existing removed-augment tombstones preserved.
- Optional `provenance` map (per-field source) to make the guard test (§6 Step 6) trivial and seed P2.
- **Public export unchanged:** `public/data/augments.json` still carries **no `win_rate`**, no
  internal telemetry — `export_public_catalog.py` sanitization and `public-data-boundary.test.ts`
  stay green.

---

## 6. Execution plan — goal-driven steps

Codex executes **in order**. Each step: **commit → stop at the Claude gate** (post verification
evidence to `docs/handoffs/augment-truth-progress.md`) → proceed only on Claude approval.

**Step 0 — Baseline.** Confirm branch `feat/augment-truth-resourcing`; run the full gate; record
baseline augment count (256), win_rate coverage (185), and the test count `npm test` actually
reports (the `CLAUDE.md` STATE figure is auto-maintained and may lag — trust the live run).
*Success:* baseline suite green, numbers recorded. *Claude gate:* confirm baseline.

**Step 1 — Canonical identity + resolver.** Build an augment identity resolver: CDragon
`augmentNameId` as the key; a normalized-name matcher (lowercase, strip non-alphanumerics, strip
`Quest:` prefix); a small **hand-maintained alias table** for exceptions; emit an **unmatched
report**. Add `augmentId` plumbing to the schema.
*Success:* resolver maps the full CDragon roster ↔ wiki ↔ arammayhem; unmatched list produced;
unit tests for the resolver. *Claude gate:* **Claude reviews the unmatched list and signs off on
every alias-table entry** (data-truth decision).

**Step 2 — CDragon authoritative base (rich endpoint).** Extend/replace the CDragon scrape to pull
from `cdragon/arena/en_us.json` (+ per-locale) **and** `cherry-augments.json`: `augmentId`, name,
locale names, rarity, `iconLarge`/`iconSmall`, `desc`/`tooltip`, `dataValues`/`calculations`.
Join CDragon's **two internal id schemes** — arena `apiName` ↔ `cherry-augments` `augmentNameId`
(the existing `kiwi_*`/`cherry_*` stringtable index already bridges them). Produce the **base
catalog** = the live Mayhem roster (~170).
*Success:* base catalog has ~170 augments, each with rarity + icon + effect + structured numbers,
100% CDragon-sourced. *Claude gate.*

**Step 3 — Demote arammayhem to win_rate feed.** Refactor `scrape_arammayhem.py` so it **no longer
writes the augment list**; it emits `{augmentId → win_rate}` (resolved via Step 1), as an **isolated
module** shaped so a telemetry feed can replace it later.
*Success:* arammayhem code path can no longer create augments or set name/rarity/icon; win_rate
attaches onto the base; coverage reported. *Claude gate.*

**Step 4 — Wiki = effect-text feed keyed to augmentId.** Rekey `scrape_wiki_augments.py` /
`enrich_wiki.py` to attach wiki display effect text by resolved `augmentId`; flag wiki-only augments.
*Success:* `wikiDescription` attached by `augmentId`; wiki-only augments flagged (not added). *Claude gate.*

**Step 5 — Assemble-catalog step + precedence.** New assemble step composes `augments.json` from
base + feeds with the §3 per-field precedence. Existence = CDragon roster; non-live → history /
tombstone (reuse `flags.lifecycle` + `apply_removed_augment_tombstones.py`); removed tombstones
preserved.
*Success:* `augments.json` rebuilt; active ≈ 170; tombstones preserved; **no field except `win_rate`
has arammayhem provenance**. *Claude gate.*

**Step 6 — Guard tests + reconciliation report.** Add a guard test: every active augment resolves to
a CDragon `augmentId`; `rarity` equals CDragon's; **no arammayhem provenance except `win_rate`**;
active count tracks the roster. Emit the **reconciliation report** artifact (unmatched/flagged) for P2.
*Success:* new tests + full suite green; report written. *Claude gate.*

**Step 7 — Pipeline integration + reproducibility.** Wire the new order into `update-data.sh`;
ensure **no-key deterministic CI reproducibility**; CDragon fetch failure → keep last committed base,
abort the rebuild (don't emit partial/empty); public-data boundary intact.
*Success:* a full `update-data` run reproduces; `npm test` green; `export_public_catalog.py` +
boundary test green. *Claude gate.*

**Step 8 — Final verification + handoff.** Full gate (`npm test`, `eslint`, `npm run build`,
overlay build). Update `CLAUDE.md` STATE (augment count change ~256→~170 active). Write the P1→P2
handoff note.
*Success:* whole gate green; STATE updated; handoff written. *Claude gate:* **Claude independently
re-verifies and performs any push** (main remains the human gate).

---

## 7. Definition of done (the `/goal` success criteria)

- [ ] Every **active** augment has an `augmentId` resolving to a CDragon `augmentNameId`.
- [ ] `rarity`, `icon`, locale names, and exact numbers have **CDragon provenance for 100%** of
      active augments; display effect text comes from the **wiki**; **`win_rate` is the only
      arammayhem-sourced field**.
- [ ] The arammayhem code path **cannot create augments or set rarity/name/icon** — enforced by a test.
- [ ] Active augment count tracks the CDragon roster (~170); non-live augments are tombstoned/history;
      previously-removed tombstones preserved.
- [ ] A reconciliation report lists **all** unmatched/flagged augments (input to Phase 2).
- [ ] Full gate green: `npm test` (Step 0 baseline + new guard tests, all passing), `npx eslint src scripts`,
      `npm run build`, `(cd overlay && npm run build)`; `public-data-boundary` test green;
      no-key deterministic CI reproducibility intact.
- [ ] `CLAUDE.md` STATE augment count updated.
- [ ] **No regression to the public-data boundary** — `public/data/augments.json` still has no `win_rate`.

---

## 8. Collaboration protocol (Claude involved each step)

- Codex runs `/goal` against this spec on `feat/augment-truth-resourcing`, executing §6 **in order**.
- After **each** step Codex **commits** and **stops**, posting that step's verification evidence
  (the exact commands + output) to `docs/handoffs/augment-truth-progress.md`.
- **Claude independently re-verifies** the step's success criterion (re-runs the commands, reviews
  the diff + report) and either **approves** or returns it with specific corrections. Codex proceeds
  **only on Claude approval**.
- **Claude sign-off is mandatory** for: the Step 1 alias table + unmatched list, and any field-precedence
  judgment call (these are data-truth decisions, not mechanics).
- **Codex never pushes to `main`.** Final push / any move toward `main` is Claude's, and merging to
  `main` stays the human gate.

---

## 9. Constraints & hazards

- **Public-data boundary is sacred:** `win_rate` and any telemetry stay **internal-only**;
  `export_public_catalog.py` + `public-data-boundary.test.ts` must stay green. (Riot policy: augment
  win rates must never be public.)
- **No-key reproducibility:** the daily cron must reproduce with **no API key** (deterministic
  fallback). CDragon fetches must be resilient — on failure, **keep the last committed base and abort
  the rebuild**; never emit a partial or empty catalog.
- **Stay in lane:** do not touch `supabase/**`, `src/app/api/**`, `overlay/**` runtime, or web
  membership components beyond what consumes the catalog. Decision/scoring logic
  (`src/lib/decision/**`, the scoring twins) is unchanged except for reading the new fields.
- **Never guess identity:** an unmatched augment is **flagged**, never assigned a guessed id.
- **Tooling hazards:** the rtk shell hook can falsify `diff`/`ls`/`find` — use `/usr/bin/` absolute
  paths for verification evidence. Bash CWD persists across calls — use `git -C` / absolute paths.
  macOS `xargs` lacks GNU `-a`.

---

## 10. Verification commands

```bash
# full gate
npm test
npx eslint src scripts
npm run build
(cd overlay && npm run build)

# augment count + win_rate coverage + provenance spot-check
node -e "const a=require('./data/internal/augments.json').augments; \
  const active=a.filter(x=>(x.flags?.lifecycle)!=='removed'); \
  console.log('active=',active.length,'with augmentId=',active.filter(x=>x.augmentId).length, \
  'win_rate=',a.filter(x=>typeof x.win_rate==='number').length)"

# guard: nothing but win_rate is arammayhem-sourced  (Step 6 test encodes this)
# reconciliation report (Step 6 artifact)
cat data/internal/augment-reconciliation-report.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('unmatched=',r.unmatched?.length,'wiki_only=',r.wikiOnly?.length)})"

# public boundary (must stay green)
python3 scripts/export_public_catalog.py && npm test -- public-data-boundary
```

---

## 11. Sources (canonical references)

- CDragon roster/identity/rarity/icon: `…/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`
- CDragon effects + numbers + icons: `…/cdragon/arena/en_us.json` (+ `zh_cn`/`zh_tw`/`ja`/`ko`)
- CDragon tooltips by locale: `game/<locale>/data/menu/<locale>/lol.stringtable.json` (`kiwi_*`/`cherry_*`)
- LoL Wiki (display text + Notes): `https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem/Augments`
- Official Tencent 26.12 validation: `https://lol.qq.com/gicp/news/410/37088140.html#n3`
- arammayhem (win_rate feed only): `https://arammayhem.com`
