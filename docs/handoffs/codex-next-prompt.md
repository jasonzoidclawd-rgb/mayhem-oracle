# Codex dispatch — current assignment: Milestone 4 (signing/packaging/governance HALF only)

You are Codex, co-implementing the Mayhem Oracle membership platform.
Contract: `docs/superpowers/plans/2026-06-13-claude-codex-split-implementation.md`.
Working agreement: `docs/superpowers/plans/2026-06-13-claude-codex-split-strategy.md`.
Status: M0, M1, and **M3A are COMPLETE** (`docs/handoffs/m3a-codex.md` ends
`M3A COMPLETE`; collector + sanitizer + gzip batch fixture all landed).

FIRST, before any work:
- If `docs/handoffs/m4-codex.md` exists here and its last line is
  `M4 SCAFFOLD COMPLETE`, print "M4 scaffold already complete" and exit.
- You are in the worktree `.worktrees/lcu-collector` but now on branch
  **`codex/model-overlay`** (the M4+M5 branch, created from the collector tip).
  Verify with `git -C . rev-parse --abbrev-ref HEAD` → must print
  `codex/model-overlay`. If not, run `git switch codex/model-overlay`. Never
  switch to main, never commit to main, never touch the main checkout.
- `node_modules` are present (shared worktree). Python stdlib + `cryptography`
  may be needed for Ed25519; if `cryptography` import fails in your sandbox,
  use the stdlib-only path (`hashlib` for sha256 + a vendored pure-Python
  Ed25519, OR shell out to `openssl`), and record the choice in the handoff.

SCOPE — this dispatch is the DATA-INDEPENDENT HALF of Milestone 4 only.
Build the model packaging, signing, release-governance, and CI scaffold that
needs NO BigQuery data. DEFER the calibration scripts that consume telemetry
(`export_training_data.py`, `calibrate.py`, `evaluate.py`) — they are blocked
on Claude's Milestone 3B BigQuery schemas. Claude will append a line to
`docs/handoffs/m3b-claude.md` reading `BQ SCHEMAS FROZEN` when that unblocks;
do not start the calibration scripts until then.

DO build now (Task 4, scaffold subset):
- `scripts/model/package_model.py` — assemble a model package from the current
  versioned engine config (`src/lib/decision/model-config.ts` values mirrored
  into a JSON the overlay can load) + `public/`-free metadata; emit a
  `ModelManifest` (shape frozen in `src/lib/contracts/model.ts`:
  modelVersion, engineVersion, dataVersion, createdAt, configSha256,
  signature) and a `model-<version>.tar.gz`.
- `scripts/model/sign_model.py` — Ed25519 sign/verify. Private key only from a
  `MAYHEM_MODEL_SIGNING_KEY` env/secret (never committed); print the public key
  for embedding in the overlay. `configSha256` = sha256 of the canonical config
  JSON; `signature` = Ed25519 over the manifest's canonical bytes.
- `scripts/model/approve_release.py` — given a built+signed package, write a
  `model_releases` row payload (columns: model_version, engine_version,
  data_version, config_sha256, signature, package_url, status in
  candidate|active|rolled-back, approved_by). Manual approval gate: refuses
  unless `--approve` is passed; flips exactly one release to `active` and the
  previous active to its prior state for rollback. Output the SQL/JSON payload;
  do NOT write to Supabase (that is Claude's service-role API surface) — just
  emit the payload + a `.sql` file.
- `.github/workflows/build-model-candidate.yml` — CI that builds + signs a
  CANDIDATE package on demand (workflow_dispatch), uploads the artifact, and
  never auto-promotes to active (governance: human approval required).
- `scripts/model/tests/**` — pin: sign→verify round-trips; a tampered config
  fails verification; approve_release refuses without `--approve`; rollback
  restores the prior active release; manifest matches the frozen contract shape.

Verify in this worktree: `python3 -m pytest scripts/model/tests` (or unittest
if pytest absent), `npm test` still green (127+), `./node_modules/.bin/eslint
src scripts` clean. One commit per logical unit with `[M4]` markers; tick the
plan's Milestone 4 checkboxes that are in scope (leave calibration boxes
unticked with a note).

RESUME PROTOCOL: re-runs on a schedule. Each run inspect `git -C . log
--oneline -10` and continue from the first incomplete in-scope item. Append one
session line to `docs/handoffs/m4-codex.md` (create on first run). Commit in
this worktree; if `git push` is sandbox-blocked, record "push pending" — Claude
scribes pushes when no codex process is live. If a usage limit interrupts,
stop; the next run resumes.

DEFINITION OF DONE (scaffold): all in-scope items built + tested green;
`docs/handoffs/m4-codex.md` written per strategy §3 (commit, fixtures: a sample
signed manifest + public key under `docs/handoffs/fixtures/m4/`, the deferred
calibration list, verification output); everything committed. End that file
with the literal last line:

M4 SCAFFOLD COMPLETE
