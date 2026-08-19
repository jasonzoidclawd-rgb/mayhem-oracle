#!/usr/bin/env bash
# Fast deterministic project gate. Continues after failures and exits nonzero
# when any suite fails so one run reports the complete local verification state.
set -uo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

fail=0
run() {
  printf '\n=== %s ===\n' "$1"
  shift
  "$@" || fail=1
}

run "overlay data" bash -c 'cd overlay && npm run sync-data'
run "overlay unit" bash -c 'cd overlay && npm run test'
run "overlay types" bash -c 'cd overlay && npx tsc --noEmit'
run "Rust unit" bash -c 'cd overlay/src-tauri && cargo test'
run "web unit" npm test
run "eslint" npx eslint src scripts
run "skill suite" env PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s .codex/skills/test-league-augment-overlay/scripts -p 'test_*.py'
run "skill cwd" bash \
  .codex/skills/test-league-augment-overlay/scripts/verify_workflow_cwd.sh

if [ "$fail" -eq 0 ]; then
  printf '\nGATE: PASS\n'
else
  printf '\nGATE: FAIL\n'
fi

exit "$fail"
