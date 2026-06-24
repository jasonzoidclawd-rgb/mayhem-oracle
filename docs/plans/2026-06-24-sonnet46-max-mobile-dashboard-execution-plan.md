# Sonnet 4.6 Max Execution Plan — Mobile Dashboard Integration

**Intended executor:** Claude Code / Sonnet 4.6 / max effort  
**Reviewer gate:** Codex review before implementation, then phase gates after
each commit-sized slice.  
**Repo:** `/Users/jason/Desktop/mayhem-oracle`  
**Primary source docs:**  
- `docs/plans/2026-06-24-mobile-first-integration-execution-plan.md`
- `docs/handoffs/mobile-dashboard-integration-packet.md`
- `docs/modernization-proposal-2026-06.md`
- `docs/mobile-first-companion-addendum-2026-06.md`
- `prototype/dashboard.html`
- `prototype/companion.html`

This plan supersedes the first execution plan where it conflicts with Codex's
review. Do not start implementation until the preflight and decision gates below
are satisfied.

## Mission

Integrate the validated mobile-first Mayhem Oracle dashboard and companion-mode
design into the real Next.js app without breaking the existing data pipeline,
i18n, PWA behavior, or web/overlay scoring boundary.

The product direction is fixed:

- Mobile is primary because many users use a phone as a second screen while
  playing.
- Desktop/Mac remains the premium broadcast command center.
- Phone portrait is the fast glance surface.
- Phone landscape unlocks the desktop-style broadcast bento grid.
- Companion mode stays portrait-first and one-handed.

## Non-Negotiable Rules

1. Preserve unrelated dirty work. Never revert or clean files you did not create.
2. Do not hand-edit `public/data/`; it is generated.
3. New user-facing copy must land in all five `messages/*.json` files in the
   same commit.
4. Do not touch `overlay/`, `src/lib/scoring/`, or overlay scoring twins.
5. Companion mode must call the existing API boundary only:

```ts
CompanionClient -> requestDecision() -> /api/decision/evaluate
```

Forbidden:

```ts
CompanionClient -> src/lib/scoring/*
CompanionClient -> src/lib/decision/*
```

6. Do not claim mobile access is fixed unless a phone-reachable URL is verified,
   preferably a hosted preview or tunnel if LAN access remains unreliable.
7. Use `npx eslint src scripts`, not bare `npm run lint`, because bare lint can
   crawl `.worktrees/*/.next` noise.

## Phase -1 — Preflight And Isolation

**Goal:** start from a safe base before editing app code.

**Commands / checks**

```bash
cd /Users/jason/Desktop/mayhem-oracle
git status --short --branch
git fetch origin
```

**Required decision**

Pick the implementation base before editing:

- Preferred: a fresh worktree from the current integration branch/mainline.
- Do not implement directly in the current dirty root checkout unless the user
  explicitly says to accept that risk.

**Fresh worktree shape**

```bash
git worktree add .worktrees/mobile-dashboard <base-ref>
cd .worktrees/mobile-dashboard
git status --short --branch
```

The status must be clean before app-code edits begin.

**Design artifact handling**

Copy or reference these as inputs only:

- root `prototype/dashboard.html`
- root `prototype/companion.html`
- root `docs/modernization-proposal-2026-06.md`
- root `docs/mobile-first-companion-addendum-2026-06.md`

If copying them into the worktree creates doc/prototype changes, keep that in a
separate docs/prototype commit from app integration.

**Done criteria**

- Implementation worktree is clean.
- Base ref is recorded in the handoff.
- User/Claude WIP in the root checkout is untouched.

## Phase 0 — PWA Manifest And Icons

**Goal:** installed PWA supports landscape and has real icons.

**Why first**

`public/manifest.json` currently sets `"orientation": "portrait-primary"`.
That blocks the exact phone-landscape dashboard behavior this project now
requires. Manifest icon files are also referenced but missing.

**Files in scope**

- `public/manifest.json`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/icon-512-maskable.png`
- `public/icons/apple-touch-icon.png`
- `src/app/[locale]/layout.tsx`

**Implementation**

1. Change manifest orientation to:

```json
"orientation": "any"
```

2. Split icon purposes instead of using one `"any maskable"` asset for all
   contexts:

```json
{
  "src": "/icons/icon-192.png",
  "sizes": "192x192",
  "type": "image/png",
  "purpose": "any"
}
```

```json
{
  "src": "/icons/icon-512-maskable.png",
  "sizes": "512x512",
  "type": "image/png",
  "purpose": "maskable"
}
```

3. Add an iOS touch icon through Next metadata, not an ad hoc `<head>` block.
The current App Router layout returns `<html><body>` and uses metadata, so add
this under `generateMetadata()`:

```ts
icons: {
  apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
},
```

4. If no brand source art exists, create a simple generated icon using the
existing Mayhem Oracle bolt/gradient identity, but keep it deliberate and note
that it is a v1 generated brand asset.

**Verification**

```bash
npx eslint src scripts
npm run build
```

Manual/browser checks:

- `/manifest.json` returns the new icon paths.
- every referenced icon URL returns `200`.
- installed PWA no longer locks orientation to portrait.

**Stop conditions**

- If the executor cannot produce acceptable icon assets, stop and ask for brand
  art rather than committing placeholder-looking icons.

## Phase 1 — Scoped Public Data Loader

**Goal:** the home/dashboard route can read only the public JSON files it
actually needs.

**Problem**

`src/lib/data/public-loader.ts` statically imports every public JSON file,
including the large `abilities.json`. The current homepage imports this barrel
to read only a small subset.

**Files in scope**

- `src/lib/data/read-public-file.ts` or similarly named targeted loader
- `src/app/[locale]/page.tsx`
- focused tests if added under `src/lib/__tests__/`

**Implementation**

1. Add a targeted server-only loader using `node:fs/promises`, following the
   pattern already used by `src/lib/api/public-catalog.ts`.
2. Type the accepted filenames narrowly. Do not allow arbitrary path input.
3. Migrate only the home/dashboard route away from `loadPublicJson()` in this
   phase.
4. Leave other current callers alone unless the actual implementation proves the
   old barrel keeps poisoning the dashboard chunk.

**Required proof**

Build output alone is not sufficient. After `npm run build`, inspect generated
artifacts enough to prove the dashboard/home route did not embed the full
`abilities.json` payload.

Acceptable proof examples:

```bash
/usr/bin/grep -R "known-large-ability-only-token" .next/server/app || true
/usr/bin/du -sh .next/server/app/[locale]/page*
```

Use a real string from `public/data/abilities.json` for the grep, not a made-up
placeholder.

**Verification**

```bash
npm test
npx eslint src scripts
npm run build
```

**Done criteria**

- `/` still renders.
- Home/dashboard route no longer imports `src/lib/data/public-loader.ts`.
- Evidence shows the large ability payload is absent from the home/dashboard
  route artifact.

## Phase 2 — Dashboard As Home Page

**Goal:** turn `prototype/dashboard.html` into the real localized `/` route.

**Files in scope**

- `src/app/[locale]/page.tsx`
- `src/components/dashboard/*`
- `src/components/ui/MobileTabBar.tsx`
- `src/components/ui/RotateHint.tsx`
- `src/components/ui/Navbar.tsx`
- `src/app/[locale]/layout.tsx`
- `src/styles/globals.css`
- all five `messages/*.json`

**Important correction from Codex review**

The mobile nav breakpoint must be below `lg`, not below `sm`.

Current `Navbar.tsx` desktop nav starts at `sm:flex`, and account icon starts
at `sm:flex`. If `MobileTabBar` is `lg:hidden`, tablet widths from `640px` to
`1023px` would show both top route links and bottom tab bar.

Required behavior:

- below `lg`: brand + language selector in top bar, bottom `MobileTabBar` owns
  route navigation.
- `lg` and above: full top nav owns route navigation; `MobileTabBar` hidden.
- routes that do not fit the five-slot tab bar go into a `More` tab/dropdown.

**Dashboard component split**

Server components:

- `PatchPulseBanner`
- `HeroMover`
- `MetaAtAGlance`
- `TierMiniGrid`
- `MoversCarousel`
- `AugmentSpotlight`
- `ComboHighlights`
- `AdvisorTeaser`
- `CompanionLauncher`

Client components:

- `DashboardIslands`
- `CmdKSearch`
- `MobileTabBar`
- `RotateHint`

No other dashboard file should need `'use client'`.

**Mobile-first layout contract**

- base layout: one column
- `md`/768px: six-column layout
- `lg`/1024px: twelve-column broadcast layout
- phone landscape promotion:

```css
@media (orientation: landscape) and (max-height: 500px) and (max-width: 1023px)
```

- portrait phone rotate hint is dismissible with `localStorage`
- all tap targets at least 44px
- reduced motion respected globally
- no looping Ken Burns animation on phones

**Data contract**

Use smallest practical reads:

- `meta.json`
- `patch-notes.json`
- `champions.json`
- `augments.json`
- `combos.json`

Do not read `abilities.json` for dashboard v1.

If “movers this patch” lacks reliable previous-patch data, ship it as a
current-patch highlight instead of inventing deltas.

**I18n**

Add a new `dashboard` namespace in:

- `messages/en.json`
- `messages/zh-TW.json`
- `messages/zh-CN.json`
- `messages/ja.json`
- `messages/ko.json`

Do not delete the `home` namespace unless a key-parity test proves it has no
remaining callers and the deletion is included across all locales.

**Verification**

```bash
npm test
npx eslint src scripts
npm run build
```

Manual visual checks:

- phone portrait
- phone landscape
- desktop width >= 1024px
- reduced-motion mode
- CJK locale page

**Mobile access acceptance**

LAN URL is not enough because it has already failed on the user’s phone. Before
claiming mobile verification complete, provide one of:

- a verified Vercel preview URL, or
- a verified tunnel URL, or
- a physically confirmed phone load on the same network.

If using LAN, explicitly state it is provisional.

## Phase 3 — Companion Route

**Goal:** implement `/companion` as the phone-first in-game second screen.

**Files in scope**

- `src/lib/membership/read-member-access.ts`
- `src/app/[locale]/advisor/page.tsx`
- `src/app/[locale]/companion/page.tsx`
- `src/components/companion/CompanionClient.tsx`
- all five `messages/*.json`
- `src/app/sitemap.ts`
- `src/components/ui/MobileTabBar.tsx`

**Implementation**

1. Extract the existing advisor entitlement check into
   `read-member-access.ts`.
2. Use the helper from both `/advisor` and `/companion`.
3. Build `CompanionClient` from the prototype:
   - sticky champion header
   - rarity tabs
   - type-ahead augment search
   - three-tap auto-fire
   - undo window
   - verdict sheet
   - 429 countdown from `retryAfterSeconds`
   - locked state for non-members
4. Use `requestDecision()` only. Do not import scoring code.

**Sitemap/robots**

Check existing convention first. `/advisor` is currently listed in sitemap even
though member behavior is gated. Match that policy unless the user decides
otherwise; do not invent a new SEO policy in this phase.

**Verification**

```bash
npm test
npx eslint src scripts
npm run build
/usr/bin/grep -R "lib/scoring\\|lib/decision" src/components/companion && exit 1 || true
```

Manual:

- non-member sees locked state
- active member can evaluate three offered augments
- rate limit path shows countdown
- wake-lock toggle degrades gracefully
- phone portrait one-handed flow is usable

## Phase 4 — Minimal Service Worker

**Goal:** static data/icons can cache, gated decisions never cache.

**Files in scope**

- `public/sw.js`
- `src/components/ui/RegisterServiceWorker.tsx`
- `src/app/[locale]/layout.tsx`

**Rules**

- `/api/decision/*`: network-only, never cached
- `/data/*`: stale-while-revalidate
- `/icons/*`: stale-while-revalidate
- no blanket app-shell caching in v1
- no Workbox dependency

**Verification**

```bash
npx eslint src scripts
npm run build
```

Manual DevTools:

- `/api/decision/evaluate` never appears in Cache Storage
- `/data/champions.json` does appear after load
- service worker registration has no console errors

## Phase 5 — External Mobile Verification

**Goal:** close the user’s actual complaint: phone access.

Do not stop at Mac-local `curl`.

Acceptable final evidence:

1. Vercel preview URL opens on the phone; or
2. tunnel URL opens on the phone; or
3. user confirms the LAN URL opened on the phone after a verified local server.

If LAN still fails:

- do not keep repeating `192.168.x.x` instructions;
- assume router/client isolation or local firewall/privacy;
- use hosted preview or tunnel instead.

## Global Final Gate

Run from the implementation worktree:

```bash
git status --short --branch
npm test
npx eslint src scripts
npm run build
```

Overlay build is not required unless a file under `overlay/`, `src/lib/scoring/`,
or shared scoring contracts was touched. If touched accidentally, stop and
review scope before continuing.

Final report must include:

- branch/worktree used
- files changed by phase
- verification command outputs summarized
- mobile URL used for real phone verification
- any skipped checks and why
- screenshots or concise visual notes for phone portrait, phone landscape, and
  desktop

## Execution Style For Sonnet 4.6

Work one phase at a time. After each phase:

1. show `git diff --stat`
2. run that phase’s verification
3. commit or stop for review, depending on user instruction
4. do not proceed past a failed gate

Prefer small, reviewable diffs over a single massive dashboard commit. The
dashboard is design-heavy, but the integration should still be mechanically
auditable.
