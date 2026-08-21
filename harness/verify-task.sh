#!/usr/bin/env bash
# Profile adapter for the deterministic gate.
#
#   harness/verify-task.sh [profile] [--plan] [--authority] [--worktree <dir>]
#
# Selects which deterministic suites a change must clear, then hands every
# command to scripts/gate.sh. This file deliberately spells out no verification
# command: one command layer, so a profile cannot drift from what actually runs.
# Zero model tokens. A failing gate cannot be overruled by any model, effort
# level, or vote.
#
# Profiles (no argument runs `all`):
#   harness  the harness suite only — fast, no product suites
#   web      harness + web
#   overlay  harness + overlay
#   skills   harness + skills
#   rust     harness + rust
#   all      every suite the gate knows
#
# --plan prints the profile, its suites, and what it does not cover, and exits
# 0 without running anything.
#
# --worktree names the workspace to judge. The profile and the suite commands
# always come from this file's own checkout, so a dispatcher runs the trusted
# copy against a candidate worktree and the candidate cannot answer for its own
# evaluator. Omitted, the subject is the enclosing worktree.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../scripts/gate.sh"

PROFILE=all
PLAN=0
AUTHORITY=0
WORKTREE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan) PLAN=1; shift ;;
    --authority) AUTHORITY=1; shift ;;
    --worktree)
      WORKTREE="${2-}"
      if [ -z "$WORKTREE" ]; then printf 'missing directory after --worktree\n' >&2; exit 2; fi
      shift 2
      ;;
    -*) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
    *)  PROFILE="$1"; shift ;;
  esac
done

# Passed through, never interpreted here: this file selects suites and owns no
# command, so where they run is the gate's business.
TARGET=()
[ -n "$WORKTREE" ] && TARGET=(--worktree "$WORKTREE")

case "$PROFILE" in
  harness) SUITES="harness" ;;
  web)     SUITES="harness web" ;;
  overlay) SUITES="harness overlay" ;;
  skills)  SUITES="harness skills" ;;
  rust)    SUITES="harness rust" ;;
  all)     SUITES="harness web overlay skills rust" ;;
  *)
    printf 'unknown profile: %s\n' "$PROFILE" >&2
    printf 'known profiles: harness web overlay skills rust all\n' >&2
    exit 2
    ;;
esac

# Machine-readable and header-free: a caller parses these rows, so the profile
# banner below would just be noise it has to strip.
if [ "$AUTHORITY" -eq 1 ]; then
  bash "$GATE" --authority $SUITES
  exit $?
fi

printf 'PROFILE: %s\n' "$PROFILE"
printf 'SUITES: %s\n' "$SUITES"

# Every profile names what it did NOT run, from the gate's own inventory. A
# narrow profile printing a bare GATE: PASS reads as a proven change; it is not
# one — and a suite added to the gate must never be silently covered by
# omission here.
print_not_covered() {
  local uncovered=""
  while IFS=$'\t' read -r name description; do
    [ -n "$name" ] || continue
    case " $SUITES " in *" $name "*) continue ;; esac
    uncovered+="  - $name ($description)"$'\n'
  done < <(bash "$GATE" --list)
  [ -n "$uncovered" ] || return 0
  printf '\nNOT COVERED BY THIS PROFILE:\n%s' "$uncovered"
}

if [ "$PLAN" -eq 1 ]; then
  print_not_covered
  printf '\nPLAN ONLY (profile=%s) — nothing executed\n' "$PROFILE"
  exit 0
fi

bash "$GATE" ${TARGET[@]+"${TARGET[@]}"} $SUITES
status=$?

print_not_covered

if [ "$status" -eq 0 ]; then
  printf '\nGATE: PASS (profile=%s)\n' "$PROFILE"
else
  printf '\nGATE: FAIL (profile=%s)\n' "$PROFILE"
fi
exit "$status"
