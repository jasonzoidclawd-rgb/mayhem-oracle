# Current GitHub Context

Last verified locally for this docs update: `2026-07-06`.

This file is context only. Re-verify with `gh` before making merge or release
decisions.

## 2026-07-06: SEO/GEO + auth hardening arc (direct pushes to main, no PRs)

Commits `2863be9..ddf2ca9` landed the post-P5 review follow-ups directly on
`main` (deployed to wasfun.lol; verified live):

- Detail-page SEO: patch summaries on augment + item pages, localized in all
  five locales; JSON-LD builders require `homeUrl`; SEO helper import-boundary
  test (`seo-helper-boundary.test.ts`); `generateStaticParams` fails loudly.
- Auth: locale-aware signout, case-insensitive next blocklist, locale-prefix
  stripping derived from `routing.locales`, GoogleSignInButton localized with
  provider errors bucketed (raw errors console-only).
- Verifiers: `scripts/verify_live_jsonld.py` (+ unittest) owns the
  augment/item/champion structured-data moat check — 15 checks, JSON-LD-parse
  only. Patch-note verifier untouched. Data guard: `meta.json` and
  `augments.json` patch values are pinned together in data-integrity tests.
- Riot full-locale expansion stays gated — see the 2026-07-06 addendum in
  `docs/plans/2026-07-02-full-riot-locale-coverage.md` (demand gate, content
  depth bar, tiering) before starting L1.

Post-deploy checks for future pushes: `python3 scripts/verify_live_jsonld.py
--base-url https://wasfun.lol` and `python3 scripts/verify_live_patch_seo.py
--base-url https://wasfun.lol`.

## Recent PR State

| PR | State | Branch / merge commit | Notes |
| --- | --- | --- | --- |
| #18 | Merged | `9d6902c823b42000bae01f342913d7af2f1dab4c` | SP1 pool-add hardening and 26.13 ingest. CDragon became first-party live evidence while official removal/disable/tombstone/conflict precedence stayed higher. |
| #19 | Merged | `7be1f9d6ebfe13b53fc308c738c86880e3b1aef1` | SP2 freshness unknown-state reporting. |
| #20 | Merged | `09a148fc58eccdcf7987115ddea1590ca60b5bb1` | Freshness JSON stdout hotfix. |
| #21 | Merged | `3717b1f2625cc35ab21781c7becbfde7e1da487c` | Overlay focus-safety split: consent and collector controls moved out of the fullscreen transparent overlay. |

Verification command used for #21:

```bash
gh pr view 21 --json number,state,mergedAt,mergeCommit,headRefName,baseRefName,url,title --jq '.'
```

Observed result after merge: PR #21 was `MERGED` at `2026-07-01T03:34:04Z` with merge commit `3717b1f2625cc35ab21781c7becbfde7e1da487c`.

## Data State At Verification

- Public augment count: `268` from `jq '.augments | length' public/data/augments.json`.
- `CLAUDE.md` line count before this docs update: `82`.
- `AGENTS.md` line count before this docs update: `65`.
- Keep `CLAUDE.md` and `AGENTS.md` as short pointers; put detailed context in
  `docs/handoffs/*` or `docs/plans/*`.

## Scope Notes For Future Agents

- Do not modify or revert PR #21 overlay behavior as part of context updates.
- Do not mix SP1/SP2 data freshness work into overlay or roadmap docs unless a
  task explicitly asks for it.
- Do not hand-edit generated data under `public/data/`.
- There may be a separate 26.12 scoring-engine docs branch or plan lineage.
  Treat this docs context branch as potentially conflicting with that branch
  only in documentation files, not runtime scoring code.
