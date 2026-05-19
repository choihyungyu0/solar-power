#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[harness] repo root: $REPO_ROOT"

if [ ! -f "apps/web/package.json" ]; then
  echo "apps/web/package.json 파일을 찾을 수 없습니다. 레포 루트에서 실행되는지 확인하세요." >&2
  exit 1
fi

cd apps/web
echo "[harness] installing frontend dependencies"
npm install

echo "[harness] building frontend"
npm run build

echo "[harness] success"
