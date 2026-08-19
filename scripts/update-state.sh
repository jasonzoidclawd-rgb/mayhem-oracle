#!/usr/bin/env bash
# Regenerate scripts/state.json.
# Installed as a post-commit hook by scripts/install-hooks.sh.
#
# This script deliberately does NOT write any instruction file. Machine-rewriting
# an always-loaded file made every session start from a dirty tree and load a
# stale scalar nobody could act on. Query the counts from the gate instead:
# bash harness/verify-task.sh. Enforced by harness/test/policy.test.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."

REPORT=$(mktemp)
trap 'rm -f "$REPORT"' EXIT

if ! ./node_modules/.bin/vitest run --reporter=json > "$REPORT"; then
  echo "Refusing to update state from a failed test run" >&2
  exit 1
fi

PATCH=$(python3 -c "import json; print(json.load(open('public/data/meta.json'))['patch'])")
AUGMENTS=$(python3 -c "import json; print(len(json.load(open('public/data/augments.json'))['augments']))")
TESTS=$(python3 - "$REPORT" <<'PY'
import json
import sys

text = open(sys.argv[1], encoding="utf-8").read()
start = text.find("{")
if start == -1:
    raise SystemExit("Vitest JSON report was not found")
report = json.loads(text[start:])
if not report.get("success") or report.get("numFailedTests") != 0:
    raise SystemExit("Refusing to update state from a failed test run")
print(report["numPassedTests"])
PY
)
PARITY=$(/usr/bin/grep -o 'PARITY_BUDGET = [0-9]*' src/lib/__tests__/cross-parity.test.ts | /usr/bin/grep -o '[0-9]*$')
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")

PATCH="$PATCH" AUGMENTS="$AUGMENTS" TESTS="$TESTS" PARITY="$PARITY" LAST_TAG="$LAST_TAG" python3 << 'PY'
import json
import os

state = {
    "patch": os.environ["PATCH"],
    "augments": int(os.environ["AUGMENTS"]),
    "tests": os.environ["TESTS"],
    "parityBudget": int(os.environ["PARITY"]),
    "lastTag": os.environ["LAST_TAG"],
}
with open("scripts/state.json", "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)
    f.write("\n")

print(f"state: patch={state['patch']} augments={state['augments']} "
      f"tests={state['tests']} parity={state['parityBudget']} tag={state['lastTag']}")
PY
