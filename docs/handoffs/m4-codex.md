# Handoff: M4 Offline Calibration and Signed Model Releases - Codex
- Commits: scaffold `ec33358` through `54393df`; calibration `9dd7d04` through `884995b` on `codex/model-overlay`.
- Fixtures: signed scaffold artifacts plus `docs/handoffs/fixtures/m4/sample-candidate-model-config.json` and `sample-candidate-report.json`; the sample candidate is generated from `scripts/model/fixtures/*.ndjson`.
- Verification: model `unittest` 22/22; root Vitest 134/134; scoped ESLint clean; web production build green; candidate workflow YAML parses; generated candidate/report reproduce byte-for-byte; explicit candidate package signs/verifies; `git diff --check` clean. Overlay build skipped because no overlay files changed.
- Contract deltas since freeze: NONE. `ModelManifest` remains the frozen six-field shape. Ed25519 signs canonical JSON bytes of the five unsigned manifest fields; `configSha256` binds canonical model-config JSON.
- Calibration: `DataSource.rows(table)` isolates fixture/BigQuery access. Export projects only frozen-schema fields and removes quarantine/under-480-second matches. Round curves use only contributor selections; non-round bounded deltas use only participant final associations/outcomes.
- Crypto: signing resolves and validates OpenSSL 3.x, preferring `/opt/homebrew/bin/openssl`; it no longer relies on macOS PATH selecting a non-LibreSSL binary. The private key remains only in `MAYHEM_MODEL_SIGNING_KEY`.
- Governance: candidate CI is manual dispatch and artifact-only; it never promotes. `approve_release.py` refuses without `--approve`, verifies package signatures, emits JSON plus locked transactional SQL, preserves one active release, and supports rollback.
- Deferred: immutable R2 publication/service-role application. No learned candidate auto-publishes or auto-promotes.
- Push pending: `git push origin codex/model-overlay` is blocked by sandbox DNS (`Could not resolve host: github.com`).
- Session: 2026-06-13T11:35:34+08:00 - M4 data-independent signing, packaging, release governance, candidate CI, fixtures, and local verification complete.
- Session: 2026-06-13T11:39:00+08:00 - Final review added a red-tested pre-mutation single-active SQL guard; all gates rerun.

M4 SCAFFOLD COMPLETE

- Session: 2026-06-13T14:26:02+08:00 - Resumed M4 calibration after confirming `codex/model-overlay`, frozen BigQuery schema presence, and incomplete calibration guard.
- Session: 2026-06-13T14:40:39+08:00 - Built and verified fixture/BigQuery-source export, deterministic provenance-bounded calibration with empty-data fail-closed behavior, candidate evaluation report, explicit candidate signing path, and OpenSSL 3 resolution. Push remains pending because sandbox DNS cannot resolve github.com.

M4 CALIBRATION COMPLETE
