# M6 integration playbook (dry-run verified 2026-06-14)

Result of a real dry-run merge of `codex/model-overlay` (M1+M3A+M4+M5) into the
web branch's committed state. **The core code integrates cleanly** — the split
worked. Conflicts are confined to shared pipeline/state/data files.

## Merge order

The web branch (`improve/transparency-freshness-clutter`, currently being
finalized) already contains M1+M2+M3B+SEO/hotfix. `codex/model-overlay` already
contains M1+M3A+M4+M5. So integration is a **single merge**:

```
git switch -c codex/platform-integration <final web HEAD>
git merge --no-ff codex/model-overlay
```

(`codex/lcu-collector`/M3A is an ancestor of `codex/model-overlay` — no separate
merge needed.)

## Conflicts to expect, and how to resolve each

**Clean (no conflict) — the whole point of the split:** `src/lib/decision/**`,
`src/lib/scoring/**` + `overlay/src/scoring/**` (M1 identical on both sides),
`src/lib/api/**`, `supabase/**`, `overlay/**`, `src/lib/telemetry/**`,
`src/components/**`, locale pages. Verify parity at budget 0 after merging
regardless.

**Regenerate, never hand-merge (data files):**
- `public/data/combos.json`, `data/internal/patch-notes.json` → take either
  side then run `npm run update-data` (or accept the web side, which is newer).

**Take-latest / combine (state + docs):**
- `CLAUDE.md` (STATE sentinel block — disable the post-commit hook during the
  merge, then let it regenerate), `scripts/state.json` → take the web side.
- `docs/handoffs/m3b-claude.md` → take the web side (full M3B completion;
  supersedes the cherry-picked BQ-freeze stub on the overlay side).

**Real hand-merge (small, ~2 files) — both sides evolved the data pipeline:**
- `scripts/update-data.sh` — keep BOTH additions: the web side's CDragon
  hotfix step (8b) AND the overlay/M1 internal→public split steps.
- `scripts/export_public_catalog.py` — keep BOTH: the web side's hotfix-feed
  copy (`mayhem-hotfixes.json` → public) AND M1's sanitized catalog export.
- `src/lib/__tests__/public-data-boundary.test.ts` — both carry M1's version;
  reconcile to the superset of assertions.

## After resolving

```
npm test            # expect 226+ (web) plus M1 engine tests
npx eslint src scripts
npm run build
(cd overlay && npm run build)
(cd overlay/src-tauri && PATH=/opt/homebrew/bin:$PATH cargo test)   # homebrew openssl/python
python3 -m unittest discover -s scripts/model/tests                  # python ≥3.11
# cross-parity + overlay-decision-parity must be budget 0
```

Then the security/privacy + product review (plan Milestone 6), and **merge to
main is the human gate** — do not automate it.

## Env requirements (from earlier findings)

- CI must pin **Python ≥3.11** (model scripts use PEP-604 `dict | None`; fails on
  macOS system 3.9).
- Ed25519 signing needs **OpenSSL 3** (homebrew), not macOS LibreSSL.
- Deploy-time provisioning + the AdSense/Vercel-Hobby hosting decision are in
  `INTEGRATION-READY.md` / `hosting-spike.md`.

## Status

Do NOT run M6 yet: the web branch is still being actively finalized (hotfix UI +
review hardening in progress in the main checkout). Re-run this dry-run against
the final web HEAD before the real merge — the conflict set above is stable
(pipeline/state/data), but the web HEAD is moving.
