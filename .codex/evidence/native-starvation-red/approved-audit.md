# v0.8 Recovery and Harness Audit — 2026-08-20

**Revision 2 (2026-08-20, post independent review).** This revision retracts
two overclaims from revision 1 and is the authoritative version. The
substantive changes: `4eb271b` is downgraded from *baseline* to
**V0.8-CANDIDATE**; tree-reconstruction confidence is separated from
behavioral-baseline confidence; the Rust starvation finding is downgraded from
"the whole remaining gap" to a graded hypothesis about a *second, distinct*
defect; "done" is replaced by three completion levels; the account pool is
restated as 2+2 target with setup status; the verifier design is renamed
**Verifier-Lite**. Superseded text has been rewritten in place, not appended,
so nothing in this file contradicts anything else in it.

Read-only archaeology pass. No repository mutation outside this file and the
two instruction-file proposals it references.

Evidence grades used throughout: **OBSERVED** (I ran it and saw output),
**SOURCE-PROVEN** (read in current source/git objects), **TEST-PROVEN**
(a deterministic gate demonstrated it), **INFERRED**, **HYPOTHESIS**,
**UNVERIFIED**.

---

## A. Executive conclusion

**1. v0.8 is not lost, it is not `60925a6`, and `4eb271b` is a CANDIDATE —
not a proven baseline.** The overlay line is `feat/overlay-tier-card`, tip
`4eb271b` (2026-08-06). `60925a6` is a mid-branch ancestor 24 commits behind;
`76a97b6` is 5 behind. The "important dirty tracked changes" the prompt worries
about were real, are captured in an external snapshot, and were **committed**
on 2026-08-05 by `3f2a5e0`.

But the user defined v0.8 *behaviorally* — the last state where L3/R1 and L7/R2
worked — and git absorption plus green offline tests do not establish that.
The two confidences must be reported separately:

| | Grade | Basis |
|---|---|---|
| **Tree reconstruction** | **HIGH** | Every file in the Aug-03 snapshot is committed at `4eb271b`; verified per-file |
| **Behavioral baseline** | **LOW — not established** | The tree that produced the observed two-round behavior is `76a97b63` **+ 197 uncommitted paths**, 42 of them source. Its content is identified only by a hash. 22 non-test source files then changed by **+3020/−432** before `4eb271b` |

**Therefore this report calls `4eb271b` V0.8-CANDIDATE and recommends no
`v0.8-baseline` tag.** (§C)

**2. The overlay is in better shape than the prompt assumes.** At `4eb271b`,
every deterministic gate is green: 727/727 overlay tests, 1209/1209 web tests,
317/317 skill tests, `tsc --noEmit` clean — total wall clock ~25 seconds,
zero model tokens. (§B, TEST-PROVEN)

**2b. No successful augment round is captured anywhere in the evidence
corpus.** Sweeping 297 artifact files across `.codex/evidence/`, both external
review roots, `~/Desktop/wt-snapshots/`, and the `overlay-minimal-v2` corpus —
covering `.log`, `.jsonl`, `.json`, `.txt`, `.ndjson` — yields exactly **3
distinct `[round-content-complete]` events**, and **all three are
`result: FAIL_DATA`** (the rest are duplicate copies of the same three). There
is no artifact in which any round completed successfully. The behavioral
baseline the recovery targets rests entirely on the user's recollection.
**OBSERVED.** (§C)

**3. The L11/L15 symptom is not level-specific and never was.** It is
"every augment round after the first native geometry wedge." The full causal
chain in the prompt's §18 is source-proven with file:line citations in
`.codex/evidence/native-recovery-gate/contract.md`. The JS half of the repair
already landed. The **Rust half has not**: a tokio task went unpolled for
~340 seconds while inline commands returned in 2–4 ms.

I previously called this "the whole remaining gap." **That claim is retracted.**
It asserts causal sufficiency, and no deterministic experiment establishes it —
indeed no test anywhere starves a tokio runtime (0 matches for `worker_threads`,
`new_current_thread`, `Builder::new_multi_thread`, `block_in_place` across
`src-tauri/`), and `cargo test` is not run by any local gate. Graded honestly:

| Claim | Grade |
|---|---|
| A ~340 s native wait occurred | **OBSERVED** (`nativeElapsedMs: 340108`) |
| The timeout sits after `spawn_blocking`, so firing it needs a free async worker | **SOURCE-PROVEN** (`lib.rs:874`, `:884`; in-source analysis at `:1499-1510` calls resume "the true starvation signal here") |
| Starvation causes the post-wedge rounds not to arrive | **INFERRED** |
| Fixing it yields a working four-round overlay | **HYPOTHESIS — untested** |

**There are two distinct defects, and revision 1 conflated them.** The rounds
that *were* reached both ended `FAIL_DATA` at the champion-augments dataset
fetch — an OBSERVED data-layer failure, not a scheduling one. Starvation is the
leading explanation for *rounds 3–4 never arriving*; the data-layer defect is
the OBSERVED reason *the rounds that did arrive carried no tier content*.
Repairing either alone does not produce a working overlay. (§E, §M)

**4. The real finding of this audit is not in the overlay — it is in the
process.** Between 2026-08-07 and 2026-08-11, an elaborate gate-governance
program (`~/Desktop/overlay-minimal-v2-*`) ran **12 case revisions across 28
frozen checkpoints** and produced **zero lines of overlay code**. That is now
**OBSERVED, not inferred**: across all `~/Desktop/overlay-minimal-v2-*` trees
there are **0** files with a `.ts`, `.tsx`, `.rs`, or `.mjs` extension — the
corpus is 321 `.md`, 98 `.txt`, 90 `.json`, 19 `.diff`, 16 `.sha256`, 14 `.py`,
12 `.sh` — and every one of the 19 `.diff` files is **empty** (0 lines; no
`+++` header anywhere in the corpus, so not one line is added to any file by
any of them). The captured `tracked.diff` and `staged.diff` being empty is
itself the proof that the working tree was never modified. Its own
terminal record says `implementationAuthorized: false`,
`nextAction: FRESH_GATE_0`. It has been silent for 9 days. This is the exact
failure mode the prompt asks me to optimize against — correctness per unit of
scarce model capacity — and it was caused by *too much* verification
machinery, not too little. (§G)

**5. Therefore I disagree with the prompt's harness premise, on evidence.**
Building a *process-heavy* Pi orchestrator would be the third such harness this
project has built in a month. (Pi itself remains the target; installation is a
prerequisite — see §I. What is disputed is only how much mutable state it should
own.) Only one Claude
account and one Codex account are authenticated here — the 2+2 pool does not
currently exist. The correct move is to spend the next unit of capacity on the
Rust async-runtime defect, using the ~25-second deterministic gate that already
exists, and to add harness only where the deterministic gate cannot reach. (§G, §M)

---

## B. Exact repository state

Retrieved 2026-08-20, all via `/usr/bin/git` (rtk-hook caveat). **OBSERVED.**

| Item | Value |
|---|---|
| Primary checkout | `/Users/jason/Desktop/mayhem-oracle` |
| Its branch / HEAD | `claude/windows-overlay-clickthrough` @ `5047c19` (2026-07-11) |
| Its dirty state | 5 modified tracked, 6 untracked (incl. an 11 GB untracked `.codex/`) |
| `main` | `bf605c4` (2026-07-13) |
| `origin/main` | `aa86f54` (2026-07-14) |
| **Overlay line** | **`feat/overlay-tier-card` @ `4eb271b` (2026-08-06)** |
| Overlay worktree | `.claude/worktrees/overlay-tier-card` |
| Overlay tracked dirt | **none** — clean |
| Overlay untracked | `.codex/evidence/`, `.codex/gates/` (7.8 MB, 203 files) |
| Ahead of `origin/feat/overlay-tier-card` | **73 commits (unpushed)** |
| Ahead of `main` | 117 commits |
| Behind `origin/main` | 0 commits |
| Git remote | `github.com/jasonzoidclawd-rgb/wasfun.lol` |
| Worktrees registered | 21 (2 prunable, pointing at deleted `/private/tmp` paths) |
| Stashes | 7 |
| Active git hooks | `post-commit` |

### Deterministic gate results at `4eb271b` — TEST-PROVEN, run once each

| Gate | Command | Result | Duration |
|---|---|---|---|
| Overlay unit | `cd overlay && npm run test` | **727 passed / 727, 60 files** | 1.31 s |
| Overlay types | `cd overlay && npx tsc --noEmit` | **exit 0** | ~10 s |
| Web unit | `npm test` | **1209 passed / 1209, 116 files** | 3.62 s |
| Skill suite | `python3 -m unittest discover .codex/skills/.../scripts` | **317 tests, OK** | 19.0 s |

**This is the single most important number in the audit: the complete
deterministic gate costs ~25 seconds and zero model tokens.** Every harness
decision below follows from it.

### Scale markers (SOURCE-PROVEN)

- `overlay/src/App.tsx` — **4,095 lines**. This is the §19 concern, confirmed.
- `overlay/src-tauri/src/lib.rs` — 2,642 lines.
- 147 source files under `overlay/src` + `overlay/src-tauri/src`; 58 test files.

### Disk pollution (OBSERVED)

| Path | Size | Tracked? |
|---|---|---|
| `.claude/worktrees/` | **17 GB** | no (`.claude/` is gitignored) |
| `.codex/worktrees/` | **11 GB** | **no — and `.codex/` is NOT in `.gitignore`** |
| `.codex/evidence` + `.codex/gates` (tier-card) | 7.8 MB | no |
| `~/.codex` rollouts | 1.60 GB, 303 files | n/a (codex doctor warning) |

Zero files under `.codex/` or `.claude/` are tracked by git. The 11 GB is
build output (`node_modules`, `target/`) inside a nested worktree. It shows as
`?? .codex/` in every `git status` at the repo root, which is why the primary
checkout looks dirtier than it is.

---

## C. v0.8 reconstruction — tree HIGH, behavior NOT ESTABLISHED

### The decisive artifact

`~/Desktop/overlay-runtime-review-20260803-003417/` is an out-of-repo snapshot
taken 2026-08-03 00:34 CST. It contains `head.txt`, `git-status.txt`,
`git-diff-stat.txt`, `environment.txt`, and a **66 MB / 500,016-line
`runtime.log`**. **OBSERVED.**

- `head.txt` = `76a97b630bbdbec9b53d1e757b09bae887544733` — **not** `60925a6`.
- `git-diff-stat.txt` = 10 modified tracked files, **+1455 / −211**.
- `git-status.txt` = 30 untracked files, including 9 brand-new overlay
  source/test modules and the entire `docs/specs`, `docs/testing`,
  `docs/plans/overlay-v1-*` set.

This is exactly the "dirty tracked delta + important untracked source/tests"
the prompt asks me to reconstruct. It was never lost.

### The delta was absorbed, not dropped — TEST-PROVEN

I checked each file from the 2026-08-03 snapshot against the tree at `4eb271b`:

```
overlay/src/BadgeChipLayer.tsx          TRACKED@4eb271b
overlay/src/augmentOverlayGate.ts       TRACKED@4eb271b
overlay/src/positionedBadgeChips.ts     TRACKED@4eb271b
overlay/src/badgeLayerDiagnostic.ts     TRACKED@4eb271b
overlay/src/auth/member.ts              TRACKED@4eb271b
overlay/src/liveGamePollIntegration.test.ts  TRACKED@4eb271b
docs/specs/overlay-v1-product-contract.md    TRACKED@4eb271b
docs/plans/overlay-v1-implementation-plan.md TRACKED@4eb271b
docs/handoffs/overlay-v1-current-state.md    TRACKED@4eb271b
.codex/skills/test-league-augment-overlay/SKILL.md  TRACKED@4eb271b
```

`git log --diff-filter=A` attributes all of them to a single commit:
**`3f2a5e0` (2026-08-05) "checkpoint: overlay v1 accumulated slices + round34
acquisition diagnostic."**

### Reconstruction verdict — two separate confidences

The prompt's §28 asks for "a defensible v0.8 reconstruction." Revision 1 gave
one number. There are two, and they disagree.

**TREE RECONSTRUCTION CONFIDENCE: HIGH.** Every file in the Aug-03 snapshot
exists at `4eb271b` with its content committed by `3f2a5e0`, verified per file
with `git cat-file -e` and `git log --diff-filter=A`. Nothing was dropped.

**BEHAVIORAL BASELINE CONFIDENCE: NOT ESTABLISHED.** The user's definition of
v0.8 is behavioral. The evidence cannot support it, for four independent
reasons, each verified this pass.

**(i) The observed run did not execute any commit.** The only trace containing
two rounds — `.codex/evidence/round34-live/`, session
`20260805-110950`, started `2026-08-05T03:09:50Z` — records its own provenance
in `manifest.json`:

    head        76a97b630bbdbec9b53d1e757b09bae887544733
    dirtyCount  197
    branch      feat/overlay-tier-card

Of those 197 dirty paths, **42 are source**, and they are precisely the files
the diagnosis depends on: `surfaceProbeScheduler.ts`, `offerRoundOwnership.ts`,
`ocrOwner.ts`, `sameOfferDataRefresh.ts`, `App.tsx`, `lib.rs`,
`surface_probe.rs`, `foreground.rs`. The executed tree was
`76a97b63` **plus uncommitted work that no longer exists in recoverable form**.

**(ii) The timeline forbids equating the run with the nearby checkpoints.** The
recording started 11:09 local. `3f2a5e0` and `812ee4f` were committed at
**12:35 and 12:36** — over an hour *into* the session — and `20c9dfe` at 16:41,
after it ended. A commit made during or after a run is not proof of the tree
that ran.

**(iii) The exact tree is hash-identified but not reconstructible.** The
recorder pins a content fingerprint (`preflight.py:398`,
`repository_fingerprint`) binding, length-prefixed: schema version, HEAD, the
staged tracked diff bytes, the unstaged tracked diff bytes, and every untracked
file's path, exact content, and type tag. For this session:

    repositoryFingerprintStart  41aa9b58282ea03070ccf4b6be2ba5bfc05902f313e6c4eb56be4c63ed3a9724
    repositoryFingerprintFinal  41aa9b58282ea03070ccf4b6be2ba5bfc05902f313e6c4eb56be4c63ed3a9724
    repositoryStable            true

Start equals final, so the tree provably **did not drift** across the whole
recording: the observed behavior belongs to exactly one tree state. But a hash
identifies; it does not reconstruct. And because HEAD is itself bound into the
digest, **`4eb271b` cannot match `41aa9b58…` by construction** — no computation
required. The candidate is a different tree from the one that was observed.

**(iv) The delta between them is large and lands in every named subsystem.**
`76a97b63..4eb271b` is 5 commits; restricted to non-test source it is
**22 files, +3020 / −432**, attributable almost entirely to two commits
(`3f2a5e0`: 21 files, +2644/−384; `20c9dfe`: 4 files, +376/−48; the other three
carry no non-test source change):

| Subsystem the reviewer named | Changed in the range | Evidence |
|---|---|---|
| geometry | **yes** | `surfaceGeometry.ts` +179 (new file), `surfaceProbeScheduler.ts` +75 |
| scheduling | **yes** | `surfaceProbeScheduler.ts` wedge discount |
| lifecycle | **yes** | `offerRoundOwnership.ts` +79 (new), `App.tsx` +1024 |
| OCR | **yes** | `ocrOwner.ts` |
| publication | **yes** | `sameOfferDataRefresh.ts` +106 (new), `publicationDiagnostics.ts` +123 |
| native capture | **yes** | `lib.rs` +399, `surface_probe.rs` +213, `foreground.rs` +32 |
| rendering | **yes** | `BadgeChipLayer.tsx` +106 (new), `positionedBadgeChips.ts` +105 |

Seven of seven. This is not a range that can be waved through as behavior-
preserving.

### What would promote CANDIDATE to BASELINE

The fingerprint is a *checkable* equivalence test, which makes this tractable
rather than hopeless. In increasing order of strength:

1. **Cheapest and decisive-if-lucky.** Search for a stored copy of the executed
   tree (a `wt-snapshots` entry, a stash, an editor backup) and run
   `repository_fingerprint()` against `41aa9b58…`. A match reconstructs the
   observed state exactly. Not attempted this pass — it is a bounded T0 sweep.
2. **Direct.** Record one new session at `4eb271b` on a clean tree and observe
   whether R1/R2 behave as remembered. This produces a *new* baseline anchored
   to a committed SHA, which is worth more than recovering the old one.
3. **Weakest, still useful.** Review the +3020/−432 for behavior-preservation
   per subsystem. Expensive, and it yields argument rather than evidence.

**Recommendation: option 2.** Options 1 and 3 chase a tree whose value is
purely historical; option 2 produces a baseline that is committed, hashable,
and re-runnable.

### Correction to revision 1's reading of `round34-live`

Revision 1 said this trace "matches the remembered symptom exactly." That
overstated it. What the trace shows:

- `round-content-complete` for **round 1** (`offerGeneration: 4`) and **round 2**
  (`offerGeneration: 30`) — so the lifecycle *did* advance past round 1, and
  round-independence worked at least that far;
- both with `result: FAIL_DATA`;
- `badge-layer: 63`, `rendered-records: 50`, `coverage.rendered: true` — so
  badges **did** render;
- `geometry-watchdog: 37`, `geometry-recovery: 30`, `stale-results: 30` — the
  scheduler was actively firing recovery;
- no round 3 or 4 anywhere, `coverage.ended: false`, status `partial`.

So "L3/R1 and L7/R2 worked" is *consistent* with this trace if "worked" means
badges appeared, and *contradicted* by it if "worked" means tier content was
correct. **This is a genuine ambiguity I cannot resolve from artifacts** — it is
Open Question 1 in §N.

## D. Keep / salvage / freeze / abandon manifest

Scope: everything accumulated between `60925a6` and `4eb271b`, plus the
adjacent programs.

| Subsystem / artifact | Class | Justification |
|---|---|---|
| `offerRoundOwnership.ts` (sole writer of round identity, slice E) | **KEEP** | Live-proven; replaced the ad-hoc `recordRoundCompleted`/`clearOfferState` bookkeeping. SOURCE-PROVEN |
| `augmentOverlayGate.ts` fail-closed authorization | **KEEP** | Removed the `TIER_FIXTURE_MEMBER` entitlement-fabrication path. SOURCE-PROVEN |
| `surfaceProbeScheduler.ts` wedge discount (`WEDGED_NATIVE_PROBE_MS`=4000, cap 2) | **KEEP** | Correct, bounded, with an explicit no-latch bounding argument. SOURCE-PROVEN |
| `surfaceGeometry.ts`, `ocrOwner.ts` round authority, `sameOfferDataRefresh.ts` | **KEEP** | Each closes a named stale-publication defect with tests. TEST-PROVEN |
| `overlayReplay.ts` (slice H, deliberately unwired) | **KEEP** | Deterministic offline replay over the real reducers — this is the §26.1 seam, already built |
| 727 overlay + 1209 web tests | **KEEP** | The whole basis of cheap iteration |
| `docs/specs/overlay-v1-product-contract.md` | **KEEP** | Best artifact in the repo; already canonical in AGENTS.md |
| `.codex/evidence/native-recovery-gate/contract.md` | **KEEP** | Source-proven root-cause chain with file:line. Promote to an ADR |
| Windows parity branch `feat/overlay-tier-card-windows-parity` (`0bed271`, +5 unpushed) | **FREEZE** | 27 commits of CI/packaging work, diverged from the overlay line at `49dd04b` (2026-07-27). Do not rebase until macOS four-round works |
| `.codex/skills/test-league-augment-overlay/**` recorder/analyzer | **FREEZE** | Explicitly declared non-release-gating ("Option A") with 4 known internal defects. 317 tests green; keep running in CI, don't invest |
| Rust async-runtime starvation (probe 446) | **UNKNOWN → next slice** | Diagnosed, diagnosed again, never repaired. §E |
| `20c9dfe` geometry starvation diagnostics | **KEEP (as instrument)** | Commit message honestly states "Does NOT claim to fix the post-Round-2 acquisition collapse" |
| `~/Desktop/overlay-minimal-v2-*` (13 case dirs + 28 review checkpoints) | **ABANDON the machinery, SALVAGE two ideas** | §G. The bundle governance produced no code in 5 days. Salvage: (a) sha256-pinning a spec before review, (b) blind-then-compare review. Abandon: the 5-gate FSM, revision records, manifest hashing, `PRD_REVISION_REQUIRED` loop |
| `~/Desktop/wt-snapshots/` (11 snapshots) | **KEEP** | Cheap, deterministic, `scripts/checkpoint.sh`-generated. Working as designed |
| 2 prunable `/private/tmp` worktree registrations | **ABANDON** | Point at deleted dirs; `git worktree prune` when you choose |
| `.codex/` untracked 11 GB at repo root | **ABANDON (the build output)** | Add `.codex/worktrees/` to `.gitignore`; keep `.codex/evidence`, `.codex/gates`, `.codex/skills` |
| `fix/level-11-15-lifecycle-current` (`574388c`, 2 commits not in tier-card) | **ABANDON — superseded, content present** | `git cherry` marks both commits `+`, but that is patch-id divergence, not lost work: the distinguishing symbols `LIVE_DATA_FAILURE_GRACE_MS` (8 hits) and `resolveLiveDataPoll` (15 hits) **are present at `4eb271b`**. Re-committed, not dropped. Safe to delete after tagging. SOURCE-PROVEN |
| `fix/overlay-poll-owner-watchdog` (`df8af27`) → **`bd099ed` only** | **FREEZE — real unmerged work, highest-value salvage on this list** | `df8af27` itself is patch-equivalent in tier-card (`git cherry` `-`), but its parent `bd099ed` *"fix(overlay): recover stalled live game polling"* is not: **+260 lines** across `App.tsx`, `liveGamePoll.ts` and 2 test files, and its symbols `LIVE_GAME_POLL_OWNER_DEADLINE_MS`, `LIVE_GAME_POLL_MEMBER_DEADLINE_MS`, `supersededRunId` have **0 hits at `4eb271b`**. A concept-level grep for `watchdog\|deadline\|stalled\|ownerDeadline` across `4eb271b:overlay/src` returns **0 hits** — v0.8 has no equivalent under another name. `bd099ed` is reachable from **exactly one ref** and is not an ancestor of `main`. SOURCE-PROVEN |
| `backup/overlay-tier-card-broken-22e0ed4` | **ABANDON — fully subsumed** | `git cherry 4eb271b 22e0ed4` returns **empty**: zero unique commits. Nothing to lose. SOURCE-PROVEN |
| 7 stashes (oldest 2026-06-04) | **UNKNOWN** | Not classified this pass — needs a separate cheap T0 sweep |

**One row above deserves to be read twice.** `bd099ed` is 260 lines of
test-backed live-poll recovery logic that exists on one branch, nowhere else,
and has no counterpart in v0.8 under any name. Deleting that branch loses it
permanently. I am **not** claiming it is correct or that it should be merged —
absence at `4eb271b` is equally consistent with a design that was tried and
deliberately dropped, and I did not read the code closely enough to tell which.
That is exactly why the class is FREEZE rather than KEEP or ABANDON: tag it,
then decide with evidence. It is also adjacent to the §M v0.9 slice, so the
decision should be made *there*, not now.

**Note the KEEP/ABANDON split the prompt asks for:** the `overlay-minimal-v2`
*implementation* is ABANDON, but the *invariant it was trying to protect* —
"a reviewer must not see the executor's reasoning" — is KEEP, and it survives
as a one-line rule in §K rather than as a 14-document bundle.

---

## E. Confirmed failure timeline

The prompt's §18 chain is not a hypothesis. It is source-proven at
`.codex/evidence/native-recovery-gate/contract.md`, with line citations I
verified against the tree. **SOURCE-PROVEN.**

```
native geometry capture wedges
  observed: one physical call grew 1,885 ms → 340,108 ms
        │
        ▼
geometryNativeOutstandingRef incremented at App.tsx:1891,
decremented ONLY in the settle finally (App.tsx:2448-2451)
        │
        ▼
nativeOutstanding pinned at 1 forever
(MAX_OUTSTANDING_NATIVE_PROBES = 1, surfaceProbeScheduler.ts:59)
        │
        ▼
every later tick → skip: "native-backlog" (surfaceProbeScheduler.ts:115)
        │
        ▼
no accepted geometry → lastAcceptedGeometryAt ages past
GEOMETRY_SCHEDULER_HEALTH_DEADLINE_MS (1,250 ms)
        │
        ▼
geometrySchedulerIsHealthy = false (App.tsx:1999, 3258)
        │
        ▼
RealAugmentOverlayGate.geometrySchedulerHealthy = false (App.tsx:1313)
        │
        ▼
realAugmentOverlayRenderable = false (augmentOverlayGate.ts:52-62)
        │
        ▼
ENTIRE BADGE LAYER SUPPRESSED (App.tsx:3844) for the rest of the game
  observed: continuousUnhealthyAgeMs ≈ 17 minutes, never recovered;
            schedulerRestartCount 1 → 21; nativeOutstanding pinned at 1
```

### Verdict on each §18 hypothesis

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Level is eligibility/wakeup, not visual proof | **CONFIRMED** | The chain contains no level term. Failure is "first round after the first wedge" |
| Geometry/surface state should establish offer presence | **CONFIRMED** | Render eligibility already keys off `lastAcceptedGeometryAt`, not OCR |
| OCR identifies cards rather than establishing existence | **CONFIRMED** | OCR runs on an independent channel counter; geometry gates rendering |
| Logical timeout ≠ physical native cancellation | **CONFIRMED, and it is the crux** | "Abandoning is not cancelling" (`surfaceProbeScheduler.ts:42`). The watchdog releases the JS guard and deliberately issues no replacement |
| Async replacement must remain bounded | **CONFIRMED and implemented** | `effectiveCap = wedged ? 2 : 1`; the unbounded `if (backlogged && aged) return start` form is explicitly rejected in the contract |
| Geometry and OCR cannot starve one another | **CONFIRMED at the JS layer** | Separate channel counters. **Not confirmed at the Rust layer** — see the open defect |
| Round ordinal cannot be required to perceive a visible offer | **CONFIRMED** | Round identity is downstream metadata written solely by `offerRoundOwnership.ts` |
| Stale async publication needs generation/ownership protection | **CONFIRMED and implemented** | `frameResultIsCurrent(captureSeq, geometrySeqRef.current)` (App.tsx:768) + `geometryInFlightTokenRef` (App.tsx:2462) |
| Lifecycle should be generic, not L11/L15-specific | **CONFIRMED** | No level special-casing exists anywhere in the chain |

**Every §18 hypothesis holds. This is the strongest part of the prompt and it
should be promoted to ADRs verbatim.**

### The one thing that is still broken — THE v0.9 TARGET

`native-recovery-gate/contract.md`, "Out of scope, discovered during
investigation":

> For probe 446 the capture breakdown is healthy (`preCaptureMs` 234,
> `captureMs` 273, `analysisMs` 221 ≈ 730 ms) yet `nativeElapsedMs` is
> **340108** with `timeoutClassification: "none"` and `stale: false` — i.e.
> `tokio::time::timeout(NATIVE_CAPTURE_TIMEOUT, worker)` (`lib.rs:884`) did
> **NOT fire across ~340 s**, which is only possible if the async task went
> unpolled. Meanwhile non-async `get_foreground_state` returned in 2–4 ms
> throughout, so the IPC/main thread was healthy.

A tokio timeout that does not fire for 340 seconds, while the runtime's inline
path stays at 2–4 ms, means the async task was never scheduled. Async tasks
starved; inline commands fine. **This is a Rust runtime/executor defect, and it
is the last thing standing between this repo and a four-round overlay.**

`20c9dfe` (2026-08-05) added instrumentation for it — blocking-pool dispatch
vs runtime-resume split, an async-runtime scheduling heartbeat, probe
classification — and its commit message states plainly: *"Does NOT claim to fix
the post-Round-2 acquisition collapse."* Fifteen days later it is still unfixed,
because the following two weeks went into gate bundles instead.

---

## F. Target overlay architecture

I evaluated the prompt's §19 diagram against the source. **It is already the
architecture the code implements**, with one accurate criticism.

```
LCU / Live Client Data          liveGamePoll.ts
   ├── game ownership           transitionConfirmedGameOwnership
   ├── level eligibility        (wakeup only — no visual authority) ✓
   └── lifecycle wakeups
            ▼
geometry / surface scheduler    surfaceProbeScheduler.ts + surfaceGeometry.ts
            ▼
visible offer state             (accepted geometry, not OCR) ✓
            ▼
generic offer lifecycle         offerRoundOwnership.ts  ← sole round authority ✓
        ┌───┴───┐
        ▼       ▼
      OCR   publication owner   ocrOwner.ts (round-authoritative) ✓
        └───┬───┘
            ▼
     badge renderer             BadgeChipLayer.tsx / positionedBadgeChips.ts
```

Round ordinal **is** already downstream metadata. There **are** no L11/L15
special cases. Both prompt requirements are already satisfied. **SOURCE-PROVEN.**

### The one accurate architectural criticism

`App.tsx` is **4,095 lines** and owns, directly:

- the geometry probe invoke/settle lifecycle and its in-flight token
- `geometryNativeOutstandingRef` / `geometrySeqRef` mutation
- the watchdog abandon branch
- game epoch transitions and the three close/suspend/begin paths
- scheduler health computation
- gate input assembly and the final render decision

The scheduler *reducer* is cleanly extracted and pure — but its *state* lives
in refs inside a 4,095-line component. Every proven defect in §E is a
consequence of that split: the increment is at `App.tsx:1891`, the decrement is
at `App.tsx:2448`, 557 lines apart, in a file where nothing structurally
prevents a third path from touching either.

**Recommendation:** extract a `geometryProbeRuntime` module owning
`nativeOutstanding`, `oldestNativeStartedAt`, `geometrySeq`, and the in-flight
token, exposing `begin()/settle()/abandon()` — so the wedge invariant is
enforced by a module boundary rather than by 557 lines of discipline. This is
**not** aesthetic refactoring; it is the smallest change that makes the §E
class of bug structurally unrepresentable. Do it *after* the Rust fix, not
before, and do not touch anything else in `App.tsx` in the same slice.

---

## G. Pi harness architecture — and why I am proposing less of it

### The disputed assumption

> *"Pi as the primary harness"* and *"the Pi orchestrator with task classifier,
> context packer, model/account router, quota ledger, worktree allocator,
> deterministic gate runner, verification dispatcher."*

**Evidence against building this now:**

**(i) Pi does not exist on this machine.** `command -v pi` → not found. No
`~/.pi`, no pi-like binary in `/opt/homebrew/bin`, `/usr/local/bin`,
`~/.local/bin`, or global npm. **OBSERVED.**

**(ii) This project has already built two harnesses this quarter.**

- `.claude/skills/slice-contract/SKILL.md` + `.codex/gates/<slice>/` +
  `.codex/evidence/<slice>/` + `scripts/checkpoint.sh` — codified in AGENTS.md
  under "Bounded Slices," with four terminal states, sha256-frozen red tests,
  and per-phase gate reports. **This one worked**: it produced
  `native-recovery-gate/`, the best root-cause document in the repository.
- `~/Desktop/overlay-minimal-v2-*` — a 14-document bundle with a normative FSM
  (`14_GATE_ROUTING.json`, 12 required terminal states), Gate 0–4, a blind
  Gate 2a / comparison Gate 2b, sha256 manifest pinning, and per-case JSON
  revision records. **This one did not.**

**(iii) The measured output of the second harness. OBSERVED:**

| Metric | Value |
|---|---|
| Span | 2026-08-07 → 2026-08-11 (5 days) |
| Case revisions | A, A2 … A12 (**12**) |
| Frozen review checkpoints | **28** |
| Terminal state reached | `GATE_0_PARTIAL` (hard stop) |
| `implementationAuthorized` | **false** |
| `experimentsAuthorized` | **false** |
| `nextAction` | `FRESH_GATE_0` |
| Overlay lines of code produced | **0** |
| Days silent since | **9** |

**This table is not the whole story, and the difference matters.** The
governance program *did* clear Gate 1 before it stalled: the frozen review
directories record **5 `PASS`** results against **2 `FAIL_DATA`**. The failure
was never "the perception work was wrong" — it is that the program then
regressed into Gate-0 partials and spent its remaining four days on revision
records instead of on the passing lane. Read the row above as *0 lines of code
despite a passing Gate 1*, which is a considerably worse indictment of the
machinery than 0 lines of code because nothing worked.

The Case-A12 record is worth quoting, because it diagnoses itself:

> `"revisionType": "governance-only successor revision binding the Gate-1
> first-experiment producer contract to the Gate-2b consumer contract at their
> normative sources"`

and, on the prior case's failure:

> `"rootCause": "DERIVATIVE_FALSE_ATTESTATION_ABOUT_THE_TRANSPORT_SEAM"`

Case A12's entire content is a repair to the *hash field of a JSON key used to
route between two gates*. Twelve revisions of a review process, terminating in
a hard stop, about a field in the review process. Meanwhile the actual defect —
a tokio task going unpolled — sat untouched from 2026-08-05 to today.

**This is not a criticism of rigor. It is a measurement of where rigor was
spent.** A verification apparatus that cannot authorize implementation has a
correctness-per-unit-capacity of exactly zero, no matter how sound each
individual gate is.

**(iv) The deterministic gate already does the expensive part, for free.**
25 seconds, 0 tokens, 2,253 assertions. Any harness component whose job is to
decide *"is this change correct?"* is competing with something that is already
faster, cheaper, and more trustworthy than any model.

### What I propose instead — minimum stateful control-plane complexity

Revision 1 argued "three components, not seven." **The count was the wrong
objective and is retracted** — the `overlay-minimal-v2` evidence argues against
process-heavy orchestration, but it does not imply any particular number.

The correct objective: **the minimum stateful control-plane complexity that
still discharges all six required responsibilities.** Every responsibility gets
a named owner; the design question is only how much *mutable state* each owner
holds, because state is what fails, drifts, and needs reconciling. Owners may
be a component, a static lookup table, or an explicit human procedure — a
responsibility discharged by a table that holds no state is strictly better
than one discharged by a service that does.

| Required responsibility | Owner | State owned | Why this owner |
|---|---|---|---|
| Deterministic gates | `scripts/gate.sh` | **none** — reads the repo, exits a code | Pure function of the tree. The single highest-value thing to build |
| Worktree isolation | `git worktree` + `scripts/checkpoint.sh` | **git's own** — no new store | Already exists and works; 21 worktrees registered |
| Small context packets | `docs/task-packets/<slice>.md` | **none** — a file per slice, versioned with the work | Packets must be reconstructible without conversation history |
| Task classification / routing | **static table in `.claude/harness-tiers.json`** + the routing matrix in §I | **none** — a lookup, re-read each time | Classification is a rule, not a running service. Keeping it a table means model churn edits data, never code |
| Account / quota routing | **Pi**, as the only stateful component | **the only mutable state in the design**: which account is in use, and observed exhaustion | Genuinely stateful — it must remember what was used. This is the one place a live process earns its complexity, and it is why Pi is the right target once the 2+2 pool is authenticated |
| Independent verification | Verifier-Lite protocol (§K), dispatched by Pi | **none beyond the routing above** | The *rules* are static; only the account choice is dynamic |

**Five of six responsibilities are dischargeable with zero new mutable state.**
That is the actual finding — not a component count. Pi owns the one irreducibly
stateful responsibility (which account, how much left), and should own nothing
else, because everything else is a pure function of the repository.

**What the `overlay-minimal-v2` evidence does and does not license.** It
licenses: *do not build a control plane whose state is the review process
itself* — 12 revision records, a 12-state FSM, and manifest hashes are all
mutable state describing work rather than doing it. It does not license any
claim about component counts, and revision 1 should not have made one.

**Proposed harness, in full:**

```
    scripts/gate.sh                      ← the only new executable
    (overlay tests, tsc, web tests, skill tests, eslint;
     prints one PASS/FAIL block; exits nonzero on any failure)
            │
            ▼
    docs/task-packets/<slice>.md         ← §7's packet, as a template
    (TASK / BASE SHA / WORKTREE / SPEC / PATHS / INVARIANTS /
     KNOWN FACTS / OPEN QUESTIONS / ACCEPTANCE TESTS / DO-NOT-TOUCH)
            │
            ▼
    one executor in one worktree         ← Claude or Codex, per §I
            │
            ▼
    scripts/gate.sh                      ← must be green
            │
            ▼
    risk-tiered review (§K)              ← 0, 1, or 2 reviewers. Usually 1.
            │
            ▼
    you decide what merges
```

That is the whole harness. It fits in one shell script and one markdown
template, it is provider-neutral, it survives Pi arriving later, and it
consumes zero model capacity when idle.

**Where Pi genuinely helps, when installed:** running `gate.sh` on a file-watch
and shipping the failure block into the next task packet automatically. That is
plumbing, and plumbing is exactly what the prompt correctly says Pi should be:
*"Pi is coordination infrastructure. Pi is NOT an additional epistemic
authority."* I agree with that sentence completely. I disagree only with
building the coordination infrastructure before the coordinated work exists.

---

## H. Current Arena model evidence

Retrieved **2026-08-20** from `https://arena.ai/leaderboard/agent`.
Leaderboard self-dated **2026-08-18**. 51 models, 1,893,896 total sessions.
**OBSERVED.**

Rows for models reachable from this machine's subscriptions:

| Rank | Model | Net Improvement | Confirmed Success | Steerability | Bash Recovery | Tool Halluc. | Sessions |
|---|---|---|---|---|---|---|---|
| 1 | **Claude Opus 5 (High)** | 12.34% ±1.53 | 15.49% ±3.15 | **10.95% ±2.98** | **14.31% ±0.81** | 1.09% ±0.17 | 19,783 |
| 2 | **Claude Opus 5 (Max)** | 11.97% ±1.79 | **18.23% ±3.26** | 6.46% ±3.62 | 14.65% ±0.90 | 1.16% ±0.17 | 15,561 |
| 3 | **Claude Fable 5 (High)** | 11.64% ±1.71 | 12.41% ±3.23 | 8.67% ±3.61 | 14.00% ±2.44 | 1.18% ±0.17 | 31,658 |
| 5 | **GPT 5.6 Sol (xHigh)** | 9.80% ±1.39 | 10.12% ±2.86 | 6.01% ±2.88 | 9.67% ±1.03 | 1.19% ±0.17 | 26,243 |
| 11 | Claude Sonnet 5 (High) | 6.59% ±2.18 | **1.54% ±4.59** | 4.77% ±4.61 | 11.24% ±1.72 | 1.04% ±0.18 | 25,806 |
| 19 | GPT 5.6 Luna (xHigh) | 4.25% ±1.87 | 1.37% ±4.22 | 1.63% ±3.78 | 11.51% ±1.46 | 1.19% ±0.17 | 8,780 |
| 22 | GPT 5.6 Terra (xHigh) | 3.16% ±1.20 | 2.13% ±2.93 | 4.70% ±2.38 | 9.84% ±1.24 | 1.19% ±0.17 | 14,520 |

**Data-fidelity caveat:** in the fetched rendering, ranks ~30–51 show
magnitudes without minus signs while being ordered below clearly-positive rows
(e.g. rank 51 shows "19.81%" Net Improvement). The sign is evidently stripped
in conversion for negative values. Every model relevant to this project sits at
ranks 1–22 where the ordering makes the sign unambiguous, so no routing
conclusion below depends on the ambiguous region. Flagged rather than silently
used.

### Four conclusions the numbers actually support

**1. Max effort buys nothing on Net Improvement and costs Steerability.**
Opus 5 High 12.34% ±1.53 vs Max 11.97% ±1.79 — CIs overlap almost entirely.
But Steerability is 10.95% ±2.98 (High) vs 6.46% ±3.62 (Max), a gap that barely
survives its own error bars in the other direction. **This is direct public
evidence for the prompt's §5.** Max earns its place only where Confirmed
Success dominates and mid-course correction does not matter — i.e. final
arbitration, exactly as §5 says.

**2. Opus 5 High and Fable 5 High are statistically indistinguishable at the
top.** 12.34% ±1.53 vs 11.64% ±1.71, with Fable on a larger sample (31,658 vs
19,783). Treat FRONTIER as a **set**, not a ranking. Route between them by
quota state. Both are reachable on this Pro account (`claude-fable-5[1m]` is
listed in the account's model-options cache — **OBSERVED**).

**3. For bash-heavy repository archaeology, Claude is measurably better and the
CIs do not overlap.** Bash Recovery: Opus 5 High 14.31% ±0.81 → [13.50, 15.12];
GPT 5.6 Sol xHigh 9.67% ±1.03 → [8.64, 10.70]. Disjoint. Steerability shows the
same direction (10.95 ±2.98 vs 6.01 ±2.88). This is the single strongest
routing signal in the table, and it maps directly onto this repository's work:
git archaeology, worktree navigation, gate running.

**4. Tool Hallucination does not discriminate.** Every model in our pool sits at
1.04–1.19% ±0.17. Identical within error. **Do not route on it.** (The metric
does discriminate elsewhere — Opus 4.8 at rank 24 shows 28.02% ±8.93 — but not
among options we can actually pick.)

**5. Sonnet 5's Confirmed Success CI crosses zero** (1.54% ±4.59). As a
BALANCED tier it is fine for bounded implementation *behind a hard
deterministic gate*, and unsuitable as an autonomous finisher. Given our gate
costs 25 seconds, that constraint is free to satisfy.

---

## I. Model / account routing matrix

### Inventory — target pool vs current local auth

Revision 1 reported this as "the pool is 1+1, not 2+2." **That was a category
error and is retracted.** What I observed is local authentication state, which
does not revise the resource pool the user says they have. Local auth is a
setup task; the pool is a given. Restated as two separate facts:

**TARGET / AVAILABLE POOL (given by the user, not for me to revise):**
`CLAUDE_A`, `CLAUDE_B`, `GPT_A`, `GPT_B` — 2 × Claude Pro, 2 × ChatGPT Plus.

| Slot | Current local auth | Action |
|---|---|---|
| **CLAUDE_A** | authenticated | none |
| **CLAUDE_B** | **setup required** | second profile/credential not present on this machine |
| **GPT_A** | authenticated | none |
| **GPT_B** | **setup required** | single `~/.codex/auth.json` |
| **Pi** | **setup required — installation prerequisite, not a design input** | `command -v pi` → not found |

Likewise retracted: "Pi is not installed, therefore do not target Pi." Absence
of an installation is a prerequisite to satisfy, not evidence about the right
target architecture. §G is rewritten accordingly — Pi is the target harness;
what §G disputes is only *how much stateful machinery it should own*, which is
an argument from the `overlay-minimal-v2` outcome, not from `command -v`.

**Detail behind the auth observations:**

| Slot | Status | Evidence |
|---|---|---|
| **CLAUDE_A** | **OBSERVED** — `jasonwangpsr@gmail.com`, `organizationType: claude_pro`, `billingType: stripe_subscription`. Claude Code 2.1.235. Models: Opus 5 (session default), Fable 5 (in options cache), Sonnet, Haiku | `~/.claude.json`, `claude --version` |
| **GPT_A** | **OBSERVED** — Codex CLI 0.147.0, ChatGPT OAuth (`tokens` present, `OPENAI_API_KEY: false`), default `model = "gpt-5.6-sol"` | `~/.codex/auth.json`, `~/.codex/config.toml`, `codex doctor` |
| **CLAUDE_B** | **UNVERIFIED** — one credential in Keychain (`Claude Code-credentials`), one `oauthAccount`, no second profile | `security dump-keychain`, `~/.claude/` |
| **GPT_B** | **UNVERIFIED** — single `~/.codex/auth.json` | `~/.codex` |
| **Pi** | **ABSENT** | `command -v pi` → not found |

**⚠ Budget-premise conflict you should know about.** The prompt says *"Do not
enable API billing, usage credits, or pay-as-you-go fallback unless explicitly
authorized."* CLAUDE_A currently has **`hasExtraUsageEnabled: true`** — overage
billing beyond the included Pro capacity is switched on. I did **not** change
it. If the intended budget really is included-subscription-only, turn it off in
your Claude account settings; if paid overage is intentional, the §J policy
below still holds but the ceiling is money rather than quota.

**⚠ Second config conflict.** `~/.codex/config.toml` sets
`model_reasoning_effort = "xhigh"` as the **global default**. That contradicts
prompt §5 ("Do not use maximum reasoning effort by default") on every Codex
invocation on this machine. Recommend `"medium"` as the default with per-task
`-c model_reasoning_effort=high` escalation. One line, real savings.

### Capability tiers, mapped to what actually exists here

| Tier | CLAUDE_A | GPT_A | Basis |
|---|---|---|---|
| FRONTIER | Opus 5 (high) · Fable 5 (high) | GPT 5.6 Sol (high) | Arena ranks 1/3/5 |
| BALANCED | Sonnet 5 (medium) | GPT 5.6 Terra (medium) | Arena 11/22 |
| THROUGHPUT | Haiku 4.5 (low) | GPT 5.6 Luna (low) | Cheapest that clears narrow verifiable tasks |

Store this mapping in `.claude/harness-tiers.json`, not in AGENTS.md, so model
churn never requires editing an always-loaded instruction file (§22).

### Routing matrix — 2+2 target pool, annotated with current auth

| Task class | Account | Tier | Effort | Parallel? | Verification |
|---|---|---|---|---|---|
| Repo search / path inventory | CLAUDE_A | throughput | low | only if separable | deterministic only |
| Test-output triage | either | throughput | low | yes | deterministic only |
| **Git archaeology / worktree navigation** | **CLAUDE_A** | balanced | medium | no | deterministic |
| Docs / handoff writing | GPT_A | balanced | medium | yes (frees Claude) | read-only review |
| Bounded implementation (known seam, red test exists) | GPT_A | balanced | medium | no | `gate.sh` |
| Nontrivial debugging | CLAUDE_A | balanced→frontier | high | no | `gate.sh` + 1 reviewer |
| **Rust async-runtime / concurrency** | **CLAUDE_A** | frontier | high | no | `gate.sh` + GPT_A cross-review |
| Architecture decisions | CLAUDE_A | frontier | high | GPT_A independent critique | cross-provider |
| Final dispute / release baseline | CLAUDE_A + GPT_A | frontier | high / max | yes | deterministic + reversed-order pairwise |

**The archaeology and concurrency rows are the only two where I claim a
*measured* provider preference**, and both rest on the disjoint Bash Recovery
interval in §H.3. Everything else is a quota-balancing choice, not a quality
claim — say so rather than dressing preference as evidence.

**When CLAUDE_B / GPT_B are confirmed:** the only rows that change are the last
two. B accounts become the independent reviewers, so the A accounts never
review their own work and no context has to be rebuilt. Nothing above needs
rewriting — which is the point of routing by tier rather than by model name.

---

## J. Token / quota policy

### Where capacity actually goes — measured, not guessed

| Sink | Size | Replaceable by |
|---|---|---|
| **HIGH — re-deriving repository state each session** | This audit read ~40 files before it could reason at all | `docs/handoffs/overlay-v1-current-state.md` + this report. A packet costs ~2k tokens; rediscovery costs ~80k |
| **HIGH — governance documents about governance** | 5 days, 12 revisions, 0 code (§G) | Delete the apparatus. `gate.sh` decides correctness |
| **HIGH — loading `App.tsx` (4,095 lines) for any overlay task** | ~50k tokens per agent, per session | Module extraction (§F) turns a 4,095-line read into a 300-line read |
| **MEDIUM — full-repo context for narrow tasks** | 17 GB of worktrees | Task packets with explicit RELEVANT PATHS |
| **MEDIUM — evidence-tree reading** | 203 files, 7.8 MB | Read the `contract.md` and the `analysis.json`; skip the raw logs. The 66 MB `runtime.log` should be queried with grep, never read by a model |
| **LOW — the deterministic gate** | **25 s, 0 tokens, 2,253 assertions** | Nothing. This is the floor and it is already optimal |

Applying the prompt's §25 questions to each HIGH sink:

- *Can deterministic code replace this?* — Yes, for correctness judgement.
  `gate.sh` replaces every "does this work?" reviewer.
- *Can retrieval replace reasoning?* — Yes, for state. One current-state handoff
  replaces per-session rediscovery, permanently.
- *Can a persistent artifact remove the need to explain it again?* — Yes, and
  this report is that artifact for the v0.8 question. It should never need to
  be re-derived.
- *Can smaller context replace the whole repo?* — Yes, once `App.tsx` is split.

### Standing rules

1. **Run `gate.sh` before asking any model anything about correctness.**
   25 seconds beats every reviewer.
2. **Never read `runtime.log` (66 MB / 500k lines) into a model.** Grep it.
3. **Default effort medium.** Escalate on evidence: a failed hypothesis, a
   deterministic contradiction, a concurrency ambiguity. Not on importance —
   importance raises *verification* rigor, not every agent's effort (§10).
4. **One executor per slice.** N=2 candidates only with a written answer to
   "what uncertainty does B resolve?"
5. **Fresh session per task packet.** Conversation history is disposable cache;
   the packet plus the repo is the durable state.
6. **Do not build a quota ledger** until a provider exposes token counts under
   subscription auth. Record the available proxies instead — model, effort,
   files loaded, tool calls, duration, whether a quota warning appeared.

### Honest limitation

Neither Claude Code nor Codex reports per-request token consumption under
subscription authentication. **Every token number in this section is a
structural estimate, not a measurement.** The prompt's §3 ledger schema is
sound but currently unfillable for its `approx_input_tokens` /
`approx_output_tokens` columns. Record proxies; do not fabricate numbers.

---

## K. Verifier policy

I read both sources. **The paper is real** — *LLM-as-a-Verifier: A
General-Purpose Verification Framework*, Kwok, Li, Atreya, Liu, Jiang, Finn,
Pavone, Stoica, Mirhoseini; arXiv 2607.05391, submitted 2026-07-06 (v2
2026-07-07). Terminal-Bench V2 86.5%, SWE-Bench Verified 78.2%,
RoboRewardBench 87.4%, MedAgentBench 73.3%. **OBSERVED.**

### A blocking constraint the prompt does not mention

The paper's central mechanism is that the verifier *"computes the expectation
over the distribution of scoring token logits to generate continuous scores."*
**Logprobs are not exposed by Claude Code or the Codex CLI under subscription
authentication.** The framework's core scoring primitive is therefore
**not implementable** in this harness without API billing, which is out of
budget scope.

What *is* portable is the structural half, and it is the useful half:

| Mechanism | Portable? | Adopt? |
|---|---|---|
| Continuous scores from token logits | **No** — no logprob access | Skip. Use ordinal severities |
| Decomposed criteria | Yes | **Yes** — §L's nine criteria |
| Repeated evaluation (K passes) | Yes, at K× cost | Only at RISK 4 |
| Order reversal / positional-bias cancellation | Yes, free | **Yes** — whenever comparing two candidates |
| Probabilistic Pivot Tournament (O(N²)→O(Nk)) | Yes | Irrelevant at N≤2. Note for later |

**Naming, per the reviewer's correction.** The subscription-compatible
mechanism is therefore called **Verifier-Lite** throughout this report and in
the AGENTS.md addendum. It must never be described as an implementation of the
paper, in a commit message, a doc, or a review comment. Verifier-Lite comprises
exactly: decomposed criteria, independent reviewers, fixed-point diffs,
mandatory evidence citations, reversed A/B ordering, and disagreement
escalation. It excludes the logprob-derived continuous scoring that defines the
published method.

This name is provisional on the budget constraint, not on principle: if a
backend *within the authorized subscription capacity* is found that exposes
scoring-token logprobs, the exact mechanism becomes available and the name
should be revisited. No such backend is known to me today, and finding one is
not authorized to involve enabling billing.

**Verifier-Lite never outranks a deterministic gate.** A failing gate cannot be
overruled by any number of reviewers at any effort level.

### Risk-adaptive policy

| Risk | Example in this repo | Required |
|---|---|---|
| **0** | Docs, formatting, `.gitignore` | `gate.sh`. No LLM verifier |
| **1** | Isolated bugfix with an existing red test | `gate.sh` + optional read-only review |
| **2** | Behavior change (e.g. a new scheduler threshold) | `gate.sh` + one independent reviewer |
| **3** | Overlay lifecycle / native / concurrency / ownership | `gate.sh` + cross-provider review. **The Rust async fix is RISK 3** |
| **4** | v0.8 baseline arbitration, release-critical | `gate.sh` + two independent reviewers + reversed-order pairwise if two viable candidates |

### Non-negotiables

- **A verifier is read-only.** It may not fix its own finding in the
  verification pass.
- **A verifier never sees the executor's reasoning transcript.** It gets the
  spec, the diff, the invariants, and the gate output. This is the one idea
  worth salvaging from `overlay-minimal-v2` — its blind Gate 2a had exactly
  this property (`gate2aReviewerVisibleFiles: ["01_PRD.md", "BASELINE_REPORT.md"]`).
- **A failing deterministic gate cannot be overruled** by any model, effort
  level, or majority vote.
- Findings must carry CLAIM / EVIDENCE / SEVERITY / CONFIDENCE / VIOLATED
  INVARIANT. "Looks good" is not a review.

---

## L. AGENTS.md / CLAUDE.md redesign

### Finding: AGENTS.md is already good; CLAUDE.md is actively self-corrupting

`AGENTS.md` (12 KB) is provider-neutral, contains no volatile state, and
already encodes the data ladder, localization architecture, bounded slices, and
the augment cardinality invariant. **Recommendation: keep it, and add one
section.** Rewriting it would be exactly the unrequested churn its own §3
forbids.

`CLAUDE.md` has a real, mechanical §22 defect. **SOURCE-PROVEN:**

```markdown
Maintained by `scripts/update-state.sh` (post-commit hook via ...)
<!-- STATE:START -->
- Patch: `26.13`
- Augments: `268`
- Tests passing: `322`      ← rewritten by a post-commit hook
- Cross-parity budget: `0` divergent champions
- Last tag: `pre-docs-review-4a83c26`
<!-- STATE:END -->
```

An **active `post-commit` hook** rewrites an always-loaded instruction file with
volatile state. Consequences observed right now:

- The primary checkout is dirty in `CLAUDE.md` and `scripts/state.json` purely
  from this mechanism (`322` committed vs `445` working).
- Both values are already wrong for the overlay line: the real counts at
  `4eb271b` are **1209** web and **727** overlay.
- Every session pays tokens to load a number that is stale, unqueryable, and
  meaningless without knowing which of three suites it counts.

This is precisely the prompt's §22 rule — *"Do not allow post-commit automation
to rewrite always-loaded instruction files with volatile state. Queryable facts
should remain queryable."* Tests-passing is the definitive queryable fact:
`gate.sh` prints it in 25 seconds.

### Proposals (written as separate files; nothing overwritten)

- `docs/proposals/2026-08-20-AGENTS.md-addendum.md`
- `docs/proposals/2026-08-20-CLAUDE.md-revision.md`

Root `CLAUDE.md` has uncommitted local modifications and was deliberately not
touched.

### The Pocock skill set — adopt 3, skip 4

The prompt (§14) names seven skills from `github.com/mattpocock/skills` and
asks for an explicit evaluation. Install path is
`claude plugins install mattpocock-skills`. **None are installed today**, and
the honest finding is that this repository has already converged on most of
what they encode — the gap is narrower than the prompt assumes.

| Skill | Verdict | Why |
|---|---|---|
| `diagnosing-bugs` | **ADOPT** | The single highest-value one here, and the only one that addresses a *demonstrated* failure. §E's chain was diagnosed correctly three separate times and repaired zero times; §M is that skill's shape (falsifiable hypotheses, then the cheapest discriminating experiment) applied by hand. Making the shape explicit is what stops a fourth re-diagnosis |
| `tdd` | **ADOPT (as reinforcement, not new practice)** | Already the house style — 2,253 assertions, sha256-frozen red tests in the slice contract. Adopt for the vocabulary, not the method |
| `code-review` | **ADOPT** | Fills a genuine gap. §K's independence rules say *who* reviews; this says *how*. Pair it with the reviewer-never-sees-the-executor's-transcript rule, which it does not itself enforce |
| `research` | **SKIP** | Superseded here by the evidence-grade ladder (OBSERVED / SOURCE-PROVEN / TEST-PROVEN / INFERRED) already used throughout this report and mandated by AGENTS.md's Verification Floor |
| `codebase-design` | **NOT IN DEFAULT EXECUTION PATH** | Load it for an explicitly architectural task, not by default. `docs/specs/overlay-v1-product-contract.md` is the standing design authority, so the default path does not need it |
| `improve-codebase-architecture` | **NOT IN DEFAULT EXECUTION PATH** | Revision 1 said "actively counter-indicated." **Retracted** — that conflated unnecessary architecture *churn* with architecture *reasoning*. The failure was the former. Load this deliberately when an architectural question is the actual task; keep it out of the default loop so it cannot become a substitute for shipping |
| `implement` | **SKIP** | Directly overlapped by `.claude/skills/slice-contract/SKILL.md`, which is repo-specific, already load-bearing in AGENTS.md, and encodes gates this project actually has. Two competing implementation protocols is worse than one |

The three-skill default set is therefore `diagnosing-bugs`, `tdd`,
`code-review`; the rest are available-on-demand rather than rejected.

**Sequencing:** install nothing until the §M slice is done. Adopting three new
skills *and* attempting the Rust defect in the same week reproduces the exact
pattern §G documents — tooling investment displacing the fix. Adopt them at the
v0.9 retrospective, when there is a shipped result to compare against.

---

## M. v0.8 → v0.9 migration plan

### Reaudit: "done" was the wrong word

Revision 1 called §26 steps 0–3 and 6–7 "done." That collapsed three different
things. Reaudited with the levels the reviewer specified —
**IMPLEMENTED** (source contains the mechanism), **OFFLINE-PROVEN**
(a deterministic regression demonstrates it), **LIVE-PROVEN** (controlled live
acceptance demonstrates it):

| Recovery invariant | IMPLEMENTED | OFFLINE-PROVEN | LIVE-PROVEN | Evidence |
|---|---|---|---|---|
| Generic next-offer recognition | **yes** | **yes** — 8 cases | **no** | `offerRoundOwnership.ts`; zero `level` references, so identity is not level-keyed. Live: reached R2 generically, but both rounds ended `FAIL_DATA` |
| Round-independence | **yes** | **yes** — 10 cases (`roundContentCompletion`) | **partial** | Live trace advanced R1→R2 with distinct `offerGeneration` (4, 30). **R3/R4 never observed in any artifact** |
| Slot-local reroll | **yes** | **yes** — 35 reroll cases across `rerollInvalidation`, `offerLifecycle`, `badgeLayout` | **no** | No live trace isolates a slot-local reroll with a clean result |
| Stale publication | **yes** | **yes** — 3 + 6 cases | **partial** | `sameOfferDataRefresh.ts`, `frameResultIsCurrent`; live `stale-results: 30` shows the guard firing, not that it was correct |
| Scheduler recovery | **yes** | **yes** — 31 cases | **NO — live evidence is against it** | `WEDGED_NATIVE_PROBE_MS` = 4000. Live: `geometry-watchdog: 37`, `geometry-recovery: 30` — recovery fired **thirty times and rounds 3–4 still never arrived** |

**The last row is the most important line in this section.** Scheduler recovery
is fully implemented and fully offline-proven, and the one live trace shows it
executing repeatedly without achieving its purpose. That is the clearest
demonstration available that **offline-proven is not live-proven**, and it is
independent evidence that the remaining defect lies below the JS scheduler —
consistent with, though not proof of, the Rust hypothesis.

Restating §26 with the same discipline:

| §26 step | Level reached | Note |
|---|---|---|
| 0. reconstruct / freeze v0.8 | **CANDIDATE identified; not frozen, not behaviorally proven** | §C |
| 1. deterministic trace/replay seam | IMPLEMENTED + OFFLINE-PROVEN (1 case only) | `overlayReplay.ts` deliberately unwired |
| 2. bounded native capture | IMPLEMENTED (JS) / **not IMPLEMENTED (Rust)** | the open defect |
| 3. non-starving scheduling | IMPLEMENTED + OFFLINE-PROVEN, **not LIVE-PROVEN** | see table above |
| 4. ownership through gaps | IMPLEMENTED + OFFLINE-PROVEN | `82dc436`, `ec59fc4` |
| 5. bounded recovery from wedge | IMPLEMENTED + OFFLINE-PROVEN, **live evidence against** | 30 recoveries, no R3 |
| 6. generic next-offer | IMPLEMENTED + OFFLINE-PROVEN | not live-proven |
| 7. stale publication / reroll | IMPLEMENTED + OFFLINE-PROVEN | partially live |
| 8–11. prove R1–R4 | **none proven** | all 3 captured completions are `FAIL_DATA` |
| 12–15. clearing, ghosts, liveness | not reached | — |

Note this reaudit **lowers** step 8's status from revision 1, which claimed
"R1, R2 proven." They were reached, not proven.

### Recommended first v0.9 slice — a red-capable reproduction, not a fix

Revision 1 defined the slice as "fix the starvation." That skipped the
feedback loop. The slice is redefined as **building a deterministic
reproduction first**; the repair is slice 2 and is not authorized by this
report.

**Why the reproduction has to come first, in one fact:** the whole suite is
green, the production symptom persists, and **`cargo test` is executed by
exactly one thing in this repository — `.github/workflows/windows-overlay.yml:72`.**
It does not run on macOS, and it is not in the local gate. The Rust tests that
do exist (`geometry_timing_fields.rs`) assert that `dispatch_wait_ms` and
`resume_wait_ms` *exist and serialize*, not that starvation is detected. No
test anywhere constructs a starved runtime.

```
SLICE:        v0.9-s1 — RED-CAPABLE REPRODUCTION of native async-runtime starvation
GOAL:         a test that FAILS on current code for the right reason.
              No production code is modified in this slice.
BASE SHA:     4eb271b79826877e5fce0cfa7ad4e24b01cb6d71   (V0.8-CANDIDATE)
WORKTREE:     fresh worktree off the candidate; tracked tree clean at start
RISK:         2  (test-only) → gate + one independent review
ROUTE:        CLAUDE_A, FRONTIER, effort HIGH (concurrency reasoning;
              Arena Bash Recovery CI [13.50,15.12] vs [8.64,10.70], disjoint)
REVIEW:       GPT_A, read-only, spec + diff + gate output only

PREREQUISITE (blocks the slice, ~1 line):
  `cargo test` must run locally on macOS and be added to the gate. Until then
  a red Rust test cannot be observed going green. This is the actual first
  action.

THE DISCRIMINATING INSTRUMENT ALREADY EXISTS.
  20c9dfe split the opaque in-Rust wait into two fields with different causes
  (lib.rs:1499-1510, verbatim):
    dispatch_wait_ms — command entry → blocking closure body begins.
      Crossing it needs NO async worker; "should read ~0 even under total
      starvation" (tokio defaults to 512 blocking threads).
    resume_wait_ms   — closure body ends → command returns. Crossing it
      DOES require an async worker to re-poll the woken timeout;
      "this is the true starvation signal here."
  So the reproduction has a precise, pre-existing oracle.

HYPOTHESES, cheapest discriminator first:
  H1  The async runtime is starved of workers, so the woken timeout is never
      re-polled.        Predicts: resume_wait_ms >> 0, dispatch_wait_ms ~ 0.
  H2  A blocking syscall runs on an async worker (missing spawn_blocking).
      Predicts: BOTH waits large.
  H3  Runtime undersized vs concurrent capture permits (lib.rs:837 try_acquire).
      Predicts: stall MOVES when worker_threads is raised, rather than clearing.
  H4  A permit is held across an await, deadlocking the semaphore.
      Predicts: stall is unbounded and independent of worker_threads.
      Prior art against H4: lib.rs:874-881 documents the permit deliberately
      living inside the blocking worker.

FIRST EXPERIMENT — zero code, one command:
  Extract dispatch_wait_ms and resume_wait_ms around probe 446 from the
  already-captured 66 MB runtime.log and compare them.
  This separates H1 from H2 before a line is written, using data already on
  disk. Do this before opening an editor.
  (Not run in this pass: the log predates 20c9dfe, so the fields may be
  absent — in which case the answer is "capture one fresh trace at the
  candidate," which is cheap and is also step 2 of §C's promotion path.)

THE RED TEST (write only after the experiment picks a hypothesis):
  A #[tokio::test] on a deliberately constrained multi-thread runtime that
  occupies every worker, then drives run_bounded_capture_with_gate and asserts
  the timeout fires within its configured budget.
  RED CRITERION: on current code the observed fire latency exceeds the
  configured timeout by a wide, non-flaky margin.
  Freeze the test by sha256 before any repair, per the slice contract.

ACCEPTANCE FOR THIS SLICE (all four):
  1. cargo test runs locally on macOS and is in the gate
  2. the new test FAILS on 4eb271b, for the documented reason
  3. it is not flaky — 20 consecutive runs, same verdict
  4. no production source modified

EXPLICITLY NOT IN THIS SLICE: the repair; JS scheduler threshold changes;
the champion-fetch data defect; any live-game run.
```

**Then, and only then, slice 2:** smallest fix → show red → green → run the
regression gates. **Slice 3** is the champion-augments fetch defect, which is
independently OBSERVED and which no amount of Rust work will resolve.

### Correction to §26's ordering

§26 says *"Do not skip directly to R3/R4."* Correct in general — but R1 and R2
are already proven at `4eb271b` and re-proving them costs a live game per
attempt. The right reading is *"do not skip the four-round proof"*, and the
first slice above preserves it: `round-content-complete: 4` is the acceptance
criterion, which necessarily re-demonstrates R1 and R2.

---

## N′. Resource safety and backup — exact changes, none applied

### Subscription-only safety

Two settings currently contradict the stated budget. **I applied neither, and
recommend the user apply them; billing settings are not mine to change.**

| # | Finding | Where it actually lives | Exact change |
|---|---|---|---|
| 1 | `hasExtraUsageEnabled: true` | **`~/.claude.json:1629`, inside the `oauthAccount` object** — this is a *server-synced mirror of account state*, not a local preference | **Do not edit the JSON**; a local edit would be overwritten on next sync and would not change billing. Turn extra usage off in **Claude account settings on claude.ai**, then confirm the mirror flips to `false` |
| 2 | `fableOverageConsentV2: {"5c7662a8-…": true}` at `~/.claude.json:1622` | org-level overage consent for Fable | Review alongside #1. Same reasoning: change it at the account level, not in the file |
| 3 | `model_reasoning_effort = "xhigh"` | `~/.codex/config.toml:2` — a genuine local preference | Change the default to `"medium"`; escalate per invocation with `-c model_reasoning_effort=high`. One line, applies to every Codex call on this machine |

Verification after #1 and #2: re-read the two keys and confirm `false`. There
is no local command that can prove billing is disabled — only the account page
is authoritative.

### Effort routing (default policy)

| Class | Effort |
|---|---|
| Mechanical — search, inventory, reformat, test-output triage | **low** |
| Bounded implementation against an existing red test | **medium** |
| Hard debugging — concurrency, native lifecycle, unexplained runtime behavior | **high** |
| Frontier / disputed / release-critical | **high**, with `xhigh`/`max` **only by explicit escalation**, one sentence of justification recorded |

Arena results are a **routing prior, not an oracle**: they inform which
provider to prefer for a class of work, and they never override a deterministic
gate or a reproduction.

### Remote backup — separate the two actions

Revision 1 bundled these. They have different risk profiles and only one is
currently justified.

**A. Remote backup — recommended now.** 73 commits exist on a single disk,
inside a gitignored directory. The safest exact operation:

    git -C .claude/worktrees/overlay-tier-card push origin feat/overlay-tier-card

It is non-destructive: it fast-forwards an existing remote branch that is 73
behind, creates nothing, and overwrites nothing. Verify with
`git rev-parse origin/feat/overlay-tier-card` matching `4eb271b` and
`[ahead 0]` in the status line. Also worth backing up separately, per §D:

    git push origin fix/overlay-poll-owner-watchdog     # preserves bd099ed

**B. Semantic tag — NOT `v0.8-baseline`, not yet.** Behavioral confidence is
not established (§C), so the name would assert something unproven. If an
immutable marker is wanted before then, use an explicitly provisional
**annotated** tag:

    git tag -a v0.8-candidate-4eb271b -m "V0.8 CANDIDATE. Tree reconstruction HIGH; behavioral baseline NOT established. Observed 2-round tree was 76a97b63 + 197 dirty paths, fingerprint 41aa9b58…, which this commit provably is not. See docs/reviews/2026-08-20-v08-recovery-and-harness-audit.md §C."

**Branch, annotated tag, or both? Both, and they do different jobs.** The
branch is the backup — it moves, and it preserves the whole line including
future work. The tag is the marker — annotated rather than lightweight because
an annotated tag is its own object carrying a message, a tagger, and a date,
so the reasoning above travels with the repository instead of living only in
this file. A lightweight tag would be a bare pointer and would lose exactly the
caveat that matters here. Push the branch first; the tag is optional and can
wait for the user's decision on the name.

**Neither has been executed.** Both remain unauthorized.

---

## N. Open questions

1. **★ What does "worked" mean for L3/R1 and L7/R2?** Now the most
   consequential open question in the audit, because the entire v0.8 target is
   defined by it. The one two-round trace shows badges **rendering** (63
   `badge-layer`, 50 `rendered-records`) while both rounds ended
   `result: FAIL_DATA` with null tier/stat fields. If "worked" means *badges
   appeared*, that state is captured and `round34-live` is the baseline
   reference. If it means *correct tier content appeared*, then **no artifact
   anywhere records the state being recovered**, and the champion-augments
   fetch defect is on the critical path to any live proof. UNVERIFIED —
   unresolvable from artifacts; only you can answer. *Blocking: the definition
   of done for v0.9.*
2. **Setup: CLAUDE_B, GPT_B, Pi.** The pool is 2+2 by your statement; only
   `CLAUDE_A` and `GPT_A` are authenticated here, and Pi is not installed.
   These are setup tasks, not architectural facts. *Blocking nothing today.*
2. **Is `hasExtraUsageEnabled: true` on CLAUDE_A intentional?** It contradicts
   the stated subscription-only budget. I did not change it.
3. **Push the branch now?** 73 commits exist only inside a gitignored
   directory. Recommendation: **yes, push** (§N′). The *tag* is a separate
   decision and my recommendation there is **not yet** — or a provisional
   `v0.8-candidate-4eb271b` if a marker is wanted before behavioral proof.
4. **Is `overlay-minimal-v2` formally abandoned?** 9 days silent at
   `GATE_0_PARTIAL`. §D classifies the machinery ABANDON and salvages two ideas.
   Confirm before I act on that classification.
5. **Where should `feat/overlay-tier-card` live?** Working inside
   `.claude/worktrees/` (gitignored, 17 GB) is fragile for the project's most
   valuable branch.
6. **Is Pi going to be installed?** §G's harness works without it and gains
   automation with it. Nothing waits on the answer.
7. **The 7 stashes** (oldest 2026-06-04) are unclassified. Cheap T0 sweep,
   deferred.
8. **Should `.codex/worktrees/` be gitignored?** 11 GB currently shows as
   untracked in every root `git status`.

---

## Audit packet

**Revision 2 evidence added:** full-corpus sweep of **297** artifact files
(`.log`/`.jsonl`/`.json`/`.txt`/`.ndjson` across `.codex/evidence/`, both
external review roots, `~/Desktop/wt-snapshots/`, and the `overlay-minimal-v2`
corpus) → 3 distinct `round-content-complete` events, all `FAIL_DATA`;
`round34-live/manifest.json` provenance (HEAD `76a97b63`, `dirtyCount` 197,
fingerprint stable start==final); per-commit attribution of the
`76a97b63..4eb271b` source delta; the `repository_fingerprint` algorithm at
`preflight.py:398`; Rust test inventory and the `cargo test`-runs-only-in-
Windows-CI finding. Still **0 commits, 0 production files changed.**


| Field | Value |
|---|---|
| STARTING HEAD | `5047c19` (primary checkout, unchanged) |
| ENDING HEAD | `5047c19` — **no commits created** |
| Overlay line inspected | `4eb271b` — unchanged, still clean |
| WORKTREE STATUS | unchanged; no worktree added, pruned, or removed |
| FILES CHANGED | none |
| FILES CREATED | this report + 2 proposal files (all new, untracked) |
| FILES DELETED | none |
| COMMITS CREATED | **0** |
| TESTS RUN | overlay vitest; overlay `tsc --noEmit`; web vitest; skill unittest |
| EXACT RESULTS | **727/727 pass (1.31 s)** · **exit 0** · **1209/1209 pass (3.62 s)** · **317 tests OK (19.0 s)** |
| MODEL ROUTING USED | single session, Claude Opus 5, effort xhigh (set by the operator before the task) |
| ACCOUNT ROLES USED | CLAUDE_A only |
| PARALLEL AGENTS USED | **0** |
| WHY | Every finding chained off the previous one — the `.codex` evidence tree was only worth reading *after* ancestry disproved the `60925a6` premise, and `overlay-minimal-v2` was only findable *after* that. Parallel scouts would have duplicated context with no independent information gain (§13) |
| VERIFIERS USED | 3 advisor consultations plus **1 independent reviewer pass** whose 11 corrections drove revision 2. Corrections accepted: 11 of 11 |
| TOKEN / QUOTA DATA | **unavailable** — neither CLI reports per-request tokens under subscription auth. Proxies: ~25 tool calls, 4 gate runs, 4 external fetches |
| DISAGREEMENTS (rev 2) | §G (control-plane *state*, not component count), §K (logprobs unavailable → Verifier-Lite), §L (3 of 7 skills in the default path), §M (sequencing note: no behavioral baseline is LIVE-PROVABLE until the champion-fetch defect is fixed, since every captured round completion is `FAIL_DATA`) |
| **UNVERIFIED CLAIMS** | **(1)** Existence of `CLAUDE_B` / `GPT_B` — the prompt asserts 2+2; one authenticated account of each was OBSERVED, and absence of credentials is not proof the subscriptions do not exist (§I). **(2)** Arena rows 30–51: the sign convention on the lower-ranked entries is ambiguous in the retrieved table; the four conclusions in §H rest only on rows whose confidence intervals do not overlap, and no claim depends on the ambiguous tail. **(3)** Whether `bd099ed`'s absence from `4eb271b` means *lost* or *deliberately superseded* — divergence is SOURCE-PROVEN, the interpretation is not (§D). **(4)** Contents of the 7 stashes — never opened. **(5)** Whether `scripts/state.json` has consumers — the CLAUDE.md proposal is explicitly conditioned on checking, not on an assumption. **(6)** The 4,000 ms `WEDGED_NATIVE_PROBE_MS` constant is source-proven present but its *sufficiency* against a ~340 s stall is untested |

### Expensive-invocation justification

The prompt requires one sentence per FRONTIER invocation explaining why a
cheaper route was insufficient. **This session was the only invocation, and it
ran at xhigh effort set by the operator before the task began.** A cheaper
route would have been insufficient for the ancestry/absorption analysis in §C —
which required holding four SHAs, two worktrees, and an out-of-repo snapshot in
one reasoning context — but *would* have sufficed for the file inventory and
gate execution. **A correctly-tiered version of this audit would have run the
inventory at THROUGHPUT and only §C, §E, and §G at FRONTIER.** I am recording
that against myself because §25 asks the question honestly.

### Corrections to the prompt

1. **§16** — `60925a6` is not v0.8's HEAD; it is 24 commits behind
   `feat/overlay-tier-card`. The branch tip is `4eb271b`.
2. **§16** — "There may have been important dirty tracked changes above that
   SHA." There were, at `76a97b6`, and they are **fully recovered and
   committed** (`3f2a5e0`). Nothing is missing.
3. **§17** — `76a97b6` is not "a later dirty tree." It is an ordinary ancestor
   5 commits behind the tip, and its dirty state is the Aug-03 snapshot.
4. **§1 / §3** — The 2+2 account pool is not authenticated on this machine
   (a setup gap, not a smaller pool). 1+1
   verified.
5. **§20** — Pi is not installed (setup prerequisite). No `~/.pi`, no binary.
6. **§11** — The verifier framework's core scoring mechanism requires token
   logprobs, which subscription authentication does not expose. Only its
   structural mechanisms are adoptable.
7. **§18** — Not a correction: every hypothesis in the chain is confirmed.
   Promote them to ADRs.
8. **§19** — Not a correction: the target architecture is already implemented.
   The valid criticism is `App.tsx` at 4,095 lines.
9. **§26** — Steps 0–7 are largely complete; the ordering should start at the
   Rust half of step 2.

### Remaining risks

1. **73 unpushed commits inside a 17 GB gitignored directory.** Highest
   concrete risk in the project. One `rm -rf .claude` ends the overlay.
2. **The Rust async-runtime defect is undiagnosed at root cause.** Diagnosed
   twice, instrumented once, never repaired.
3. **R3/R4 have never been observed working**, on any revision, in any capture.
   v0.8 is a *two-round* overlay that is architecturally ready for four.
4. **Live four-round validation requires a real game**, so the final acceptance
   gate is manual and slow — the one place where the 25-second loop does not
   reach. Budget model capacity accordingly: everything cheap should be proven
   before a game is played.
5. **The post-commit hook keeps rewriting `CLAUDE.md`**, so every session starts
   from a dirty tree and stale numbers until §L lands.
</content>
