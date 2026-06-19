#!/usr/bin/env bash
# Save Claude memories before a container rebuild.
#
# Moves memory files OUT of the (ephemeral) home directory and INTO the
# host-mounted repo at .claude/memories/ so they survive the rebuild.
# Run restore-memories.sh in the fresh container to put them back.
set -euo pipefail

MEM_SRC="$HOME/.claude/projects/-workspaces-the-test-cabinet/memory"
REPO_DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.claude/memories"

if [ ! -d "$MEM_SRC" ] || [ -z "$(ls -A "$MEM_SRC"/*.md 2>/dev/null)" ]; then
  echo "No memory files found at $MEM_SRC — nothing to save."
  exit 0
fi

mkdir -p "$REPO_DEST"
mv -v "$MEM_SRC"/*.md "$REPO_DEST"/
echo "Saved $(ls -1 "$REPO_DEST"/*.md | wc -l) file(s) to $REPO_DEST"
echo "Now safe to rebuild the container. Run restore-memories.sh afterwards."
