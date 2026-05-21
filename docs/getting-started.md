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

## External Daemon

Start the daemon from GoodVibes TUI or the daemon host before using daemon-backed Agent features. Agent expects the daemon to expose the public operator/Agent routes, including:

- `/status`
- `/api/goodvibes-agent/knowledge/status`
- `/api/goodvibes-agent/knowledge/ask`
- `/api/goodvibes-agent/knowledge/search`

Agent lifecycle commands that would start or mutate daemon posture are blocked intentionally. Use `goodvibes-agent status`, `goodvibes-agent doctor`, and read-only surface checks for diagnostics.

## Current Baseline Notes

This repository still contains broad copied TUI code. That is intentional for the baseline. Coding-first guardrails and WRFC-default behavior must be removed or reshaped before user-facing Agent validation. The final Agent product should be serial/proactive by default and delegate build/fix/review work explicitly to GoodVibes TUI.
