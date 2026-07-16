# PR 39 product-first pickiest-customer review

Date: 2026-07-15 (Asia/Taipei)  
Target: `http://127.0.0.1:3000`  
Recommendation: **BLOCK**

## Review independence and constraints

This was a fresh-context, product-first review. No implementation reasoning or PR self-assessment was provided to this reviewer. Before completing the black-box findings, I did **not** inspect PR #39, its description, git history, git diff, handoffs, implementation notes, prior-agent reasoning, or synthetic fixtures. I did not read a PR handoff at any point in this pass. After the rendered-product review was complete, I used file-name inventory only to make the ownership hypotheses below; I did not use source contents to excuse or reinterpret product behavior.

The requested in-app Browser skill was read and attempted first. Its required `node_repl` browser-control tool was not exposed in this session, so the in-app Browser could not be connected. Per the permitted fallback, I used local Playwright Chromium against the live target. All screenshots and temporary scripts are outside the repository in `/tmp/pr39-pickiest-review-1`. The only repository file created is this report.

## Executive verdict

This build is not releasable. English is unreachable, the core augment-ranking surface presents synthetic rarity-derived constants as Oracle scores, removed/malformed augments remain in the current decision picker, lifecycle claims contradict each other, premium sign-in is explicitly unavailable, and several public pages expose raw localization markup or unresolved entities. These are trust and primary-flow failures, not isolated polish issues.

There are no P0 findings. There are **8 P1**, **10 P2**, **2 P3**, and **3 Taste** findings.

## Route-by-viewport test matrix

Legend: ✓ rendered and inspected; ! rendered with material defect; X could not render; — not separately exercised.

| Route/state | 390×844 | 768×1024 | 1280×900 | 125% zoom equivalent | 200% zoom equivalent | Notes |
|---|---:|---:|---:|---:|---:|---|
| `/` English landing | X | — | X | — | — | Redirect loop, `ERR_TOO_MANY_REDIRECTS` |
| `/en`, `/en/champions` | — | — | X | — | — | Redirect to unprefixed route, then loop |
| `/zh-TW` landing | ! | ! | ! | ! | ! | Responsive without page overflow; localization/data contradictions |
| `/zh-TW/champions` | ! | ! | ! | — | — | English role/stat tokens |
| `/zh-TW/champions/brand` | ! | ! | ! | — | — | Raw tags/units; pool includes removed count |
| `/zh-TW/augments` | ! | ! | ! | ! | ! | All current entries show `A`; score constants follow rarity |
| `/zh-TW/augments/draw-your-sword` | — | — | ! | — | — | Real prismatic rarity inspected; displayed Oracle tier still `A` |
| `/zh-TW/augments/tank-engine` | — | — | ! | — | — | Real gold rarity inspected; displayed Oracle tier still `A` |
| `/zh-TW/augments/heavy-hitter` | — | — | ! | — | — | Real silver rarity inspected; raw variable remains |
| `/zh-TW/augments/void-immolation` | — | — | ! | — | — | Desolate present; links to item `223069` |
| `/zh-TW/augments/sonic-boom` | ! | ! | ! | — | — | 2,624–3,883 px document width from raw unbroken title |
| `/zh-TW/augments/missing-ping-augment` | — | — | ! | — | — | Simultaneously current and removed |
| `/zh-TW/augments/siphon` | — | — | ! | — | — | Removed detail; still offered in companion |
| `/zh-TW/items` | — | — | ! | — | — | English descriptions/stat dumps |
| `/zh-TW/items/223069` | ! | ! | ! | ! | ! | Broken icon request; raw concatenated English copy |
| `/zh-TW/patch-notes` | — | — | ! | — | — | Stale-source warning, unresolved entities, English payload labels |
| `/zh-TW/patch-notes/26.13` | ! | ! | ! | — | — | Canonical dot route works; hyphen route 404s |
| `/zh-TW/advisor` | ! | ! | ! | — | — | Premium surface cannot sign in |
| `/zh-TW/companion` | ! | ! | ! | — | — | Removed and malformed current choices; undersized targets |
| `/zh-TW/damage-sim` | — | — | ! | — | — | Advertised calculator exposes empty/unfinished data tables |
| Search (`Ctrl+K`, click, empty/result/no-result) | ! | — | ! | — | — | Search works for Brand and Void Immolation; focus restoration fails |
| Mobile bottom navigation / More sheet | ✓ | ✓ | n/a | ✓ | ✓ | Sheet opens and links render |
| Unknown route/entity/item | ! | ! | ! | — | — | Raw framework 404 |
| Footer/about/privacy/terms/contact | — | — | ✓ | — | — | Links and disclosures render |
| Reduced-motion preference | ✓ | — | ✓ | — | — | Motion durations are effectively clamped |
| Dark/light OS preference | ✓ | — | ✓ | — | — | Product supports only the same dark appearance; screenshots identical |
| Slow network, item `223069` | ! | — | — | — | — | Main content absent at DOMContentLoaded; load completes around 18.9 s |

The requested real S+, S, A, B, C, and neutral **augment** states could not be validated because the live product did not expose them: all 205 current augment cards rendered `A`, and the real prismatic/gold/silver detail samples also rendered `A`. I did not treat fixture-like or rarity-derived values as proof.

## Findings

### F01 — P1 — English is completely unreachable

- Route: `/`, `/en`, `/champions`, `/en/champions`
- Viewport: 1280×900; also reproduced with `curl`
- Reproduction: open `/` with an English browser locale, or open `/en` directly.
- Expected: canonical English landing/content loads.
- Actual: `/` rewrites toward `/en` while responding `307 Location: /`; `/en` redirects to `/`; Chromium ends on `chrome-error://chromewebdata/` with `ERR_TOO_MANY_REDIRECTS`. Unprefixed child routes behave the same way.
- Screenshot: `/tmp/pr39-pickiest-review-1/P1_english_redirect_loop.png`
- Console/network: failed document request, `net::ERR_TOO_MANY_REDIRECTS`; header evidence captured in the test log.
- Likely owner: `src/proxy.ts`, `src/i18n/routing.ts`, `src/i18n/navigation.ts`
- Blocks merge: **Yes**

### F02 — P1 — “Oracle scores” and tiers are synthetic rarity-derived constants

- Route: `/zh-TW/augments`, search results, augment detail routes
- Viewport: 390×844, 768×1024, 1280×900, 125%, 200%
- Reproduction: open the augment index; compare prismatic, gold, and silver sections; open `draw-your-sword`, `tank-engine`, and `heavy-hitter`.
- Expected: real user-facing S+/S/A/B/C/neutral model results, independent of rarity, with meaningful distribution.
- Actual: all 205 current cards show tier `A`. Every prismatic card shows Oracle `67`, every gold card `61`, and every silver card `56` (70/76/59 cards respectively). Real rarity samples still show `A`. This is rarity/tier confusion presented as ranking data.
- Screenshot: `/tmp/pr39-pickiest-review-1/P1_augment_all_a_scores.png`
- Console/network: no request failure explains the fallback; the page declares it is sorted by current win-rate-derived Oracle score.
- Likely owner: `src/components/augments/AugmentsClient.tsx`, `src/lib/scoring/oracle-score.ts`, `src/app/[locale]/augments/page.tsx`
- Blocks merge: **Yes**

### F03 — P1 — The “current” decision pool includes removed and malformed augments

- Route: `/zh-TW/companion`, `/zh-TW/champions/brand`, `/zh-TW/augments/siphon`, `/zh-TW/augments/sonic-boom`
- Viewport: 390×844 and 1280×900
- Reproduction: open Companion on Silver; scroll the choices to `Siphon` and the card beginning `<healing>`; compare the Siphon detail. Open Brand and read its pool construction summary.
- Expected: current picker excludes removed records and uses clean localized names; Brand’s pool count matches the 205-current index.
- Actual: the picker offers `Siphon`, whose detail says it was removed in 26.13, plus the malformed Sonic Boom record. Brand claims it builds and retains all 268 augments, exactly current 205 + removed 63.
- Screenshots: `/tmp/pr39-pickiest-review-1/P1_companion_removed_siphon.png`, `/tmp/pr39-pickiest-review-1/P1_companion_raw_sonic.png`, `/tmp/pr39-pickiest-review-1/detail_siphon.png`
- Console/network: no relevant failed request; this is rendered server data.
- Likely owner: `src/components/companion/CompanionClient.tsx`, `src/lib/data/augment-set.ts`, `src/lib/scoring/pool-orchestrator.ts`, `src/components/champions/PoolConstructionSection.tsx`
- Blocks merge: **Yes**

### F04 — P1 — Lifecycle state contradicts itself for live augment records

- Route: `/zh-TW/augments/missing-ping-augment`, `/zh-TW/patch-notes`, `/zh-TW/augments`
- Viewport: 1280×900
- Reproduction: open the missing-ping detail; compare its header and version summary; inspect the patch’s adjusted and removed sections. Search the augment index for `豪豬`.
- Expected: one authoritative lifecycle state and one canonical record.
- Actual: Missing Ping is labeled `目前可用` and, in the same page, “removed in 26.13.” Patch 26.13 treats it as adjusted while also listing unresolved `???` records as removed. `豪豬` appears in the current catalog and removed/history records. Customers cannot know what can actually roll.
- Screenshots: `/tmp/pr39-pickiest-review-1/P1_lifecycle_contradiction.png`, `/tmp/pr39-pickiest-review-1/P1_patch_unknown_entity.png`
- Console/network: no relevant request failure.
- Likely owner: `src/lib/data/augment-set.ts`, `src/components/patch-notes/PatchNotesView.tsx`, `src/app/[locale]/augments/[slug]/page.tsx`
- Blocks merge: **Yes**

### F05 — P1 — Landing says “0 changes” while the patch surface says 9

- Route: `/zh-TW`, `/zh-TW/patch-notes`, `/zh-TW/patch-notes/26.13`
- Viewport: all required viewports
- Reproduction: compare landing “本版本變更 0” with patch “總變更 9 / 增幅符文調整 9.”
- Expected: the same current patch has the same change count everywhere.
- Actual: two prominent first-party summaries disagree. The landing also labels augment count `268`, while the index calls only 205 current.
- Screenshots: `/tmp/pr39-pickiest-review-1/desktop1280_landing.png`, `/tmp/pr39-pickiest-review-1/P1_patch_unknown_entity.png`
- Console/network: no relevant request failure.
- Likely owner: `src/components/dashboard/MetaAtAGlance.tsx`, `src/components/patch-notes/PatchNotesView.tsx`, public data loaders
- Blocks merge: **Yes**

### F06 — P1 — Malformed Sonic Boom makes the page horizontally unusable

- Route: `/zh-TW/augments/sonic-boom`
- Viewport: 390×844, 768×1024, 1280×900
- Reproduction: open the detail page and attempt to read/navigate horizontally.
- Expected: a localized human name, wrapped copy, and no horizontal document overflow.
- Actual: the raw localization payload becomes the title, metadata, breadcrumb text, and page summary. The H1 is 2,608–3,851 CSS px wide; document width is 2,624 px on mobile and 3,883 px on desktop. Essential controls/content are pushed far off-screen.
- Screenshots: `/tmp/pr39-pickiest-review-1/P1_mobile390_sonic_horizontal_overflow.png`, `/tmp/pr39-pickiest-review-1/P1_desktop1280_sonic_horizontal_overflow.png`
- Console/network: no relevant failure; malformed content is in the rendered HTML.
- Likely owner: `src/app/[locale]/augments/[slug]/page.tsx`, `src/lib/i18n/localized-name.ts`, entity formatting/catalog pipeline
- Blocks merge: **Yes**

### F07 — P1 — Premium advisor advertises a primary action that cannot work

- Route: `/zh-TW/advisor`, Brand detail’s member gates
- Viewport: 390×844, 768×1024, 1280×900
- Reproduction: open Advisor and use “使用 Google 登入.”
- Expected: sign-in starts, or the feature is hidden/disabled with honest pre-release framing.
- Actual: the premium surface immediately says “Google 登入目前無法使用.” A paying-customer flow is knowingly dead while the product continues to advertise “解鎖神諭.”
- Screenshot: `/tmp/pr39-pickiest-review-1/desktop1280_advisor.png`
- Console/network: repeated aborted RSC prefetches to account/membership/advisor; no successful auth flow.
- Likely owner: `src/components/membership/MembershipGate.tsx`, `src/components/auth/GoogleSignInButton.tsx`, `src/app/[locale]/advisor/page.tsx`
- Blocks merge: **Yes**

### F08 — P1 — Patch notes silently render an unresolved entity as a valid link

- Route: `/zh-TW/patch-notes`, `/zh-TW/patch-notes/26.13`, `/zh-TW/augments/missing-ping-augment`
- Viewport: 390×844 and 1280×900
- Reproduction: find the adjusted `???` card and activate its entity chip.
- Expected: resolved canonical name, or a visibly unresolved non-link with an explicit data warning.
- Actual: `???` is shown as a normal linked augment, with raw `Description`, `tooltip`, dash placeholders, and English payload text. The destination claims both current and removed states.
- Screenshot: `/tmp/pr39-pickiest-review-1/P1_patch_unknown_entity.png`
- Console/network: no failed request; this is accepted catalog data.
- Likely owner: `src/components/patch-notes/PatchCard.tsx`, `src/components/entities/EntityLink.tsx`, `src/lib/patch-notes/search.ts`
- Blocks merge: **Yes**

### F09 — P2 — Item 223069 has a broken hero icon and raw, concatenated copy

- Route: `/zh-TW/items/223069`
- Viewport: all required viewports and zoom equivalents
- Reproduction: open item 223069; inspect the icon, structured value, description, effect, and mechanics.
- Expected: local/proxied reliable artwork and readable localized structured content.
- Actual: the icon is an empty placeholder. The remote CommunityDragon image fails with `net::ERR_BLOCKED_BY_ORB`. Copy concatenates fields (`RegenImmolate`, `DesolateKilling`) and leaves most content English; arrows and lifecycle badges read like pipeline output.
- Screenshot: `/tmp/pr39-pickiest-review-1/P2_item_image_and_raw_copy.png`
- Console/network: failed `raw.communitydragon.org/.../223069_kiwi_voidimmolation...png`, `net::ERR_BLOCKED_BY_ORB`; repeated under slow network.
- Likely owner: `src/app/[locale]/items/[identifier]/page.tsx`, `src/components/entities/EntityIcon.tsx`, `src/lib/items/catalog.ts`
- Blocks merge: **Yes**

### F10 — P2 — Slow network shows the footer before the primary content with no meaningful loading state

- Route: `/zh-TW/items/223069`
- Viewport: 390×844, emulated 3G (400 ms latency, ~50 KB/s download)
- Reproduction: cold-load the item route under throttling; inspect at DOMContentLoaded.
- Expected: item skeleton or stable primary layout appears before/footer alongside progressive content.
- Actual: at DOMContentLoaded (~2.61 s), only header, language selector, footer, and bottom tabs are present; the item body is absent. Navigation timing did not complete until ~18.94 s, dominated by asset behavior. This looks like a blank/failed route rather than loading.
- Screenshots: `/tmp/pr39-pickiest-review-1/slow_network_domcontentloaded.png`, `/tmp/pr39-pickiest-review-1/slow_network_networkidle.png`
- Console/network: the item icon fails twice with ORB; companion RSC prefetch aborts.
- Likely owner: route `loading.tsx` coverage for item detail, `src/components/entities/EntityIcon.tsx`, layout/footer streaming order
- Blocks merge: **No alone; yes in aggregate**

### F11 — P2 — zh-TW is extensively mixed with English and raw mechanical tokens

- Route: `/zh-TW`, `/zh-TW/items`, `/zh-TW/augments`, disclosure panel
- Viewport: all required viewports
- Reproduction: read the landing prismatic spotlight, item cards, and “遊戲備註與互動.”
- Expected: coherent Traditional Chinese or an explicitly English-only section.
- Actual: the landing’s hero augment description is a full English paragraph; item stats/descriptions are English; the augment mechanics disclosure is almost entirely English and includes dense formula prose. Terminology alternates between `增強` and `增幅符文`; English `Oracle` is unexplained.
- Screenshots: `/tmp/pr39-pickiest-review-1/P2_landing_untranslated_feature.png`, `/tmp/pr39-pickiest-review-1/mobile390_augment_help_open.png`, `/tmp/pr39-pickiest-review-1/desktop_zh-TW__items.png`
- Console/network: none relevant.
- Likely owner: locale messages/public catalog localization, `src/components/dashboard/AugmentSpotlight.tsx`, `src/components/augments/AugmentsClient.tsx`, `src/components/items/ItemsClient.tsx`
- Blocks merge: **No alone; yes in aggregate**

### F12 — P2 — Champion pages expose schema/debug vocabulary instead of customer copy

- Route: `/zh-TW/champions`, `/zh-TW/champions/brand`
- Viewport: all required viewports
- Reproduction: inspect champion cards and Brand’s header/stat/skill sections.
- Expected: localized roles, human-readable stats, and deliberate skill summaries.
- Actual: `marksman`, `assassin`, `mage`, `support`, `ability`, `cc`, `dot`, `haste`, `sec`, and `units` remain English. Brand repeats “技能係數” and “技能冷卻” without associating values to abilities, creating a stat dump rather than an understandable overview. `slow 0.25s` is semantically suspicious.
- Screenshots: `/tmp/pr39-pickiest-review-1/P2_champion_untranslated_roles.png`, `/tmp/pr39-pickiest-review-1/P2_brand_raw_fields.png`
- Console/network: none relevant.
- Likely owner: `src/components/champions/ChampionsIndex.tsx`, `src/lib/champions/detail-data.ts`, `src/app/[locale]/champions/[slug]/page.tsx`
- Blocks merge: **No alone; yes in aggregate**

### F13 — P2 — Unknown routes/entities fall through to an unbranded English framework 404

- Route: `/zh-TW/does-not-exist`, `/zh-TW/champions/does-not-exist`, `/zh-TW/augments/does-not-exist`, `/zh-TW/items/999999`
- Viewport: all required viewports
- Reproduction: open any unknown localized route/entity.
- Expected: localized branded not-found page with navigation/search and a distinction between unknown vs removed entity.
- Actual: blank white/black framework page with only `404 This page could not be found.` It discards app navigation and locale.
- Screenshot: `/tmp/pr39-pickiest-review-1/P2_raw_404.png`
- Console/network: document returns 404 and logs “Failed to load resource: 404.”
- Likely owner: missing `src/app/[locale]/not-found.tsx` / root `not-found.tsx`
- Blocks merge: **No**

### F14 — P2 — Landing heading structure is unusable for document navigation

- Route: `/zh-TW`
- Viewport: 1280×900; keyboard-only
- Reproduction: inspect heading navigation or DOM order.
- Expected: one meaningful H1, followed by H2 sections and nested H3s.
- Actual: there is no H1. Content starts with six H3 headings; the only H2 headings are footer columns (`探索`, `帳號`, `法律`).
- Screenshot: `/tmp/pr39-pickiest-review-1/desktop1280_landing.png`
- Console/network: none.
- Likely owner: `src/app/[locale]/page.tsx`, dashboard section components, `src/components/ui/Footer.tsx`
- Blocks merge: **No alone; yes in aggregate accessibility gate**

### F15 — P2 — Search dialog does not restore keyboard focus and is not marked modal

- Route: any zh-TW route, search via `Ctrl+K`
- Viewport: 1280×900, keyboard-only
- Reproduction: focus search, open, then press Escape.
- Expected: focus returns to the invoking search control; dialog exposes modal semantics and contains keyboard focus.
- Actual: Escape closes the dialog and moves focus to `BODY`. The dialog has an accessible label but no `aria-modal`. Initial Tab traversal stays within visible results, but restoration is broken and a full cycle could not be proven trapped before the long result list ended.
- Screenshot: `/tmp/pr39-pickiest-review-1/search_open_keyboard.png`
- Console/network: no JS errors.
- Likely owner: `src/components/dashboard/CmdKSearch.tsx`
- Blocks merge: **No alone; yes in aggregate accessibility gate**

### F16 — P2 — Frequent mobile controls miss reasonable touch-target size

- Route: `/zh-TW/companion`, global nav
- Viewport: 390×844 and 768×1024
- Reproduction: inspect/tap champion chooser and global search/account controls.
- Expected: approximately 44×44 CSS px or equivalent spacing.
- Actual: companion champion buttons are 36×36; global mobile search is 42×36; desktop account is 32×32. The companion grid contains over 170 tightly packed targets, magnifying mis-tap risk.
- Screenshot: `/tmp/pr39-pickiest-review-1/mobile390_companion.png`
- Console/network: none.
- Likely owner: `src/components/companion/CompanionClient.tsx`, `src/components/ui/Navbar.tsx`
- Blocks merge: **No alone; yes in aggregate accessibility gate**

### F17 — P2 — Damage simulator is linked as a product feature but visibly unfinished

- Route: `/zh-TW/damage-sim`
- Viewport: 1280×900
- Reproduction: open from primary navigation and inspect calculator/data tables.
- Expected: selectable attacker/target and usable item/augment calculation, or a clearly labeled beta/reference page.
- Actual: the calculator remains at “選擇攻擊者和目標”; supporting sections state `0 Mayhem AD items`, `0 Mayhem AP items`, and `0 個增幅裝置有傷害相關效果`; most formula UI is English. This reads as an internal scaffold in primary navigation.
- Screenshot: `/tmp/pr39-pickiest-review-1/desktop_zh-TW__damage-sim.png`
- Console/network: no relevant error.
- Likely owner: `src/components/damage-sim/DamageCalculator.tsx`, `src/app/[locale]/damage-sim/page.tsx`
- Blocks merge: **No alone; yes in aggregate product-readiness gate**

### F18 — P2 — Freshness messaging is internally inconsistent and weakens provenance

- Route: `/zh-TW`, `/zh-TW/patch-notes`
- Viewport: 1280×900
- Reproduction: compare “更新時間 2026年7月13日” on landing/index with patch source card “2026年6月24日 / 來源可能已過期,” while patch events say “1 天前偵測.”
- Expected: every freshness label identifies which dataset it covers, with a clear authoritative timestamp.
- Actual: global “updated” claims imply current data while the patch surface warns its source may be stale. The product does not explain whether champion rankings, current augment pool, patch detection, and CommunityDragon snapshot are independently fresh.
- Screenshots: `/tmp/pr39-pickiest-review-1/desktop1280_landing.png`, `/tmp/pr39-pickiest-review-1/desktop_zh-TW__patch-notes.png`
- Console/network: none.
- Likely owner: `src/components/ui/DataProvenance.tsx`, `src/lib/patch-notes/freshness.ts`, dashboard metadata components
- Blocks merge: **No alone; yes in aggregate trust gate**

### F19 — P3 — Search cannot find canonical item 223069 by ID

- Route: global search
- Viewport: 390×844
- Reproduction: open search and enter `223069`.
- Expected: if search is the site-wide discovery affordance, canonical item IDs resolve; otherwise the UI should explicitly scope itself.
- Actual: “找不到符合「223069」的結果.” Brand and Void Immolation do resolve canonically. The input placeholder only says heroes/augments, so this is scope ambiguity rather than a broken promise.
- Screenshot: `/tmp/pr39-pickiest-review-1/search_223069.png`
- Console/network: none relevant.
- Likely owner: `src/components/dashboard/CmdKSearch.tsx`
- Blocks merge: **No**

### F20 — P3 — Patch slug failure is a needlessly brittle edge case

- Route: `/zh-TW/patch-notes/26-13`
- Viewport: 1280×900
- Reproduction: use a hyphenated human/SEO-style patch slug.
- Expected: redirect to canonical `/26.13` or branded not-found.
- Actual: raw framework 404. Canonical dot route works.
- Screenshot: `/tmp/pr39-pickiest-review-1/desktop_zh-TW__patch-notes__26-13.png`
- Console/network: 404 console error.
- Likely owner: `src/lib/patch-notes/routes.ts`, `src/app/[locale]/patch-notes/[patch]/page.tsx`
- Blocks merge: **No**

## Design-taste findings

### T01 — Taste — The interface is visually monotonous and over-carded

Almost every section is another nearly identical navy rounded rectangle inside a navy page. Patch notes are cards inside bordered cards; the landing combines large empty containers with tiny 18–26 px entity art. The result feels like a component inventory, not an editorially composed decision tool. Screenshot: `/tmp/pr39-pickiest-review-1/desktop1280_landing.png`.

### T02 — Taste — Entity imagery is too small to carry the hierarchy

Augment index art is visually consumed by a gray frame while the repeated `A / Oracle 67` dominates. On mobile, two-column cards devote more space to empty padding than artwork or explanation. This is especially harmful when color/tier is supposed to communicate meaning. Screenshot: `/tmp/pr39-pickiest-review-1/mobile390_augments.png`.

### T03 — Taste — Mobile is responsive but often merely compressed

Brand’s stat dump and patch cards stack into dense walls; the fixed bottom bar covers the last 57 px of the viewport; the rotate-phone hint appears even though the product presents a mobile-first companion action. No horizontal overflow was found on normal key routes, but reading quality is not intentional enough. Screenshots: `/tmp/pr39-pickiest-review-1/mobile390_brand.png`, `/tmp/pr39-pickiest-review-1/mobile390_patch2613.png`.

## Entity-frame review

- Normal key routes showed no document-level horizontal overflow except malformed Sonic Boom.
- Rendered entity links themselves use focus rings rather than doubled resting borders; no reproducible doubled ring was confirmed on normal cards.
- The tier system still fails its primary correctness criterion because all augments render `A`; rarity badges supply the only meaningful color variation.
- Champion and item frames are effectively neutral, but item `223069` loses its art entirely.
- Tier distinction cannot be assessed in grayscale because the product did not expose real S+/S/B/C/neutral augment examples. The repeated `A` letter does not solve this.

## Data-integrity findings and positive checks

Confirmed failures are F02–F05 and F08–F09. Additional checks:

- `Desolate` appears on Void Immolation augment, item `223069`, and patch 26.13.
- The augment links canonically to `/zh-TW/augments/void-immolation`; the item links canonically to `/zh-TW/items/223069`.
- One Desolate change event was observed on patch 26.13; no duplicate Desolate event was found.
- No raw sample count, confidence value, internal source path, or pipeline JSON payload was visible in normal UI.
- The UI does expose raw field labels and localization payloads (`Description`, `tooltip`, `passive-added`, tags, markup), which is still unacceptable production leakage.

## Console and failed-request summary

- **Fatal:** English document navigation fails with `ERR_TOO_MANY_REDIRECTS`.
- **User-visible asset failure:** item `223069` CommunityDragon icon is repeatedly blocked by ORB.
- **404s:** unknown routes and hyphenated patch slug log failed-resource 404 errors.
- **Noise:** many RSC prefetch requests to advisor/account/membership/companion are aborted (`ERR_ABORTED`). They did not break the rendered zh-TW pages but make failure triage noisy.
- **No observed:** hydration warnings, duplicate React-key warnings, uncaught page exceptions, or never-resolving loaders in the exercised routes.

## Keyboard-navigation notes

- Global navigation, search, account, locale selector, banners, and cards are tabbable.
- Visible browser/focus rings appeared on sampled controls and entity links; entity links use a stronger 2 px ring.
- `Ctrl+K` opens search and moves focus to the input; Escape closes it.
- Search fails focus restoration (F15).
- Mobile More is a real button and opens a menu sheet with the missing primary links.
- Full keyboard use of premium/advisor could not proceed because sign-in is unavailable.

## Accessibility findings

- Severe heading-order defect on landing (F14).
- Search dialog focus restoration/modal semantics defect (F15).
- Undersized high-frequency targets (F16).
- Unresolved `???` and raw markup produce nonsensical screen-reader names (F06/F08).
- Meaningful champion/augment images are often `alt=""`; surrounding links contain names, so this is acceptable where redundant, but item `223069` has neither visible art nor an image fallback description.
- Reduced-motion preference is honored in practice: CSS durations were reduced to about `0.00001s`; no persistent animation violation was observed.
- Color-only tier distinction could not be fairly tested because the live augment tier data collapsed to `A`.

## Localization findings

English is entirely inaccessible (F01), and zh-TW contains extensive untranslated content (F11/F12). Raw markup and variables appear in public names/descriptions. Terminology drifts among `增強`, `增幅`, and `增幅符文`; rarity labels use localized words on some surfaces and lowercase English enum values on detail pages. Unknown states and 404s are English/unbranded.

## Appearance and motion

No appearance switch is exposed. OS dark and light preferences produce byte-identical screenshots and the same `rgb(10,14,23)` background, so only dark mode is supported. This is not itself a blocker because no light-mode promise was found. Reduced motion passed the exercised search/modal state.

## Five most damaging customer impressions

1. “This ranking engine is making up scores from rarity and calling them Oracle data.”
2. “The app does not know which augments are actually in the game.”
3. “The paid feature is advertised even though sign-in is broken.”
4. “The localization/data pipeline is leaking raw templates directly into production.”
5. “Even the homepage, patch page, and pool builder disagree about basic current-patch facts.”

## Ten highest-value fixes

1. Fix locale canonicalization so `/`, English child routes, and `/en` cannot redirect-loop; add live integration tests.
2. Remove rarity-derived placeholder Oracle scores from public UI; fail closed to neutral/unranked until real model data exists.
3. Establish one lifecycle authority and filter removed/non-current augments from companion, champion pools, index, and search.
4. Quarantine unresolved/malformed entity names; never render raw tags/variables or `???` as valid linked records.
5. Make home, patch, pool, and index counts derive from the same current-patch snapshot and label current vs historical totals explicitly.
6. Restore Google sign-in before advertising member Advisor, or hide/disable premium CTAs with honest availability copy.
7. Proxy/cache item artwork or use a reliable fallback; test item `223069` in Chromium with ORB/CORP behavior.
8. Complete zh-TW localization for item descriptions, mechanics, roles, tags, units, and patch field labels.
9. Add localized branded 404/unknown/removed-entity states and canonical redirect for common patch slug variants.
10. Run an accessibility gate covering heading order, dialog focus restoration/modal semantics, names, and 44 px touch targets.

## Unresolved uncertainties

- Whether the redirect loop is present in the intended production host or specific to this local middleware configuration; it is unquestionably present on the supplied target.
- Whether “Oracle 67/61/56” is intentionally a temporary heuristic. The UI presents it as win-rate-derived ranking without disclosure, so intent would not reduce severity.
- Whether Google sign-in is disabled only in local configuration. The supplied release target explicitly exposes a dead premium action.
- Exact grayscale tier distinguishability, because real non-A augment tiers were absent.
- Full screen-reader output was not tested with VoiceOver; DOM semantics and keyboard behavior were inspected instead.
- Back-navigation/filter persistence after many cross-route client transitions was sampled but not exhaustively stress-tested because the higher-severity data failures already block release.

## Routes and states not successfully tested

- Any English content beyond the redirect error page.
- Real S+, S, B, C, or neutral augment frames; the product exposed only `A`.
- Authenticated member Advisor/recommendations, saved account state, and paid entitlements because Google sign-in is unavailable.
- A completed three-card Companion recommendation because current-pool integrity is already invalid and the picker exposes removed/malformed records.
- Real payment/invite redemption, desktop collector, overlay, or service-worker offline behavior.
- VoiceOver announcement sequence and browser-native zoom controls. Zoom was modeled by the equivalent CSS viewport sizes for 1280×900 at 125% (1024×720) and 200% (640×450), which exercises the responsive layout but not Chrome’s native zoom UI.

## Final merge recommendation

**BLOCK.** F01–F08 must be resolved and re-tested on the actual running product. At minimum, release requires reachable English, authoritative current-pool/lifecycle data, non-synthetic augment tiers, clean entity names, internally consistent patch facts, working or honestly disabled premium access, and a reliable item `223069` presentation. The accessibility/localization P2 cluster should also be treated as a release gate because it affects primary public routes rather than fringe content.
