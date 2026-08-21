#!/usr/bin/env bash
# Deterministic repository verification — the one place a verification command
# is written down.
#
#   scripts/gate.sh <suite>...   run those suites, in order
#   scripts/gate.sh --list       print "<suite>TAB<description>", run nothing
#   --worktree <dir>             judge that worktree instead of the enclosing one
#
# Provider-neutral by construction: it knows how to prove this repository and
# nothing about who or what asked for the proof. Profile selection lives in
# harness/verify-task.sh, which owns no command of its own.
#
# Continues after a failing suite so one run reports the complete state, and
# exits nonzero if any suite failed. Unknown suite names exit 2 before
# anything runs.
set -uo pipefail

# The subject under test, named by the caller rather than inferred from wherever
# the gate was invoked. This is what keeps the evaluator out of the candidate's
# reach: a dispatcher runs the *trusted* copy of this script and points it at the
# workspace it must judge, so the checkout being evaluated is never also the
# checkout that decides what evaluation means. Without --worktree the enclosing
# worktree is the subject, which is what a human running the gate by hand wants.
TARGET=""
ARGV=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --worktree)
      TARGET="${2-}"
      if [ -z "$TARGET" ]; then printf 'missing directory after --worktree\n' >&2; exit 2; fi
      shift 2
      ;;
    *) ARGV+=("$1"); shift ;;
  esac
done
set -- ${ARGV[@]+"${ARGV[@]}"}

if [ -n "$TARGET" ]; then
  if [ ! -d "$TARGET" ]; then printf 'no such worktree: %s\n' "$TARGET" >&2; exit 2; fi
else
  # An empty toplevel would make `cd` fall through to $HOME and gate whatever
  # happens to live there, so not knowing the subject is an error, not a default.
  TARGET="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -z "$TARGET" ]; then
    printf 'not inside a git worktree, and no --worktree was given\n' >&2
    exit 2
  fi
fi
cd "$TARGET" || exit 2

SUITES=(harness web overlay skills rust)

describe() {
  case "$1" in
    harness) printf 'harness policy tests + task packet template' ;;
    web)     printf 'web vitest + eslint' ;;
    overlay) printf 'overlay vitest + overlay tsc' ;;
    skills)  printf '.codex skill suite + workflow cwd check' ;;
    rust)    printf 'overlay/src-tauri cargo test' ;;
  esac
}

fail=0
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
suite_rust() {
  # No pipe, no `|| true`: cargo's exit status is the suite's exit status.
  run "rust unit" bash -c 'cd overlay/src-tauri && cargo test'
}

if [ "$#" -eq 0 ]; then
  printf 'usage: scripts/gate.sh <suite>... | --list\n' >&2
  printf 'suites: %s\n' "${SUITES[*]}" >&2
  exit 2
fi

if [ "$1" = "--list" ] || [ "$1" = "list" ]; then
  for suite in "${SUITES[@]}"; do printf '%s\t%s\n' "$suite" "$(describe "$suite")"; done
  exit 0
fi

for requested in "$@"; do
  known=0
  for suite in "${SUITES[@]}"; do [ "$requested" = "$suite" ] && known=1; done
  if [ "$known" -eq 0 ]; then
    printf 'unknown suite: %s\n' "$requested" >&2
    printf 'known suites: %s\n' "${SUITES[*]}" >&2
    exit 2
  fi
done

printf 'WORKTREE: %s\n' "$PWD"

for requested in "$@"; do "suite_$requested"; done

if [ "$fail" -eq 0 ]; then
  printf '\nGATE SUITES: PASS (%s)\n' "$*"
else
  printf '\nGATE SUITES: FAIL (%s)\n' "$*"
fi
exit "$fail"
