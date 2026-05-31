#!/bin/sh
set -eu

if ! command -v bun >/dev/null 2>&1; then
  cat >&2 <<'EOF'
goodvibes-agent requires Bun.

Install Bun first, then install GoodVibes Agent with:

  bun add -g @pellux/goodvibes-agent

If the installed command is not found, add Bun's global bin directory to PATH:

  export PATH="$(bun pm bin -g):$PATH"
EOF
  exit 1
fi

if ! bun --version >/dev/null 2>&1; then
  echo "goodvibes-agent requires a working Bun executable on PATH." >&2
  exit 1
fi
