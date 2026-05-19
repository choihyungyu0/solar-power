#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/choihyungyu0/solar-power.git"
TARGET_DIR="solar-power"

if [ ! -d "$TARGET_DIR/.git" ]; then
  git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

echo "Copy this starter's contents into $(pwd), then run:"
echo "git add ."
echo "git commit -m 'chore: initialize solar power MVP scaffold'"
echo "git push -u origin main"
