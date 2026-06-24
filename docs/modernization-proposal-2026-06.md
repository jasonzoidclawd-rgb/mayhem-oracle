# Mayhem Oracle — Modernization Proposal: Integrated Broadcast Dashboard, Front-End & $0 Back-End

> **Lead architect synthesis.** This document folds every adversarial verdict adjustment into a single buildable plan. Where a track's headline claim was proven false (the splash URL, the Server-Component `dynamic(ssr:false)` pattern, the "Inter never loaded" premise, the i18n key count, the freemium "free transport" fix, the Vercel image-optimizer-is-free assumption), the corrected version is already the design — not a footnote.

---

## 1. Executive summary

Mayhem Oracle today is a fast but inert encyclopedia: a static hero, four stat cards, no daily-return loop, and a visual system that stops well short of the "premium esports broadcast" target. This proposal makes **one integrated command-center dashboard the new home (`/`)** — a broadcast-style "pre-show" that summarizes and deep-links into every surface (tier-list, champions, augments, items, advisor, damage-sim, patch-notes) and layers on the retention mechanics the audit found entirely missing: a patch-day "what moved" moment, localStorage favorites, a daily check-in, and shareable cards. The cinematic feel is paid for at **build time and on the GPU compositor**, never on the main thread or the network critical path: a static server shell ships an instant LCP, all motion is CSS + IntersectionObserver gated behind `prefers-reduced-motion`, and the dashboard never imports the 1.79 MB `abilities.json`. Everything stays inside the existing `$0` envelope — static JSON, Vercel, Supabase free tier, the daily 22:00 UTC cron — with **build-time pre-baked images instead of the Vercel image optimizer** (which is non-commercial-only on Hobby and this site runs AdSense). Scoring parity, engine purity, and the generated-data contract are untouched; every new artifact is pipeline-owned. The retention loop reuses the existing nightly scrape as its supply side and turns it, for the first time, into something users can see.

**Before → After**

| | Before | After |
|---|---|---|
| Home `/` | Static hero + 4 StatCards; no patch link, nothing changes day-to-day | Broadcast command-center: patch pulse, hero mover, meta-at-a-glance, tier grid, movers, favorites, advisor teaser, ⌘K search |
| Daily-return trigger | None | "8 champs moved this patch" + "your followed champ jumped S→S+" + optional Web Push |
| Visual language | 95-line blitz.gg clone, no display font, no motion | Broadcast tokens, Latin display face, compositor-only reveals, unified tier scale |
| Heaviest payloads | damage-sim ships ~1.4 MB twice; tier-list 824 KB HTML | Build-time projections; damage-sim segment <120 KB; tier-list shell slimmed |
| Images | 24 `unoptimized` raw-CDN, zero `priority` | Pre-baked AVIF/WebP static assets, one `priority` LCP per route |
| Observability | None | `@vercel/speed-insights` + web-vitals + CI Lighthouse budget gate |

---

## 2. The integrated dashboard (centerpiece)

### 2.1 Stance: the dashboard *is* the new `/`

We replace the contents of `src/app/[locale]/page.tsx` rather than adding a `/dashboard` route. Rationale: the current home is the lowest-value, most-visited URL and the PWA `start_url`; a separate route would fork the landing/OG/i18n surface and leave `/` a dead marketing page. The ⚡ logo keeps routing to `/`. The seven feature pages stay as drill-down destinations; the dashboard is the glance layer that funnels into them. The only Navbar change is a **⌘K search trigger** left of the account icon (Surgical-Changes principle).

### 2.2 Widget inventory & information architecture

Ordered by glance-value in <5 s. **Above the fold = server-rendered, zero client JS. Below the fold = lazy client islands.**

| # | Widget | Fold | Boundary | Deep-links to | Data source |
|---|---|---|---|---|---|
| W1 | **PatchPulseBanner** — "Patch 26.12 is live · 8 champs moved up" | Above | Server | `/patch-notes` | `patch-notes.json` + `changes.json` |
| W2 | **HeroMover** — #1 S+ champ, full-bleed art, grade + WR delta (the LCP) | Above | Server | `/champions/[slug]` | `champions.json` (rank 1) + `changes.json` |
| W3 | **MetaAtAGlance** — S+ count, biggest riser, augment of the patch, last-updated | Above | Server | mixed | `champions.json` + `changes.json` + `meta.json` |
| W4 | **TierMiniGrid** — compact S+/S icon row (top ~12) | Above | Server | `/tier-list` | `champions.json` (projection) |
| ⌘K | **CmdKSearch** — global palette over champions/augments/items | Global | Client (lazy) | all detail pages | `search/index.json` (loaded on open) |
| W5 | **MoversCarousel** — horizontal scroll, B→A delta chips | Below | Client island | `/tier-list`, `/champions/[slug]` | `changes.json` |
| W6 | **FavoritesStrip** — "Your Champions"; highlights followed movers | Below | Client island (`ssr:false`) | `/champions/[slug]` | `localStorage` ∩ slim champ map ∩ `changes.json` |
| W7 | **AugmentSpotlight** — augment of the patch + 3 prismatic picks | Below | Server | `/augments` | `augments.json` + `combos.json` teaser |
| W8 | **AdvisorTeaser** — static-sample verdict + unlock CTA | Below | Client island | `/advisor`, `/account` | `GRADE_TOKENS` (static sample only) |
| W9 | **ComboHighlights** — top S-tier combos (joined to champ icons) | Below | Server | `/champions/[slug]` | `combos.json` ⋈ `champions.json` |
| W10 | **StreakCheckin** — "new since your last visit"; member "continue" | Below | Client island (`ssr:false`) | `/account`, `/advisor` | `localStorage` + (members) `decision_sessions` |

**Critical data-wiring fixes folded in:**

- **No widget reads `abilities.json` or `items.json`.** The damage-sim widget is a static teaser link, not a live calculator.
- **`combos.json` is NOT render-ready.** It is a flat list of `{champion, augment, tier}` strings with no icons. W9/W5/W2 build a server-side `{slug → {name, icon, tier}}` map from `champions.json` and join by lowercased champion name. This join is explicit in the spec.
- **W8 ships only a static, hand-authored sample verdict + grade-token rings.** No real `DecisionResult` ever reaches an unauthenticated client. The "one free evaluation" idea is **explicitly rejected** to preserve fail-closed gating (HARD CONTRACT #4). Members still get the real gated `/api/decision/evaluate` path inside `/advisor`, not on the dashboard.

### 2.3 The server/client boundary (the CWV story — corrected)

The original track proposed calling `dynamic(() => import(...), { ssr:false })` **inside the Server Component `page.tsx`**. This is illegal in the Next 16 App Router and will not build. **Corrected pattern:**

```
src/app/[locale]/page.tsx                 (SERVER)
  ├─ reads small JSON via a dedicated fs/promises reader (NOT loadPublicJson)
  ├─ renders W1,W2,W3,W4,W7,W9 directly (server, zero client JS)
  └─ renders <DashboardIslands movers={...} favSlim={...} sample={...} />
src/components/dashboard/DashboardIslands.tsx   ('use client')
  └─ const FavoritesStrip = dynamic(() => import('./FavoritesStrip'), { ssr:false, loading: Skeleton })
     const StreakCheckin  = dynamic(() => import('./StreakCheckin'),  { ssr:false, loading: Skeleton })
     const MoversCarousel = dynamic(() => import('./MoversCarousel'))   // SSR ok; thin motion wrapper
     const AdvisorTeaser  = dynamic(() => import('./AdvisorTeaser'))
     const CmdKSearch     = dynamic(() => import('./CmdKSearch'))       // index.json fetched on open only
```

`ssr:false` is only legal inside a `'use client'` file — that is `DashboardIslands.tsx`. `page.tsx` passes only KB-sized serializable props.

**Loader fix (load-bearing):** `src/lib/data/public-loader.ts` is a synchronous static-import module that pulls **all eight** JSON files — including `abilities.json` (verified 1,789,451 bytes) — into one shared module map. Any page calling `loadPublicJson()` drags that 1.79 MB into its server module graph. The dashboard therefore uses a **separate reader**:

```ts
// src/lib/data/read-public-file.ts  (server-only)
import { readFile } from "node:fs/promises";
import path from "node:path";
export async function readPublicFile<T>(name: string): Promise<T> {
  const raw = await readFile(path.join(process.cwd(), "public", "data", name), "utf8");
  return JSON.parse(raw) as T;
}
```

A build assertion inspects the dashboard page chunk to confirm `abilities.json` is absent from its graph — a verifiable test, not a claim.

### 2.4 Responsive broadcast bento grid

**Desktop (12-col, inside `max-w-7xl`):**
```
+----------------------------------------------------------+
| W1 PatchPulseBanner ............ 12col, h~64px ... [NEW]  |
+--------------------------------+-------------------------+
| W2 HeroMover  8col  (LCP)      | W3 MetaAtAGlance  4col  |
|   pre-baked AVIF splash, scrim |  2x3 stat readouts      |
|   grade + WR-delta, kenburns*  +-------------------------+
|                                | ⌘K trigger       4col   |
+--------------------------------+-------------------------+
| W4 TierMiniGrid ........ 12col S+/S icon row ........... |
==================== FOLD (≈900px) ========================
| W5 MoversCarousel 8col scroll  | W8 AdvisorTeaser  4col  |
+--------------------------------+-------------------------+
| W6 FavoritesStrip 6col         | W7 AugmentSpotlight 6col|
+--------------------------------+-------------------------+
| W9 ComboHighlights 8col        | W10 StreakCheckin  4col |
+----------------------------------------------------------+
```

**Tablet (`md`, 6-col):** W2 spans 6 at `h-[320px]`; W3 drops below it as a 3-across readout row; W4 full width; the 8/4 and 6/6 pairs stack to full where needed.

**Mobile / PWA (single column, IA order):**
```
W1 (sticky, dismissible)
W2  16:9 cropped splash, h-[220px], object-cover top focal
W3  2-col chip row
W4  scrollable icon row
---- fold ----
W5  overflow-x-scroll snap (broadcast lower-third feel)
W6 → W7 → W8 → W9 (h-scroll) → W10  full-width cards
```

`*` Ken-Burns is a **transform-only `scale` animation on a `will-change:transform` layer**, capped duration, inside `@media (prefers-reduced-motion: no-preference)`. Delta "count-ups" are **replaced by statically rendered numbers** with an optional opacity-only reveal — count-up animates text and risks INP/CLS on mobile for negligible payoff. SSR renders the final number, never `0`.

### 2.5 Route + component tree

```
src/app/[locale]/page.tsx            (SERVER — replaces current home)
src/components/dashboard/
  PatchPulseBanner.tsx   (server)
  HeroMover.tsx          (server; pre-baked <Image unoptimized> or <img srcset>, priority, w/h)
  MetaAtAGlance.tsx      (server)
  TierMiniGrid.tsx       (server)
  AugmentSpotlight.tsx   (server)
  ComboHighlights.tsx    (server; joins combos.json → champions map)
  DashboardIslands.tsx   ('use client'; hosts all dynamic(ssr:false) calls)
  MoversCarousel.tsx     (client)
  FavoritesStrip.tsx     (client)
  AdvisorTeaser.tsx      (client; static sample only)
  StreakCheckin.tsx      (client)
  CmdKSearch.tsx         (client; fetch index.json on open)
  BentoCell.tsx          (server wrapper; .glass-card/.bento-cell)
  RevealMotion.tsx       (client; reduced-motion-gated IO wrapper)
```

---

## 3. Viewable prototype spec (`prototype/dashboard.html`)

A **single self-contained file**, no build step, opens directly in a browser — the Phase-1 quick win that secures design sign-off before any app code. Build it exactly from this spec.

**Structure:** one `<style>` block (tokens + layout + motion), one `<script>` with inline `MOCK`, a vanilla `renderDashboard()` that injects all ten widgets, plus the ⌘K trigger. Plain `<img>` (CDN) for look only.

**Tokens to inline verbatim in `:root` (copied from `globals.css` @theme + `grade-tokens.ts`):**
```css
:root{
  --bg-primary:#0a0e17; --bg-secondary:#111827; --bg-card:#1a1f2e; --bg-stage:#05070d;
  --neon-primary:#00d4ff; --neon-secondary:#7c3aed;
  --tier-god:#ff4655; --tier-strong:#ff8c00; --tier-good:#3b82f6; --tier-avg:#22c55e; --tier-weak:#6b7280;
  --rarity-prismatic:#c896ff;
  --grade-hot:#fbbf24; --grade-strong:#34d399; --grade-steady:#38bdf8; --grade-average:#94a3b8; --grade-weak:#fb7185;
  --mover-up:#34d399; --mover-down:#fb7185; --mover-new:#fbbf24;
  --radius-card:14px; --radius-bento:18px;
  --ease-broadcast:cubic-bezier(.16,1,.3,1);
}
.glass-card{background:rgba(26,31,46,.6);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.08);border-radius:var(--radius-card)}
.bento-cell{border-radius:var(--radius-bento);border:1px solid rgba(255,255,255,.08)}
.scrim{background:linear-gradient(180deg,transparent,rgba(10,14,23,.85))}
.delta-up{color:var(--mover-up)} .delta-down{color:var(--mover-down)}
@media (prefers-reduced-motion: no-preference){
  @keyframes reveal{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes kenburns{from{transform:scale(1)}to{transform:scale(1.06)}}
  .reveal-on-view{animation:reveal .5s var(--ease-broadcast) both}
  .hero-kenburns{animation:kenburns 18s ease-in-out infinite alternate}
}
```

**Layout:** `display:grid; grid-template-columns:repeat(12,1fr); gap:16px` → `@media(max-width:768px){grid-template-columns:repeat(6,1fr)}` → `@media(max-width:640px){grid-template-columns:1fr}`, matching §2.4.

**Mock data (verified real values):**
```js
const MOCK = {
  patch: "26.12", lastUpdated: "Jun 22",
  summary: { up: 8, down: 5, new: 0 },
  heroMover: { name: "Brand", slug: "brand", tier: "S+", wr: 55.98, wrDelta: +2.1,
    // prototype-only image; real route uses pre-baked asset, see §7
    splash: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/63.png" },
  meta: { splus: 7, riser: "Sett", augOfPatch: "Tank Engine" },
  movers: [
    { name:"Brand", from:"S",  to:"S+", d:+2.1 },
    { name:"Ziggs", from:"A",  to:"S",  d:+1.4 },
    { name:"Sett",  from:"B",  to:"A",  d:+0.8 },
    { name:"Yasuo", from:"S",  to:"A",  d:-1.2 }
  ],
  augmentSpotlight: { name:"Tank Engine", rarity:"gold" },
  favorites: ["brand","ziggs"],
  sampleVerdict: { pick:"Brand", grade:"hot" }   // static marketing sample, not engine output
};
```
*(Brand = real rank-1 S+ at 55.98% WR; 7 S+ champs; Tank Engine = real gold augment; 172 champions / 255 augments / 441 combos.)*

**Widgets the prototype renders:** all of W1–W10 + ⌘K trigger. Each prototype section carries a build-spec comment, e.g. `<!-- W2 HeroMover → src/components/dashboard/HeroMover.tsx -->`. Hero uses `.hero-kenburns`; cards use `.reveal-on-view` — both gated, so the reduced-motion contract is visible from day one. **Tier chip mapping must be present** (`S+→tier-god, S→tier-strong, A→tier-good, B→tier-avg, C→tier-weak, D→tier-weak`) — there is no `.tier-S+` class.

---

## 4. Design language

### 4.1 Tokens (`src/styles/globals.css` @theme) — additive, unified

The audit's "Inter never loaded" claim is **stale** — `layout.tsx:2,17–20` already loads Inter via `next/font/google` with `--font-inter`, and `globals.css` body already carries the CJK fallback chain. **We do not re-implement body fonts or add `html[lang=...]` rules** (they would collide). Net-new is only a display face. We also collapse the three forked tier-color definitions into one token map.

```css
@theme {
  --color-bg-stage: #05070d;
  /* ONE tier source — refactor ChampionsIndex TIER_COLOR/TIER_BG + TierListClient to read these */
  --tier-god:#ff4655;    --tier-god-bg:rgb(255 70 85/.15);   --tier-god-border:rgb(255 70 85/.30);
  --tier-strong:#ff8c00; --tier-strong-bg:rgb(255 140 0/.15);--tier-strong-border:rgb(255 140 0/.30);
  --tier-good:#3b82f6;   --tier-good-bg:rgb(59 130 246/.15); --tier-good-border:rgb(59 130 246/.30);
  --tier-avg:#22c55e;    --tier-avg-bg:rgb(34 197 94/.15);   --tier-avg-border:rgb(34 197 94/.30);
  --tier-weak:#6b7280;   --tier-weak-bg:rgb(107 114 128/.15);--tier-weak-border:rgb(107 114 128/.30);
  /* mover deltas */
  --color-mover-up:#34d399; --color-mover-down:#fb7185; --color-mover-new:#fbbf24;
  /* elevation + ONE glow discipline (one glowing region per viewport, via `featured` prop) */
  --shadow-stage: inset 0 1px 0 rgb(255 255 255/.04), 0 8px 32px -8px rgb(0 0 0/.6);
  --glow-hot: 0 0 0 1px rgb(255 70 85/.35), 0 0 24px -4px rgb(255 70 85/.5);
  --grad-stage: radial-gradient(120% 120% at 50% 0%, var(--color-bg-primary) 0%, var(--color-bg-stage) 100%);
  --grad-glass: linear-gradient(180deg, rgb(255 255 255/.06), rgb(255 255 255/.01));
  /* display face — Latin glyphs only; CJK tail MUST be appended so headings never drop to bare system-ui */
  --font-display: var(--font-broadcast), var(--font-inter), system-ui,
    "PingFang TC","PingFang SC","Microsoft JhengHei","Hiragino Sans",
    "Noto Sans CJK TC","Noto Sans CJK SC","Noto Sans CJK JP","Noto Sans CJK KR", sans-serif;
  /* motion */
  --ease-broadcast:cubic-bezier(.16,1,.3,1); --ease-snap:cubic-bezier(.34,1.56,.64,1);
  --dur-base:240ms; --dur-reveal:480ms; --dur-cinematic:720ms; --stagger-step:60ms;
}
.stat-readout,.tier-letter{ font-family:var(--font-display); font-variant-numeric:tabular-nums; }
```

**Two intentionally separate scales** (document so they don't get re-merged): **TIER** (catalog/meta rank, the unified tokens above) vs **GRADE** (engine verdict, `src/lib/membership/grade-tokens.ts`, **parity-locked, DO NOT EDIT** — its `accent` hexes feed the overlay canvas and OG cards; editing forks `cross-parity.test.ts`, budget 0).

`grade-tokens.ts` is left byte-identical. Refactoring `ChampionsIndex.tsx` tier maps to the unified tokens must keep the S+/S/A/B/C/D→color mapping byte-identical (pure token swap, no visible change).

### 4.2 Typography — display face, CWV-safe, no CJK webfont

One self-hosted display face via `next/font/local` (e.g. a condensed grotesk), **Latin + digits + tier-letter subset only, target ≤15 KB woff2**, `display:swap`, with **`size-adjust`/`ascent-override` matched to the fallback** so the swap causes no CLS. CJK locales (zh-TW, zh-CN, ja, ko) ship **zero** display webfont — headings fall through the CJK tail in `--font-display`. Subset MUST include `0-9 % + S A B C D` because numerals/tier letters are the scoreboard identity across all 5 locales.

```ts
// layout.tsx — ADD alongside existing Inter (do not touch Inter)
import localFont from "next/font/local";
const broadcast = localFont({
  src: "../../../public/fonts/Broadcast-Subset.woff2",
  variable: "--font-broadcast", display: "swap", weight: "600 800",
  preload: true, // only because it is the LCP-adjacent headline face
  declarations: [{ prop:"size-adjust", value:"104%" }, { prop:"ascent-override", value:"92%" }],
});
// <html className={`dark ${inter.variable} ${broadcast.variable}`}>
```

> **LCP-swap guard:** restrict the display face to **tier letters / stat numerals / W1–W4 headings**. The hero H1 over the splash uses the already-loaded Inter so the LCP element does not repaint on font swap.

### 4.3 Motion + reduced-motion contract

CSS-first, **no Framer Motion**. Mechanisms: `@keyframes` reveals; a ~0.5 KB `useReveal` IntersectionObserver hook toggling `[data-reveal-ready]`. **View Transitions are demoted to a best-effort spike**, never a deliverable — gate behind both `matchMedia('(prefers-reduced-motion: no-preference)')` and `typeof document.startViewTransition === 'function'`; the page must work identically when absent.

**Default-state fix (prevents hiding above-the-fold content from no-JS/slow-hydrate users):** the static `.reveal` class renders at `opacity:1`. The `opacity:0` start applies *only* when both reduced-motion is off **and** the hydrated hook has set `[data-reveal-ready]`:

```css
@media (prefers-reduced-motion: no-preference){
  @keyframes reveal-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
  [data-reveal-ready] .reveal{opacity:0}                 /* only after hydration */
  [data-reveal-ready] .reveal.in{animation:reveal-up var(--dur-reveal) var(--ease-broadcast) both}
}
@media (prefers-reduced-motion: reduce){ .reveal,.reveal.in{opacity:1;transform:none;animation:none} }
```
`content-visibility:auto; contain-intrinsic-size:0 480px` on off-screen tier sections — **acceptance-gated on a screen-reader + in-page Cmd-F + anchor-link test**; if find-in-page breaks, fall back to plain rendering.

### 4.4 Iconography & PWA assets

Replace emoji with ~20 inlined Lucide paths in `src/components/ui/icons.tsx` (`currentColor`, <6 KB, **no npm dep**). **Generate the missing `public/icons/` first** (a Phase-1 build step using `sharp` to rasterize one brand SVG → `icon-192.png`, `icon-512.png`, `apple-touch-icon`, with a ≥10% maskable safe-zone and a separate `purpose:"maskable"` manifest entry). `manifest.json` currently 404s on these and the service worker depends on them — they ship before any push work.

### 4.5 Primitives

`BentoCell`, `TierBadge` (reads unified tokens; replaces `ChampionsIndex` forks), `StatReadout` (display-font + `tabular-nums`), `RevealMotion`. Glow is exposed **only** via a single `featured` prop so "one glow per viewport" is enforced structurally, not by review convention. `backdrop-filter` stays at the existing 12 px on `.glass-card`; new cells use the cheaper `--grad-glass` overlay for depth.

---

## 5. Front-end: supporting screen redesigns (deep-link targets)

### 5.1 Tier-list — the broadcast tier board
```
+-----------------------------------------------------------+
| TIER LIST · 26.12   [search]  [All|Assassin|Mage|...]     |
+-----------------------------------------------------------+
| ╔═══╗ S+ GOD TIER (8)                                     |
| ║S+ ║ [art|Brand 55.98% ▲2 ▓▓▓▓ WR-bar] [art|...] ...     |
| ╚═══╝                                                     |
| ╔═══╗ S STRONG (14) ...                                   |
```
- **Boundary:** keep client filtering (172 rows is fine), but `page.tsx` passes a **slim projection** (`slug, localized names, tier, rank, win_rate, pick_rate, tags, icon, delta`) — drops `baseStats`/`kit_tags`, cutting the 824 KB route. Verify every field the new tiles read survives the projection.
- **Motion:** IO-driven stagger-rise; WR bar width = `var(--wr)` (correct server-side even with no JS) animates `0→value` once. Filter re-rank uses View Transitions **only as best-effort** (feature-detected, no-op fallback).
- **Retention hook:** ▲▼/NEW delta chips from `changes.json`; deep-link `/tier-list?moved=up` from the dashboard MoversCarousel.

### 5.2 Advisor — locked teaser sells, unlocked feels like coaching
```
LOCKED:                              UNLOCKED (members):
◷ THE ORACLE IS LIVE FOR MEMBERS     verdict cards + grade-ring sweep
[ghost silhouette]                   confidence meter, reasons reveal
[███ ?? HOT][███ ?? STDY][███ ??]    KEEP/CONSIDER/REROLL lower-third
"See the verdict"
[I have an invite code]
```
- **Boundary:** gating logic in `advisor/page.tsx` unchanged. Locked state = new `<AdvisorLockedShowcase>` server component: **redacted placeholders (`••`) + grade-token rings only**. Real `DecisionResult` never enters this path. **No free-eval CTA** — fail-closed gating preserved (HARD CONTRACT #4).
- **Unlocked:** restyle `AdvisorMemberClient` results with ring-sweep + staggered reasons (CSS only).

### 5.3 Champion detail (`[slug]`) — broadcast hero + follow
```
+-----------------------------------------------------------+
| [full-bleed splash, scrim]                                |
|  ⬡ BRAND        S+   ★ Follow                             |
|    #1/172 · 55.98% WR ▲2 this patch · 14.5% PR            |
+-----------------------------------------------------------+
|  (existing dense sections — UNTOUCHED below this line)    |
```
- **Surgical:** add `<ChampionHero>` (server, pre-baked splash, `priority`) + `<FollowButton>` (localStorage) **above** the proven dense data sections; gating untouched.
- **Splash source (corrected — see §7):** pipeline-emitted `splashUrl` + `hasSplash`, **not** a runtime regex.
- **Retention hook:** ★ Follow seeds the dashboard FavoritesStrip; "moved ▲2 this patch" delta. Add `opengraph-image.tsx` (lazy/on-demand ISR, not eager for 860 routes).

---

## 6. Retention & engagement system

The spine is **one build-time artifact**, `public/data/changes.json`, derived **only** from already-public fields (`tier`/`rank`/`win_rate` are present in `champions.json` — verified). Five surfaces consume it.

| Surface | Data | $0 mechanism | Supabase/RLS delta | i18n |
|---|---|---|---|---|
| **Patch-day moment** (W1 banner + `/movers`) | `changes.json` | `scripts/build_changes.py` step 12b in `update-data.sh`, reads new + prior public `champions.json` | none | `engagement` ns ×5 |
| **Personalization** (W6 favorites) | `localStorage 'mo:favorites'` | `useSyncExternalStore` clone of `useAdConsent.ts`; anon = $0 | optional `champion_follows(user_id, champion_slug)` RLS self-only | `followAdd/Remove` ×5 |
| **Web Push** | `push_subscriptions` + `changes.json` | hand-rolled `public/sw.js`; `web-push` (server-only dep); VAPID env; dispatch via **`vercel.json` cron at 22:15** (avoids the git-push→deploy race) | `push_subscriptions(... follows text[], locale check, last_sent_at)`, service-role write only | per-locale push body from `messages/<locale>.json` |
| **Shareable OG cards** | `changes.json` + champ icons | `next/og` edge, lazy ISR, `Cache-Control: immutable` keyed by patch+slug+locale | none | romanized `name` field (Latin-safe) — see fix below |
| **Daily surface** (W10) | `localStorage` + `decision_sessions` | "new since last visit" (free); member "continue" reuses existing read | none new | `newSinceVisit/continueSession` ×5 |

**Mandatory corrections folded in:**

- **OG fonts:** `next/font/google` exposes **no buffer** to `next/og`, and the site ships **no CJK webfont** — so a ja/ko/zh OG card with a CJK name renders **tofu**. Resolution: render OG card text from a vendored Latin `.woff` ArrayBuffer and use the **romanized `name`** field (always Latin) for the champion name, accepting a less-localized card over a broken one. Bundle a CJK subset only if a fully-localized card is later required.
- **ICU plurals are net-new and the parity test does NOT validate bodies.** Add a test that compiles every ICU string in all 5 locale files via `IntlMessageFormat`. For zh/ja/ko author **only the `other` category** with `{n}` interpolation.
- **PWA icons ship first** (§4.4) — the SW `showNotification` icon and manifest both depend on them.
- **`build_changes.py` robustness:** if `git show HEAD:public/data/champions.json` fails (first run), emit `{summary:{up:0,down:0,new:0}, movers:[]}` — never crash. Derive `prev_patch` from the prior file's own `meta.patch`, not "the last commit." Compute deltas strictly from the public file so it fails loudly if `win_rate` is ever stripped.
- **Push fan-out:** chunk `web-push` sends (~100/iteration), prune 410/404 endpoints, throttle via `last_sent_at` + a per-patch global guard, and verify `meta.patch` is actually deployed before dispatch.
- **iOS reality:** Web Push needs iOS 16.4+, installed-to-home-screen, permission granted inside the PWA. Frame push as one channel, not "the" lever; anon subs get top-mover only.
- **Streak scope-down:** keep only "new since your last visit: N movers" + member "continue" — drop the day-count chip (ITP 7-day localStorage eviction silently resets it for the exact infrequent visitors we target).
- **Engine-purity guard (real test, not a comment):** assert `src/lib/decision/**` and `src/lib/scoring/**` contain no `@supabase` import and never reference `champion_follows`/`push_subscriptions`.

---

## 7. Back-end: evolutionary $0 design

### 7.1 Payload re-architecture (the dependency the dashboard rests on)

All build-time, deterministic, pipeline-owned. New scripts run in `scripts/update-data.sh` **after** `export_public_catalog.py` and **before** `rm -rf .next`; they only re-project already-scraped data, so they are testable standalone (committed fixtures, run in CI **without** `GROQ_API_KEY`).

```
public/data/
  abilities.json          # KEEP full (API + back-compat)
  calc/profiles.slim.json # ~361KB: per-champ {damageType,attackType,playstyle,abilities:[{key,name,icon,stats}]} — NO descriptions
  calc/abilities-by-slug.json  # ONE sharded {slug: full profile} map (NOT 172 files — avoids 172-file cron churn)
  lists/champions.list.json    # slim tier-list/champions projection
  lists/items.list.json        # slim items projection
  search/index.json       # ~51KB, 902 entries, all 5 locale names (cmd-K)
  changes.json            # retention spine (§6)
```
- **damage-sim:** server reads `calc/profiles.slim.json` → client segment drops ~588 KB → <120 KB. Descriptions fetched per-champ on selection.
- **champions/[slug]:** indexes `calc/abilities-by-slug.json` instead of the 1.79 MB blob.
- **Drift guard:** vitest asserts reassembled chunks == source profiles.

### 7.2 The freemium/winrate decision (NOT a free transport side effect)

`win_rate`/`pick_rate` are **actively rendered and sorted** (`ChampionsIndex.tsx` WR/PR columns + `:110` sort, `TierListClient.tsx:158` coloring), and `champions.json` is in `COPY_FILES` (verified — verbatim copy, `strip_keys` bypassed). Two corrections:

1. **Product decision (RECOMMENDED): keep WR/PR public as an intentional freemium teaser.** Then *update the data-ownership spec* to whitelist them so the audit "leak" is reclassified as intended. This avoids a UI-gutting PR. `oracleScore` and internal augment/item win-rates stay stripped (`forbidden_telemetry` already covers them — verified). `changes.json` computes `wrDelta` only from these public champion values, never internal.
2. Either way, **route `champions.json` through the same sanitize path** as other files (or make `champions.list.json` the only public champion artifact) so the bypass is removed deliberately, with a CI assertion on the exact field set.

> Do **not** ship a list projection that silently deletes rendered columns — that is a product/UI decision requiring 5-locale strings, not a side effect.

### 7.3 Loader, contracts, caching, observability

- **Typed loader** `src/lib/data/catalog-loader.ts`: `cache()`-memoized `readFile` accessors returning types from `src/lib/contracts/catalog.ts`. **Contracts handle the envelope** — `champions.json`/`augments.json` are `{patch, scraped_at, <collection>:[]}`, so accessors return `{patch, scraped_at, champions: ChampionListEntry[]}`, not a bare array (the version spine must survive the projection).
- **ISR is a rendering-model migration, sequenced last, not "additive":** on this `dynamicParams=false`, no-cacheComponents app (verified), enabling `revalidateTag`/`'use cache'` requires `experimental.cacheComponents` and per-page `cacheTag('catalog')`, gated behind a test proving `revalidateTag` actually re-renders (not a no-op on still-static routes). An auth-gated `/api/revalidate` (CRON_SECRET) is the patch-day refresh seam.
- **API:** memoize `readPublicResource` via `cache()`; **per-resource content-hash ETag** (not a global `dataVersion` — a hotfix to one file must not 304-lock others); register `lists/*`, `calc/*`, `search/index` as typed `/api/v1` resources; read-only, CORS, `dynamic='force-static'`.
- **Observability (hard P0):** `@vercel/speed-insights` + web-vitals capture a baseline **before** motion/art lands; a CI chunk-size guard fails the build if `profiles.slim.json`>450 KB, `champions.list.json`>60 KB, or `search/index.json`>80 KB.

**Contracts kept intact:** scoring twins (`src/lib/scoring/` ↔ `overlay/src/scoring/`, parity budget 0), engine purity (`src/lib/decision/*` pure, gating in API routes only), generated-data ownership (every new file is pipeline-emitted), i18n key parity (all new copy ×5).

---

## 8. Performance budget — "cinematic on $0"

CI-enforced via `@lhci/cli` in the existing GitHub Action (LCP/INP/CLS = `error`; byte-weight = `warn`, ratcheted later). Requires an **unprotected** Vercel preview URL per PR (or a bypass token) or Lighthouse hits a login wall — verify this setup as an explicit step.

| Route | LCP | INP | CLS | route JS | top image / payload |
|---|---|---|---|---|---|
| **dashboard `/`** | ≤2.3s | ≤200ms | ≤0.05 | ≤55 KB | hero ≤80 KB AVIF (pre-baked) |
| tier-list | ≤2.3s | ≤200ms | ≤0.05 | ≤55 KB | above-fold icons only, lazy below |
| champions/[slug] | ≤2.5s | ≤200ms | ≤0.10 | ≤70 KB | splash ≤110 KB AVIF (measured; raw centered splash is 90 KB) |
| damage-sim | ≤2.5s | ≤200ms | ≤0.05 | ≤90 KB | data ≤120 KB (was ~588 KB) |
| **Global** | shared first-load JS ≤180 KB gz · display webfont ≤15 KB Latin · **CJK webfont = 0 KB** | | | | |

**How the cinematic feel stays under budget:**

1. **Images are pre-baked static assets, NOT the Vercel optimizer.** The site runs AdSense (`src/components/ads/AdSlot.tsx`), and **Vercel Hobby Image Optimization is non-commercial-only** under the Fair Usage Policy, plus capped at ~5,000 transforms/mo (402 → broken images on exceed). So `sharp` in the GitHub Action pre-resizes splashes/icons to fixed widths (640/1080/1920), commits them to `public/`, and they serve as plain CDN files via `<img srcset>` or `next/image unoptimized` — **zero runtime transforms, zero Fair-Use exposure, genuinely $0.** Generate `blurDataURL` LQIP in the same `sharp` step.
2. **Splash source fixed.** The track's `raw.communitydragon.org/.../champion-splashes/centered/{id}/{id}000.jpg` **404s** for every tested id, and the icon-id regex cannot drive DDragon. The pipeline emits `splashUrl` from the working source and a build-time `hasSplash` HEAD check; missing splash → square champion-icon over a CSS gradient (never a broken LCP). If the chosen working host (`cdn.communitydragon.org`) is used, it **must be added to `next.config.ts` remotePatterns** — only `raw.communitydragon.org` and `ddragon` are allowlisted today.
3. **One `priority` image per route**, fixed `aspect-ratio` container, LQIP blur → zero CLS. The H1 (Inter) is the guaranteed text LCP; the splash streams behind it.
4. **Motion is compositor-only** (transform/opacity), in a post-LCP island, reduced-motion-default-resting-state, with `content-visibility` skipping off-screen rows.
5. **i18n correction:** the bundle is **672 leaf keys (~33 KB en)**, not 2,118. Per-route message scoping is a minor follow-up, **not** a prerequisite — pass the few new island strings as props rather than growing the always-shipped bundle.

---

## 9. Phased roadmap

### Phase 1 — Viewable prototype + foundation (S, ~1 day) · zero app risk
**Goals:** user sees the dashboard in a browser; design tokens + a11y contract land.
- `prototype/dashboard.html` (§3) — self-contained, real tokens, real mock values.
- `globals.css` @theme additions (§4.1), reveal/reduced-motion keyframes (default-state fix), unified tier map.
- `next/font/local` display face wiring; obtain + subset the ≤15 KB woff2.
- Generate `public/icons/` via `sharp`; fix `manifest.json`.
- Add `@vercel/speed-insights` + web-vitals; capture baseline LCP/INP/CLS on home/tier-list/a champion page.
- **Success:** stakeholder sign-off on `dashboard.html`; baseline CWV recorded; CI Lighthouse gate live (warn mode).

### Phase 2 — Retention spine + static dashboard shell (M, ~3 days)
**Goals:** the patch-day moment ships; daily-return loop exists.
- `scripts/build_changes.py` (step 12b) + `build_search_index.py`; register reads via `readPublicFile`/catalog-loader (NOT `public-loader.ts`).
- `champions.json` sanitize-path fix + freemium spec decision (§7.2); CI field-set assertion.
- `src/app/[locale]/page.tsx` server shell + W1–W4, W7, W9 (server, zero client JS); `combos.json`→champ-icon join.
- Pre-baked splash/icon `sharp` step in the Action; `hasSplash` fallback; remotePatterns updated if needed.
- `engagement` i18n namespace ×5 + ICU compile test.
- **Success:** dashboard live on `/`; "N champs moved this patch" renders; dashboard LCP ≤2.3 s mobile, no `abilities.json` in page chunk (build assertion green).

### Phase 3 — Islands + personalization + supporting screens (M/L, ~4 days)
**Goals:** personalization + the broadcast deep-link targets.
- `DashboardIslands.tsx` (`'use client'`) hosting all `dynamic(ssr:false)` islands; W5, W6, W8 (static sample), W10, ⌘K.
- `useFollows` / `useStreak` (clone `useAdConsent`); FollowButton on champion detail; FavoritesStrip personalization.
- Tier-list slim projection + WR bars + delta chips; champion-detail hero + opengraph-image (lazy ISR); advisor locked showcase + unlocked motion.
- `engine-purity` guard test; `content-visibility` Cmd-F/SR acceptance test.
- **Success:** favorites persist + surface on dashboard; INP ≤200 ms across new islands; advisor locked state leaks zero scores (verified).

### Phase 4 — Web Push, OG cards, ISR refresh seam (M, ~2–3 days)
**Goals:** reach absent users; instant patch-day refresh.
- `supabase/migrations/2026xxxx_engagement.sql` (`champion_follows`, `push_subscriptions`, RLS); `public/sw.js`; `web-push` (server-only).
- `/api/push/subscribe` + dispatch via `vercel.json` cron 22:15 with deploy guard + chunked fan-out.
- OG routes (Latin/romanized names, immutable cache); `/api/revalidate` + `cacheComponents`/`cacheTag` migration (gated test).
- **Success:** a patch-day push reaches a subscribed device in the user's locale; on-demand revalidate refreshes data without a full rebuild; CWV budgets still green.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Vercel image optimizer breaks $0 + ToS** (AdSense = commercial; Hobby non-commercial-only, 5K cap) | Pre-bake AVIF/WebP static assets with `sharp` in the Action; serve as plain CDN files. Zero runtime transforms. |
| **Splash URL 404 / wrong host** | Pipeline `splashUrl` + `hasSplash` HEAD check + icon/gradient fallback; add the working host to remotePatterns. |
| **`abilities.json` 1.79 MB leaks into dashboard bundle** via `loadPublicJson` | Dedicated `readPublicFile`/`catalog-loader`; build assertion the page chunk excludes it. |
| **`dynamic(ssr:false)` in a Server Component won't build** | All `ssr:false` calls live inside `DashboardIslands.tsx` (`'use client'`). |
| **`changes.json` empty on day one** | Snapshot prior `champions.json`; empty-state contract; every widget has a defined empty render (W2 shows grade, no delta; W5 hides). |
| **OG cards render CJK tofu** | Vendor a Latin font buffer; use romanized `name`. |
| **ICU plurals pass key-parity but break at runtime** | Mandatory `IntlMessageFormat` compile test; zh/ja/ko use `other` only. |
| **Display-font swap repaints LCP** | `size-adjust`/`ascent-override`; restrict display face to letters/numerals/headings, keep H1 on Inter. |
| **ISR migration is a no-op or destabilizes routing** | Treat as its own gated PR with `experimental.cacheComponents` flag flip + a test proving `revalidateTag` re-renders. |
| **Reveal hides above-the-fold content for no-JS users** | `opacity:0` only under `[data-reveal-ready]` post-hydration; SSR renders final state. |

## Open questions (≤5)

1. **Freemium/winrate:** confirm WR/PR stay **public** as an intentional teaser (recommended — avoids gutting tier-list columns) so we update the data-ownership spec rather than ship a UI-removal PR?
2. **Splash host:** acceptable to add `cdn.communitydragon.org` (or another verified-200 source) to `next.config.ts` remotePatterns, and to commit pre-baked splash/icon assets to the repo (modest size + cron diff growth)?
3. **Web Push priority:** ship in Phase 4 as designed, or defer entirely given iOS's install-to-home-screen requirement limits reach for the LoL mobile audience?
4. **Membership funnel:** is the AdvisorTeaser strictly a static marketing sample (current safe design), or do you want a future server-rendered "sample of the day" that rotates without ever invoking the engine for anonymous users?
5. **ISR vs full-rebuild:** is the current daily-cron-rebuild cadence acceptable for now (defer the Phase-4 `cacheComponents` migration), or is instant patch-day refresh a launch requirement?