# Handoff: M3A LCU Collector and Safe Export - Codex
- Commits: `71f8097` red policy tests; `dbd1565` collector implementation; this `[M3A]` verification commit on `codex/lcu-collector`.
- Fixtures: `docs/handoffs/fixtures/m3a/sample-batch-v1.json.gz`; `docs/handoffs/fixtures/m3a/sanitizer-test-evidence.txt`.
- Verification: Rust 15/15; root Vitest 127/127; cargo check, ESLint, root build, overlay build, and macOS app-only release bundle pass. Default Tauri build reaches the release binary and `.app`, then fails in `bundle_dmg.sh`.
- Contract deltas since freeze: NONE. Review corrected Rust `itemIds` to the frozen `string[]` shape.
- Safe persistence: only consent/pause/day counter plus sanitized gzip batches and retry metadata reach disk. Full LCU responses, PUUIDs, Riot IDs, names, chat-like strings, and OCR screenshots remain memory-only.
- Upload: schema version `1`; `Authorization: Bearer <device token>`, `Content-Type: application/json`, `Content-Encoding: gzip`, `x-mayhem-schema-version: 1`.
- Retry: immediate first attempt; exponential backoff from 30 seconds capped at 21,600 seconds; success deletes gzip and metadata, failure persists attempts and next-retry time. Endpoint/token come from `MAYHEM_TELEMETRY_ENDPOINT` and `MAYHEM_DEVICE_TOKEN`.
- Platform: real macOS lockfile format and app-only release bundle verified. Live LCU endpoints, in-app visual UI, Windows lockfile/runtime/packaging, and DMG packaging remain unverified. Push pending.
- Session: 2026-06-13T10:50:02+08:00 - Started Task 3A.1; branch clean, baseline Rust tests green.
- Session: 2026-06-13T11:02:00+08:00 - Task 3A.1 red tests compiled: 6 run, 3 expected failures.
- Session: 2026-06-13T11:20:00+08:00 - Task 3A.2 implemented; Rust collector tests 13/13 and root Vitest 127/127 green.
- Session: 2026-06-13T11:25:00+08:00 - Task 3A.3 verified; review regressions fixed; macOS release app bundle passes; Windows/live/UI/DMG checks remain explicitly pending.

M3A COMPLETE
