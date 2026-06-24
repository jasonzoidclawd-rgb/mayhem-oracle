# Mobile Dashboard Integration Packet

Date: 2026-06-24
Owner: Claude/Codex handoff
Repo: `/Users/jason/Desktop/mayhem-oracle`

## Current Situation

The redesign artifacts from the Claude session are present in the root checkout:

- `prototype/dashboard.html`
- `prototype/companion.html`
- `docs/modernization-proposal-2026-06.md`
- `docs/mobile-first-companion-addendum-2026-06.md`

The root checkout is dirty and on `feat/augment-truth-resourcing`. Preserve the
existing changes. Do not treat this checkout as a clean implementation base
without first checking `git status --short --branch`.

Recommended implementation base: create a fresh worktree from the current
integration branch/mainline, then copy/reference the docs and prototype files as
design inputs. Avoid mixing this UI integration with the existing dirty data
work unless the user explicitly asks for that.

## Verified Prototype Server

Root cause of the mobile URL failure: no durable server was serving the
prototype. A plain background `python3 -m http.server` process was killed after
the command exited, and a launchd process could not read the Desktop project
directory due macOS privacy permissions.

Working workaround: serve a temp copy of the prototype from `/private/tmp`.

Verified LAN URLs:

- Dashboard: `http://192.168.0.104:8080/dashboard.html`
- Companion: `http://192.168.0.104:8080/companion.html`

Current temporary service:

- LaunchAgent plist: `/private/tmp/mo-prototype-server.plist`
- Served directory: `/private/tmp/mo-prototype`
- Label: `local.mayhem-oracle.prototype-server`
- Stop command:

```bash
launchctl bootout gui/$(id -u) /private/tmp/mo-prototype-server.plist
```

If the prototype files change, refresh the served copy:

```bash
cp prototype/dashboard.html /private/tmp/mo-prototype/dashboard.html
cp prototype/companion.html /private/tmp/mo-prototype/companion.html
```

If the phone still cannot open the verified LAN URL, do not keep repeating
localhost instructions. The next fallback is a tunnel or hosted preview. This
machine does not currently have `cloudflared` installed.

## Product Direction To Preserve

Mobile is primary because many users will use a phone as a second screen while
playing. Desktop remains the premium broadcast command center.

Dashboard:

- Mobile base layout first, then enhance up to tablet/desktop.
- Portrait phone: fast single-column surface with a dismissible rotate hint.
- Landscape phone: promote to the broadcast bento layout using:
  `(orientation: landscape) and (max-height: 500px) and (max-width: 1023px)`.
- Desktop/Mac: keep the original premium esports broadcast grid.

Companion:

- Keep portrait-first and one-handed.
- Do not force landscape in the in-game 3-augment scoring flow.
- This is the compliance-safe twin of the overlay: user-provided inputs on a
  second device, no game memory reads, no client injection.

## Current Build Integration Facts

Current home page: `src/app/[locale]/page.tsx`.

Current home page imports:

```ts
import { loadPublicJson } from "@/lib/data/public-loader";
```

Do not use that loader for the dashboard route. It statically imports every
public JSON file:

- `abilities.json` is about 1.7 MB.
- `items.json` is about 501 KB.
- `augments.json` is about 198 KB.
- `champions.json` is about 169 KB.
- `combos.json` is about 40 KB.

The dashboard must not accidentally pull the full ability corpus into its route
chunk. Use a targeted server-side file reader instead, following the pattern in
`src/lib/api/public-catalog.ts` (`readFile` from `node:fs/promises`) or create a
small dashboard-specific loader.

Generated data rule: do not hand-edit `public/data/`.

## Recommended Phase 1 Implementation Scope

Start with a real route that is low-risk and easy to compare against the
prototype:

- Safer first route: `src/app/[locale]/dashboard/page.tsx`
- Later decision: promote it to `/` after review.

Create server-first components:

- `src/components/dashboard/PatchPulseBanner.tsx`
- `src/components/dashboard/HeroMover.tsx`
- `src/components/dashboard/MetaAtAGlance.tsx`
- `src/components/dashboard/TierMiniGrid.tsx`
- `src/components/dashboard/AugmentSpotlight.tsx`
- `src/components/dashboard/ComboHighlights.tsx`
- `src/components/dashboard/MobileRotateHint.tsx`

Create one client island only where needed:

- `src/components/dashboard/DashboardIslands.tsx`

Keep these server-rendered/static in Phase 1:

- patch pulse
- hero/meta summary
- mini tier board
- augment spotlight
- combo highlights

Defer these client-heavy pieces until Phase 2:

- Cmd-K global search
- favorites/personalization
- Supabase-backed check-in/streak
- web push

## Companion Route Scope

Companion should be its own route after the dashboard shell lands:

- `src/app/[locale]/companion/page.tsx`
- `src/components/companion/CompanionClient.tsx`

The companion client must call the existing decision API boundary. It should not
import scoring engine internals into the browser.

Allowed direction:

```ts
CompanionClient -> decision-client -> /api/decision/evaluate
```

Forbidden direction:

```ts
CompanionClient -> src/lib/scoring/*
```

This preserves the web/overlay scoring-twin boundary and keeps cross-parity
budget at zero.

## Data Wiring

Dashboard widgets should use the smallest possible public data:

- patch pulse: `public/data/meta.json` and `public/data/patch-notes.json`
- tier mini: `public/data/champions.json`
- augment spotlight: `public/data/augments.json`
- combo highlights: `public/data/combos.json`
- items only when a widget actually displays item data
- avoid `public/data/abilities.json` on the dashboard shell

If a widget needs a derived small subset, add a generated derivative to the
pipeline instead of loading the whole source file in the client.

## I18n Requirements

Any new user-facing strings must be added to all five locale files under
`messages/` in the same commit.

Avoid shipping a CJK display webfont. Use the existing locale-aware fallback
strategy from the docs and keep display styling Latin-only where needed.

## Styling Requirements

The prototype is a visual reference, not a paste target. Extract the ideas into
Tailwind/React using existing project tokens in `src/styles/globals.css`.

Required mobile behavior:

- 44 px minimum touch targets.
- bottom thumb-zone nav or launcher on phone only.
- rotate hint only for portrait phones, dismissible with localStorage.
- landscape phone gets the bento grid.
- motion must respect `prefers-reduced-motion`.
- no looping Ken Burns animation on phones.

Avoid remote hotlinked art in the app integration. First pass can use existing
icons/gradients; later pass should pre-bake images in the data pipeline if real
art is required.

## Suggested Claude/Codex Split

Claude owns:

- translating `prototype/dashboard.html` into the React component structure;
- preserving the broadcast look and mobile landscape behavior;
- adding locale strings across `messages/*.json`;
- keeping `/companion` portrait-first if implemented.

Codex owns:

- route/data-loader safety;
- test/build verification;
- confirming `abilities.json` is not pulled into the dashboard shell;
- phone URL verification after integration;
- preserving generated data ownership and web/overlay parity.

## Verification Floor

For a docs/prototype-only change, verify:

```bash
curl -I http://127.0.0.1:8080/dashboard.html
curl -I http://192.168.0.104:8080/dashboard.html
```

For real app integration, run:

```bash
npm test
npx eslint src scripts
npm run build
```

Run overlay build only if overlay code or shared scoring logic is touched:

```bash
(cd overlay && npm run build)
```

Also manually verify the phone route over LAN or a tunnel before claiming
mobile access is fixed.

## Open Product Calls

1. Start as `/dashboard` first, or replace `/` immediately?
2. Should the installed PWA start URL remain `/`, or open directly into
   `/companion`?
3. Should companion v1 show a locked teaser, or require membership/auth from the
   first integration?
4. Which widgets are must-have above the fold for a 5-second phone glance?
