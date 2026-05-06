# CLAUDE.md — Mayhem Oracle Project Context

## What is this?
A PWA (Progressive Web App) serving as an ARAM Mayhem decision engine for League of Legends.
Built with Next.js 15 (App Router), TypeScript, Tailwind CSS v4, and next-intl for i18n.

## Key architecture decisions
- **PWA over native**: $0 budget means no Apple Dev account ($99/yr). PWA gives iOS (Add to Home Screen) + Windows (browser + MS Store) for free.
- **Static JSON data**: Scraped data lives as JSON in `public/data/`. GitHub Actions cron updates daily, Vercel auto-deploys.
- **next-intl with locale prefix routing**: URLs like `/zh-TW/tier-list`, `/ja/champions/brand`. Default locale (en) has no prefix.
- **Server Components by default**: Pages use `getTranslations()` server-side. Only interactive components (filters, search, language switcher) are Client Components.

## Locale codes
en, zh-TW, zh-CN, ja, ko

## Oracle Score algorithm (from oracle_ghost.py)
`score = champion_wr + set_tier_bonus + combo_bonus + trap_penalty + same_set_synergy + rarity_bonus + system_breaker_bonus`
- Set tier: prismatic +14, gold +10, silver +6
- Strong combo: +12
- Trap penalty: -15
- Same-set synergy: +2
- Rarity: prismatic +3, gold +1, silver +0
- System breaker (質變增幅): +20

## Augment Selection Mechanics (VERIFIED)
See GAME_MECHANICS.md for full detail. Key rules:
- 4 rounds at levels 3, 7, 11, 15
- Round 1: no death required. Rounds 2-4: must be dead to open UI.
- **3 slots per round, each slot has 1 independent reroll** → max 6 unique augments viewable
- **Tier sync**: all 10 players see same tier per round
- Round 1 is NOT always Silver — Prismatic at start is possible
- **Golden Reroll** (from progression track): only way to break tier sync
- **Smart Tailoring**: pool filtered by champion tags (role, damage type, resource)
- **Qualitative Change augments**: system breakers that transcend tier color
- Probability formula: P(target) = k / N_tailored

## Data sources
- arammayhem.com: RSC wire format (HTML-entity-encoded JSON, no __NEXT_DATA__)
- CommunityDragon: CDN for champion icons, item images
- LoL-Patch-Change GitHub repo: Bilingual EN/CN patch diff JSON
- apexlol.info: Combo synergy/trap ratings (SS-D scale)

## Important quirks
- arammayhem.com uses React Server Components wire format — not standard HTML tables or JSON API
- Riot has NOT made ARAM Mayhem data available through their API
- ZH_REV dictionary maps 80+ Chinese augment names to English for OCR matching (from oracle_ghost.py)

## Dev commands
```bash
npm run dev      # localhost:3000
npm run build    # production build
npm run lint     # ESLint
```

## Cowork Notes (2026-04-25)
- Use `@/i18n/navigation` for internal app links in locale-routed UI. Avoid `next/link` in app components unless you explicitly want to bypass locale handling.
- On champion pages, render combo chips from `resolveChampionCombos(...).augmentSlug`; do not re-slugify combo names with ad-hoc string replacement.
- Keep the web app TypeScript boundary scoped to the Next app. `tsconfig.json` excludes `overlay/`, `packages/`, and `scripts/` so unrelated workspace issues do not break `npm run build`.
- Shared scoring logic currently exists in both `src/lib/*` and `packages/scoring/src/*`. If you change one side, mirror the change or dedupe the implementation before the two copies drift.
