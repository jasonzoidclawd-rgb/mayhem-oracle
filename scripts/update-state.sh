#!/usr/bin/env bash
# Regenerate scripts/state.json and the CLAUDE.md <!-- STATE --> block.
# Installed as a post-commit hook by scripts/install-hooks.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

PATCH=$(python3 -c "import json; print(json.load(open('public/data/meta.json'))['patch'])")
AUGMENTS=$(python3 -c "import json; print(len(json.load(open('public/data/augments.json'))['augments']))")
TESTS=$(./node_modules/.bin/vitest run --reporter=json 2>/dev/null \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['numPassedTests'])" 2>/dev/null || echo "unknown")
PARITY=$(/usr/bin/grep -o 'PARITY_BUDGET = [0-9]*' src/lib/__tests__/cross-parity.test.ts | /usr/bin/grep -o '[0-9]*$')
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")

PATCH="$PATCH" AUGMENTS="$AUGMENTS" TESTS="$TESTS" PARITY="$PARITY" LAST_TAG="$LAST_TAG" python3 << 'PY'
import json
import os
import re

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

block = (
    "<!-- STATE:START -->\n"
    f"- Patch: `{state['patch']}`\n"
    f"- Augments: `{state['augments']}`\n"
    f"- Tests passing: `{state['tests']}`\n"
    f"- Cross-parity budget: `{state['parityBudget']}` divergent champions\n"
    f"- Last tag: `{state['lastTag']}`\n"
    "<!-- STATE:END -->"
)
path = "CLAUDE.md"
text = open(path, encoding="utf-8").read()
updated = re.sub(r"<!-- STATE:START -->.*?<!-- STATE:END -->", block, text, flags=re.DOTALL)
if "<!-- STATE:START -->" not in text:
    raise SystemExit("CLAUDE.md is missing the STATE sentinel block")
open(path, "w", encoding="utf-8").write(updated)
print(f"state: patch={state['patch']} augments={state['augments']} "
      f"tests={state['tests']} parity={state['parityBudget']} tag={state['lastTag']}")
PY
