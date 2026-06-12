#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

FIXTURE="$TMP/repo"
VITEST="$FIXTURE/node_modules/.bin/vitest"
mkdir -p "$FIXTURE/scripts" "$FIXTURE/public/data" \
  "$FIXTURE/src/lib/__tests__" "$(dirname "$VITEST")"

cp "$ROOT/scripts/update-state.sh" "$FIXTURE/scripts/update-state.sh"

cat > "$FIXTURE/public/data/meta.json" <<'EOF'
{"patch":"26.12"}
EOF
cat > "$FIXTURE/public/data/augments.json" <<'EOF'
{"augments":[{"slug":"one"},{"slug":"two"}]}
EOF
cat > "$FIXTURE/src/lib/__tests__/cross-parity.test.ts" <<'EOF'
const PARITY_BUDGET = 0;
EOF
cat > "$FIXTURE/CLAUDE.md" <<'EOF'
# Fixture

<!-- STATE:START -->
stale
<!-- STATE:END -->
EOF

git -C "$FIXTURE" init -q
git -C "$FIXTURE" config user.name "State Test"
git -C "$FIXTURE" config user.email "state-test@example.com"
git -C "$FIXTURE" add .
git -C "$FIXTURE" commit -qm "fixture"
git -C "$FIXTURE" tag fixture-1

cat > "$VITEST" <<'EOF'
#!/usr/bin/env bash
printf '{"numPassedTests":7,"numFailedTests":0,"success":true}\n'
EOF
chmod +x "$VITEST"

bash "$FIXTURE/scripts/update-state.sh"
python3 - "$FIXTURE/scripts/state.json" <<'PY'
import json
import sys

state = json.load(open(sys.argv[1], encoding="utf-8"))
assert state == {
    "patch": "26.12",
    "augments": 2,
    "tests": "7",
    "parityBudget": 0,
    "lastTag": "fixture-1",
}
PY

STATE_HASH=$(cksum "$FIXTURE/scripts/state.json")
CLAUDE_HASH=$(cksum "$FIXTURE/CLAUDE.md")
cat > "$VITEST" <<'EOF'
#!/usr/bin/env bash
printf '{"numPassedTests":6,"numFailedTests":1,"success":false}\n'
EOF
chmod +x "$VITEST"

if bash "$FIXTURE/scripts/update-state.sh"; then
  printf 'update-state unexpectedly accepted a failed test run\n' >&2
  exit 1
fi
test "$STATE_HASH" = "$(cksum "$FIXTURE/scripts/state.json")"
test "$CLAUDE_HASH" = "$(cksum "$FIXTURE/CLAUDE.md")"

printf 'state automation smoke passed\n'
