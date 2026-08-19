COMPLETE — DETERMINISTIC RED REPRODUCTION

What shipped: two deterministic, test-only Tokio experiments exercise the
private production bounded-capture seam, and the local deterministic gate now
runs Rust tests. Test A is the blocking-pool saturation control; Test B freezes
the finite async-worker-starvation wall-clock defect. The durable report and
pinned evidence package accompany them.

What did not ship: no production repair, baseline tag, merge, cherry-pick,
`App.tsx` refactor, Pi redesign, Claude billing edit, or unrelated fix.

Root cause as understood: Test B proves that, after blocking dispatch and rapid
closure completion, starving the shared async worker set delays re-polling the
bounded future from a 25 ms logical budget to 250 ms and returns the completed
value rather than a timeout. Test A proves blocking-pool saturation alone does
not suppress a healthy async timer. The same mechanism's responsibility for
historical probe 446 remains HYPOTHESIS because its log predates dispatch and
resume fields.

Invariants preserved: physical permits remain held until real blocking work
returns; Test A proves queued work eventually runs and releases its permit; no
native screen-capture fake or production behavior extraction was added; the
RED assertion and 4x ceiling remain unchanged and SHA-256 frozen.

Compliance: base and ending HEAD are
`4eb271b79826877e5fce0cfa7ad4e24b01cb6d71`. Only approved test, gate, report,
and evidence paths changed in a clean isolated worktree. The operator explicitly
authorized an intentional RED terminal state, which overrides the generic
all-green completion convention for this reproduction slice.

Verification: Test A passed 5/5; Test B failed for the exact intended invariant
5/5; 140 unrelated Rust tests passed with only Test B filtered. Overlay data
sync, overlay 727/727, web 1209/1209, TypeScript, ESLint, 317 skill tests,
workflow-CWD, `cargo check`,
`cargo fmt --check`, clippy, both frontend builds, Tauri release build, diff
check, and evidence/test hash checks passed. The full gate exits 1 solely
because Test B remains intentionally RED. Independent second-hand review of
this new diff was not performed under the active no-delegation policy and is
recorded in `phase4-independent-verification.md`.

The final source/report diff was regenerated after the last gate-hardening
change; this contract and the commit checklist are the terminal package writes.
