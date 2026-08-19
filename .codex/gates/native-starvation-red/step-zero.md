# Step Zero — inherited-claim verification

All pinned hashes were verified with:

```text
(cd .codex/evidence/native-starvation-red && /usr/bin/shasum -a 256 -c pinned.sha256)
prelive-runtime.log: OK
prelive-head.txt: OK
prelive-status.txt: OK
prelive-tracked.diff: OK
round34-manifest.json: OK
approved-audit.md: OK
```

1. **Claim:** candidate HEAD is `4eb271b79826877e5fce0cfa7ad4e24b01cb6d71`, and it is a candidate rather than a behaviorally proven baseline. Source: approved audit §§A–C and operator prompt.
   **CONFIRMED.** `git rev-parse HEAD` in the isolated worktree returned that exact SHA. The later two-round manifest binds the observed run to another state (`76a97b63` plus 197 dirty paths and fingerprint `41aa9b58...`), so equivalence to `4eb271b` is not established.

2. **Claim:** the later two-round run was stable at `76a97b63` plus a dirty tree with repository fingerprint `41aa9b58...`. Source: approved audit §C and operator prompt.
   **CONFIRMED.** Exact command and output:

   ```text
   jq -r '...repository fields...' .codex/evidence/native-starvation-red/round34-manifest.json
   round34_head=76a97b630bbdbec9b53d1e757b09bae887544733
   round34_branch=feat/overlay-tier-card
   round34_dirty_count=197
   fingerprint_start=41aa9b58282ea03070ccf4b6be2ba5bfc05902f313e6c4eb56be4c63ed3a9724
   fingerprint_final=41aa9b58282ea03070ccf4b6be2ba5bfc05902f313e6c4eb56be4c63ed3a9724
   repository_stable=true
   ```

3. **Claim:** the separate pre-live run containing the 340-second native event was also based at `76a97b63` with a dirty tree. Source: approved audit §E and native-recovery contract.
   **CONFIRMED, with corrected dirt scope for this artifact.** Its direct `head.txt` is `76a97b63`; its direct `status.txt` contains 23 modified and 38 untracked paths, 61 total. This is a different capture bundle from the later 197-path round34 run and must not be conflated with it.

4. **Claim:** probe 446 had a roughly 340-second native wait while its measured capture phases were sub-second. Source: approved audit §E.
   **CONFIRMED.** Direct runtime lines:

   ```text
   3180:[geometry-watchdog] {"probeSeq":446,..."scheduledAt":1027633,"inFlightSince":1025633,"inFlightMs":2000,..."nativeOutstanding":1,"action":"abandon"}
   3710:[geometry-timing] {"probeSeq":446,"stale":false,"preCaptureMs":234,"captureMs":273,"analysisMs":221,"nativeElapsedMs":340108,"roundTripMs":528108,"timeoutClassification":"none",...}
   ```

5. **Claim:** historical dispatch and resume measurements can discriminate the cause. Source: approved audit §M.
   **UNVERIFIABLE from the historical log.** `/usr/bin/grep -E -c 'dispatchWaitMs|resumeWaitMs|dispatch_wait_ms|resume_wait_ms' prelive-runtime.log` returned `0`. Commit `20c9dfe` added those fields on 2026-08-05, two days after the 2026-08-03 log. Neither value will be inferred.

6. **Claim:** the same bounded-capture seam existed in the historical tree and was configured for 1,500 ms. Source: current and historical Rust source.
   **CONFIRMED.** `git show 76a97b63:overlay/src-tauri/src/lib.rs` places `NATIVE_CAPTURE_TIMEOUT` at 1,500 ms, `run_bounded_capture_with_gate` at line 732, and `tokio::time::timeout(timeout, worker).await` at line 754. The pinned tracked diff does not alter that function. Current `4eb271b` has the same timeout call at lines 790/884.

7. **Claim:** local deterministic verification omitted Rust and only Windows CI ran `cargo test`. Source: approved audit §§B/M.
   **CONFIRMED.** `.github/workflows/windows-overlay.yml:72` is the only tracked `cargo test` invocation found; `scripts/gate.sh` is absent. An unchanged macOS run from `overlay/src-tauri` completed with 139 passed, 0 failed, and 1 ignored.

8. **Claim:** visible badge activity proves successful augment behavior. Source: earlier ambiguous reporting, corrected by the operator.
   **CORRECTED.** Badge-layer/rendered-record events with `FAIL_DATA` prove only **VISUAL/PRESENTATION ACTIVITY OBSERVED**. No semantic R1/R2 success is promoted from those records.

No inherited claim establishes the exact historical split between blocking-pool dispatch, unmeasured closure work, and async resume. The deterministic experiments therefore test those mechanisms separately instead of forcing a historical attribution.
