#!/usr/bin/env bash
# Deterministic repository verification — the one place a verification command
# is written down.
#
#   scripts/gate.sh <suite>...   run those suites, in order
#   scripts/gate.sh --list       print "<suite>TAB<description>", run nothing
#   scripts/gate.sh --authority <suite>...
#                                print "<suite>TAB<path>", run nothing
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

SUITES=(harness web overlay skills rust pipeline)

# The paths that decide what a suite's PASS *means*, as opposed to the paths it
# is judging. A suite reads its checks out of the workspace under test, so a
# candidate that edits these is editing its own examiner — deleting the test
# that catches it passes just as loudly as fixing the bug. Declared here, beside
# the command, because this is already the one place a suite is defined.
#
# A trailing slash is a directory prefix; * matches within one path segment and
# ** spans them; anything else is matched literally.
authority_paths() {
  case "$1" in
    harness) printf 'harness/test/\nscripts/gate.sh\nharness/verify-task.sh\n' ;;
    web)     printf 'src/**/*.test.*\npackage.json\npackage-lock.json\n*.config.*\ntsconfig*.json\n.npmrc\n' ;;
    overlay) printf 'overlay/src/**/*.test.*\noverlay/package.json\noverlay/package-lock.json\noverlay/*.config.*\noverlay/tsconfig*.json\noverlay/.npmrc\n' ;;
    skills)  printf '.codex/skills/test-league-augment-overlay/scripts/test_*.py\n.codex/skills/test-league-augment-overlay/scripts/verify_workflow_cwd.sh\n' ;;
    # Deliberately conservative: the manifest decides membership, while
    # over-declaring examiner files is safe and under-declaring them is not.
    pipeline) printf 'scripts/pipeline_suite.py\nscripts/test_*.py\n' ;;
    # cargo test runs #[cfg(test)] modules that live inside the sources, so for
    # this suite the sources are the tests. Nothing separates examiner from
    # subject here, and the declaration says so rather than pretending.
    rust)    printf 'overlay/src-tauri/tests/\noverlay/src-tauri/src/\noverlay/src-tauri/Cargo.toml\noverlay/src-tauri/Cargo.lock\n' ;;
  esac
}

# The ignored state a suite's checks are *executed by*, as opposed to the files
# they are written in. npm and npx resolve the runner, the linter and every
# library under test out of node_modules; cargo runs whatever compiled artifact
# in target/ its fingerprint calls fresh; python loads __pycache__ bytecode in
# preference to compiling the source beside it. None of that is in any commit,
# so no diff can show a change to it — which is exactly why it is declared.
#
# A suite with no rows here resolves nothing it does not carry: the harness
# suite runs node over builtins and relative imports and nothing else.
runtime_paths() {
  case "$1" in
    harness) ;;
    web)     printf 'node_modules/\n' ;;
    overlay) printf 'overlay/node_modules/\n' ;;
    skills)  printf '.codex/skills/test-league-augment-overlay/scripts/__pycache__/\n' ;;
    rust)    printf 'overlay/src-tauri/target/\n' ;;
    pipeline) printf 'scripts/__pycache__/\n' ;;
  esac
}

# The roots the gate cannot reach at all: paths where a file may appear, and
# disappear, without any suite below being able to import, compile, execute,
# discover or read it. Declared here because "can the gate see this?" is a
# property of the gate, and the controller must not have to guess it from a
# filename. A root is honored only when every suite that runs declares it, so a
# suite added later inherits no exemption nobody checked for it.
#
# The claim is checkable, and here is the check. Every suite's discovery is
# rooted somewhere explicit, and none of those roots is an ancestor of these:
#
#   harness  node --test harness/test/*.test.mjs  — a literal directory glob,
#            plus one literal packet path. Nothing else is read.
#   web      vitest.config.ts pins include to src/**/*.test.ts and
#            overlay/src/**/*.test.ts; eslint is given src and scripts.
#   overlay  vitest runs with overlay/ as its root, and tsc --noEmit with
#            overlay/tsconfig.json's include of ["src"]. Both are confined to
#            overlay/, and these roots are not under it.
#   skills   unittest discover -s .codex/skills/test-league-augment-overlay/scripts
#            — a sibling of .codex/evidence/ and .codex/gates/, not a parent.
#   rust     cargo test with overlay/src-tauri as its manifest directory.
#   pipeline python runs the explicit manifest in scripts/pipeline_suite.py.
#
# And no tracked file any of those reaches reads out of these roots: the only
# references in the repository are prose comments in overlay tests and one Rust
# test, transcribing numbers that were copied into the source. There is no
# include_str!, include_bytes!, File::open, fs::read or readFileSync among them.
#
# If that stops being true, narrow the root or move the evidence — do not widen
# the exemption. The harness re-proves the disjointness against this same
# declaration, and refuses to honor a root that collides with anything above.
NON_INPUT_ROOTS='.codex/evidence/
.codex/gates/
debug-evidence/
'
evidence_paths() {
  case "$1" in
    harness|web|overlay|skills|rust|pipeline) printf '%s' "$NON_INPUT_ROOTS" ;;
  esac
}

describe() {
  case "$1" in
    harness) printf 'harness policy tests + task packet template' ;;
    web)     printf 'web vitest + eslint + tsc' ;;
    overlay) printf 'overlay vitest + overlay tsc' ;;
    skills)  printf '.codex skill suite + workflow cwd check' ;;
    rust)    printf 'overlay/src-tauri cargo test' ;;
    pipeline) printf 'data-pipeline and publication safety net' ;;
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
  run "web types" npx tsc --noEmit
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
suite_pipeline() {
  run "pipeline suite" env PYTHONDONTWRITEBYTECODE=1 python3 scripts/pipeline_suite.py
}

if [ "$#" -eq 0 ]; then
  printf 'usage: scripts/gate.sh <suite>... | --list\n' >&2
  printf 'suites: %s\n' "${SUITES[*]}" >&2
  exit 2
fi

if [ "$1" = "--authority" ]; then
  shift
  if [ "$#" -eq 0 ]; then set -- "${SUITES[@]}"; fi
  for requested in "$@"; do
    known=0
    for suite in "${SUITES[@]}"; do [ "$requested" = "$suite" ] && known=1; done
    if [ "$known" -eq 0 ]; then printf 'unknown suite: %s\n' "$requested" >&2; exit 2; fi
    for kind in tracked runtime evidence; do
      rows=""
      case "$kind" in
        tracked)  rows="$(authority_paths "$requested")" ;;
        runtime)  rows="$(runtime_paths "$requested")" ;;
        evidence) rows="$(evidence_paths "$requested")" ;;
      esac
      while IFS= read -r path; do
        [ -n "$path" ] || continue
        printf '%s\t%s\t%s\n' "$requested" "$kind" "$path"
      done <<EOF
$rows
EOF
    done
  done
  exit 0
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
