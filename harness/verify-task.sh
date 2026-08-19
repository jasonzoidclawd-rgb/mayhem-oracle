#!/usr/bin/env bash
# Deterministic gate for the Mayhem Oracle agent harness.
#
#   harness/verify-task.sh [profile]
#
# Profiles select which suites run; no argument runs `all`. Zero model tokens.
# A failing gate cannot be overruled by any model, effort level, or vote.
#
# Profiles:
#   harness  harness policy tests only (fast; no product suites)
#   web      harness + web vitest + eslint
#   overlay  harness + overlay vitest + overlay tsc
#   skills   harness + .codex skill suite
#   all      harness + web + overlay + skills   (default)
#   rust     NOT WIRED — see the rust) case below
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

PROFILE="${1:-all}"
fail=0
ALL_SUITES=(harness web overlay skills rust)
declare -a RAN=()

describe() {
  case "$1" in
    harness) printf 'harness policy tests + task packet template' ;;
    web)     printf 'web vitest + eslint' ;;
    overlay) printf 'overlay vitest + overlay tsc' ;;
    skills)  printf '.codex skill suite + workflow cwd check' ;;
    rust)    printf 'cargo test — deferred, see the rust profile' ;;
  esac
}

run() {
  local name="$1"; shift
  printf '\n=== %s ===\n' "$name"
  if "$@"; then
    printf -- '--- %s: PASS\n' "$name"
  else
    printf -- '--- %s: FAIL\n' "$name"
    fail=1
  fi
}

suite_harness() {
  run "harness policy tests" node --test harness/test/*.test.mjs
  run "task packet template" node harness/route.mjs validate-packet docs/task-packets/TEMPLATE.md
}
suite_web() {
  run "web unit" npm test
  run "eslint" npx eslint src scripts
}
suite_overlay() {
  run "overlay unit" bash -c 'cd overlay && npm run test'
  run "overlay types" bash -c 'cd overlay && npx tsc --noEmit'
}
suite_skills() {
  run "skill suite" env PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
    -s .codex/skills/test-league-augment-overlay/scripts -p 'test_*.py'
  run "skill cwd" bash .codex/skills/test-league-augment-overlay/scripts/verify_workflow_cwd.sh
}

case "$PROFILE" in
  harness) RAN=(harness);                    suite_harness ;;
  web)     RAN=(harness web);                suite_harness; suite_web ;;
  overlay) RAN=(harness overlay);            suite_harness; suite_overlay ;;
  skills)  RAN=(harness skills);             suite_harness; suite_skills ;;
  all)     RAN=(harness web overlay skills); suite_harness; suite_web; suite_overlay; suite_skills ;;
  rust)
    # DELIBERATELY NOT WIRED. `cargo test` runs in exactly one place today,
    # .github/workflows/windows-overlay.yml, so it never runs on macOS and
    # never runs locally. The validated command is owned by the parallel
    # native-starvation reproduction task. Wiring a guessed command here would
    # let a red Rust test be reported green. Fails closed until that task
    # returns the command; then replace this block with it.
    printf '\n=== rust ===\n'
    printf 'DEFERRED: no validated cargo test command yet. Refusing to guess.\n'
    printf '\nGATE: BLOCKED (profile=rust)\n'
    exit 2
    ;;
  *)
    printf 'unknown profile: %s\n' "$PROFILE" >&2
    printf 'known profiles: harness web overlay skills all rust\n' >&2
    exit 2
    ;;
esac

# Every profile names what it did NOT run. A narrow profile printing a bare
# GATE: PASS reads as a proven change; it is not one.
declare -a NOT_COVERED=()
for suite in "${ALL_SUITES[@]}"; do
  covered=0
  for ran in "${RAN[@]}"; do [ "$ran" = "$suite" ] && covered=1; done
  [ "$covered" -eq 0 ] && NOT_COVERED+=("$suite ($(describe "$suite"))")
done

if [ "${#NOT_COVERED[@]}" -gt 0 ]; then
  printf '\nNOT COVERED BY THIS PROFILE:\n'
  for item in "${NOT_COVERED[@]}"; do printf -- '  - %s\n' "$item"; done
fi

if [ "$fail" -eq 0 ]; then
  printf '\nGATE: PASS (profile=%s)\n' "$PROFILE"
else
  printf '\nGATE: FAIL (profile=%s)\n' "$PROFILE"
fi
exit "$fail"
