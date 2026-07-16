# Entity presentation follow-up handoff

Date: 2026-07-14
Branch: `followup/entity-presentation`
Dependency: merged patch/hotfix/PBE pipeline PR #38

## Baseline and source decision

- The worktree was clean at `8d3a07a` before this goal; the unrelated
  `CLAUDE.md` and `scripts/state.json` changes were preserved.
- Port 3000 remains the target worktree server. Visual QA reused a rebuilt
  production-equivalent server on port 3001 after verifying its cwd.
- CommunityDragon latest/PBE snapshots and the normalized canonical IDs are
  the structural authority. Riot prose remains metadata-only.
- The current registry, Kiwi definitions, and live Tencent signal agree that
  `terraind`, `surge-field`, `squishy-slappy-grab`, `porcupine`, `its-go-time`,
  and `from-downtown` are current. The old tombstones are stale aliases, not
  removal evidence.

## Lifecycle result

| slug | before | after | canonical ID | route |
| --- | --- | --- | --- | --- |
| `terraind` | removed / unverified legacy | active / confirmed live | `Terraind` | `/augments/terraind` |
| `surge-field` | removed / unverified legacy | active / confirmed live | `SurgeField` | `/augments/surge-field` |
| `squishy-slappy-grab` | removed / unverified legacy | active / confirmed live | `SquishySlappyGrab` | `/augments/squishy-slappy-grab` |
| `porcupine` | removed / unverified legacy | active / confirmed live | `PinCushion` | `/augments/porcupine` |
| `its-go-time` | removed / unverified legacy | active / confirmed live | `ItsGoTime` | `/augments/its-go-time` |
| `from-downtown` | removed / unverified legacy | active / confirmed live | `ARAM_BangBang` | `/augments/from-downtown` |

`Forged By The Master` (`2127`) is also active and routeable. The historical
`pin-cushion` alias remains removed, and `upgrade-sword-of-blossoming-dawn`
remains removed; the generic CDragon namespace is intentionally allowlisted so
legacy rows cannot be revived accidentally.

## Presentation and route changes

- Shared `EntityRef`, `EntityLink`, `EntityIcon`, section heading, tag, meter,
  inline stat, patch-change, and entity-card primitives now serve champions,
  items, and augments.
- Regular item links use numeric canonical IDs; only the seven approved
  Mayhem-exclusive item routes use slugs. Unknown records are icon/name-only,
  with no invented href.
- Duplicate canonical IDs prefer an active routeable catalog row over a removed
  historical alias; equal-confidence duplicates fail closed.
- Wooglet's Witchcap uses Mayhem catalog stats/effects (300 AP, 20 haste,
  50 armor, Stasis/Magical Opus) while the entity projection supplies identity,
  icon, lifecycle, and bounded patch data. No unstructured prose references
  were converted into related-entity links because the source has no structured
  relation records for them.
- Champion detail uses the ability-card language and compact structured stat
  lines; the old `EntityStats` tile component is deleted. Augment tier is an
  icon-frame/data attribute; rarity remains a separate localized tag.
- Patch projection text is localized for all five locales and uses human labels
  instead of raw dotted source paths.

## Verification evidence

- `npm test`: 66 files, 474 tests passed.
- `PYTHONPATH=scripts python3 -m unittest discover -s scripts -p 'test_*.py'`:
  165 tests passed.
- `npx eslint src scripts`: passed.
- `npm run build`: passed; 4,623 static pages generated.
- `python3 -m compileall -q scripts`: passed.
- `python3 scripts/verify_public_bundle_boundary.py`: 44 files scanned, 0 leaks.
- `python3 scripts/verify_patch_publish.py`: 8 current-cycle changes,
  100% zh-TW text coverage, fresh structured-diff source.
- Re-export hash comparison is byte-stable for entity, patch, PBE, and augment
  public files.
- Final route crawl: 1,334 emitted hrefs and 887 known projected entities,
  0 broken/soft-404 destinations. Six lifecycle routes pass in all five
  locales with no false removed label.
- Browser payload/body checks found no raw CDragon snapshots, internal PBE
  loaders, `source_path`, `coefficient1`, or `Effect2Amount` text.

Screenshots are retained outside the repository under `/private/tmp/`:

- `entity-final-home-zhTW-desktop.png`
- `entity-final-brand-zhTW-desktop.png`
- `entity-final-wooglet-zhTW-mobile.png`
- `entity-final-augment-zhTW-desktop.png`
- `entity-final-porcupine-zhTW-mobile.png`
- `entity-final-item-3168-zhTW-mobile.png` (expected unavailable route)

The in-app Browser backend was unavailable (`Browser is not available: iab`),
so the screenshots and navigation checks used the repository's installed
host-context Playwright Chromium runner. Port 3000 was not killed or replaced.

## PR #39 pickiest-customer final gate

Date: 2026-07-16

### Reviewer independence and recommendations

- First reviewer: a fresh-context independent agent using the strongest model
  available to the collaboration runtime and maximum practical review effort.
  The runtime does not expose an exact model identifier. It received the
  product requirements and routes but no implementation reasoning or
  self-assessment, inspected the live port-3000 production build before any
  handoff, made no product-code changes, and initially recommended **BLOCK**.
- First-pass findings: **0 P0, 8 P1, 10 P2, 2 P3, 3 Taste**.
- Verification reviewer: a second fresh-context independent agent under the
  same strongest-available-model constraint. It received the original
  requirements, first-review findings, and successive final previews, made no
  product-code changes, preserved each BLOCK result, and issued the definitive
  recommendation **MERGE** only after independently confirming the last V01
  fix at 390x844, 768x1024, and 1280x900.
- First report: `docs/handoffs/pr39-pickiest-customer-review.md`.
- Verification report: `docs/handoffs/pr39-pickiest-customer-verification.md`.
- Screenshot and probe evidence remains outside the repository in
  `/tmp/pr39-pickiest-review-1` and `/tmp/pr39-pickiest-review-2`.

### Finding disposition

| Finding | Final disposition |
| --- | --- |
| F01 English redirect loop | Fixed; `/en` and English child routes return 200 without canonicalization loops. |
| F02 synthetic all-A tiers/scores | Fixed; no synthetic numeric score is published. Current distribution is 12 S+, 24 S, 36 A, 30 B, 18 C, and 84 neutral. |
| F03 removed/malformed picker records | Fixed; current catalog and Companion use 204 offerable records with 204 canonical links. |
| F04 lifecycle contradiction | Fixed; removed aliases are excluded, Missing Ping narrates archival ordering, and Pin Cushion points to the current Gold Porcupine replacement. |
| F05 landing/patch/count contradiction | Fixed; patch-event total is 9, while the narrower carousel explicitly says 8 current cards with patch events. |
| F06 Sonic Boom overflow/raw title | Fixed; sanitized name and no horizontal overflow at required viewports. |
| F07 dead premium action | Fixed fail-closed; preview auth unavailability is explicit and no working sign-in is falsely promised. |
| F08 unresolved `???` link | Fixed; unresolved archive data is contextualized and not emitted as a valid canonical current link. |
| F09 item 223069 icon/raw copy | Fixed; icon loads, copy is localized, and Desolate/荒蕪 plus canonical links pass. |
| F10 slow-network shell | Improved with an item loading boundary; residual shell-only time at DOMContentLoaded is accepted as non-blocking P3 because content appeared by about 3 seconds with no error or broken asset. |
| F11 zh-TW leakage | Materially fixed on landing, item, patch, Brand, and removed-record surfaces. Residual untranslated archival names and low-level synergy labels are retained as non-blocking localization debt. |
| F12 champion schema vocabulary | Fixed for customer-critical role, kit, passive, stun, and slow labels; remaining archival/internal taxonomy prose is non-blocking. |
| F13 raw 404 | Fixed for status, localized body, H1, navigation, and locale. The settled generic client title remains accepted P3 V07. |
| F14 landing heading order | Fixed with one H1. |
| F15 search modal/focus | Fixed; modal semantics, input focus, Escape, and trigger focus restoration independently pass. |
| F16 undersized targets | Fixed for primary mobile/navigation/selection targets; More link is 374x44 in verification. |
| F17 unfinished damage simulator | Fixed fail-closed; scaffold and zero-data tables are hidden, route is removed from promotion/sitemap, noindexed, and explains input verification is incomplete. |
| F18 freshness/lifecycle ambiguity | Fixed for dataset scope and lifecycle narration; the source-date warning remains intentionally honest provenance. |
| F19 item-ID search | Fixed; `223069` resolves canonically. |
| F20 patch hyphen slug | Fixed; `/26-13` resolves to the canonical 26.13 content. |
| T01 over-carded | Accepted, deferred; changing the visual language is outside this consistency repair. |
| T02 tiny entity art | Partially improved on detail surfaces; remaining index hierarchy is accepted Taste debt. |
| T03 compressed mobile | Navigation and overlay behavior fixed; remaining catalog density is accepted Taste debt. |
| V06 slow network | Accepted non-blocking P3; no error, content visible by about 3 seconds. |
| V07 hydrated 404 title | Accepted non-blocking P3; hard 404, localized body/H1/navigation, and initial localized metadata remain correct. |

No reviewer finding was rejected as invalid. Findings were either fixed,
materially reduced and explicitly accepted at P3/Taste, or preserved as honest
unsupported-state messaging. Synthetic fixtures were not used as resolution
proof; every merge-policy invariant was confirmed against the running product.

### Final production and automated evidence

- `npm test`: 68 files, **482 tests passed**.
- `PYTHONPATH=scripts python3 -m unittest discover -s scripts -p 'test_*.py'`:
  **191 tests passed**.
- `npx eslint src scripts`: passed.
- `git diff --check`: passed.
- `npm run build`: passed; **4,658 static pages** generated.
- `python3 scripts/verify_public_bundle_boundary.py`: **46,131 files**, 0 leaks.
- `python3 scripts/verify_patch_publish.py`: 9/9 current-cycle events,
  100% zh-TW coverage, fresh source status.
- Live JSON-LD: **15/15** passed; live patch SEO: **31/31** passed.
- Browser smoke: required mobile/desktop routes have no overflow, page errors,
  failed requests, or `/zh-TW/augments` console/hydration errors; expected hard
  404 document requests alone log 404 resource messages.
- Entity closure: 204 current cards, 204 unique IDs, 204 canonical links;
  Forged By The Master and Rejuvenation resolve, while the retired Rabble
  Rousing alias is absent.
- Void Immolation and item 223069 both expose localized Desolate/荒蕪 and
  canonical links. Cross-surface tier colors and exactly 1 px resting borders
  were independently verified.

### GitHub-hosted checks and draft decision

GitHub displays `test-and-lint`, `python-pipeline-tests`, and `Build Windows
Tauri overlay` as failures, but every job has zero executed steps and the check
annotations state that the jobs were not started because recent account
payments failed or the spending limit must be increased. This is an external
account-billing blocker, not a code failure and not a green check.

The local branch contains current `origin/main`, all local release gates pass,
and the independent reviewer recommends MERGE. Code and review are ready to
leave draft, but **PR #39 should remain draft until the billing issue is cleared
and the required GitHub-hosted jobs actually execute**. This external blocker
is the only reason not to mark the PR ready now.
