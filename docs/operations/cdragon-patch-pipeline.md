# CDragon Patch, Hotfix, and PBE Pipeline

## Source authority

CommunityDragon is the structural authority for champion, item, and augment
changes. The pipeline snapshots normalized entities from both `latest` and
`pbe`, compares stable canonical IDs, and records deterministic CDragon events.
Riot patch articles are metadata only: title, publication date, canonical URL,
authors, and optional introduction. They do not supply entity changes, kinds,
links, additions, removals, or hotfixes.

## Lanes and storage

Each CDragon branch has its own source version, observed timestamp, and three
committed snapshots:

- `data/internal/cdragon-{augment,champion,item}-latest.json` — live lane.
- `data/internal/cdragon-{augment,champion,item}-pbe.json` — preview lane.
- `data/internal/patch-events.json` — latest events and current open live
  cycle.
- `data/internal/pbe-preview.json` — PBE lifecycle archive, including landed
  and aged-out entries for reconciliation.

`latest` is live/current-patch data. `pbe` is display-only preview data and
must never enter scoring, Advisor inputs, or any live catalog. A PBE preview is
initially compared to a read-only latest baseline; that comparison is recorded
in event provenance and does not merge the two lineages.

## Promotion and recovery

`python3 scripts/cdragon_patch_pipeline.py --branch latest` or `--branch pbe`
fetches every required payload for that branch before writing anything. It
rejects missing/duplicate canonical IDs, malformed responses, abrupt coverage
loss, lane mismatch, and version regression. A PBE version regression starts a
fresh PBE lineage and ages the prior open entries instead of emitting false
removals.

The three branch snapshots and their archive are promoted through a journaled
transaction. If a process dies mid-write, the next promotion restores the prior
file set before acquiring new data. A failed PBE fetch does not mutate latest;
a failed latest fetch does not create preview data.

Promotions also take a per-repository process lock outside the checkout so a
manual run cannot interleave with a scheduled run through the shared journal.
Remote payloads are bounded to 128 MiB and have finite network timeouts; an
oversized, malformed, or truncated response fails closed. A PBE poll whose live
baseline is missing, non-fresh, or more than 36 hours old is retained internally
as unconfirmed and is not exported as a truthful preview.

When latest source values exactly match an open PBE event's target values, the
PBE event becomes `landed`. It leaves the public upcoming list and the live
projection marks the related event as landed from PBE. Time, prose similarity,
and release-date guesses never mark an event as landed.

## Public projection and freshness

`scripts/export_public_catalog.py` is the only export boundary. It creates:

- `public/data/patch-notes.json` — current live CDragon event cycle rendered
  into the existing patch-card route contract, plus bounded Riot metadata for
  historical URLs.
- `public/data/pbe-preview.json` — only active, current-cycle preview events.

The preview projection filters by the archive's current cycle as well as
`upcoming` lifecycle, so an older open entry retained for aging never leaks into
the public window. `entity-presentation.json` is the separate public-safe
EntityRef/stat projection used by detail pages, cards, search, and related
links; it contains only normalized current values plus current-cycle live/PBE
stat changes. `verify_patch_publish.py` requires the entity projection as well
as both public patch files when their corresponding internal snapshots or
archives change. Public catalog files are staged and journal-promoted together
so an export failure leaves the previous complete public set intact.

Raw snapshots, comparison provenance, lifecycle history, internal scoring
fields, and calibration data stay under `data/internal/`. PBE links are emitted
only when the entity already exists in the live public catalog. The patch UI
uses day-level detected-at freshness and distinguishes fresh zero changes from
stale, unavailable, or not-yet-confirmed source state.

## Entity presentation

`public/data/entity-presentation.json` is the only browser-safe source for
canonical EntityRefs and structured detail-page stats. `EntityLink` resolves by
type plus canonical CDragon ID, then supplies the localized name, stable route,
icon, lifecycle state, and an accessible combined link. Unknown IDs, duplicate
IDs, missing locales, and missing presentation fields fail closed. Champion base
stats, item cost/stats, and augment rarity are emitted only when their CDragon
field semantics are explicit; descriptions remain neutral prose and are never
used to derive balancing values. The legacy Mayhem-only item rows are enriched
with their explicit CDragon IDs during export so their cards and detail pages
share the same canonical resolver.

## Operator workflow

The daily `.github/workflows/update-data.yml` performs both lane promotions as
part of the full data refresh. `.github/workflows/update-pbe-preview.yml` polls
PBE every six hours. Both use the same GitHub Actions concurrency group so they
cannot race a snapshot/export transaction.

For a local recovery or inspection:

```bash
python3 scripts/cdragon_patch_pipeline.py --branch latest
python3 scripts/cdragon_patch_pipeline.py --branch pbe
python3 scripts/scrape_patch_notes.py
python3 scripts/export_public_catalog.py
python3 scripts/verify_patch_publish.py
npx vitest run src/lib/__tests__/public-data-boundary.test.ts
npm run build
python3 scripts/verify_public_bundle_boundary.py
```

Do not hand-edit `public/data/` or snapshot JSON. Inspect the diagnostic, fix
the source/adapter issue, and rerun the complete affected branch transaction.
