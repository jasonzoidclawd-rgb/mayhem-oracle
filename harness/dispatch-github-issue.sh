#!/usr/bin/env bash
# Local GitHub-issue dispatch — the V1 interface.
#
#   ./harness/dispatch-github-issue.sh <issue-number> [--dry-run]
#                                      [--available CLAUDE_A,GPT_A] [--repo owner/name]
#
# GitHub is the durable bug ledger; harness/route.mjs decides who executes and
# who reviews; git worktrees isolate the work; harness/verify-task.sh is the
# gate. This wrapper only checks that the local prerequisites exist and then
# hands over to the dispatcher.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v gh >/dev/null 2>&1; then
  printf 'dispatch: the GitHub CLI (gh) is not installed\n' >&2
  exit 2
fi
if ! gh auth status >/dev/null 2>&1; then
  printf 'dispatch: gh is not authenticated — run `gh auth login`\n' >&2
  exit 2
fi
if [ "$#" -eq 0 ]; then
  printf 'usage: %s <issue-number> [--dry-run] [--available A,B] [--repo owner/name]\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

exec node "$HERE/dispatch-github-issue.mjs" "$@"
