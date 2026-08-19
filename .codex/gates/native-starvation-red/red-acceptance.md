# Phase 2 — RED acceptance

## Verdict

Test A is a green discriminating control and Test B is a deterministic RED at
the true production seam. Both compile and execute. No compile error, skipped
test, source-text assertion, fake native implementation, or nested Tokio timeout
is used as the liveness oracle.

## Test A

`blocking_pool_saturation_keeps_async_timeout_within_wall_clock_budget`
exercised `run_bounded_capture_with_gate` on a two-worker runtime whose sole
blocking thread was occupied. All five runs passed. The 40 ms timeout completed
in 45–50 ms, below the 160 ms (4x) ceiling, before the queued capture closure
started. Releasing the blocker then proved physical work still ran and released
its permit. This is TEST-PROVEN evidence against blocking-pool saturation as the
complete explanation.

## Test B

`bounded_capture_timeout_must_survive_finite_async_worker_starvation` first
waited for blocking dispatch, then occupied both async workers for a finite 250
ms window and released a fast blocking closure. The external OS test thread was
the watchdog. The final liveness assertion failed first and failed identically
in five runs:

```text
timeout=25 ms
acceptable completion < 100 ms (4x)
dispatch=0 ms
closure end=0 ms
resume=250 ms
external completion=250 ms
result=Ok("capture-completed")
```

The setup assertions remained green: dispatch and closure completion both
occurred before the 100 ms ceiling, proving neither blocking queueing nor the
closure was the dominant delay. The only failing assertion is the intended
wall-clock liveness invariant.

Five repetitions are sufficient here because barriers remove start-order races,
the controlled starvation is 10x the configured timeout and 2.5x the failure
ceiling, and all ten control/RED runs produced the same categorical outcome.
Twenty repetitions would add cost without testing another interleaving.

## Freeze

After `rustfmt`, `/usr/bin/shasum -a 256 overlay/src-tauri/src/lib.rs` produced:

```text
1aee40433c6fc2ec9bdd61263161c296fda197f32b30a1e2bcfbdaf6b8bf23fd
```

The whole file is frozen because the true-seam tests live in its existing
`#[cfg(test)]` module. No later slice work may edit it without reopening this
RED package.

## Representativeness

- SAME production seam: TEST-PROVEN.
- Dispatch-small/resume-large mechanism: TEST-PROVEN.
- Historical probe 446 had that exact split: HYPOTHESIS; its log predates both
  fields.
- A 340-second native command interval and responsive foreground calls:
  OBSERVED.
- Fixing this mechanism yields correct four-round augment semantics:
  HYPOTHESIS; every captured round completion remains `FAIL_DATA`.
