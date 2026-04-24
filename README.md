# ⚡ Mayhem Oracle

**ARAM Mayhem decision engine** — Champion tier lists, augment scoring, combo synergies, and patch analysis.

PWA that works on iOS (Add to Home Screen) and Windows (browser + Microsoft Store).

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/mayhem-oracle.git
cd mayhem-oracle
npm install

# 2. Run dev server
npm run dev
# → opens http://localhost:3000

# 3. Test locales
# http://localhost:3000          → English (default)
# http://localhost:3000/zh-TW    → 繁體中文
# http://localhost:3000/zh-CN    → 简体中文
# http://localhost:3000/ja       → 日本語
# http://localhost:3000/ko       → 한국어
```

## Deploy to Vercel (free)

1. Push to GitHub
2. Go to [vercel.com](https://vercel.com) → Import your repo
3. Framework preset: **Next.js** (auto-detected)
4. Click **Deploy**
5. Done — live at `your-project.vercel.app`

## Project structure

```
mayhem-oracle/
├── messages/              # Translation JSON per locale
│   ├── en.json
│   ├── zh-TW.json         # 繁體中文
│   ├── zh-CN.json         # 简体中文
│   ├── ja.json
│   └── ko.json
├── public/
│   ├── manifest.json      # PWA manifest
│   ├── icons/             # App icons (192 + 512px)
│   └── data/              # Static JSON cache (from scraper)
├── scripts/               # Python data scrapers (GitHub Actions)
├── src/
│   ├── app/
│   │   └── [locale]/      # All pages under locale segment
│   │       ├── layout.tsx  # App shell + providers
│   │       ├── page.tsx    # Homepage
│   │       ├── tier-list/
│   │       ├── champions/[slug]/
│   │       ├── augments/
│   │       └── patch-notes/
│   ├── components/        # React components
│   ├── i18n/              # Internationalization config
│   │   ├── routing.ts     # Locale definitions
│   │   ├── request.ts     # Server-side message loading
│   │   └── navigation.ts  # Locale-aware Link, useRouter
│   ├── lib/               # Shared types, utilities, scoring
│   ├── styles/
│   │   └── globals.css    # Tailwind + dark gaming theme
│   └── middleware.ts      # Locale detection + routing
├── .github/workflows/
│   └── update-data.yml    # Daily scraper cron
└── next.config.ts         # Next.js + next-intl plugin
```

## Data sources

| Source | What it provides | Method |
|--------|-----------------|--------|
| arammayhem.com | Win rates, augments, combos, tier data | RSC wire format scraper |
| CommunityDragon | Champion icons, item images | Static CDN URLs |
| LoL-Patch-Change (GitHub) | Bilingual patch diff JSON | Git API / raw fetch |
| apexlol.info | Combo synergy/trap ratings | HTML scraper |
| metasrc.com | Secondary validation data | Manual cross-reference |

## Tech stack

- **Next.js 15** — App Router, SSR, static generation
- **TypeScript** — Type safety everywhere
- **Tailwind CSS v4** — Utility-first styling
- **next-intl** — i18n with 5 locales
- **Vercel** — Free hosting with edge CDN
- **GitHub Actions** — Free daily data scraper cron

## Supported languages

| Code | Language | Status |
|------|----------|--------|
| en | English | ✅ Complete |
| zh-TW | 繁體中文 | ✅ Complete |
| zh-CN | 简体中文 | ✅ Complete |
| ja | 日本語 | ✅ Complete |
| ko | 한국어 | ✅ Complete |

## License

MIT
