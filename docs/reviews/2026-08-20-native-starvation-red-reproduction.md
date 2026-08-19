# Native starvation deterministic RED reproduction

Date: 2026-08-20 (Asia/Taipei)

Terminal state: **deterministic RED established; production repair not applied.**

## A. Base SHA / worktree

- Candidate base and ending HEAD: `4eb271b79826877e5fce0cfa7ad4e24b01cb6d71`
- Isolated worktree: `/Users/jason/Desktop/mayhem-oracle-native-starvation-red`
- Checkout mode: detached HEAD, clean at entry; the final status contains only this
  slice's test/gate/report/evidence files.
- Primary checkout remained at
  `5047c19f0c0ef34d93877559013a322e5d4421f7`; its pre-existing dirty files were
  not edited.
- `4eb271b` remains a **V0.8-CANDIDATE**, not a behavioral baseline. No tag,
  merge, or cherry-pick was made.

The observed two-round bundle is separately bound to
`76a97b630bbdbec9b53d1e757b09bae887544733` plus 197 dirty paths. Its manifest
records matching start/final repository fingerprints
`41aa9b58282ea03070ccf4b6be2ba5bfc05902f313e6c4eb56be4c63ed3a9724`.
That content identity is not `4eb271b`, and behavioral equivalence is not
established.

## B. Historical evidence

The zero-code experiment used the actual pre-live runtime log containing the
approximately 340-second event. The pinned copy is
`.codex/evidence/native-starvation-red/prelive-runtime.log` (SHA-256
`4dd9491f2134ca6a420f742c6b89046537780514d9b51e2e832ba894ca045ee1`).
It was produced at HEAD `76a97b63` with a different dirty snapshot (23 modified
and 38 untracked paths), so it is not the 197-path two-round fingerprint and is
not evidence for candidate equivalence.

| Measurement | Value | Source | Interpretation | Confidence |
|---|---:|---|---|---|
| probe identity | `probeSeq=446`, `attemptGeneration=446` | runtime log lines 3180 and 3710 | Watchdog and late timing record name the same probe | OBSERVED |
| scheduler scheduled/in-flight | `scheduledAt=1027633`, `inFlightSince=1025633`, `inFlightMs=2000`, restart `20`, native outstanding `1` | line 3180 `[geometry-watchdog]` | JS abandoned a logical wait while one native request remained outstanding | OBSERVED |
| configured Rust capture timeout | 1,500 ms | `overlay/src-tauri/src/lib.rs:1009,1119-1125` at the candidate | Production bounded-capture budget | SOURCE-PROVEN |
| pre-capture / capture / analysis | 234 / 273 / 221 ms | runtime log line 3710 | Explicit measured phases total 728 ms | OBSERVED |
| native elapsed | 340,108 ms | runtime log line 3710 | The Rust-side reported interval greatly exceeded 1,500 ms | OBSERVED |
| unattributed historical residual | 339,380 ms | arithmetic: 340,108 - 728 | Delay existed outside the three recorded phases; the old log cannot locate it | INFERRED |
| round trip | 528,108 ms | runtime log line 3710 | End-to-end delay was larger still | OBSERVED |
| timeout classification | `none` | runtime log line 3710 | The delayed poll ultimately accepted a completed result instead of returning timeout | OBSERVED |
| `dispatch_wait_ms` | unavailable | zero matching fields in the pinned log | Cannot measure blocking-pool queue latency for probe 446 | OBSERVED |
| `resume_wait_ms` | unavailable | zero matching fields in the pinned log | Cannot measure continuation delay for probe 446 | OBSERVED |

The log predates commit `20c9dfe1fa74eb70a87a4003897e65929b0caed5`
(2026-08-05), which added the dispatch/resume fields. It therefore cannot
decide H1 versus H2 by itself, and no missing measurement is inferred.
Foreground-settle calls around the watchdog continued to complete, usually in
single/tens of milliseconds (with occasional 120-223 ms values), so the process
was not globally frozen; that does not identify which Rust worker set was
unavailable.

Historical badge-layer/rendered-record activity is classified only as
**VISUAL/PRESENTATION ACTIVITY OBSERVED**. Every captured round-content
completion was `FAIL_DATA` with null tier/stat content. R1/R2 semantic augment
offer behavior is not LIVE-PROVEN.

## C. Hypotheses

- **H1 — async continuation/runtime starvation.** Blocking work dispatches and
  finishes, but the task/timer is not polled again for far beyond its logical
  deadline. Test B reproduces this mechanism. Its attribution to historical
  probe 446 remains a HYPOTHESIS because that log lacks the two discriminating
  fields.
- **H2 — the native/blocking operation itself took approximately 340 seconds.**
  The historical log does not disprove this: its large residual is not split.
  Test B proves a different mechanism can produce the signature, not that H2
  was absent historically.
- **H3 — blocking-pool saturation/queueing suppresses the timeout despite
  healthy async workers.** Test A discriminates against this as a complete
  explanation: the timeout still fired within its wall-clock ceiling.
- **H4 — Tokio timeout is a logical polling deadline, not an independent
  wall-clock completion oracle.** Test B returned `Ok("capture-completed")`
  after the deadline when the delayed task was finally polled. This behavior is
  TEST-PROVEN at the exact production seam.

## D. Test A design + result

Test:
`bounded_capture_tests::blocking_pool_saturation_keeps_async_timeout_within_wall_clock_budget`

The test constructs a two-worker Tokio multi-thread runtime with time enabled
and exactly one blocking thread. It occupies that blocking thread, queues the
production `run_bounded_capture_with_gate` seam, and uses an external standard
thread/channel wall clock. The async workers remain healthy.

Budget is 40 ms; the stable acceptance ceiling is `<160 ms` (4x). Five runs
passed in 45-50 ms. Each returned `BoundedCaptureError::Timeout` before the
queued closure began. After releasing the blocking occupier, the test also
proved that physical work eventually ran and released the production permit.

Result: the blocking-pool saturation control is **OFFLINE-PROVEN**. Simple
blocking-queue saturation is not the complete explanation for a missing async
timeout.

## E. Test B design + result

Test:
`bounded_capture_tests::bounded_capture_timeout_must_survive_finite_async_worker_starvation`

The test constructs a two-worker Tokio multi-thread runtime with two blocking
threads and time enabled. It first proves the exact production seam dispatched
its blocking closure. Two barrier-coordinated, finite non-yielding tasks then
occupy the two async workers for 250 ms. The blocking closure is released and
ends immediately. A standard OS test thread and `recv_timeout`, not another
Tokio timeout, are the wall-clock oracle.

Budget is 25 ms; the stable acceptance ceiling is `<100 ms` (4x); controlled
starvation is 250 ms (10x budget, 2.5x failure ceiling). Five runs failed
identically:

```text
dispatch_wait_ms=0
closure_end_ms=0
resume_wait_ms=250
configured_timeout_ms=25
external_completion_ms=250
result=Ok("capture-completed")
```

The setup assertions stayed green. Dispatch and blocking closure duration were
not the dominant delay. This is finite, barrier-controlled starvation after
real production dispatch, not the tautology that permanently blocking every
worker prevents all Tokio work.

Five runs are sufficient: the barriers eliminate start-order races, the
failure margin is categorical, and all five Test A controls plus all five Test
B reproductions produced the same respective outcome. Twenty repetitions would
add suite cost without exercising a new interleaving.

## F. Exact RED invariant

> A bounded native operation with a 25 ms logical timeout must complete at the
> external wall-clock observer in less than 100 ms after its blocking closure
> has dispatched and ended promptly.

Current code violates this at the exact seam: completion is 250 ms and returns
success, with the entire dominant delay in `resume_wait_ms`. The assertion was
not weakened. The frozen Rust source/test SHA-256 is
`1aee40433c6fc2ec9bdd61263161c296fda197f32b30a1e2bcfbdaf6b8bf23fd`.

Status: mechanism **IMPLEMENTED**; liveness invariant **not OFFLINE-PROVEN**
(deterministic RED); **not LIVE-PROVEN**.

## G. Production representativeness

Representative, TEST-PROVEN:

- The tests call the private production `run_bounded_capture_with_gate`
  implementation directly from its existing `#[cfg(test)]` module.
- They preserve `spawn_blocking`, `tokio::time::timeout`, permit ownership until
  physical return, and the production result mapping.
- The Test B dispatch-small/resume-large mechanism is executable and stable on
  macOS without fake screen capture.

Not established:

- Historical probe 446's missing dispatch/resume split.
- Which production task(s), if any, occupied the async workers.
- Behavioral equivalence between `76a97b63` plus dirty content and `4eb271b`.
- Functionally correct augment content in any captured historical round.
- A live/equivalent runtime acceptance after a repair.

No production extraction was required; all Rust changes are under
`#[cfg(test)]`. Windows-only OCR/window behavior and macOS real `xcap` capture
are intentionally not invoked. The target is scheduler liveness, so real
screen pixels would add nondeterminism without strengthening this seam test.

## H. Existing tests / gates

Before this slice, tracked local scripts did not invoke Rust tests; only
`.github/workflows/windows-overlay.yml:70-76` ran `cargo test` and clippy. The
crate is `overlay/src-tauri/Cargo.toml` (`mayhem-oracle-overlay`, not a multi-
crate workspace). Integration tests are `calibration`, `capture_failure`,
`dpi_coordinates`, `geometry_timing_fields`, `member_contract`, and macOS-only
`ocr_corpus` / `r1_replay`. Windows OCR and overlay-window native APIs are
platform-gated; `xcap` real capture is OS/environment dependent.

`scripts/gate.sh` is now the narrow deterministic local gate. It regenerates
the overlay's ignored data fixture with the existing `npm run sync-data`, then
includes `cd overlay/src-tauri && cargo test`. It continues after failures,
reports every suite, and exits nonzero if any suite fails.

Exact final outcomes:

| Command | Outcome |
|---|---|
| Test A exact command, 5 runs | 5/5 exit 0; 45-50 ms |
| Test B exact command, 5 runs | 5/5 exit 101; exact intended invariant failure at 250 ms |
| `cargo test -- --skip bounded_capture_tests::bounded_capture_timeout_must_survive_finite_async_worker_starvation` | exit 0; 140 unrelated tests passed, 1 ignored, RED test filtered |
| `cargo test` | exit 101; 114 passed, 1 intended failed, 1 ignored before integration binaries |
| `bash scripts/gate.sh` | exit 1 solely for intentional Rust RED; data sync, overlay 727/727, web 1209/1209, types, ESLint, 317 skill tests, and workflow-CWD checks passed |
| `cargo check` | exit 0; existing deprecation warnings |
| `cargo fmt --check` | exit 0 |
| `cargo clippy --all-targets` | exit 0; existing warnings |
| root `npm run build` | exit 0; 4,703 static pages generated |
| `cd overlay && npm run build` | exit 0 |
| `cd overlay && npx tauri build` | exit 0; app and arm64 DMG bundled |
| `git diff --check` | exit 0 |
| frozen-test `shasum -c` | exit 0 |

The clean isolated worktree initially lacked the ignored generated fixture
`overlay/public/data/augments.json`, causing macOS `ocr_corpus` to fail before
test execution. The byte-identical candidate fixture (SHA-256
`920f0991b388b5c505aac4bb4f8ea67e80973e8af8ca9e2fa019c2a7a2e268df`)
was copied as initial environment setup; no test assertion or production data
source was altered. The final gate now regenerates the same ignored fixture
through the repository's existing sync command, so a fresh worktree does not
depend on that manual copy.

Fresh release artifact:
`overlay/src-tauri/target/release/mayhem-oracle-overlay`, 19,289,808 bytes,
modified `2026-08-20T04:36:28+0800`, SHA-256
`c12b094d922d65178ac24e21285930bbd371304add79d3867bf5ee4fb4bf90e0`.

## I. Files changed

Intended source/report/gate changes:

- `overlay/src-tauri/src/lib.rs` — test-only Test A and Test B in the existing
  bounded-capture module; no production statement changed.
- `scripts/gate.sh` — local deterministic gate including Rust.
- `docs/reviews/2026-08-20-native-starvation-red-reproduction.md` — this report.
- `.codex/evidence/native-starvation-red/` — pinned historical inputs and hash
  manifest.
- `.codex/gates/native-starvation-red/` — baseline, RED output, freeze, gate,
  and completion records.

Environment-only ignored outputs include `node_modules`, Rust `target`, web
build directories, and the byte-identical generated augment fixture. No
production repair, `App.tsx` refactor, billing edit, tag, merge, or cherry-pick
was made.

## J. Next smallest production fix (not implemented)

First identify the production async-worker occupier with one fresh candidate
trace containing `dispatchWaitMs` and `resumeWaitMs`; the historical trace
cannot name it. If it confirms dispatch-small/resume-large, make the bounded
capture's deadline/completion supervision independent of the shared, starvable
Tauri async-worker set (a dedicated capture supervisor/executor with an OS
wall-clock deadline), while keeping physical permits owned until the native
closure actually returns. The Tauri command response path must also be checked:
moving only the timer is insufficient if delivering the response still depends
on the same starved workers.

Then make Test B green without changing its timing thresholds, rerun the full
Rust/gate/build set, and obtain controlled live evidence. Do not raise the
timeout, increase worker count as the only fix, release permits at logical
timeout, or infer that scheduler liveness repairs the independent
champion-augment `FAIL_DATA` defect.

Current classification: the shared-runtime liveness weakness is TEST-PROVEN;
its responsibility for probe 446 is HYPOTHESIS; the production occupier and
smallest safe integration point remain unresolved.
