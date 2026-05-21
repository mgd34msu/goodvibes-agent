# goodvibes-agent

`goodvibes-agent` is the proactive serial assistant/operator surface for the GoodVibes ecosystem.

It talks to the GoodVibes daemon through public SDK/daemon contracts, owns assistant-local memory, skills, and personas, and delegates real build/fix/review work to GoodVibes TUI sessions instead of becoming a second coding TUI.

## Product Boundary

- Assistant/operator work is serial by default: chat, inspect, remember, schedule, query knowledge, use safe daemon tools, and route tasks.
- WRFC is not a default reasoning mode. It is requested only for explicit build/implementation/fix/review/check work.
- Coding UX, file edits, git/worktrees, QEMU/sandbox command UX, and WRFC execution stay owned by `goodvibes-tui`.
- This package must not import from `goodvibes-tui/src/*`; use `@pellux/goodvibes-sdk`, daemon REST/operator routes, and published contracts.
- The codebase is strongly typed TypeScript. Explicit `any` is not allowed.

## Quick Start

```sh
bun install
bun run dev tui
```

`goodvibes-agent` connects to an already-running GoodVibes daemon. It does not start, stop, install, or supervise the daemon.

Common commands:

```sh
bun run dev status
bun run dev config
bun run dev smoke
bun run dev auth
bun run dev chat "What do you remember about my Home Assistant setup?"
bun run dev ask "GoodVibes project planning status"
bun run dev ask "GoodVibes project planning status" --json
bun run dev search "GoodVibes Agent"
bun run dev memory add "We use Bun for goodvibes-agent" --class constraint --tags runtime,typescript
bun run dev skills create weekly-plan --description "Plan the week from durable context" --triggers "plan week,weekly planning"
bun run dev personas create travel --description "Travel planning mode" --body "Plan travel carefully using known preferences."
bun run dev delegate --wrfc "Build the first version of the assistant inbox"
```

Terminal controls:

- `Enter` submits.
- `Ctrl-J` inserts a newline.
- `Up` / `Down` navigates input history.
- `Ctrl-U` clears the current input.
- `Ctrl-R` refreshes the read-only operator status panes.
- `Ctrl-C`, `Esc`, `/quit`, or `/exit` exits and restores the terminal.

Daemon connection defaults:

- Base URL: `GOODVIBES_AGENT_BASE_URL`, `GOODVIBES_BASE_URL`, or `http://127.0.0.1:3421`
- Token: `GOODVIBES_AGENT_TOKEN`, `GOODVIBES_HTTP_TOKEN`, `GOODVIBES_DAEMON_TOKEN`, or `~/.goodvibes/daemon/operator-tokens.json`
- Companion chat routing: optional `GOODVIBES_AGENT_PROVIDER` and `GOODVIBES_AGENT_MODEL`

When both provider and model are configured, the agent follows daemon runtime provider-row semantics. For example, `GOODVIBES_AGENT_PROVIDER=openai-subscriber` with `GOODVIBES_AGENT_MODEL=openai:gpt-5.5` creates companion chat sessions with provider `openai-subscriber` and model `gpt-5.5`.

Local assistant state is stored under `~/.goodvibes/agent/`.

Human-facing `ask` and `search` output is concise by default. Use `--json` on those commands when you need the full daemon response for inspection or tooling. Auth and config diagnostics report token source, presence, and fingerprints, never token values.

## Packaging Notes

While private and unreleased, the package version stays at `0.0.0`. The first intentionally published usable alpha should become `0.1.0`; SDK compatibility is expressed through the exact `@pellux/goodvibes-sdk` dependency pin, not by mirroring SDK or TUI versions.

During pre-1.0 near-fork development, `@pellux/goodvibes-sdk` is pinned exactly to the daemon-compatible version instead of using a caret range. This package does not currently ship a binary postinstall or trust native lifecycle packages it does not directly exercise.

The distributed package must install a real `goodvibes-agent` executable through `package.json` `bin`. The bin is TypeScript-authored and Bun-backed; release smoke must verify `goodvibes-agent --help` and `goodvibes-agent smoke` from a fresh install.
