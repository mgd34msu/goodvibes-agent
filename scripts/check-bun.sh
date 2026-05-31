#!/bin/sh
set -eu

if ! command -v bun >/dev/null 2>&1; then
  cat >&2 <<'EOF'
goodvibes-agent requires Bun.

Install Bun first, then install GoodVibes Agent from the npm registry with:

  bun add -g @pellux/goodvibes-agent
EOF
  exit 1
fi

if ! bun --version >/dev/null 2>&1; then
  echo "goodvibes-agent requires a working Bun executable on PATH." >&2
  exit 1
fi
