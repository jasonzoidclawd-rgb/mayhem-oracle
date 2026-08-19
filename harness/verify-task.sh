#!/usr/bin/env bash
# Profile adapter for the deterministic gate.
#
#   harness/verify-task.sh [profile] [--plan]
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
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../scripts/gate.sh"

PROFILE=all
PLAN=0
for arg in "$@"; do
  case "$arg" in
    --plan) PLAN=1 ;;
    -*)     printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
    *)      PROFILE="$arg" ;;
  esac
done

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

bash "$GATE" $SUITES
status=$?

print_not_covered

if [ "$status" -eq 0 ]; then
  printf '\nGATE: PASS (profile=%s)\n' "$PROFILE"
else
  printf '\nGATE: FAIL (profile=%s)\n' "$PROFILE"
fi
exit "$status"
