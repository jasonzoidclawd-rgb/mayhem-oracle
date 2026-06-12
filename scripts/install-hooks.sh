#!/usr/bin/env bash
# Install the repo's git hooks (post-commit state refresh).
set -euo pipefail
cd "$(dirname "$0")/.."

HOOKS_DIR=$(git rev-parse --git-path hooks)
mkdir -p "$HOOKS_DIR"

cat > "$HOOKS_DIR/post-commit" << 'HOOK'
#!/usr/bin/env bash
# Refresh scripts/state.json + the CLAUDE.md state block after each commit.
# Non-blocking: state lags one commit by design.
bash scripts/update-state.sh >/dev/null 2>&1 || true
HOOK
chmod +x "$HOOKS_DIR/post-commit"
echo "post-commit hook installed at $HOOKS_DIR/post-commit"
