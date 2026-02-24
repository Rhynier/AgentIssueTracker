#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/artifacts/agents"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: Agent prompt files not found at $SOURCE_DIR" >&2
  exit 1
fi

FILES=("$SOURCE_DIR"/*.md)
if [ ${#FILES[@]} -eq 0 ]; then
  echo "Error: No .md files found in $SOURCE_DIR" >&2
  exit 1
fi

if [ $# -ge 1 ]; then
  TARGET_DIR="$1/.claude/agents"
else
  TARGET_DIR="$HOME/.claude/agents"
fi

echo "This will copy the following agent prompt files:"
echo ""
for f in "${FILES[@]}"; do
  echo "  $(basename "$f")"
done
echo ""
echo "Destination: $TARGET_DIR"
echo ""
read -rp "Continue? [Y/N] " answer

if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

mkdir -p "$TARGET_DIR"
for f in "${FILES[@]}"; do
  cp "$f" "$TARGET_DIR/"
  echo "Copied $(basename "$f")"
done

echo "Done. Agent prompts installed to $TARGET_DIR"
