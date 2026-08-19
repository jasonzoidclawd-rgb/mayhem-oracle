# Native starvation RED pinned evidence

Pinned in the isolated worktree before source or test edits. Timestamps are from
`/usr/bin/stat -f "%Sm|%z|%N"`; hashes are SHA-256 from `/usr/bin/shasum -a 256`.

| Pinned file | Exact source | Source timestamp | Bytes | SHA-256 |
|---|---|---:|---:|---|
| `prelive-runtime.log` | `/Users/jason/Desktop/overlay-v1-prelive-20260803-102930/runtime.log` | Aug 3 10:59:26 2026 | 580977 | `4dd9491f2134ca6a420f742c6b89046537780514d9b51e2e832ba894ca045ee1` |
| `prelive-head.txt` | `/Users/jason/Desktop/overlay-v1-prelive-20260803-102930/head.txt` | Aug 3 10:29:30 2026 | 41 | `56a0149d82cc44c47b6a3531768d3e3cb3d1b556546fe0b224e54d710bc6345e` |
| `prelive-status.txt` | `/Users/jason/Desktop/overlay-v1-prelive-20260803-102930/status.txt` | Aug 3 10:29:30 2026 | 2863 | `e3f293dbb456b60a262eac566c5945fe7ad4c3dbce2771e033c51a1238079ee8` |
| `prelive-tracked.diff` | `/Users/jason/Desktop/overlay-v1-prelive-20260803-102930/tracked.diff` | Aug 3 10:29:30 2026 | 172679 | `9a7d0ba000052b1563e0e938342c05d91ae733b9ea89a7bbcad40f28e9bf6a82` |
| `round34-manifest.json` | `/Users/jason/Desktop/mayhem-oracle/.claude/worktrees/overlay-tier-card/.codex/evidence/round34-live/manifest.json` | Aug 5 13:31:33 2026 | 48241 | `8e3ab83c97a7ffc1eda06d21c8c60fd70420038391ba2c5145011aa6ce558d36` |
| `approved-audit.md` | `/Users/jason/Desktop/mayhem-oracle/.claude/worktrees/overlay-tier-card/docs/reviews/2026-08-20-v08-recovery-and-harness-audit.md` | Aug 20 03:37:10 2026 | 77653 | `f1aa399ecc588e11ff778cc7e4ceb09982303c41efea2f2e10845a3db0a5b5f3` |

The runtime log and its `head`/`status`/tracked-diff companions are the direct
source for the 340-second probe. The separate round34 manifest is the direct
source for the later two-round run's HEAD, dirty-count, stable repository
fingerprint, and therefore its non-equivalence to `4eb271b`. The approved audit
is authority for this slice's recovery constraints, but all load-bearing values
below are re-derived from the direct artifacts or current source.
