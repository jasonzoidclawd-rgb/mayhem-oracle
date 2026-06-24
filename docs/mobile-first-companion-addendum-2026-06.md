# Mayhem Oracle — Mobile-First & Second-Screen Companion Addendum

> **Status:** Decision-ready. Extends `docs/modernization-proposal-2026-06.md` (the "Proposal"). References its sections by number; does not repeat them.
> **Author:** Lead architect. **Date:** 2026-06-22. **Patch baseline:** 26.12, 255 augments live (256 rows incl. header), 172 champions, cross-parity budget 0.
> **Adversarial fixes:** All track-level verdict adjustments are folded in below as the shipping design. Contested numbers were re-measured against the repo (see §4) — where this doc and a track disagree, this doc's numbers are the verified ones.

---

## 1. Where we stand & the reframe

`prototype/dashboard.html` is **desktop-first responsive-collapse**: the base layout is `.grid{grid-template-columns:repeat(12,1fr)}` and two `max-width` media blocks (`980px → 6 cols`, `620px → 1fr`) shrink it down, with `col-*` spans authored for desktop and overridden on the way down. The phone gets whatever falls out of collapse — it is the least-considered render path. That is exactly backwards for this product. The defining hardware fact is that **the phone is a live in-game second screen held one-handed beside the keyboard between ARAM Mayhem augment rounds** — glanced at for ~2 seconds, often mid-fight, in a dark room, on cellular or shared wifi. So the priority inverts: **mobile is the primary live-decision surface; desktop is the lean-back research/browse surface** (Proposal §2.4, §5). The base stylesheet must *be* the phone, and the broadcast bento (Proposal §2.4) becomes an additive `min-width` enhancement on top. This is also the **compliance-safe twin** of the Tauri overlay (`overlay/`, flagged compliance-sensitive in `CLAUDE.md`): a player glancing at their own phone reads no game memory, injects nothing, accesses no hidden information — and reaches the huge no-install audience.

---

## 2. Mobile-first responsive architecture

### 2.1 The inversion (CSS ownership)

Good news from the repo audit: the *current* home `src/app/[locale]/page.tsx` is already authored mobile-base Tailwind, so the desktop-collapse hazard lives **only in the new bento prototype**. We fix it there and keep it inverted everywhere.

**BEFORE** — `prototype/dashboard.html` (desktop-first; lines ~68–70 + the two collapse blocks):

```css
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}   /* BASE = desktop */
.col-3{grid-column:span 3}.col-8{grid-column:span 8} /* ... always-on desktop spans */
@media (max-width:980px){ .grid{grid-template-columns:repeat(6,1fr)}
  .col-3,.col-4{grid-column:span 3}.col-5,.col-6,.col-7,.col-8{grid-column:span 6} }
@media (max-width:620px){ .grid{grid-template-columns:1fr}
  [class^=col-],[class*=' col-']{grid-column:1/-1} }              /* override every span */
```

**AFTER** — mobile-base + `min-width` enhancement; the two `max-width` blocks are **deleted**; desktop becomes an explicit `grid-template-areas` map (no span arithmetic that can leave holes):

```css
/* BASE = phone, single priority column */
.grid{display:grid;grid-template-columns:1fr;gap:var(--gap)}
.grid>*{grid-column:auto}                                  /* full-width by default */

/* >=768px: tablet 6-col bento + Ken-Burns re-enabled (see §2.5, no tablet dead zone) */
@media (min-width:768px){
  .grid{grid-template-columns:repeat(6,1fr)}
  .col-3,.col-4{grid-column:span 3}
  .col-5,.col-6,.col-7,.col-8{grid-column:span 6}
  .col-12{grid-column:1/-1}
}

/* >=1024px: desktop 12-col broadcast bento, named areas reproduce Proposal §2.4 1:1 */
@media (min-width:1024px){
  .grid{grid-template-columns:repeat(12,1fr);
    grid-template-areas:
      'pat pat pat pat pat pat pat pat pat pat pat pat'
      'her her her her her her her her met met met met'
      'her her her her her her her her cmd cmd cmd cmd'
      'tie tie tie tie tie tie tie tie tie tie tie tie'
      'mov mov mov mov mov mov mov mov adv adv adv adv'
      'fav fav fav fav fav fav aug aug aug aug aug aug'
      'cmb cmb cmb cmb cmb cmb cmb cmb stk stk stk stk'}
  .w-pat{grid-area:pat}.w-her{grid-area:her}.w-met{grid-area:met}.w-cmd{grid-area:cmd}
  .w-tie{grid-area:tie}.w-mov{grid-area:mov}.w-adv{grid-area:adv}.w-fav{grid-area:fav}
  .w-aug{grid-area:aug}.w-cmb{grid-area:cmb}.w-stk{grid-area:stk}
}
```

**Tailwind v4 production form** (in `src/app/[locale]/page.tsx` / `BentoCell.tsx`): base `grid grid-cols-1 gap-3`, then `md:grid-cols-6`, then `lg:grid-cols-12`; widgets carry `lg:col-span-8` etc. The `lg:` prefix means spans apply **only ≥1024px** — additive-up, no override-on-collapse. Tablet promoted to **768px** (not 600px) so iPad-portrait / Android tablets get the bento, not a stranded middle tier. **Do not redefine `--breakpoint-sm`** (a track proposed 600px) — it would silently move every existing `sm:` utility in the app; use Tailwind's stock `md:`=768 and `lg:`=1024.

> **Desktop stays neat:** `grid-template-areas` reproduces the Proposal §2.4 arrangement exactly (W1 banner 12 · W2 hero 8 + W3 meta 4 + ⌘K 4 · W4 12 · fold · W5 8 + W8 advisor 4 · W6 6 + W7 6 · W9 8 + W10 4) and is *more* maintainable than 11 scattered `col-*` spans — the layout is one readable map, provably gap-free.

### 2.2 Mobile IA — a priority queue, not a reflow

DOM/source order = mobile priority. Desktop re-places by area **name**, so a different mobile order costs nothing on desktop.

| # | Widget | Mobile treatment |
|---|--------|------------------|
| 0 | **CompanionLauncher** (NEW) | `lg:hidden` full-width "⚡ Score my augments" button, sticky under banner — the 2-second above-fold job |
| 1 | W1 PatchPulseBanner | full-width, sticky-top, dismissible |
| 2 | W2 HeroMover | full-width card, splash cropped 16:9, **static** (no Ken-Burns on phone) |
| 3 | W3 MetaAtAGlance | 2-col chip grid |
| 4 | W4 TierMiniGrid | horizontal snap row (`overflow-x:auto`) |
| — | **fold** | — |
| 5 | W6 FavoritesStrip | **promoted above movers** — a returning player's own champs out-rank generic movers |
| 6 | W5 MoversCarousel | h-snap row |
| 7 | W7 AugmentSpotlight | full-width card |
| 8 | W9 ComboHighlights | `<details>` collapsed on mobile (low glance value); desktop renders open |
| 9 | W8 AdvisorTeaser | soft upsell **below** the working CompanionLauncher |
| 10 | W10 StreakCheckin | lowest |

> **Desktop stays neat:** area-by-name placement means W6-before-W5 in the DOM still renders `mov` left / `fav` below-left on desktop. CompanionLauncher and the W9 `<details>` collapse are `lg:hidden` / open on desktop. **A11y tab-order fix (mandatory):** because desktop visual order ≠ DOM order, add `tabindex` ordering on the desktop bento so keyboard traversal follows reading order — do *not* "accept it." Verify with an axe + keyboard pass in CI.

### 2.3 Thumb-zone navigation

`layout.tsx` line 132 currently renders one top `<main className="...pt-20 pb-12">` under a top Navbar — everything actionable lives at the top, the hardest one-handed reach. We add a **bottom tab bar on mobile**, demote the top nav to a brand bar, and restore the full top broadcast nav at `lg:`.

```css
/* src/components/ui/MobileTabBar.tsx — fixed thumb-zone, safe-area, 44px targets */
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:50;
  display:grid;grid-template-columns:repeat(5,1fr);
  height:calc(56px + env(safe-area-inset-bottom));
  padding-bottom:env(safe-area-inset-bottom);
  background:rgba(10,14,23,.92);backdrop-filter:blur(14px);
  border-top:1px solid var(--color-border-default)}
.tab{display:grid;place-items:center;min-height:44px;font-size:11px;gap:2px;color:var(--color-text-secondary)}
.tab[aria-current=page]{color:var(--color-neon-primary)}
.tab-fab{align-self:center;width:56px;height:56px;border-radius:50%;
  background:linear-gradient(135deg,var(--color-neon-secondary),var(--color-neon-primary));
  display:grid;place-items:center;transform:translateY(-10px);
  box-shadow:0 8px 24px -6px rgba(0,212,255,.5)}
@media (min-width:1024px){.tabbar{display:none}}
```

Targets: `[ Home ] [ Tiers ] ( ⚡ ) [ Augments ] [ Me ]` — center FAB = `/companion`, the live-decision entry, the single most-reachable pixel.

`layout.tsx` line 132 edit (mobile-first padding, reserve tab-bar height so late paint = 0 CLS):

```
BEFORE: <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 pb-12">
AFTER:  <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-14 pb-[calc(64px+env(safe-area-inset-bottom))] lg:pt-20 lg:pb-12">
```

⌘K becomes `hidden lg:flex` (meaningless on a phone); its mobile twin is the Tiers/Augments tabs + a search icon. Navbar link row becomes `hidden lg:flex`.

> **Desktop stays neat:** the entire tab bar is `display:none` at ≥1024px; the `lg:` padding split keeps desktop's `pt-20 pb-12`; the top Navbar + ⌘K + avatar are unchanged.

### 2.4 Fluid type & spacing (additive to `@theme` in `src/styles/globals.css`)

```css
@theme {
  --text-hero: clamp(28px, 7vw, 52px);   /* lower floor for narrow phones */
  --text-h2:   clamp(18px, 4.5vw, 24px);
  --text-stat: clamp(20px, 5vw, 28px);
  --text-body: clamp(13px, 3.6vw, 15px);
  /* labels stay fixed at 11px — never clamp below legibility */
}
/* per-breakpoint spacing in :root (cascades by media) */
:root{--gap:12px;--pad:14px;--radius-bento:14px}
@media(min-width:768px){:root{--gap:14px;--pad:16px}}
@media(min-width:1024px){:root{--gap:16px;--pad:18px;--radius-bento:18px}}
```

### 2.5 Motion & reduced-motion (MANDATORY — repo has **zero** `prefers-reduced-motion` rules today)

```css
/* base reset: ALL motion off under reduced-motion, not just Ken-Burns */
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;
    transition-duration:.001ms!important;scroll-behavior:auto!important}
}
/* Ken-Burns ONLY tablet+desktop with motion allowed — phones never loop-composite on battery */
.hero .art{transform:none}
@media (min-width:768px) and (prefers-reduced-motion:no-preference){
  .hero .art{animation:kenburns 22s ease-in-out infinite alternate;will-change:transform}
}
.hero{min-height:200px}                          /* phone: fast LCP */
@media(min-width:768px){.hero{min-height:280px}}
@media(min-width:1024px){.hero{min-height:340px}}
```

### 2.6 ASCII — PHONE (base, ~390px) vs DESKTOP (≥1024px)

```
PHONE (base, no media query; DOM = priority; tab bar fixed)   DESKTOP (>=1024px, areas re-place by name; tab bar display:none)
+------------------------------+                              +----------------------------------------------------------+
| ==(•live) Patch 26.12  [x]   | W1 sticky                    | ⚡ Mayhem Oracle  Tiers Champs Augs Items Advisor 🔍⌘K JZ |
+------------------------------+                              +----------------------------------------------------------+
| [ ⚡  Score my augments ]    | CompanionLauncher (lg:hidden)| W1 PatchPulseBanner .............. 12col ........ [NEW]   |
+------------------------------+                              +--------------------------------+-------------------------+
| W2 HeroMover [16:9 static]   | 200px, 640w AVIF, no kenburns| W2 HeroMover 8col [ken-burns]  | W3 MetaAtAGlance 4col   |
|  BRAND  S+  #1  55.98% ▲2.1  |                              |  340px, 1920w AVIF             +-------------------------+
+------------------------------+                              |                                | ⌘K trigger cell   4col  |
| W3 Meta [S+ 7][Sett] (2col)  |                              +--------------------------------+-------------------------+
+------------------------------+                              | W4 TierMiniGrid ....... 12col icon row ............      |
| W4 S+/S board > > > (snap)   |                              ==================== FOLD =================================
+----------- fold -------------+                              | W5 MoversCarousel 8col         | W8 AdvisorTeaser 4col   |
| W6 ★ Your champs > > (snap)  | PROMOTED above movers        +--------------------------------+-------------------------+
| W5 Movers > > > (snap)       |                              | W6 FavoritesStrip 6col         | W7 AugmentSpotlight 6col|
| W7 Augment spotlight         |                              +--------------------------------+-------------------------+
| W9 Top combos          [v]   | <details> collapsed          | W9 ComboHighlights 8col (open) | W10 StreakCheckin 4col  |
| W8 Oracle teaser (upsell)    |                              +----------------------------------------------------------+
| W10 Since last visit         |                              (identical to Proposal §2.4)
+==============================+
|Home Tiers ( ⚡ ) Augs   Me   | MobileTabBar, FAB=Companion
+==============================+ 56px + safe-area-inset-bottom
```

---

## 3. Companion Mode (the second-screen hero)

**Decision: a dedicated route `/companion`, not an `/advisor` live-mode toggle.** Justification: it is the PWA launch target and the bottom-tab FAB destination; it must be a thumb-first re-skin with its own ≥44px controls (the inherited `/advisor` form uses `h-9 w-9`=36px buttons, `py-2` rows, a native number input and checkbox — all sub-44px), and it must keep `/advisor`'s desktop research form untouched. It is a **new client of the same gated engine**, never a fork.

### 3.1 The timed live loop (tap counts, seconds-to-verdict)

```
WARM (game 2+, champion sticky from localStorage):
  open (FAB / home-screen icon)  →  tap aug#1  →  tap aug#2  →  tap aug#3  ⇒ AUTO-FIRE evaluate
  = 3 taps. Target: p50 < 4s, p95 < 8s to verdict.
NEXT ROUND:  1 tap "Next ▸"  (round++, offered cleared, auto-advance VISIBLE & confirmable)
COLD (first game):  +1 tap to pick champion from recent row  = 4 taps first verdict.
Per game ≈ 12 taps (3×4 rounds) vs ~40 on /advisor.
```

No separate Evaluate button — verdict auto-fires on the 3rd augment tap (250ms debounce + one-tap "undo last" for a mis-tap). Round/rarity default to 1/silver and auto-advance, but **the active R/rarity chip is always visible and echoed on the verdict** ("Ahri · R2 · GOLD"); a manual rarity change **pauses auto-advance** for that game so the loop can never silently evaluate a stale context.

### 3.2 One-handed, dark-room UI (ASCII)

```
OFFERED STATE (warm, ~3 taps left)              VERDICT STATE (2-second glance)        LOCKED NON-MEMBER (fail-closed)
+--------------------------------+              +--------------------------------+      +--------------------------------+
| Ahri · Competitive       [⚙]   |              |  Ahri · R2 · GOLD     Next ▸   |      |  Ahri · R2 · GOLD              |
| Round (2) auto   Rarity GOLD   | <- visible   |   ( S )   ( B )   ( C )         |      |   ( ?? )  ( ?? )  ( ?? )        | <- CSS-blur
|  pick the 3 you were offered   |    chips     |   Lethal  Gusto  Ironclad      |      |   Lethal  Gusto  Ironclad      |    placeholders
| +------+ +------+ +------+      |              |    HOT    steady   weak        |      |   (public catalog names only;  |
| |[icon]| |[icon]| |[icon]| ★fav | 96px tiles,  |   ▸ reasons / warnings (tap)    |      |    NO DecisionResult sent)     |
| |Lethal| |Gusto | |Iron..|      | MRU floated  +================================+      +================================+
| +------+ +------+ +------+      |              | [✓ KEEP]  ·  Lethal Tempo      | <-   | 🔒 Unlock live verdicts        |
| (type to filter long tail)     |              +--------------------------------+      |    used every game  [ Sign in ]|
+--------------------------------+              shape+color-coded pill, not color-only   +--------------------------------+
```

**Glanceability fixes folded in:** stance is **shape-coded** (filled pill + glyph: ✓ keep / ↻ reroll / ★ golden / ~ consider) so KEEP-green does not collide with an "average"-grade green ring or REROLL-red with a "HOT"-red ring — passes the dark-room + colorblind 2s read. Verdict word ≥28px static; reasons collapsed behind a chevron. **Augment input is icon-first cards, not a 256-row scroll list:** the grid is rarity-filtered (gold 96 / silver 73 / prismatic 87 — measured) with the player's recent/favorite slugs (localStorage MRU) floated to top and an auto-focused type-ahead pinned above — reaching the 3 offered augments is recognition, not scroll-hunt. Every interactive element (tiles, round chips, gear, chevron) is **≥44px (≥56px primary)** with ≥8px spacing.

### 3.3 Friction killers

- **Sticky champion + MRU augments** → localStorage (`mo.companion.*`); game 2+ skips champion. Always allow re-pick (iOS may evict after ~7d; cost = 1 tap).
- **Wake Lock** → `navigator.wakeLock.request('screen')` on entering `/companion`, re-acquire on `visibilitychange`. Works Android Chrome + iOS 16.4+ standalone. **Honest fallback:** older iOS has no reliable wake lock — show a visible "Keep screen on" toggle (default ON in standalone, OFF in a tab) and **persist the last verdict to sessionStorage** so a wake-from-lock lands back on the result instantly, clearly labeled stale and cleared on any champ/round/rarity change.
- **A2HS** → Android `beforeinstallprompt` custom button after one successful verdict; iOS (no prompt) shows a one-time Share→Add-to-Home-Screen coachmark, detected via `navigator.standalone === false`.

### 3.4 Membership states (fail-closed)

`/companion/page.tsx` gates with the same `readAdvisorAccess` as `/advisor`, ships only the **public slim catalog** (§4). **Unlocked member:** full 3-tap loop + grade rings + stance. **Locked non-member (401/403 from `/api/decision/evaluate`):** the user can still tap champion + 3 augments (catalog slugs are public), but the verdict zone shows **pure-CSS blurred placeholder rings** + a "Sign in to score" CTA — **no real `DecisionResult` is ever sent**, identical to `handleEvaluate`'s existing 401/403 path → reuse `<MembershipGate>`. **Trial:** if and only if `requireEntitlement` (`src/lib/api/decision.ts`) recognizes a trial entitlement-kind granted server-side; **do NOT borrow the overlay's `/api/overlay/game-session` lease** — that would import the compliance surface. If no such kind exists, v1 ships locked-state-only and trial is Phase 2.

### 3.5 Relation to the Tauri overlay (compliance-safe twin)

Both the phone companion and `overlay/` do the same between-rounds job and are **two clients of one gated engine**. `/companion` imports **only** `requestDecision()` from `src/lib/membership/decision-client.ts` → `POST /api/decision/evaluate`; it **never imports `src/lib/scoring/` or `evaluateDecision`**. So cross-parity budget stays 0 *by construction* (server is the single verdict source for web, overlay, and companion — `src/lib/__tests__/cross-parity.test.ts` remains the contract). The human reads the public augment offer off their own screen and types it in: **no game-memory read, no injection, no hidden info** — categorically safer than any same-machine overlay (`CLAUDE.md` compliance rule satisfied). Optional Phase-2 same-user sync may reuse the existing `/api/device/code` + `/api/device/link` flow for sticky champ/round **only** — never to read the live game; enforce by keeping companion's imports limited to `decision-client.ts`.

---

## 4. Mobile performance, PWA & offline

### 4.1 Budget table (CI-enforced; two LHCI presets — mobile is the binding gate)

Mobile preset = Moto-G-class, 4× CPU throttle, Slow-4G (1.6 Mbps / 150 ms RTT).

| Surface | LCP | INP | CLS | route JS gz | top image | above-fold widgets |
|---|---|---|---|---|---|---|
| `/companion` — **mobile** | ≤2.5s | ≤200ms | ≤0.05 | ≤45KB | none (text/SVG verdict) | n/a |
| `/companion` — desktop | ≤2.0s | ≤200ms | ≤0.05 | ≤55KB | none | n/a |
| `/` dashboard — **mobile** | ≤2.8s | ≤200ms | ≤0.05 | ≤55KB | ≤55KB AVIF **static** | 4 (W1–W4) |
| `/` dashboard — desktop | ≤2.3s (Proposal §8) | ≤200ms | ≤0.05 | ≤55KB | ≤80KB AVIF, Ken-Burns OK | up to 6 |
| Global shared first-load JS | **mobile ≤170KB** / desktop ≤180KB | | | | CJK webfont = **0KB** (Contract: no CJK webfont) | |

**Scales DOWN on phones:** Ken-Burns off (static 16:9 splash), 640w AVIF not 1920w, 4 above-fold widgets, W9 collapsed, `content-visibility:auto;contain-intrinsic-size:auto 200px` on below-fold rows, dim-mode option. **Desktop keeps** the full cinematic treatment plugged-in.

### 4.2 Exact cold-download bytes (re-measured from real `public/data/` — corrects both tracks)

- `abilities.json` **1,789,451 B**, `items.json` **513,019 B**, `augments.json` **202,955 B**, `champions.json` **173,211 B** (verified `ls`).
- **Companion / advisor slim picker projections (measured):** augments `{slug,displayName,rarity}` = **18,806 B** raw (256 rows); champions `{slug,name,icon}` = **26,026 B** raw (172 rows) → **~45KB raw embedded → ~13–16KB gz**.
- **Companion cold over Slow-4G** = server HTML + ~13–16KB gz picker + ~45KB gz route JS + ~170KB gz shared ≈ **~230KB gz / ~1.5s TTI**. Per verdict: `POST` body ~0.3KB, `DecisionResult` response ~1–3KB. **Zero** `abilities.json`/`items.json`.
- **CI assertions (mandatory):** (1) a slim `public/data/companion-catalog.json` build artifact (`{slug,name,localizedNames,rarity,iconSlug}` only) with a size-budget test (**fail build > 35KB gz**); companion loads *this*, never full `augments.json`/`champions.json`. (2) A traced-chunk assertion that **neither `abilities.json` nor `items.json` appears in the `/` or `/companion` server chunks** — `public-loader.ts` statically imports all 8 JSON in a barrel, so this is regressable the moment any new widget calls `loadPublicJson`.

### 4.3 Augment icons — self-host, never hot-link

The icon grid is the primary input. `augments.json` icons are remote `https://arammayhem.com/...webp` — fetching ~96 cross-origin webp mid-game over shared wifi is an LCP/INP/reliability hazard. **Build step downloads the set to `public/data/icons/augments/<slug>.webp` (48px + 96px), references local paths, `loading="lazy"` + explicit `width`/`height` to reserve the box (0 CLS).** Third-party CDN availability is never a mid-fight dependency.

### 4.4 PWA install & iOS reality

- **Generate `public/icons/` NOW** (blocking — the dir does not exist, so manifest `icon-192`/`icon-512` 404 today, breaking A2HS on both platforms and the home-screen-icon warm path). Via sharp in the daily Action: `icon-192.png`, `icon-512.png`, **`maskable-512.png` (≥20% safe-zone)** — split the current combined `"purpose":"any maskable"` (manifest lines 18, 24) into separate `any` + `maskable` entries. Add `icon-180.png` + `<link rel="apple-touch-icon">` in `layout.tsx` head (iOS ignores manifest icons). Add per-device `<link rel="apple-touch-startup-image">` (dark #0a0e17 + logo) to kill the iOS white launch flash.
- **manifest:** keep `start_url:"/"`; **add** `{name:"Companion",short_name:"Live",url:"/companion"}` to the existing `shortcuts[]`. Do **not** reuse `og.png` (149KB) as the hero — generate a separate ≤55KB AVIF.
- **iOS honesty (state explicitly, do not promise around):** no `beforeinstallprompt` / no programmatic install; the **standalone PWA has a separate storage jar** — a Supabase session in Safari does **not** carry into the installed app, so `/companion` must work logged-out (picker + clear "Sign in to score") and re-auth inside the standalone context; SW cache may be evicted on storage pressure → offline is best-effort on iOS, not guaranteed; Wake Lock unreliable pre-16.4 (§3.3 fallback).

### 4.5 Minimal $0 service worker (`public/sw.js`, hand-written, no Workbox)

```js
const SHELL=['/','/companion','/manifest.json','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open('shell-v1').then(c=>c.addAll(SHELL))));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api/decision/'))return;               // NETWORK-ONLY: gated verdict never cached (Contract: fail-closed, no stale/leaked verdict)
  if(u.pathname.startsWith('/data/')||u.pathname.startsWith('/icons/')){ // stale-while-revalidate
    e.respondWith(caches.open('data-v1').then(async c=>{const hit=await c.match(e.request);
      const net=fetch(e.request).then(r=>{c.put(e.request,r.clone());return r;});return hit||net;}));return;}
  e.respondWith(fetch(e.request).catch(()=>caches.match('/')));    // nav: network-first, shell fallback
});
```

Catalog + shell are safely stale-served (improves glanceability on a wifi blip); the **gated verdict stays online and fail-closed** (caching it would both leak and mislead). Register only in production.

### 4.6 INP & rate-limit handling (folded fixes)

- **INP:** the picker is rarity-filtered (≤96 rows), already inside a 192px `max-h-48 overflow-y-auto` scroller that resets `offered` on rarity change — so it does **not** need windowing. Apply `content-visibility:auto;contain-intrinsic-size:auto 44px` to the offerable rows for a cheap paint win. Build `nameBySlug` + a `rarity→augments` index **once on mount**, not a per-tap `useMemo` over 256. Add a scripted companion-flow INP trace to the mobile LHCI run — measured, not asserted.
- **429 (real: `EVALUATE_LIMIT = 30/min`, `decision.ts` lines 30/57/117, returns `Retry-After`):** auto-fire + the existing `retryAfterSeconds` in `decision-client.ts` must render a **distinct "one more sec — retry in Ns" countdown state**, separate from offline/network error, keeping the last verdict visible and respecting `Retry-After` (no retry storm). New i18n keys in all 5 `messages/*.json`.

---

## 5. Concrete change list (ordered; S/M/L)

**Foundation (do first — unblocks A2HS & honesty claims):**

1. **L** — `.github/workflows/*` (daily Action) + sharp step: generate `public/icons/{icon-192,icon-512,maskable-512,icon-180}.png` + apple-touch-startup-image set; generate `public/data/icons/augments/<slug>.{48,96}.webp`; generate slim `public/data/companion-catalog.json`. (`public/data/` stays generated, never hand-edited — Contract.)
2. **S** — `public/manifest.json`: split `any maskable` → two entries; add `maskable-512`; add Companion shortcut.
3. **S** — `src/styles/globals.css`: add `@media (prefers-reduced-motion: reduce)` global reset + the `@theme` fluid-type tokens + per-breakpoint `:root` spacing vars (§2.4–2.5).
4. **S** — `src/app/[locale]/layout.tsx`: line 132 mobile-first `<main>` padding; add `apple-touch-icon` + startup-image `<link>`s; Navbar links → `hidden lg:flex`; ⌘K → `hidden lg:flex`; render `<MobileTabBar/>` after `<Footer/>`; register SW (prod only).
5. **S** — `public/sw.js`: new (§4.5).

**Mobile-first architecture:**

6. **M** — `prototype/dashboard.html`: delete the two `max-width` collapse blocks; invert to mobile-base `1fr` + `min-width:768/1024` enhancement with `grid-template-areas` (§2.1); add a working **"⚡ Score my augments" link that opens a `/companion` mock the user can load on their phone**; gate Ken-Burns to `≥768px + no-preference`; cap mobile hero 200px / 640w.
7. **M** — `src/app/[locale]/page.tsx` + `BentoCell.tsx`: `grid-cols-1 → md:grid-cols-6 → lg:grid-cols-12`, `lg:`-prefixed spans, `area` prop → `w-{area}` class, mobile priority DOM order (§2.2), desktop `tabindex` reading-order fix.
8. **M** — `src/components/ui/MobileTabBar.tsx`: new, `lg:hidden`, 44px targets, FAB → `/companion`.
9. **S** — `src/components/companion/CompanionLauncher.tsx`: new, `lg:hidden` dashboard button.

**Companion:**

10. **L** — `src/app/[locale]/companion/page.tsx` (server, `readAdvisorAccess` gate, ships `companion-catalog.json`) + `CompanionClient.tsx` (3-tap auto-fire loop, sticky champ, calls `requestDecision()` only — **no scoring import**) + `CompanionVerdict.tsx` (SVG grade rings + shape-coded stance pill; reusable on desktop `/advisor`) + `AugmentIconGrid.tsx` (rarity-filtered, MRU float, type-ahead, ≥44px tiles, lazy self-hosted icons).
11. **S** — `src/lib/companion/sticky.ts` (localStorage) + `wake-lock.ts` (capability-guarded + sessionStorage last-verdict persistence).
12. **S** — i18n: companion + 429 + keep-awake + locked-state keys in **all 5** `messages/*.json` (key-parity test — Contract); island strings passed as props (Proposal §8.5) to avoid bundle growth.

**A11y / shared-flow corrections to existing code:**

13. **S** — `src/components/advisor/AdvisorMemberClient.tsx`: line 168 `<main>` → `<section>` (fix nested-landmark with `layout.tsx` line 132); line 217 round buttons `h-9 w-9 → min-h-11 min-w-11`; selects `py-2 → py-3`; add `content-visibility` to the offerable rows.

**CI:**

14. **M** — LHCI: add the mobile preset column (§4.1) as the binding gate; add the slim-catalog size-budget test and the `abilities.json`/`items.json` absence assertion on `/` + `/companion` chunks.

---

## 6. Roadmap delta (mobile-first moves early — not a polish pass)

Re-orders Proposal §Phase 1–4:

- **Phase 1 (foundation) — now also owns mobile-first.** Changes 1–7 + 13–14 ship here. *Success:* mobile `/` LCP ≤2.8s + INP ≤200ms on low-end-Android LHCI; CLS ≤0.05 with the bottom bar painting late; A2HS works on Android + iOS (icons no longer 404); axe + keyboard pass clean (one `<main>`, ≥44px targets, reading-order tab sequence); CI proves `abilities.json` absent from `/` chunk.
- **Phase 2 (Companion hero) — promoted ahead of secondary widgets.** Changes 8–12. *Success:* warm-path **verdict in ≤3 taps / p95 ≤8s on Slow-4G**; companion cold load ≤230KB gz / ≤2.5s LCP; route JS ≤45KB gz; slim catalog ≤35KB gz; locked state sends **zero** `DecisionResult` (test); cross-parity budget stays **0** (companion imports `decision-client.ts` only).
- **Phase 3 (offline + install polish).** `public/sw.js` SWR for catalog/shell, wake-lock + sessionStorage last-verdict, A2HS prompts, 429 countdown state. *Success:* wifi-drop mid-round still renders picker + last verdict (labeled stale); 429 shows countdown not blank; iOS standalone re-auth path works.
- **Phase 4 (desktop cinematic + tablet).** Restore full Ken-Burns/1920w on desktop, ≥768px tablet bento. *Success:* desktop LCP ≤2.3s with Ken-Burns; iPad-portrait gets the 6-col bento, not a stranded tier.

---

## 7. Open questions

1. **Trial entitlement:** does `requireEntitlement` (`src/lib/api/decision.ts`) already recognize a server-granted trial kind? If not, v1 ships locked-state-only and trial is Phase 2 (we will **not** borrow the overlay `game-session` lease). Confirm.
2. **iOS standalone auth:** acceptable for v1 that `/companion` works logged-out (picker + "Sign in to score" re-auth inside the standalone app), given the Supabase session does not carry from Safari? Or do you want a Phase-1 standalone sign-in handshake?
3. **Hero art pipeline:** is there a licensed champion-splash source + sharp AVIF step to build, or should W2 HeroMover stay text+gradient (better LCP anyway) until one exists?
4. **`start_url`:** keep `"/"` (SEO/share) with a prominent Companion shortcut + FAB, or set `start_url:"/companion"` so standalone launches straight into live mode (and `/` is reached via the tab bar)?