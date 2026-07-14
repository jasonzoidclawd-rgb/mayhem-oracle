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
