# Commit checklist

No commit was requested or created. The isolated baseline had no modified or
untracked paths, so none of the files below carried pre-existing operator work.
`final.diff` was regenerated after the final gate/script/report freeze.

## Modified

- `overlay/src-tauri/src/lib.rs` — 220 insertions, 1 deletion; every changed
  line is within the existing `#[cfg(test)] bounded_capture_tests` module.

## New source / gate / report

- `scripts/gate.sh` — 33 lines, mode 100755.
- `docs/reviews/2026-08-20-native-starvation-red-reproduction.md` — 255 lines.
- `.codex/gates/native-starvation-red/COMMIT-CHECKLIST.md`
- `.codex/gates/native-starvation-red/baseline-head.txt`
- `.codex/gates/native-starvation-red/baseline-staged.diff`
- `.codex/gates/native-starvation-red/baseline-status.txt`
- `.codex/gates/native-starvation-red/baseline-tracked.diff`
- `.codex/gates/native-starvation-red/contract.md`
- `.codex/gates/native-starvation-red/final.diff`
- `.codex/gates/native-starvation-red/frozen-tests.sha256`
- `.codex/gates/native-starvation-red/gate-log.md`
- `.codex/gates/native-starvation-red/green.log`
- `.codex/gates/native-starvation-red/phase1-root-cause.md`
- `.codex/gates/native-starvation-red/phase4-independent-verification.md`
- `.codex/gates/native-starvation-red/red-acceptance.md`
- `.codex/gates/native-starvation-red/red.log`
- `.codex/gates/native-starvation-red/step-zero.md`

## New pinned evidence

- `.codex/evidence/native-starvation-red/approved-audit.md`
- `.codex/evidence/native-starvation-red/pinned-manifest.md`
- `.codex/evidence/native-starvation-red/pinned.sha256`
- `.codex/evidence/native-starvation-red/prelive-head.txt`
- `.codex/evidence/native-starvation-red/prelive-runtime.log`
- `.codex/evidence/native-starvation-red/prelive-status.txt`
- `.codex/evidence/native-starvation-red/prelive-tracked.diff`
- `.codex/evidence/native-starvation-red/round34-manifest.json`

All paths above are shown by:

```text
git status --short --untracked-files=all
```

They are not ignored, so no force-add is required or recommended.

## Environment-only ignored material — do not commit

- root and overlay `node_modules/`
- `.next/`, `overlay/dist/`, and Rust `target/`
- `overlay/public/data/augments.json` — SHA-256
  `920f0991b388b5c505aac4bb4f8ea67e80973e8af8ca9e2fa019c2a7a2e268df`,
  a byte-identical generated fixture copied only to execute the existing macOS
  OCR corpus test in the clean worktree. It is surfaced by
  `git status --short --ignored --untracked-files=all -- overlay/public/data/augments.json`
  as `!! overlay/public/data/augments.json`.

## Explicit exclusions verified

- no production Rust/native repair
- no `App.tsx` or unrelated runtime refactor
- no `v0.8-baseline` tag
- no merge and no cherry-pick of `bd099ed`
- no Claude billing/account edit
