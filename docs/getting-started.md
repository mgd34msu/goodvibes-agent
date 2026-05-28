# Getting Started

GoodVibes Agent is currently a private `0.0.0` baseline. It is installable for smoke testing, but it is not ready for public release.

## Requirements

- Bun `1.3.10` or newer
- An already-running GoodVibes daemon compatible with `@pellux/goodvibes-sdk@0.33.35`
- A daemon token/config path accepted by the external daemon

Agent does not launch the daemon for you.

## Install From Package

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent status
```

If Bun requires lifecycle trust:

```sh
bun pm trust -g @pellux/goodvibes-agent @pellux/goodvibes-sdk core-js tree-sitter-css tree-sitter-javascript tree-sitter-json tree-sitter-python tree-sitter-typescript
```

## Run From Source

```sh
git clone https://github.com/mgd34msu/goodvibes-agent.git
cd goodvibes-agent
bun install
bun run dev
```

`bun run dev` starts the Agent TUI. The same entrypoint backs the installed `goodvibes-agent` command.

Once the TUI opens, run `/agent`, `/home`, or `/operator` to open the Agent operator workspace. That fullscreen workspace is the current front door for setup/config, knowledge status, local memory and skills, read-only work/approval/automation views, and explicit GoodVibes TUI build delegation.

## External Daemon

Start the daemon from GoodVibes TUI or the daemon host before using daemon-backed Agent features. Agent expects the daemon to expose the public operator/Agent routes, including:

- `/status`
- `/api/goodvibes-agent/knowledge/status`
- `/api/goodvibes-agent/knowledge/ask`
- `/api/goodvibes-agent/knowledge/search`

Agent lifecycle commands that would start or mutate daemon posture are blocked intentionally. Use `goodvibes-agent status`, `goodvibes-agent doctor`, and read-only surface checks for diagnostics.

## Current Baseline Notes

This repository still contains broad copied TUI code. That is intentional for the baseline. The active Agent policy is serial/proactive by default, blocks local Agent-owned WRFC/spawn fanout, and delegates explicit build/fix/review work to GoodVibes TUI instead of turning the Agent into a coding TUI.
