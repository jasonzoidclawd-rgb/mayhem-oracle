# Codex dispatch — current assignment: Milestone 4 calibration half (now UNBLOCKED)

You are Codex, co-implementing the Mayhem Oracle membership platform.
Contract: `docs/superpowers/plans/2026-06-13-claude-codex-split-implementation.md`.
Working agreement: `docs/superpowers/plans/2026-06-13-claude-codex-split-strategy.md`.
Status: M0, M1, M3A, and the **M4 signing/packaging/governance scaffold are
COMPLETE** (`docs/handoffs/m4-codex.md` ends `M4 SCAFFOLD COMPLETE`).
Claude has now **frozen the BigQuery schema** — `docs/handoffs/m3b-claude.md`
ends `BQ SCHEMAS FROZEN`, schema at `scripts/telemetry/bigquery-schema.sql`,
contract test `src/lib/__tests__/telemetry-schema.test.ts`. Calibration is
unblocked.

FIRST, before any work:
- If `docs/handoffs/m4-codex.md` ends with `M4 CALIBRATION COMPLETE`, print
  "M4 calibration already complete" and exit.
- Confirm `git -C . rev-parse --abbrev-ref HEAD` → `codex/model-overlay`. Never
  touch main or the main checkout. node_modules are present.
- Confirm the schema is on this branch: `scripts/telemetry/bigquery-schema.sql`
  must exist. If absent, stop and record "schema missing" in the handoff.

TASK: build the data-dependent half of Milestone 4 — the calibration pipeline.
There is NO real telemetry yet, so build every script to run against a LOCAL
FIXTURE that mirrors the four BigQuery tables (NDJSON or CSV under
`scripts/model/fixtures/`), with the BigQuery client behind a thin data-source
interface so production swaps the source without touching calibration logic.

Build:
- `scripts/model/export_training_data.py` — read the four tables (fixture
  source now; BigQuery later) and emit a training dataset. Export ONLY approved
  fields from the frozen schema. Exclude `quality_quarantine` rows and any
  match under 480 seconds.
- `scripts/model/calibrate.py` — produce a CANDIDATE model config (same shape
  package_model.py already consumes):
  - round effects ONLY from `contributor_round_choices` (the round-ordered signal)
  - final augment/item/champion associations + outcomes ONLY from
    `participants` (snowball final-state has no round order — do not invent it)
  - deterministic; emit the same config bytes for the same input.
- `scripts/model/evaluate.py` — candidate report: sample counts by
  patch/champion/augment/round, calibration deltas vs the active model,
  competitive vs exploration ranking stability, trap-warning regressions,
  and parity-fixture results. Require manual approval before release (wire to
  the existing `approve_release.py`; never auto-promote).
- Extend `scripts/model/tests/**`: calibration is deterministic; quarantined and
  sub-eight-minute rows are excluded; round effects derive only from
  contributor data; a known fixture yields an expected candidate config.

Honor the plan's governance: candidate → manual approval → sign → version →
rollback-able. No model auto-publishes learned weights.

Verify in this worktree (homebrew openssl must be on PATH for Ed25519):
`PATH=/opt/homebrew/bin:$PATH python3 -m unittest discover -s scripts/model/tests`,
`npm test` green, `./node_modules/.bin/eslint src scripts` clean. One commit per
logical unit with `[M4]` markers; tick the Milestone 4 calibration checkboxes.

KNOWN ISSUE to fix while here: `sign_model.py` calls bare `openssl`, which is
LibreSSL (no Ed25519) on default macOS PATH — tests only pass with homebrew
openssl first. Make it robust: resolve an OpenSSL 3.x binary explicitly
(`shutil.which` preferring `/opt/homebrew/bin/openssl`), or switch to the
`cryptography` library if importable. Record the choice.

RESUME PROTOCOL: re-runs on a schedule; continue from the first incomplete
item, append a session line to `docs/handoffs/m4-codex.md`. Commit here; if
`git push` is sandbox-blocked, record "push pending" — Claude scribes. If a
usage limit interrupts, stop; next run resumes.

DEFINITION OF DONE: calibration scripts built + tested green against fixtures;
a sample candidate config + evaluation report under
`docs/handoffs/fixtures/m4/`; `docs/handoffs/m4-codex.md` updated. End that file
with the literal last line:

M4 CALIBRATION COMPLETE
