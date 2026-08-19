# Phase 1 — mechanism localization and experiment design

## Historical measurement settlement

| Measurement | Value | Direct source | Interpretation | Confidence |
|---|---:|---|---|---|
| Probe identity | `probeSeq=446`, `attemptGeneration=446` | pinned `prelive-runtime.log:3180,3710` | Same JS attempt at watchdog abandon and late settle | OBSERVED |
| JS watchdog budget | 2,000 ms | pinned log line 3180 (`inFlightMs=2000`) | Frontend logically abandoned the attempt after 2 s | OBSERVED |
| Rust configured timeout | 1,500 ms | historical `76a97b63:lib.rs:666,754`; current `lib.rs:790,884` | `timeout(worker)` existed and was shorter than the JS watchdog | SOURCE-PROVEN |
| Pre-capture | 234 ms | pinned log line 3710 | Monitor/window/calibration setup was sub-second | OBSERVED |
| Native capture | 273 ms | pinned log line 3710 | Screen capture itself was sub-second | OBSERVED |
| Pixel analysis | 221 ms | pinned log line 3710 | Detector work was sub-second | OBSERVED |
| Measured phase sum | 728 ms | 234 + 273 + 221 | Named blocking phases do not explain 340 s | SOURCE-PROVEN arithmetic over OBSERVED values |
| Native command elapsed | 340,108 ms | pinned log line 3710 | Command-entry-to-return exceeded the 1.5 s Rust budget by about 227x | OBSERVED |
| JS round trip | 528,108 ms | pinned log line 3710 | A further 188,000 ms lies outside reported Rust command elapsed | OBSERVED |
| Blocking dispatch wait | unavailable | zero historical dispatch fields | Blocking-pool queue delay cannot be read from this run | OBSERVED absence |
| Async resume wait | unavailable | zero historical resume fields | Post-closure task-poll delay cannot be read from this run | OBSERVED absence |
| Foreground command latency around event | predominantly 7–26 ms in the shown windows, with occasional 120–223 ms | pinned log lines 3172–3188 and 3702–3718 | IPC/main path remained responsive; this does not prove every Tokio worker was healthy | OBSERVED |

The historical source overwrote the closure's internal `elapsed_ms` with the
whole command clock after `timeout(worker).await`. Its residual was described
then as dispatch wait, but that label was later corrected: without the fields
added by `20c9dfe`, the residual combines at least dispatch and resume and may
include small uninstrumented closure gaps. Historical H1 vs H2 is therefore not
directly measured.

## Hypotheses

- **H1 — async-runtime starvation.** The blocking closure dispatches and/or
  finishes, but the task polling `timeout(worker)` cannot resume. Prediction:
  dispatch remains small, resume and external wall time exceed the timeout by a
  wide margin.
- **H2 — blocking/native work alone.** The blocking pool queues the closure or
  the closure itself runs long while async workers remain healthy. Prediction:
  the async timeout still returns near budget; saturation may leave physical
  work queued/running but cannot by itself suppress the timer.
- **H3 — combined delay.** Blocking work or queueing is slow *and* async polling
  is starved. The historical fields cannot exclude this combination.
- **H4 — transport/pre-first-poll delay.** A Tauri command future waits before
  its first poll. This lands in `roundTripMs - nativeElapsedMs`, not in the
  current dispatch/resume pair, and is not the target of these Rust seam tests.

## Current Rust surface

- Crate/workspace: `overlay/src-tauri/Cargo.toml`; one package,
  `mayhem-oracle-overlay` 0.5.0; Tokio 1.51.1 with `full` features.
- Unchanged macOS baseline: `cargo test` runs locally; 139 passed, 1 ignored.
- macOS-only integration tests: `tests/ocr_corpus.rs` and `tests/r1_replay.rs`.
- Windows-only production code: Windows OCR and native overlay-window/DPI
  implementation. It cannot execute on macOS.
- Real `xcap` monitor/window capture exists on macOS, but deterministic tests
  cannot require a live League window, foreground ownership, or OS screen
  state. Scheduler/liveness tests therefore inject an in-memory closure into
  the production `run_bounded_capture_with_gate` seam.
- The seam is private. The narrowest true-seam test location is its existing
  `#[cfg(test)] bounded_capture_tests` module in `lib.rs`; no export, feature,
  fake capture implementation, or production behavior extraction is needed.

## Test A — blocking-pool saturation

Build a two-worker Tokio runtime with time enabled and a one-thread blocking
pool. Occupy the sole blocking thread, then invoke the exact bounded-capture
helper. The capture closure must remain queued while the external test thread
observes `BoundedCaptureError::Timeout` within 4x the configured 40 ms budget.
Afterward release the blocker and prove the queued physical closure eventually
runs and releases its permit. This preserves the logical-timeout-versus-
physical-cancellation distinction.

Expected result on current code: PASS. A pass discriminates against blocking-
pool saturation as the complete cause; a failure would implicate the bounded
call design or Tokio blocking-pool interaction.

## Test B — async-worker starvation

Build a two-worker Tokio runtime with time enabled. Start the exact bounded
capture task first and wait until its blocking closure reports dispatch. Only
then place one finite, non-yielding task on each async worker using a three-way
barrier, release the capture closure so it completes quickly, and use the test's
external OS thread as the watchdog. The worker occupation is finite (250 ms),
not a forever-deadlock, and begins only after production dispatch is proven.

Record separately from one monotonic command clock:

- dispatch wait (task start to blocking closure entry),
- resume wait (blocking closure exit to bounded-call task completion),
- configured timeout (25 ms), and
- external wall-clock completion.

Correct invariant: the bounded call completes within 4x its timeout. Current
Tokio 1.51.1 polls the wrapped future before its expired delay when the starved
task resumes; therefore a completed blocking worker may be returned as success
after the logical deadline. The regression must remain RED until production
owns a timeout mechanism that does not depend solely on the starved worker set.

Representativeness boundary: Test B is SOURCE-PROVEN to exercise the same
production timeout seam and TEST-PROVEN if it reproduces the dispatch-small /
resume-large signature. It is not LIVE-PROVEN as the historical log lacks both
fields, so it demonstrates a credible mechanism, not the exact historical
worker-starvation trigger.
