# Handoff: M4 Signed Model Release Scaffold - Codex
- Commits: `ec33358` red scaffold tests; `d91d53d` signed packaging; `81e3f9b` release governance; `24a8065` candidate CI; `375127b` stale-state hardening; this `[M4]` handoff commit on `codex/model-overlay`.
- Fixtures: `docs/handoffs/fixtures/m4/sample-signed-manifest.json`, `model-config.json`, and `public-key.txt`; fixture signature verifies against the mirrored current `DEFAULT_MODEL_CONFIG`.
- Verification: model `unittest` 9/9; root Vitest 127/127; scoped ESLint clean; web production build green; candidate workflow YAML parses; fixture signature valid; `git diff --check` clean. Overlay build skipped because no overlay files changed.
- Contract deltas since freeze: NONE. `ModelManifest` remains the frozen six-field shape. Ed25519 signs canonical JSON bytes of the five unsigned manifest fields; `configSha256` binds canonical model-config JSON.
- Crypto: Python `cryptography` and `pytest` are unavailable in this sandbox, so signing/verification uses OpenSSL 3.6.1. The private key is read only from `MAYHEM_MODEL_SIGNING_KEY`; only the public fixture key is committed.
- Governance: candidate CI is manual dispatch and artifact-only; it never promotes. `approve_release.py` refuses without `--approve`, verifies package signatures, emits JSON plus locked transactional SQL, preserves one active release, and supports rollback.
- Deferred until `docs/handoffs/m3b-claude.md` ends `BQ SCHEMAS FROZEN`: `export_training_data.py`, `calibrate.py`, `evaluate.py`, telemetry-driven candidate reports, and immutable R2 publication/service-role application.
- Push pending: `git push origin codex/model-overlay` is blocked by sandbox DNS (`Could not resolve host: github.com`).
- Session: 2026-06-13T11:35:34+08:00 - M4 data-independent signing, packaging, release governance, candidate CI, fixtures, and local verification complete.

M4 SCAFFOLD COMPLETE
