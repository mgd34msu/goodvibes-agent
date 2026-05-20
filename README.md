# goodvibes-agent

`goodvibes-agent` is the proactive serial assistant/operator surface for the GoodVibes ecosystem.

It talks to the GoodVibes daemon through public SDK/daemon contracts, owns assistant-local memory, skills, and personas, and delegates real build/fix/review work to GoodVibes TUI sessions instead of becoming a second coding TUI.

## Product Boundary

- Assistant/operator work is serial by default: chat, inspect, remember, schedule, query knowledge, use safe daemon tools, and route tasks.
- WRFC is not a default reasoning mode. It is requested only for explicit build/implementation/fix/review/check work.
- Coding UX, file edits, git/worktrees, QEMU/sandbox command UX, and WRFC execution stay owned by `goodvibes-tui`.
- This package must not import from `goodvibes-tui/src/*`; use `@pellux/goodvibes-sdk`, daemon REST/operator routes, and published contracts.

## Quick Start

```sh
bun install
bun run dev tui
```

Common commands:

```sh
bun run dev status
bun run dev smoke
bun run dev chat "What do you remember about my Home Assistant setup?"
bun run dev ask "GoodVibes project planning status"
bun run dev delegate --wrfc "Build the first version of the assistant inbox"
```

Daemon connection defaults:

- Base URL: `GOODVIBES_AGENT_BASE_URL`, `GOODVIBES_BASE_URL`, or `http://127.0.0.1:3421`
- Token: `GOODVIBES_AGENT_TOKEN`, `GOODVIBES_HTTP_TOKEN`, `GOODVIBES_DAEMON_TOKEN`, or `~/.goodvibes/daemon/operator-tokens.json`

Local assistant state is stored under `~/.goodvibes/agent/`.

## Packaging Notes

While private and unreleased, the package version stays at `0.0.0`. The first intentionally published usable alpha should become `0.1.0`; SDK compatibility is expressed through the exact `@pellux/goodvibes-sdk` dependency pin, not by mirroring SDK or TUI versions.

During pre-1.0 near-fork development, `@pellux/goodvibes-sdk` is pinned exactly to the daemon-compatible version instead of using a caret range. This package does not currently ship a binary postinstall or trust native lifecycle packages it does not directly exercise.

The distributed package must install a real `goodvibes-agent` executable through `package.json` `bin`. The bin is TypeScript-authored and Bun-backed; release smoke must verify `goodvibes-agent --help` and `goodvibes-agent smoke` from a fresh install.
