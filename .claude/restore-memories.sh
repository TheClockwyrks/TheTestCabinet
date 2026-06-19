#!/usr/bin/env bash
# Restore Claude memories after a container rebuild.
#
# Moves memory files OUT of the host-mounted repo (.claude/memories/) and
# back INTO the home directory where Claude Code reads them.
set -euo pipefail

REPO_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.claude/memories"
MEM_DEST="$HOME/.claude/projects/-workspaces-the-test-cabinet/memory"

if [ ! -d "$REPO_SRC" ] || [ -z "$(ls -A "$REPO_SRC"/*.md 2>/dev/null)" ]; then
  echo "No saved memory files found at $REPO_SRC — nothing to restore."
  exit 0
fi

mkdir -p "$MEM_DEST"
mv -v "$REPO_SRC"/*.md "$MEM_DEST"/
echo "Restored $(ls -1 "$MEM_DEST"/*.md | wc -l) file(s) to $MEM_DEST"
