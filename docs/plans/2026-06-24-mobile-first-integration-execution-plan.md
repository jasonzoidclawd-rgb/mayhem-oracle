# Mobile-First Integration — Execution Plan

**Owner (implementation):** Claude — this is 100% web/Next.js lane work per
`docs/superpowers/plans/2026-06-13-claude-codex-split-strategy.md`; no
`overlay/` or `src/lib/scoring/` files are touched anywhere in this plan.
**Reviewer:** Codex, before any phase below is executed.
**Source design docs:** `docs/modernization-proposal-2026-06.md`,
`docs/mobile-first-companion-addendum-2026-06.md`.
**Status:** prototypes (`prototype/dashboard.html`, `prototype/companion.html`)
are built and validated standalone. Nothing in `src/` has changed yet. This
plan turns those prototypes into real routes.

Each phase below is a `CO_WORKFLOW.md` handoff packet: one task, one owner,
one validation target. Execute in order — later phases depend on earlier
ones (dependency graph at the bottom). Stop and re-plan if a phase's actual
diff grows past its stated Files In Scope.

## Non-Goals

- No changes to `overlay/`, `src/lib/scoring/`, or any cross-parity-relevant
  file. Companion Mode calls `requestDecision()` from
  `src/lib/membership/decision-client.ts` only — never the engine directly.
- No new backend/API routes. `/api/decision/evaluate` already exists, is
  already fail-closed (`requireEntitlement()` → 401/403), and is already
  rate-limited (`EVALUATE_LIMIT = 30/60s`, confirmed in
  `src/lib/api/decision.ts:30`). Companion Mode is a pure new frontend
  consumer of it.
- No copy/design judgment calls beyond what's specified — if a phase needs a
  decision not covered below, stop and ask rather than improvise.

## Verified Ground Truth (so Codex doesn't have to re-derive it)

Checked against the current repo state on 2026-06-24, not restated from the
design docs:

1. **The home page already pays the barrel tax.** `src/app/[locale]/page.tsx`
   calls `loadPublicJson()` from `src/lib/data/public-loader.ts`, which
   statically imports **all eight** public data files into one module —
   including `abilities.json` (1,789,451 B) and `items.json` (513,019 B) —
   just to read `champions.json` (173,211 B) and `meta.json` (112 B). This is
   a real, current cost on today's homepage, not a hypothetical future one.
2. **No slim projections exist yet.** The addendum's proposed 26 KB
   champion / 18.8 KB augment projections are a Phase-1 deliverable, not
   something already on disk. Current full files: `champions.json` 173,211 B,
   `augments.json` 202,955 B.
3. **`requestDecision()` is already production-ready for Companion Mode as-is.**
   `src/lib/membership/decision-client.ts:41` already handles the 429 case
   with `retryAfterSeconds` parsed from the `Retry-After` header — the
   countdown UI the addendum asked for has a data source already.
   `DecisionContext`/`DecisionResult` (`src/lib/contracts/decision.ts`)
   already match the prototype's grade/stance vocabulary exactly
   (`hot|strong|steady|average|weak`, `keep|consider|reroll|golden-reroll`).
4. **The gating pattern to mirror already exists once.**
   `src/app/[locale]/advisor/page.tsx` has a `readAdvisorAccess()` function
   (Supabase user → `pickActiveEntitlement()` → `{active, signedIn}`) that
   gates `AdvisorMemberClient` vs. `MembershipGate`. `/companion` needs the
   identical check.
5. **Two confirmed accessibility bugs in `AdvisorMemberClient.tsx`** (addendum
   already named these; confirmed at exact lines): line 168 renders a nested
   `<main>` inside the layout's `<main>` (`src/app/[locale]/layout.tsx:132`);
   line 217 round-selector buttons are `h-9 w-9` (36px, under the 44px
   minimum touch target).
6. **The PWA manifest is currently broken, independent of this redesign.**
   `public/manifest.json` points at `/icons/icon-192.png` and
   `/icons/icon-512.png` — **neither file exists** (`public/icons/` is empty).
   Today's "Add to Home Screen" produces a blank/default icon. There is also
   no `apple-touch-icon` link anywhere, so iOS Safari has nothing to use at
   all.
7. **New finding, not in either design doc: the manifest hard-locks
   orientation.** `public/manifest.json` sets
   `"orientation": "portrait-primary"`. Android honors this strictly for
   installed/standalone PWAs — it will prevent the OS from rotating the app
   at all, which directly defeats the landscape-promotion work already built
   into `prototype/dashboard.html`. This must change to `"any"` as part of
   Phase 0, or the landscape dashboard feature silently does nothing for any
   user who installed the app to their home screen.
8. **New finding, not in either design doc: the bottom tab bar collides with
   the existing mobile nav pattern.** `src/components/ui/Navbar.tsx` already
   has a `sm:hidden` (<640px) hamburger that expands NAV_ITEMS (7 routes) as
   an in-flow dropdown below the top bar. Adding `MobileTabBar` without
   touching `Navbar.tsx` gives mobile users two competing navigation
   surfaces. See Decision Point D below.
9. `npm run lint` (bare) is the `"lint"` script (`eslint .`) — per
   `CLAUDE.md`'s own caveat this crawls `.worktrees/*/.next` noise. Use
   `npx eslint src scripts` for verification in every phase, not the bare
   script.

## Decision Points Needing Sign-Off

Flagging these because each is a real architectural choice, not a mechanical
port from the prototype. Recommendation stated; default to it unless Codex
or the user objects.

**A — Grid implementation: hand-rolled CSS classes vs. Tailwind utilities.**
`dashboard.html` hand-rolls `.col-3`/`.col-12`/etc. with custom breakpoints at
768px/1024px. `src/app/[locale]/page.tsx` today is 100% Tailwind utility
classes, zero custom layout CSS. Tailwind's default `md:`/`lg:` breakpoints
(768px/1024px) already match the prototype's breakpoints exactly.
**Recommendation: reimplement with `grid-cols-{1,6,12}` +
`md:col-span-*`/`lg:col-span-*` utilities**, not new CSS classes — matches
existing repo convention, same visual output.

**B — i18n namespace: extend `home` vs. new `dashboard` namespace.**
The home page becomes a meaningfully different surface (10 widgets vs. 4
stat cards). **Recommendation: new `dashboard` namespace** in all five
`messages/*.json`, leaving `home` alone (whatever isn't dashboard-specific,
e.g. nothing — `home` namespace becomes dead after migration and can be
removed in this same phase since this plan is the only caller). A parallel
new `companion` namespace for Phase 3.

**C — Extract `readAdvisorAccess()` vs. duplicate it for `/companion`.**
It's ~20 lines of security-relevant gating logic. Duplicating it means a
future fix to one copy can silently miss the other.
**Recommendation: extract to `src/lib/membership/read-member-access.ts`**,
used by both `advisor/page.tsx` and the new `companion/page.tsx`. This is the
one place this plan deviates from "don't abstract single-use code" — it's
no longer single-use once `/companion` exists, and the thing being duplicated
is an auth gate.

**D — Bottom tab bar vs. existing hamburger menu.**
**Recommendation:** below `lg` (1024px), the tab bar *replaces* the
hamburger pattern, it doesn't coexist with it. Concretely: gate
`Navbar.tsx`'s hamburger button + dropdown to `hidden lg:contents`-style
(effectively: only relevant ≥1024px, where the tab bar itself is
`lg:hidden`), and fold the routes that don't get one of the tab bar's 5 slots
(`/items`, `/damage-sim`, `/patch-notes`) into a 5th "More" tab that opens the
same dropdown markup the hamburger used to. No route loses one-tap-or-fewer
reachability; mobile gets exactly one navigation surface instead of two.

**E — `start_url`: stays `/`.**
Addendum open question #4. Resolving it here so Phase 2 isn't blocked: the
dashboard *is* the new home page (this plan), and `CompanionLauncher` is
item 0 on it — so `start_url: "/"` already puts an installed user one tap
from Companion Mode. No manifest change needed beyond the orientation fix
in Phase 0.

---

## Phase 0 — Fix PWA manifest & icons (independent bug-fix, unblocks Phase 2's landscape feature)

### Handoff

**Goal**
- Installed PWA has a real icon on Android/iOS and is not locked to portrait.

**Files In Scope**
- `public/manifest.json`
- `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-512-maskable.png` (new)
- `src/app/[locale]/layout.tsx` (add `apple-touch-icon` link)

**Assumptions**
- Source art for the icon already exists somewhere (brand mark) or can be
  generated from the existing ⚡ wordmark treatment used in `Navbar.tsx`. If
  no source art exists, this phase blocks on getting one — flag rather than
  improvise a placeholder.

**Requested Change**
- Generate real `icon-192.png` / `icon-512.png` (safe-zone padded, for `any`
  purpose) and a separate `icon-512-maskable.png` (full-bleed, for `maskable`
  purpose) — split the manifest's current single combined `"any maskable"`
  entry into two distinct `icons[]` entries with distinct `purpose` values
  per spec (a single image can't correctly serve both).
- Add an `apple-touch-icon` (180×180, no transparency) referenced via a
  `<link rel="apple-touch-icon">` in `layout.tsx`'s `<head>` — iOS Safari
  does not read the manifest's `icons[]` at all.
- Change `public/manifest.json`'s `"orientation": "portrait-primary"` →
  `"any"`.

**Verification**
- `npx eslint src scripts`
- `npm run build`
- Manual: install to an Android device (or Chrome's "Install app"), confirm
  icon renders (not the default globe/blank), confirm rotating the installed
  app to landscape is not blocked by the OS.

**Done Criteria**
- `public/icons/*.png` exist and are referenced correctly; no 404s for any
  manifest icon URL.
- `manifest.json` orientation is `"any"`.
- `apple-touch-icon` link present in rendered HTML `<head>`.

**Open Questions / Risks**
- None functional. Only risk is needing real brand art, which is a design
  asset question, not a code question.

---

## Phase 1 — Scoped data loader (prerequisite for Phase 2)

### Handoff

**Goal**
- Importing one public data file no longer drags in all eight.

**Files In Scope**
- `src/lib/data/read-public-file.ts` (new)
- `src/app/[locale]/page.tsx` (migrate its 3 `loadPublicJson` calls only)

**Assumptions**
- `src/lib/data/public-loader.ts` (the existing barrel) stays as-is and
  in-use by every other current caller (`advisor/page.tsx`, etc.) — this
  phase does not migrate them. Re-pointing other callers is a separate,
  later cleanup, not part of this integration.
- A per-file dynamic-or-scoped read (rather than the barrel's static
  import-everything) is achievable without breaking Next's static-analysis
  requirements for `fs` access in Server Components — needs a real
  implementation check during execution, not just assumed.

**Requested Change**
- Add `read-public-file.ts` exporting a function with the same per-file
  contract as `loadPublicJson<T>(filename)`, but implemented so that
  requesting `"champions.json"` does not pull `abilities.json` or
  `items.json` into the calling module's bundle.
- Migrate `src/app/[locale]/page.tsx`'s three calls
  (`champions.json`, `augments.json`, `meta.json`) to the new function.

**Verification**
- `npm test`
- `npx eslint src scripts`
- `npm run build` — inspect the build output's per-route JS/data size for `/`
  to confirm it dropped (baseline: today's home route pays for all 2.72 MB
  of `public/data/*.json` combined via the barrel; target: only the ~376 KB
  actually used by champions+augments+meta, pending Phase 2 also adopting
  the slimmer projections described in the addendum).

**Done Criteria**
- `npm run build`'s route size output for `/` measurably drops vs. the
  pre-phase baseline.
- No other route's behavior changes (only `page.tsx` touched).

**Open Questions / Risks**
- If Next's bundler can't scope a per-file read any tighter than the
  existing barrel without an actual runtime `fs.readFile` (i.e., losing
  build-time static optimization), say so and bring back the tradeoff
  instead of forcing it.

---

## Phase 2 — Mobile-first dashboard becomes the real home page

### Handoff

**Goal**
- `src/app/[locale]/page.tsx` renders the mobile-first bento dashboard from
  `prototype/dashboard.html` — single-column on phone, 6-col at ≥768px,
  12-col broadcast at ≥1024px, landscape-phone promotion, rotate hint — using
  real data instead of `MOCK`.

**Files In Scope**
- `src/app/[locale]/page.tsx` (full rewrite of body, keeps the same
  `setRequestLocale`/`getTranslations` shape)
- `src/components/dashboard/` (new directory): `PatchPulseBanner.tsx`,
  `HeroMover.tsx`, `MetaAtAGlance.tsx`, `TierMiniGrid.tsx`,
  `MoversCarousel.tsx`, `AugmentSpotlight.tsx`, `ComboHighlights.tsx`,
  `AdvisorTeaser.tsx`, `CompanionLauncher.tsx` — all plain Server Components,
  no `'use client'` (none of these need browser APIs)
- `src/components/dashboard/DashboardIslands.tsx` (new, `'use client'`) —
  the **only** file allowed to call `dynamic(..., {ssr:false})`, wrapping
  `FavoritesStrip.tsx` and `StreakCheckin.tsx` (both need `localStorage`,
  neither can usefully SSR)
- `src/components/dashboard/CmdKSearch.tsx` (new, `'use client'`)
- `src/components/ui/MobileTabBar.tsx` (new, `'use client'` — needs
  `usePathname()` for `aria-current`)
- `src/components/ui/RotateHint.tsx` (new, `'use client'` — needs
  `matchMedia` + `localStorage`)
- `src/components/ui/Navbar.tsx` (Decision Point D: hamburger → "More" tab
  handoff to `MobileTabBar`)
- `src/app/[locale]/layout.tsx` (mount `MobileTabBar` site-wide, below `lg`)
- `messages/{en,zh-TW,zh-CN,ja,ko}.json` (new `dashboard` namespace; Decision
  Point B)
- `src/lib/membership/grade-tokens.ts` (read-only reference — tier/grade
  color tokens must stay byte-identical, per `CLAUDE.md`'s parity contract;
  this phase reads from it, never edits it)

**Assumptions**
- Real data sources per widget: `HeroMover`/`MetaAtAGlance`/`TierMiniGrid`/
  `MoversCarousel` derive from `champions.json` (tier, wr, deltas already
  present per earlier data work); `AugmentSpotlight`/`ComboHighlights` from
  `augments.json`/`combos.json`; `AdvisorTeaser` stays the static marketing
  sample (never live engine output, per `CLAUDE.md`/addendum — this is a
  hard rule, not a placeholder-pending-removal). `FavoritesStrip`/
  `StreakCheckin` start from empty/zero state (no prior localStorage) since
  there's no existing favorites feature to migrate from.
- "Movers this patch" needs a previous-patch snapshot to diff against. If
  `meta.json`/`patch-notes.json` doesn't already carry the prior patch's
  per-champion tier, this widget ships with current-patch-only data (no
  deltas) rather than inventing a snapshot mechanism — confirm data
  availability before assuming the prototype's mock deltas are buildable as-is.

**Requested Change**
- Implement all widgets listed above, composed in `page.tsx` per the
  `dashboard.html` layout order, using Tailwind utilities per Decision
  Point A (not new custom CSS classes).
- Port the reveal-on-view `IntersectionObserver` hook and the global
  `prefers-reduced-motion: reduce` reset (the addendum confirmed
  `globals.css` had no reduced-motion reset at all) into `globals.css`.
- Port the landscape-promotion media query and `RotateHint` logic verbatim
  from the already-validated `prototype/dashboard.html` (lines implementing
  `@media (orientation:landscape) and (max-height:500px)` and
  `wireRotateHint()`), translated to Tailwind arbitrary-value media variants
  or a small scoped CSS block — whichever keeps the exact same breakpoint
  logic (max-height 500px, capped at max-width 1023px, so a short desktop
  window is never demoted).

**Verification**
- `npm test`
- `npx eslint src scripts`
- `npm run build`
- Manual, both physical phone (portrait + landscape, per the LAN-serving
  steps already in use) and desktop browser at ≥1024px width, confirming
  visual parity with the validated `prototype/dashboard.html`.
- i18n key-parity test must pass with the new `dashboard` namespace present
  in all five locale files in the same commit.

**Done Criteria**
- `/` visually matches `prototype/dashboard.html` at phone/tablet/desktop/
  landscape-phone breakpoints.
- Lighthouse mobile (throttled) LCP/INP/CLS within the budget table in
  `docs/mobile-first-companion-addendum-2026-06.md` §4.
- Zero `'use client'` directives outside `DashboardIslands.tsx`,
  `CmdKSearch.tsx`, `MobileTabBar.tsx`, `RotateHint.tsx`, and `Navbar.tsx`.

**Open Questions / Risks**
- Movers-diff data availability (above).
- Decision Points A/B/D need sign-off before this phase starts, since they
  change the shape of the diff materially.

---

## Phase 3 — Companion Mode (`/companion` route)

### Handoff

**Goal**
- A live, in-game second-screen route at `/companion`, gated identically to
  `/advisor`, that turns `prototype/companion.html`'s 3-tap auto-fire loop
  into real React calling the real gated API.

**Files In Scope**
- `src/lib/membership/read-member-access.ts` (new — extracted from
  `readAdvisorAccess()`, per Decision Point C)
- `src/app/[locale]/advisor/page.tsx` (swap its inline `readAdvisorAccess()`
  for the extracted helper — mechanical, no behavior change)
- `src/app/[locale]/companion/page.tsx` (new — mirrors `advisor/page.tsx`'s
  shape: gate, then render champion/augment picker catalogs)
- `src/components/companion/CompanionClient.tsx` (new, `'use client'`) —
  imports **only** `requestDecision` from
  `src/lib/membership/decision-client.ts`; must never import anything from
  `src/lib/scoring/` or `src/lib/decision/` directly
- `messages/{en,zh-TW,zh-CN,ja,ko}.json` (new `companion` namespace)
- `src/app/sitemap.ts` (check whether gated routes like `/advisor` are
  already excluded — match whatever that existing convention is for
  `/companion`, don't introduce a new one)
- `src/components/ui/MobileTabBar.tsx` (center FAB → `/companion`, already
  scoped in Phase 2)

**Assumptions**
- The champion/augment picker catalogs (`AdvisorChampionOption`/
  `AdvisorAugmentOption` shapes) are reusable as-is for Companion Mode's
  type-ahead search and MRU list — no new public data fields needed.
- Wake Lock API usage ports directly from the validated
  `prototype/companion.html` `try`/catch pattern; the addendum's iOS 16.4+
  caveat and manual-toggle fallback are both already proven in that
  prototype and just need translating to a `useEffect`/ref-based React
  pattern.
- MRU/sticky-champion state is `localStorage`-only (no server sync) for v1,
  matching the prototype — explicitly deferred, not silently dropped.

**Requested Change**
- Implement the gated route + client component per the prototype's verified
  UX: sticky champion header, rarity tabs (manual change pauses auto-advance,
  with the toast), type-ahead filter, 3-tap auto-fire with 250ms debounce and
  Undo, sliding verdict sheet with SVG grade rings keyed off the real
  `DecisionGrade` enum, shape-coded stance pill keyed off the real
  `reroll.stance` enum, collapsible reasons, fail-closed locked state
  (blurred placeholders, zero real `DecisionResult` reaching a non-member
  — this is the same invariant `/advisor` already enforces, just reused).
- Wire the 429 path using `requestDecision()`'s existing
  `retryAfterSeconds` to a countdown UI state (ground-truth item 3 — the
  data is already there, addendum's open question about *how* to surface it
  is answered: literal "retry in Ns" countdown, matching `/advisor`'s
  existing rate-limit handling if any exists, or net-new if `/advisor`
  doesn't yet surface 429s distinctly — check before assuming).

**Verification**
- `npm test` (cross-parity suite included automatically via
  `vitest.config.ts`'s `include: ["src/**/*.test.ts"]` — must still show 0
  divergent champions; this phase shouldn't be able to affect it at all
  given the import boundary, but verify rather than assume)
- `npx eslint src scripts`
- `npm run build`
- Manual on physical phone: full mock game loop (warm path 3 taps, cold path
  4 taps), Wake Lock toggle, member↔locked toggle (using a real test
  entitlement, not the prototype's fake demo switch).
- Grep check as a structural invariant, not just a one-time read:
  `! grep -rn "lib/scoring\|lib/decision/evaluate" src/components/companion/`
  must return nothing.

**Done Criteria**
- `/companion` is reachable, gated identically to `/advisor` (401/403
  behavior matches), and produces real `DecisionResult`-driven verdicts for
  active members.
- Cross-parity test still at budget 0.
- `CompanionClient.tsx` has zero imports from `src/lib/scoring/` or
  `src/lib/decision/` (verified by the grep above, not just code review).

**Open Questions / Risks**
- Whether `/advisor` already has 429/rate-limit UI to match patterns with,
  or whether this phase is first to build it (check before assuming either
  way).
- Trial-entitlement support (addendum open question #1) — if
  `pickActiveEntitlement()` doesn't yet recognize a trial kind, Companion
  Mode v1 simply shows the locked state for trial users same as any other
  non-active entitlement; not a blocker, just a scope note.

---

## Phase 4 — Service worker / offline (depends on Phase 0 icons + Phase 3 routes existing)

### Handoff

**Goal**
- Minimal hand-written SW: never caches a gated decision response,
  stale-while-revalidate for static data/icons.

**Files In Scope**
- `public/sw.js` (new)
- `src/components/ui/RegisterServiceWorker.tsx` (new, tiny `'use client'`
  bootstrap, mounted once in `layout.tsx`)

**Assumptions**
- No Workbox/build-step dependency — hand-written, per the addendum's
  explicit "no Workbox" call, matching the repo's $0/no-extra-deps posture.

**Requested Change**
- `/api/decision/*` — network-only, never cached (a stale gated verdict is
  worse than a slow one).
- `/data/*`, `/icons/*` — stale-while-revalidate.
- Everything else — pass-through (no blanket app-shell caching in v1; that's
  a larger change with more failure modes than this plan's scope justifies).

**Verification**
- `npx eslint src scripts`
- `npm run build`
- Manual: DevTools Application panel — confirm `/api/decision/evaluate`
  never appears in the Cache Storage; confirm `/data/champions.json` does.

**Done Criteria**
- SW registers without error on first load; gated endpoint verifiably never
  cached; static data verifiably cached and revalidated.

**Open Questions / Risks**
- None beyond standard SW versioning/update-on-reload behavior, which is
  inherent to hand-rolled SWs and acceptable for v1 per the addendum.

---

## Dependency Graph

```
Phase 0 (manifest/icons) ──┐
                           ├──> Phase 2 (dashboard) ──> Phase 3 (companion) ──> Phase 4 (SW)
Phase 1 (data loader) ─────┘
```

Phase 0 and Phase 1 have no dependency on each other and can be reviewed/
executed in either order or in parallel. Phase 2 needs both done first
(needs the orientation fix to not fight its own landscape feature; needs
the loader to not regress home-page payload). Phase 3 needs Phase 2's
`MobileTabBar` (for the FAB) to exist, though the route itself could
technically be built standalone. Phase 4 wants real icons (Phase 0) and a
real `/companion` route (Phase 3) to write meaningful caching rules for.

## Global Verification (run once, after all phases, before calling this done)

```bash
npm test
npx eslint src scripts
npm run build
```

`(cd overlay && npm run build)` is **not required** — no file in this plan
touches `overlay/`. Per `CLAUDE.md`'s rtk caveat, use `/usr/bin/diff`,
`/usr/bin/grep`, `/usr/bin/wc` for any verification evidence, not bare
`diff`/`ls`/`find`.
