# Final deterministic gate log

| # | Gate | Exact command | Result |
|---:|---|---|---|
| 1 | Test A focused | `cargo test bounded_capture_tests::blocking_pool_saturation_keeps_async_timeout_within_wall_clock_budget -- --exact --nocapture` from `overlay/src-tauri` | Five runs, each exit 0; external completion 50, 45, 49, 50, 45 ms |
| 2 | Test B focused | `cargo test bounded_capture_tests::bounded_capture_timeout_must_survive_finite_async_worker_starvation -- --exact --nocapture` from `overlay/src-tauri` | Five runs, each exit 101; each had dispatch 0 ms, closure end 0 ms, resume 250 ms, configured timeout 25 ms, external completion 250 ms, result `Ok("capture-completed")` |
| 3 | Rust unrelated suite | `cargo test -- --skip bounded_capture_tests::bounded_capture_timeout_must_survive_finite_async_worker_starvation` from `overlay/src-tauri` | exit 0; 140 passed, 1 ignored, 1 filtered |
| 4 | Rust full suite | `cargo test` from `overlay/src-tauri` | exit 101; lib 114 passed, 1 intentional failed, 1 ignored; integration binaries did not run after lib failure |
| 5 | Deterministic project gate | `bash scripts/gate.sh` | exit 1 / `GATE: FAIL` solely for Test B; overlay data sync exit 0, overlay 727/727, types exit 0, web 1209/1209, ESLint exit 0, skill suite 317 OK, skill-CWD all checks passed |
| 6 | Rust check | `cargo check` from `overlay/src-tauri` | exit 0; existing deprecation warnings |
| 7 | Rust format | `cargo fmt --check` from `overlay/src-tauri` | exit 0 |
| 8 | Rust lints | `cargo clippy --all-targets` from `overlay/src-tauri` | exit 0; existing warnings |
| 9 | Web production build | `npm run build` from repository root | exit 0; 4,703 static pages generated |
| 10 | Overlay renderer build | `npm run build` from `overlay` | exit 0 |
| 11 | Tauri release build | `npx tauri build` from `overlay` | exit 0; macOS app and arm64 DMG bundled |
| 12 | Patch whitespace | `git diff --check` | exit 0 |
| 13 | Frozen test | `/usr/bin/shasum -a 256 -c .codex/gates/native-starvation-red/frozen-tests.sha256` | exit 0; `overlay/src-tauri/src/lib.rs: OK` |
| 14 | Pinned evidence | `(cd .codex/evidence/native-starvation-red && /usr/bin/shasum -a 256 -c pinned.sha256)` | exit 0; all six pinned files OK |

The nonzero results in gates 2, 4, and 5 are the same required deterministic
RED, not unrelated failures. The operator explicitly authorized this terminal
state; the assertion remains frozen and was neither weakened nor skipped in the
project gate.

Fresh release binary:

```text
overlay/src-tauri/target/release/mayhem-oracle-overlay
size=19289808
modified=2026-08-20T04:36:28+0800
sha256=c12b094d922d65178ac24e21285930bbd371304add79d3867bf5ee4fb4bf90e0
```
