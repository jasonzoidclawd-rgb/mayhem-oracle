# PR 39 pickiest-customer verification — independent second review

Date: 2026-07-16 (Asia/Taipei)  
Target: `http://127.0.0.1:3000` (`next start`, final synchronized 4,658-page production build)  
Recommendation: **BLOCK**

## Independence and evidence policy

This was a fresh-context, product-first verification. I did not ask the implementation agent for reasoning and did not trust claimed fixes. I opened and exercised the live product before reading the prior review. I made no source-code changes. I read the first review only after the initial black-box route evidence existed, then re-ran every decisive check against the final rebuilt listener.

The in-app Browser plugin was available, but its required browser-control runtime was not callable in this session. I therefore used temporary Playwright/Chrome tooling outside the repository. Screenshots and machine-readable probe output are under `/tmp/pr39-pickiest-review-2`. The only repository file written by this reviewer is this report.

## Executive verdict

The remediation is substantial and closes most original blockers: English works, augment tiers are real and distributed, the current catalog is 204/204 canonical, Companion excludes removed aliases, mobile More is topmost and tappable, account/advisor fail closed honestly, item 223069 is clean, search semantics are fixed, and unknown entities are branded/localized.

It is still not release-ready for a demanding paying customer. The home and patch surfaces disagree on the number of 26.13 changes, while the patch transcript still shows ambiguous same-patch lifecycle events and raw pipeline-shaped English. The primary-nav damage simulator remains visibly incomplete. Traditional Chinese still leaks schema vocabulary, and Advisor has no H1.

Current count: **0 P0, 2 P1, 3 P2, 2 P3, 3 Taste**.

## Route-by-viewport matrix

Legend: ✓ passed exercised checks; ! rendered but finding remains; — not separately exercised at that viewport.

| Route/state | 390×844 | 768×1024 | 1280×900 | 125% | 200% | Notes |
|---|---:|---:|---:|---:|---:|---|
| `/`, `/zh-TW` landing | ✓ | ✓ | ! | ✓ | ✓ | 204 catalog count is correct; patch-change count mismatch remains |
| `/en`, `/en/champions`, `/en/augments` | ✓ | ✓ | ✓ | — | — | Direct 200s, stable English URLs, no loop |
| `/zh-TW/champions` | ✓ | ✓ | ✓ | — | — | 173 champions; localized role labels |
| `/zh-TW/champions/brand` | ✓ | ✓ | ! | — | — | 204 pool is correct; raw `passive`, `stun`, `slow` remain |
| `/zh-TW/augments` | ✓ | ✓ | ✓ | — | — | No console/hydration error; 204 cards/links/IDs |
| Real S+/S/A/B/C/neutral augment details | — | — | ✓ | — | — | Exact 1 px, cross-surface tier colors verified |
| `/zh-TW/augments/void-immolation` | ✓ | ✓ | ✓ | — | — | S tier, current, canonical metadata and Wiki link |
| `/zh-TW/augments/sonic-boom` | ✓ | ✓ | ✓ | — | — | No overflow or raw-markup title |
| Removed Missing Ping and Siphon details | — | — | ✓ | — | — | Clearly labeled removed; excluded from Companion |
| `/zh-TW/items` | — | — | ! | — | — | Mostly localized; `B.F. Sword` remains |
| `/zh-TW/items/223069` | ✓ | ✓ | ✓ | ✓ | ✓ | Icon, Desolate/荒蕪 copy, canonical and Wiki hrefs pass |
| `/zh-TW/patch-notes`, `/26.13` | ! | ! | ! | — | — | Count/lifecycle/raw-copy findings |
| `/zh-TW/patch-notes/26-13` | ✓ | ✓ | ✓ | — | — | Hyphen route now resolves to 26.13 content |
| `/zh-TW/advisor`, `/account`, `/membership` | ! | ! | ! | — | — | Honest preview notice; Advisor lacks H1 |
| `/zh-TW/companion` | ✓ | — | ✓ | — | — | Removed aliases absent; mobile nav and More link pass |
| `/zh-TW/damage-sim` | — | — | ! | — | — | Public scaffold remains unfinished |
| Search: open/results/no-result/Escape | ✓ | — | ✓ | — | — | Brand, Void Immolation and item ID 223069 resolve |
| Unknown generic/champion/augment/item/patch routes | ✓ | ✓ | ✓ | — | — | 404 status and localized branded body pass; client title caveat |
| Reduced motion | ✓ | — | ✓ | — | — | animation/transition durations clamp to ~0.00001 s |
| OS light/dark preference | ✓ | — | ✓ | — | — | dark-only product; byte-identical screenshots, no false light promise |
| Slow network, item 223069 | ! | — | — | — | — | primary content absent at DOMContentLoaded, present by ~3.0 s |

## Findings

### V01 — P1 — The same current patch still has two prominent change counts

- **Route:** `/zh-TW`, `/zh-TW/patch-notes`, `/zh-TW/patch-notes/26.13`
- **Viewport:** 390×844, 768×1024, 1280×900
- **Reproduction:** compare landing `本版本變更 8` with patch `總變更 9` / `增幅符文調整 9`.
- **Expected:** one authoritative 26.13 change total, or labels that explicitly explain different scopes.
- **Actual:** both are presented as the current patch total with no scope distinction. The catalog count itself is now consistent at 204.
- **Screenshots:** `/tmp/pr39-pickiest-review-2/zh-TW-1280x900.png`; `/tmp/pr39-pickiest-review-2/zh-TW--patch-notes-1280x900.png`
- **Console/network:** no request failure explains the mismatch; it is server-rendered content.
- **Likely owner:** dashboard metadata, patch-note summary derivation, shared patch snapshot contract.
- **Merge disposition:** **Blocks merge.** This is a first-party trust contradiction on the landing page.

### V02 — P1 — Patch lifecycle presentation remains ambiguous and pipeline-shaped

- **Route:** `/zh-TW/patch-notes`, `/zh-TW/patch-notes/26.13`, `/zh-TW/augments/missing-ping-augment`, `/zh-TW/augments/porcupine`
- **Viewport:** 390×844 and 1280×900
- **Reproduction:** inspect 26.13 changes and the removed archive. Missing Ping is an adjusted event and also archive-removed in 26.13. `豪豬` is shown as newly added/current gold and also as removed prismatic. Open the detail routes.
- **Expected:** a clear replacement/migration story such as “rarity changed from prismatic to gold,” and a clear sequence for adjusted-then-removed records.
- **Actual:** details now correctly label current vs removed, but the patch page leaves customers to infer whether these are replacements, duplicate events, or stale-source artifacts. It simultaneously labels its CommunityDragon source `來源可能已過期`.
- **Screenshot:** `/tmp/pr39-pickiest-review-2/zh-TW--patch-notes-1280x900.png`
- **Console/network:** no relevant error; the ambiguity is in accepted rendered data.
- **Likely owner:** patch-note event normalization and lifecycle reconciliation.
- **Merge disposition:** **Blocks merge.** Current roll eligibility is now correct, but the official change history is still not trustworthy enough.

### V03 — P2 — Traditional Chinese still exposes raw schema/pipeline vocabulary

- **Routes:** `/zh-TW/patch-notes`, `/zh-TW/champions/brand`, `/zh-TW/items`, removed augment details
- **Viewport:** all required viewports on representative pages
- **Reproduction:** read the Missing Ping and Desolate patch cards; inspect Brand abilities and item recipes.
- **Expected:** localized customer copy, with raw upstream fields either translated or hidden behind an explicitly technical disclosure.
- **Actual:** patch cards expose `Description`, `tooltip`, `passive-added` and full English payload sentences; archive rarity values are `Prismatic/Silver/Gold`; Brand exposes `passive`, `stun 1.75s`, `slow 0.25s`; items retain `B.F. Sword`; removed Siphon remains a fully English description. The fixed item 223069 detail itself is localized.
- **Screenshots:** `/tmp/pr39-pickiest-review-2/zh-TW--patch-notes-1280x900.png`; `/tmp/pr39-pickiest-review-2/final-definitive-zh-TW--champions--brand.png`; `/tmp/pr39-pickiest-review-2/final-definitive-zh-TW--items.png`
- **Console/network:** none relevant.
- **Likely owner:** patch-field presentation, champion detail vocabulary map, item/augment localized-name and description layer.
- **Merge disposition:** **Blocks in aggregate** with V01/V02; not alone.

### V04 — P2 — Damage simulator remains an unfinished public scaffold

- **Route:** `/zh-TW/damage-sim`
- **Viewport:** 1280×900
- **Reproduction:** open the primary/public route and inspect the calculator and reference tables.
- **Expected:** a usable calculator with data, or a clearly labeled beta/reference-only surface outside primary product navigation.
- **Actual:** attacker/target are unselected, six item slots are empty, the page reports `0 Mayhem AD items`, `0 Mayhem AP items`, and zero damage-related augments, and most formula UI is English. It reads as an internal engineering reference.
- **Screenshot:** `/tmp/pr39-pickiest-review-2/final-definitive-zh-TW--damage-sim.png`
- **Console/network:** no runtime error; the empty state is product data/state.
- **Likely owner:** damage simulator product surface and data adapters.
- **Merge disposition:** **Blocks the product-readiness gate** if this remains publicly promoted.

### V05 — P2 — Advisor has no H1 or equivalent page heading

- **Route:** `/zh-TW/advisor`
- **Viewport:** 390×844, 768×1024, 1280×900; keyboard/DOM inspection
- **Reproduction:** navigate by heading or inspect `h1` elements.
- **Expected:** a page-level heading such as `大亂鬥顧問`, even when the content is membership-gated.
- **Actual:** the page has zero H1 elements; the first visible label is the badge-like `會員專屬`. The account and membership pages do have H1s.
- **Screenshot:** `/tmp/pr39-pickiest-review-2/final-definitive-zh-TW--advisor.png`
- **Console/network:** none relevant.
- **Likely owner:** Advisor page/membership-gate composition.
- **Merge disposition:** **Accessibility gate; blocks in aggregate.**

### V06 — P3 — Slow-network streaming exposes a brief shell-only state and late network-idle

- **Route:** `/zh-TW/items/223069`
- **Viewport:** 390×844, 400 ms latency / ~50 KB/s download
- **Reproduction:** cold-load with cache disabled.
- **Expected:** stable item skeleton or immediate primary landmark.
- **Actual:** at DOMContentLoaded (~2.54 s), captured body text did not yet contain the item. It was visible by a 3.0 s mid-load capture, while network idle completed around 19.1 s. No error or broken image occurred.
- **Screenshots:** `/tmp/pr39-pickiest-review-2/final-slow-item-at-3s.png`; `/tmp/pr39-pickiest-review-2/final-definitive-slow-item-idle.png`
- **Console/network:** no console errors; late idle is largely non-blocking work/prefetch.
- **Likely owner:** route loading boundary and prefetch strategy.
- **Merge disposition:** Does not block alone.

### V07 — P3 — 404 metadata regresses after hydration

- **Route:** `/zh-TW/totally-unknown` and unknown entity routes
- **Viewport:** all required viewports
- **Reproduction:** open an unknown route and compare initial HTTP HTML title with the settled browser title.
- **Expected:** localized not-found title remains stable.
- **Actual:** HTTP HTML contains `此頁面不在當前大亂鬥目錄中 | ...`, but the settled browser title becomes generic `大亂鬥神諭 — ARAM 大亂鬥助手`. The status, branded body, H1, navigation and locale are correct.
- **Screenshot:** `/tmp/pr39-pickiest-review-2/final-definitive-zh-TW--totally-unknown.png`
- **Console/network:** expected 404 document error only; no hydration warning.
- **Likely owner:** localized not-found metadata composition.
- **Merge disposition:** Does not block alone.

## First-review remediation table

| Original | Status | Independent live evidence |
|---|---|---|
| F01 English redirect loop | **VERIFIED FIXED** | `/en`, `/en/champions`, `/en/augments` return 200 and retain English URLs |
| F02 all-A synthetic rarity-derived scores | **VERIFIED FIXED** | Real current distribution: S+ 12, S 24, A 36, B 30, C 18, neutral 84; no public numeric placeholder scores |
| F03 removed/malformed picker and 268 pool | **VERIFIED FIXED** | 204 offerable/current; Brand says 204; Companion excludes Siphon and raw Sonic payload; 204/204 IDs/links |
| F04 lifecycle contradictions | **PARTIAL** | Detail/current-picker authority is fixed; patch event history remains ambiguous (V02) |
| F05 landing 0 vs patch 9 and 268 vs current | **PARTIAL** | catalog count is 204 everywhere; landing 8 vs patch 9 remains (V01) |
| F06 Sonic Boom markup/overflow | **VERIFIED FIXED** | 390/768/1280 document widths equal viewport; clean human title |
| F07 dead premium sign-in CTA | **VERIFIED FIXED** | Advisor/account return 200, honestly state preview auth is unconfigured, and link to membership |
| F08 linked `???` entity | **VERIFIED FIXED** | `？？？` is contextualized in removed archive and is not a canonical current card/link |
| F09 item 223069 icon/raw copy | **VERIFIED FIXED** | icon loads; 荒蕪/Desolate copy is localized; no ORB or image failure |
| F10 slow loading | **PARTIAL** | shell-only at DOMContentLoaded; content appears by ~3 s; late network idle remains |
| F11 zh-TW leakage | **PARTIAL** | landing/item fixed; patch, Brand, item recipe, removed records and simulator still leak English/schema terms |
| F12 champion schema vocabulary | **PARTIAL** | role labels are localized; Brand still contains `passive`, `stun`, `slow` and opaque stat dump rows |
| F13 raw framework 404 | **PARTIAL** | body/status/navigation are branded/localized; settled client title is generic (V07) |
| F14 no landing H1 | **VERIFIED FIXED** | landing has one `Mayhem Oracle` H1 |
| F15 search focus/modal | **VERIFIED FIXED** | `aria-modal=true`; input receives focus; Escape restores invoking search button |
| F16 undersized targets | **VERIFIED FIXED** | primary selection buttons/nav are at least 44 px high; More link is 374×44 |
| F17 unfinished damage simulator | **UNRESOLVED** | V04 |
| F18 freshness ambiguity | **PARTIAL** | catalog snapshot and patch-source date are labeled separately, but patch still declares source stale without reconciling event semantics |
| F19 ID search | **VERIFIED FIXED** | `223069` returns `/zh-TW/items/223069` |
| F20 hyphen patch slug | **VERIFIED FIXED** | `/zh-TW/patch-notes/26-13` returns 200 with 26.13 content |
| T01 over-carded | **UNRESOLVED** | repeated navy cards still dominate long pages |
| T02 tiny entity art | **PARTIAL** | detail art is stronger; index/landing entity art remains small |
| T03 compressed mobile | **PARTIAL** | navigation stacking is fixed; dense picker/index walls remain |

## Data integrity and entity-frame checks

- Current augment grid: **204 cards, 204 canonical links, 204 unique hrefs, 204 unique entity IDs**.
- Current tiers: **12 S+, 24 S, 36 A, 30 B, 18 C, 84 neutral**.
- Canonical closure: `大師鑄造` → `/zh-TW/augments/forged-by-the-master`; `回春` → `/zh-TW/augments/rejuvenation`; no current `煽動群眾` card; no non-link current cards.
- Tier icon resting borders are exactly 1 px and match index/detail: S+ `rgb(255,70,85)`, S `rgb(255,140,0)`, A `rgb(59,130,246)`, B `rgb(34,197,94)`, C `rgb(107,114,128)`, neutral `rgba(148,163,184,0.12)`.
- No doubled resting frames were observed. Champion/item presentation remained visually neutral; rarity badges do not replace augment tiers.
- `/data/augments.json` top-level keys are only `patch`, `scraped_at`, `schemaVersion`, `augments`; recursive scan found no `counts`, `sources`, `winRateCoverage`, `sourcePath`, `performanceScore`, `rawScore`, `sampleCount`, or `confidence` fields.
- Apparent `confidence`/`winRate`/`pickRate` substrings in the HTML were localization-message keys; precise numeric-field regex checks found zero raw performance values.
- Void Immolation and item 223069 have canonical production metadata and correct LoL Wiki hrefs. Item and patch/detail surfaces show one Desolate/荒蕪 mechanic, with no duplicate current item event.

## Console and failed-request summary

- `/zh-TW/augments`: no console error, warning, page exception, hydration warning, or failed asset request.
- Normal 200 routes: no meaningful console errors, no broken images, no framework overlay.
- Expected 404 document navigations log failed-resource 404s; the rendered 404 state itself is correct.
- Numerous speculative Next RSC prefetches to account/advisor/membership abort with `net::ERR_ABORTED`. They did not break navigation but remain noisy.
- No observed ORB/CORS image failure, unhandled promise rejection, React key warning, or never-ending loader.

## Keyboard, touch and accessibility notes

- Desktop Tab traversal reaches nav, search, locale, account and content links with visible focus styling.
- `Ctrl+K` opens a labeled modal dialog and focuses the input; Escape restores the search button.
- Mobile Companion: all five bottom-nav centers own hit-testing. Normal More click opens a visible topmost dialog; the `裝備` link is 374×44 and normally navigates to `/zh-TW/items`.
- Reduced motion is honored in the exercised modal/navigation state.
- Remaining accessibility issue: Advisor has no H1 (V05). Settled 404 title also loses the not-found context (V07).
- VoiceOver output was not exercised; conclusions are based on DOM semantics, focus and hit testing.

## Localization review

English routing and the primary zh-TW landing/index/item flows are materially improved. The remaining failures are concentrated in technical/detail surfaces: patch raw fields and English payloads, Brand ability tokens, one English item component name, removed-record descriptions, and the damage simulator. Terminology still alternates among `增強`, `增幅`, `增幅符文`, and `增幅裝置`.

## Design-taste review

1. **Taste — over-carded:** patch, champion and landing sections still feel like nested component inventory rather than intentionally edited information hierarchy.
2. **Taste — tiny art:** entity artwork remains secondary to repeated borders/badges on index and landing surfaces.
3. **Taste — dense mobile:** the Companion and 204-card augment catalog are technically responsive but read as long compressed walls. The fixed nav/sheet behavior itself is now correct.

## Five most damaging customer impressions

1. “The homepage and official patch page still disagree about what changed.”
2. “Patch history looks like raw ingestion output, so I cannot tell whether a same-name augment was replaced or duplicated.”
3. “The damage calculator is a public engineering scaffold, not a finished feature.”
4. “Traditional Chinese detail pages still expose database-like field names and English formulas.”
5. “The main product is visually coherent, but long pages feel mechanically assembled rather than curated.”

## Ten highest-value fixes

1. Derive landing and patch change totals from one explicit semantic contract, or label differing scopes.
2. Collapse same-patch add/remove replacements into a single human-readable lifecycle event.
3. Quarantine raw patch fields (`Description`, `tooltip`, `passive-added`) from customer UI.
4. Finish or remove/demote the damage simulator until real item/augment data exists.
5. Complete zh-TW vocabulary mapping for Brand (`passive`, `stun`, `slow`) and removed records.
6. Add a real H1 to the gated Advisor page.
7. Preserve localized not-found metadata after hydration.
8. Add an item-detail loading skeleton and trim speculative prefetch noise.
9. Localize remaining item names such as `B.F. Sword` and unify augment terminology.
10. Reduce card nesting and increase entity-art hierarchy on index/landing/mobile surfaces.

## Unresolved uncertainties

- Whether the landing’s 8 intentionally excludes the adjusted-and-removed Missing Ping event; the UI does not say.
- Whether the gold/prismatic `豪豬` entries are intended as a rarity replacement. The UI does not narrate that transition.
- Whether the public damage simulator is intentionally a developer reference; it is not labeled as such.
- Full VoiceOver announcement order and grayscale-only tier recognition were not tested with assistive hardware.

## Untested routes/states

- Authenticated member Advisor recommendations, saved account state and entitlements (preview auth intentionally unconfigured).
- Payment/invite redemption, overlay/collector integration, service-worker/offline behavior.
- Every individual one of 204 augment details; representative real S+/S/A/B/C/neutral plus removed/current edge records were tested.
- Native browser UI zoom controls; CDP page-scale equivalents at 1.25× and 2× were used.
- Exhaustive back/forward/filter persistence and VoiceOver navigation.

## Final merge recommendation

**BLOCK.** The core remediation is now credible and many original release blockers are independently verified fixed. Merge should still wait for V01 and V02: one current-patch count contract and one unambiguous lifecycle narrative. The V03–V05 cluster should be treated as the accompanying localization/product-readiness/accessibility gate, especially while the unfinished simulator remains public.

---

## Post-remediation verification addendum — 2026-07-16 15:10 CST

### Scope and stop condition

I independently re-ran the named V01–V05 and merge-policy checks against the newly rebuilt production preview at `http://127.0.0.1:3000`. I did not use implementation-agent probe results as evidence and made no source-code changes. The in-app Browser runtime remained unavailable, so this pass used a new temporary Playwright/Chrome probe outside the repository. Fresh screenshots and the complete machine-readable result are under `/tmp/pr39-pickiest-review-2/post-remediation`.

The requested early-stop condition was met: V01 remains a merge blocker. I completed only the already-started targeted V01–V05 and invariant run and did not expand into another broad route matrix. The original BLOCK evidence above is intentionally preserved.

### Final finding dispositions

| Finding | Post-remediation disposition | Independent rendered evidence |
|---|---|---|
| V01 — patch-count contradiction | **UNRESOLVED — BLOCKER** | The same `/zh-TW` page now shows `本版本變更 9` in `版本概況一覽` and `本版本變更 8 個變更` in the current-change card. `/zh-TW/patch-notes` and `/26.13` show `總變更 9` / `增幅符文調整 9`. The customer still receives two totals with no scope explanation. Screenshot: `/tmp/pr39-pickiest-review-2/post-remediation/zh-TW-1280x900.png`. |
| V02 — lifecycle narrative | **VERIFIED FIXED** | Missing Ping now says it received a detected source update before archival and is currently absent from the pool. The archive explicitly says the prismatic `豪豬` is replaced by the current gold `豪豬`; the current catalog links only the canonical `/zh-TW/augments/porcupine`. The historical `/pin-cushion` route remains readable but is not a current catalog link. |
| V03 — zh-TW pipeline/English leakage | **PARTIAL; no longer a release blocker by itself** | Patch no longer exposes `Description`, `tooltip`, `passive-added`, or full English Missing Ping/Desolate payloads. Brand no longer shows raw `passive`, `stun`, or `slow`; `B.F. Sword` is absent from the item index; removed Siphon no longer shows the old English description. Residual raw synergy labels `ability` and `heal_shield`, plus untranslated names such as `Siphon`, remain on the archival detail. |
| V04 — unfinished damage simulator | **VERIFIED FIXED AS FAIL-CLOSED** | `/zh-TW/damage-sim` no longer renders the empty calculator or zero-data engineering tables. It has one H1, `傷害計算器預覽暫不開放`, and clearly says the calculator stays hidden until item/augment inputs are validated. Screenshot: `/tmp/pr39-pickiest-review-2/post-remediation/zh-TW--damage-sim-1280x900.png`. |
| V05 — Advisor heading | **VERIFIED FIXED** | `/zh-TW/advisor` now has exactly one H1, `顧問`, above the membership gate. Screenshot: `/tmp/pr39-pickiest-review-2/post-remediation/zh-TW--advisor-1280x900.png`. |

### Merge-policy invariant re-check

- `/zh-TW/augments` rendered 200 with **no console error, warning, page exception, React hydration warning, or framework overlay**.
- Current catalog remains **204 cards / 204 canonical links / 204 unique hrefs / 204 unique entity IDs**, with no non-link or duplicate current cards.
- Tier distribution remains exactly **S+ 12, S 24, A 36, B 30, C 18, neutral 84**.
- Index/detail tier borders still match at exactly 1 px: S+ `rgb(255, 70, 85)`, S `rgb(255, 140, 0)`, A `rgb(59, 130, 246)`, B `rgb(34, 197, 94)`, C `rgb(107, 114, 128)`, neutral `rgba(148, 163, 184, 0.12)`.
- Item 223069 still renders localized 荒蕪 copy, no raw `Desolate: Killing...` payload, a loaded icon, canonical self-link `/zh-TW/items/223069`, and the expected LoL Wiki link.
- Mobile Companion still has five fixed bottom-navigation targets that own their center hit tests. More opens normally; the 374×44 `裝備` target navigates to `/zh-TW/items` with no console error.
- `/data/augments.json` still exposes only `patch`, `scraped_at`, `schemaVersion`, and `augments` at top level. A complete recursive scan found none of the guarded internal/performance fields. The export contains 268 current-plus-archival records, while the current customer catalog remains 204/204 canonical.
- Repeated speculative RSC prefetches to account/advisor/membership still abort with `net::ERR_ABORTED`; no navigation, render, icon, or customer interaction failed because of them.

### Post-remediation merge recommendation

**BLOCK.** V02, V04, and V05 are now credibly resolved; the specific high-impact V03 leaks are substantially remediated; and the catalog, tier, canonical-link, mobile-nav, Desolate, console/hydration, and public-boundary invariants pass. V01 still fails on a single rendered landing page: `9` in the overview versus `8 個變更` in the current-change card. Merge should wait until those totals are identical or the two scopes are explicitly and unambiguously labeled.

---

## Final V01 closure verification — 2026-07-16 15:19 CST

This final narrow pass supersedes the earlier BLOCK recommendations while preserving their evidence above.

- Independently rechecked `/zh-TW`, `/zh-TW/patch-notes`, and `/zh-TW/patch-notes/26.13` at **390×844, 768×1024, and 1280×900** against the newly rebuilt production preview.
- The landing overview correctly presents **`本版本變更 9`** as the patch-event total.
- The separate eight-card carousel is now visibly and semantically scoped as **`有版本事件的當前增強`** with **`8 個當前卡片`**. It no longer claims that eight is the total number of patch changes.
- The patch index/detail remain authoritative at **9** (`總變更 9` / `增幅符文調整 9`). There is no longer a same-page or cross-page 9-vs-8 change-count contradiction.
- All nine route/viewport checks returned 200, had no console/page/hydration error or framework overlay, and had no horizontal document overflow. The only failed requests were non-user-visible speculative Companion RSC prefetch aborts.
- Evidence: `/tmp/pr39-pickiest-review-2/final-v01/final-v01-probe.json`, `/tmp/pr39-pickiest-review-2/final-v01/final-v01-visibility.json`, and the paired landing/patch screenshots in that directory.

### Definitive merge recommendation

**MERGE.** The sole remaining V01 blocker is independently verified resolved at every required viewport. Together with the prior addendum’s verified V02/V04/V05 fixes, materially remediated V03, and passing merge-policy invariants, this review has no remaining release blocker for PR #39. No product code was changed during verification.
