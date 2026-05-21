# GoodVibes Agent

GoodVibes Agent is the personal operator assistant built on the GoodVibes terminal UI foundation. This repository is intentionally in a near-fork baseline phase: the shell, renderer, input, fullscreen workspace, command, and release bones are copied from the terminal product first, then the coding-specific behavior is removed or reshaped deliberately.

The Agent product connects to an already-running GoodVibes daemon. It does not install, start, stop, restart, or own the daemon, HTTP listener, web surface, or service lifecycle.

## Current Status

- Package version: `0.0.0`
- Release state: private baseline, not public-product-ready
- Runtime: Bun-only, TypeScript-authored source
- SDK pin: `@pellux/goodvibes-sdk@0.33.35`
- Installed command: `goodvibes-agent`
- Daemon model: external daemon only

Coding and WRFC code is still present because this is a broad foundation copy, but the Agent runtime policy is now serial/proactive by default. Local agent spawning and local WRFC are blocked for normal Agent work; explicit build/fix/review requests must be delegated to GoodVibes TUI through public session/delegation contracts.

## Install

The package is private at `0.0.0`; do not publish it yet.

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent status
```

If Bun reports untrusted lifecycle dependencies, trust only the package and dependencies required by this package:

```sh
bun pm trust -g @pellux/goodvibes-agent @pellux/goodvibes-sdk core-js tree-sitter-css tree-sitter-javascript tree-sitter-json tree-sitter-python tree-sitter-typescript
```

## Source Usage

```sh
git clone https://github.com/mgd34msu/goodvibes-agent.git
cd goodvibes-agent
bun install
bun run dev
```

Useful checks:

```sh
bunx tsc --noEmit
bun run build
bun run package:install-check
bun run publish:check
```

## Daemon Prerequisite

Start or restart the daemon from GoodVibes TUI or the daemon host before launching Agent. Agent status and companion/knowledge routes connect to that external daemon, normally on `http://127.0.0.1:3421`.

Agent intentionally blocks daemon lifecycle commands:

```sh
goodvibes-agent serve
goodvibes-agent service start
goodvibes-agent surfaces enable web
```

Those commands should return explicit external-daemon guidance instead of mutating local service posture.

## Product Boundary

GoodVibes Agent owns the operator assistant surface: serial assistant flow, proactive safe actions, local memory/skills/personas until stable shared registries exist, Agent knowledge routes, companion chat, approvals/automation observability, and explicit build delegation.

GoodVibes TUI owns coding execution: file edits, git/worktree workflows, coding panels, sandbox/QEMU UX, and WRFC execution. Agent may delegate explicit build/fix/review work to TUI through public daemon/session contracts; normal assistant chat must not use shared coding sessions.

## Package Docs

Package-facing docs are intentionally narrow during the near-fork baseline:

- [Getting Started](docs/getting-started.md)
- [Deployment And Services](docs/deployment-and-services.md)
- [Release And Publishing](docs/release-and-publishing.md)

Broader copied TUI docs may exist in the source tree while the foundation is being ported, but they are not product-ready Agent documentation unless listed above.
