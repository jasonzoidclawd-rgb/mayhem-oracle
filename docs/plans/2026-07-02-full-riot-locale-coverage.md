# Full Riot Locale Coverage (Owner decision Q1: all Data Dragon locales)

Decision (2026-07-02): expand from 5 locales to every locale Data Dragon
serves, auto-discovered — not a hardcoded list. Game-data localization is free
from DDragon; UI chrome beyond the existing five uses explicit English
fallback until translated.

## Design decisions

1. **Locale discovery.** The pipeline fetches
   `https://ddragon.leagueoflegends.com/cdn/languages.json` each refresh
   (~27 codes) and emits `src/i18n/locales.generated.ts` (BCP47 web locales +
   DDragon-code mapping). Collapse English variants (`en_US/en_AU/en_GB/
   en_PH/en_SG` → `en`); keep everything else distinct (`zh_MY` stays,
   simplified content). `routing.ts` imports the generated list; no other
   hardcoded locale lists anywhere (AGENTS.md rule).
2. **Storage: per-locale display files, not more suffix columns.** Canonical
   catalogs stay language-agnostic (slug/id keyed). New generated artifacts:
   `public/data/i18n/<locale>.json` containing display strings only:
   `{champions: {slug: {name}}, augments: {slug: {name, description}},
   items: {id: {name}}, abilities: {slug: {Q|W|E|R|passive: {name,
   description}}}`. Keyed by patch via `meta.json` (files regenerate together;
   promotion is the git commit). Legacy `name_zh_TW`… suffix fields remain
   during migration, then are removed once all readers use the new resolver.
3. **Resolver.** `localizedName/localizedDescription` gain a locale-file
   lookup (server: per-locale file read; client components receive resolved
   strings — do not ship all-locale bundles to the client). English fallback
   stays inside the resolver, is logged in dev, and is test-detectable.
4. **UI chrome (`messages/*.json`).** The five existing translations remain
   human-maintained masters. New locales start as explicit fallback-to-`en`
   via next-intl `getMessageFallback` (logged), optionally seeded by an MT
   pass through the existing Groq/LiteLLM classifier infra (owner call on
   quality bar). Parity test evolves: `en` is the superset; every other file's
   keys ⊆ en; missing keys must resolve through the explicit fallback path.
5. **Static generation strategy.** 27 locales × ~930 pages ≈ 25k static pages
   (~6× build time). Phase 1: keep full static generation for the current
   five + `pt-BR`, `es-ES`, `ru-RU`, `tr-TR`, `vi-VN` (largest LoL locales);
   remaining locales flip `dynamicParams=true` (on-demand render, still
   cached by Vercel). Measure build time; promote to full static if
   acceptable. Sitemap includes all locales regardless (hreflang +
   `x-default`); split sitemap per locale if URL count nears 50k.
6. **Update-pipeline integration.** `enrich_locale_names.py` is replaced by
   `generate_locale_catalogs.py`: downloads champion/item/championFull per
   discovered locale (~3 fetches × 27, tolerable), pinned to the DDragon
   version matching the scraped patch (fallback: latest, warn on mismatch).
   The step-16 validation gate extends per locale: coverage ≥90% champions /
   ≥80% augments, else the refresh aborts. `locale-coverage.test.ts` derives
   its matrix from the generated locale list.
7. **Boundaries.** Locale files contain display strings only — the export
   sanitizer and boundary test extend to `public/data/i18n/**` (no win rates,
   no internal fields). Overlay stays at the current five until the overlay
   UI grows a language setting (separate task).

## Phasing (each phase independently green)

- **L1** pipeline: locale discovery + per-locale catalog generation +
  validation gate + generated locales module. Verify: refresh produces
  `public/data/i18n/*.json` for every discovered locale; gate trips on a
  stubbed empty locale.
- **L2** app: resolver reads locale files; migrate all call sites; remove
  suffix-field reads (keep fields emitted for overlay until L5). Verify:
  locale-coverage matrix green for all locales.
- **L3** routing/chrome: generated `routing.locales`, message fallback
  policy + parity-test evolution, `x-default` hreflang.
- **L4** SEO/static: static-generation tiering, sitemap expansion, build-time
  measurement recorded in this doc.
- **L5** cleanup: drop legacy suffix fields; overlay sync switches to locale
  files (overlay UI language support optional follow-up).

Executor: Codex per phase (L1 → L5), GPT-5.5 re-review after L2 and L5.
Do not start before the round-2 branch (`codex/round2-lease-rls-og-hardening`)
is merged — L2 touches the same champion-page files.

## 2026-07-06 review addendum (timing + risk assessment)

Assessment from the post-P5 review: the phasing above is right, but **do not
start L1 until two gates pass**, and note one content-quality risk the plan
does not yet cover.

1. **Demand gate (before L1).** The structured-data/GEO surface for the
   existing five locales went live 2026-07-05. Expansion scales an unvalidated
   bet until Search Console shows the four non-English locales earning
   meaningful impressions/clicks. Record the numbers here when checked.
2. **Sequencing gate (before L1).** Land the in-flight SEO/GEO slices first
   (SEO helper boundary test, item patch summaries, JSON-LD live verifier) —
   L2 and this work touch the same detail-page files.
3. **Thin/mixed-language content risk (new, affects L4).** DDragon covers
   names/descriptions, but `wikiDescription`, wiki passives/notes, and
   arammayhem-derived body copy are English-only sources. A new-locale detail
   page is localized chrome around an English body; at scale that risks
   site-wide quality signals, not just weak pages in the new locale. Before
   the L4 sitemap/hreflang expansion, define a per-locale content-depth bar
   (e.g. localized description coverage from the L1 catalogs) and only add a
   locale to the sitemap once it clears the bar. Tier-1 static locales in L4
   (`pt-BR es-ES ru-RU tr-TR vi-VN`) should also be the first sitemap
   additions; regional English variants stay collapsed (decision 1) and never
   get their own sitemap entries.
4. **Pre-work completed 2026-07-06** (patterns that make locale count a
   config change): patch-summary copy is injected from `messages/*.json` with
   the helper deciding only which bounded lines render (`a807235`); the
   hardcoded locale regex in `src/lib/auth/google-identity.ts` (violated
   design decision 1's no-other-locale-lists rule) now derives from
   `routing.locales`.
5. **Cost check per L4 tier.** Each locale adds ~940 static pages per build
   and one more locale to the daily refresh; record build minutes and cron
   duration here before promoting the next tier.
