# M6 integration — ALTERNATIVE solution: deterministic assembly

A second, deliberately different approach to the same M6 integration, so the two
can be compared head-to-head. The first approach lives in
[`M6-INTEGRATION-PLAYBOOK.md`](./M6-INTEGRATION-PLAYBOOK.md) — a single big-bang
`git merge` that resolves whatever conflicts git surfaces. This one **assembles**
the integration tree deterministically and never lets git silently auto-merge.

Both produce the same final tree. They differ in *process, risk surface, and
auditability*.

## Why a different approach is even possible

The merge dry-run found "core code merges clean." Quantifying that against the
real trees (root `c9520ce`) turns the hand-wave into a structural fact:

| Bucket | Files | Action |
|---|---:|---|
| Web-exclusive (web touched, Codex didn't) | 85 | already correct — branch from web |
| Codex-exclusive (Codex touched, web didn't) | 48 | copy wholesale — **conflict-free by construction** |
| Shared, byte-identical across both tips | 49 | no-op |
| Shared, genuinely differ across tips | **14** | reconcile (see below) |

And the load-bearing invariant — the six files an engine bug would hide in are
**byte-identical** on both arms:

```
IDENTICAL  src/lib/contracts/decision.ts
IDENTICAL  src/lib/contracts/model.ts
IDENTICAL  src/lib/contracts/telemetry.ts
IDENTICAL  src/lib/decision/evaluate.ts
IDENTICAL  src/lib/scoring/pool-orchestrator.ts
IDENTICAL  overlay/src/scoring/pool-orchestrator.ts
```

So 133 of the 159 touched files are mechanical (copy / leave / no-op), and the
entire decision engine needs no reconciliation at all. That's what makes
assembly safe: there is almost nothing to *decide*, only to *place*.

## The thesis

A 3-way `git merge` reasons over the **whole tree** and only stops on same-hunk
collisions (~7). The other ~56 shared files it auto-merges **silently** — and a
text-correct auto-merge can still be semantically wrong (interleaved JSON
entries, two scripts' steps spliced in the wrong order). You then trust git on
all 56.

Assembly inverts that: place the disjoint files deterministically, and force
**every** divergence into an explicit, enumerated decision. Nothing merges
behind your back, and the procedure is **reproducible** — re-run it against a
moving web HEAD and get a byte-identical result.

## Procedure

```bash
#!/usr/bin/env bash
# M6 deterministic assembly. Run from a clean checkout. Produces codex/platform-integration.
set -euo pipefail
WEB="${1:-improve/transparency-freshness-clutter}"   # pass the FINAL web HEAD
CODEX="${2:-codex/model-overlay}"                    # Codex integration tip
ROOT="$(git merge-base "$WEB" "$CODEX")"             # c9520ce

# Branch FROM web: its 85 exclusive + 49 identical-shared files are already correct.
git switch -c codex/platform-integration "$WEB"

# Phase 1 — Codex-exclusive paths (48). Web never touched them => copying cannot
# conflict. This is the whole engine/overlay/model feature set, placed verbatim.
comm -23 <(git diff --name-only --diff-filter=ACMR "$ROOT".."$CODEX" | sort) \
         <(git diff --name-only "$ROOT".."$WEB" | sort) > /tmp/m6-codex-only.txt
xargs -a /tmp/m6-codex-only.txt -r -I{} git checkout "$CODEX" -- "{}"

# Phase 2 — the ONLY files that need a human (6 of the 14 differing). Hand-edit:
#   combine  (union both arms' steps, order matters):
#     scripts/update-data.sh                  # web hotfix step 8b + Codex internal->public split
#     scripts/export_public_catalog.py        # web hotfix-feed copy + M1 sanitized catalog export
#     .github/workflows/update-data.yml       # CI steps from both arms
#   reconcile (semantic):
#     src/app/[locale]/augments/page.tsx          # web paywall gating + M1 data wiring
#     src/app/[locale]/champions/[slug]/page.tsx  # web entitlement gate + M1 data wiring
#     src/lib/__tests__/public-data-boundary.test.ts  # union of both arms' assertions

# Phase 3 — regenerate derived data with the now-combined pipeline. NEVER hand-merge JSON.
#   data/internal/{champions,items,patch-notes}.json, public/data/combos.json
npm run update-data

# Phase 4 — the remaining 4 differing files are take-web no-ops (we branched from web):
#   CLAUDE.md, scripts/state.json, docs/handoffs/m3b-claude.md,
#   docs/superpowers/plans/2026-06-13-claude-codex-split-implementation.md
# Nothing to do.

git add -A
git commit -m "M6: assemble Codex engine/overlay onto web platform"

# Phase 5 — stitch ancestry so the 27 Codex commits aren't lost to a flat commit.
# -s ours records CODEX as a second parent WITHOUT changing the assembled tree.
git merge -s ours "$CODEX" -m "M6: record Codex arm ancestry (tree already assembled)"
```

## The 14 differing files, classified

- **Take-web / no-op (4):** `CLAUDE.md`, `scripts/state.json`,
  `docs/handoffs/m3b-claude.md`, `…/split-implementation.md` — branching from web
  already gives the right version.
- **Regenerate (4):** `data/internal/{champions,items,patch-notes}.json`,
  `public/data/combos.json` — derived artifacts; produced by the combined pipeline.
- **Combine pipeline (3):** `scripts/update-data.sh`,
  `scripts/export_public_catalog.py`, `.github/workflows/update-data.yml`.
- **Reconcile code (3):** the two locale pages + `public-data-boundary.test.ts`.

## Verification

Same gate as the merge playbook:

```
npm test                 # 226 web + M1 engine tests
npx eslint src scripts
npm run build
(cd overlay && npm run build)
(cd overlay/src-tauri && PATH=/opt/homebrew/bin:$PATH cargo test)
python3 -m unittest discover -s scripts/model/tests   # python >=3.11
# cross-parity + overlay-decision-parity must be budget 0
```

Extra assembly-only check — prove the result equals what a merge would yield:

```bash
git merge-tree --write-tree "$WEB" "$CODEX" >/dev/null && echo "merge is clean too"
git diff codex/platform-integration <merge-result-tree>   # expect only the 6 reconciled files
```

## Head-to-head

| Axis | A — big-bang merge (playbook) | B — deterministic assembly (this doc) |
|---|---|---|
| Mechanism | `git merge --no-ff` over whole tree | branch web → place 48 exclusive → reconcile 6 |
| Files surfaced for review | ~7 (same-hunk collisions only) | 14 enumerated up front |
| Silent auto-merges | 56 shared files (trust git) | **0** |
| Files needing human judgment | ~7 (whatever git flags) | **6, known in advance** |
| Reproducible vs moving web HEAD | depends on merge-base/git version | **deterministic, identical re-runs** |
| History / ancestry | native merge commit, Codex lineage intact | flat — unless stitched via `-s ours` (Phase 5) |
| Failure mode | a wrong silent auto-merge slips through | forget a Codex-exclusive path / verbose |
| Best when | arms are genuinely entangled | **arms own disjoint trees ← verified here** |

## Recommendation

For *this* integration, assembly is the lower-risk option: disjointness is
verified (contracts byte-identical, 48 Codex files conflict-free by
construction), so it converts "trust git on 56 files" into "place files
mechanically + consciously reconcile 6," and the run is reproducible against the
still-moving web HEAD. Phase 5 buys back the one thing the merge gives for free —
ancestry. Keep the merge playbook as the fallback if cross-arm entanglement grows
before the real run.

Same gate as before: **merge to `main` is the human decision**, after the
security/privacy + Riot review. Do not automate it.

## Execution record (2026-06-16) — B was run

Built branch **`integration/m6`** (pushed). Web HEAD had stopped moving
(`9157a3c`, 2026-06-15, local==origin), so it was taken as the final snapshot.

What actually happened was *simpler* than the plan feared. Verifying "what does
taking web drop from codex" on all 6 shared-differing files showed **web is a
strict superset** of codex on every one:

- `update-data.sh`, `update-data.yml`, `export_public_catalog.py`, `augments/page.tsx`
  — web already absorbed M1's internal→public split and added more on top.
- `champions/[slug]/page.tsx` + `public-data-boundary.test.ts` — the only
  codex-only content web lacks is the **client-side augment rankings + login
  gate web deliberately removed** to close the paywall (no public augment
  win-rates, per Riot policy). Keeping web is *required*, not just convenient.

So the pipeline-combine and data-regen phases were **no-ops** — the integration
reduced to **Phase 1 alone**: place the 48 Codex-exclusive files
(M3A collector + M4 model pipeline + M5 overlay coach). Codex added **zero** npm
deps. Then Phase 5 stitched ancestry.

Commits: `8475472` (assemble) → `f56773a` (`merge -s ours codex/model-overlay`,
parents `8475472 7c4f0dd`, tree unchanged). Zero conflict markers; the 48 placed
files are byte-identical to the codex tip.

**Verified here:** `vitest run` → **234/234 pass, 25 files** (web's 226 + the new
`overlay-decision-parity` suite's 8). The parity suite needs `overlay/node_modules`
on the resolution path (it pulls `@tauri-apps/api` via `overlay/src/auth/member.ts`);
CI must `cd overlay && npm install` before the root suite, or it fails to load.

**Deferred to CI** (cross-language, as designed): `cargo test` / `tauri build`
for the Rust M3A+M5 (needs homebrew OpenSSL), `python3 -m unittest` for M4
(needs ≥3.11), `npm run build` + `(cd overlay && npm run build)`. `eslint`/Next
build unchanged from web's green state (only one root-`src` file was added: the
parity test).

Branch stops before `main`. Security/privacy + Riot review remain the human gate.
