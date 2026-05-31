# Getting Started

GoodVibes Agent `0.1.3` is the current installable public alpha of the personal operator assistant built on the GoodVibes TUI foundation.

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

## Local Personas And Skills

Personas and reusable Agent skills are local to GoodVibes Agent. They do not write into default Knowledge/Wiki or HomeGraph.

```text
/personas list
/personas create --name Research --description "Source-backed research" --body "Check sources, call out uncertainty, keep answers concise."
/personas use research
/agent-skills create --name "Morning Brief" --description "Daily briefing flow" --procedure "Check tasks, approvals, calendar, and unread state before summarizing." --enabled true
/agent-skills enabled
/skills local list
```

The active persona and enabled Agent skills are injected into the main serial assistant conversation. They do not spawn background agents.

## External Daemon

Start the daemon from GoodVibes TUI or the daemon host before using daemon-backed Agent features. Agent expects the daemon to expose the public operator/Agent routes, including:

- `/status`
- `/api/goodvibes-agent/knowledge/status`
- `/api/goodvibes-agent/knowledge/ask`
- `/api/goodvibes-agent/knowledge/search`
- `/api/goodvibes-agent/knowledge/ingest/url`

Agent Knowledge/Wiki is an Agent-owned product segment. Agent commands must not fall back to default Knowledge/Wiki, HomeGraph, or Home Assistant spaces.

Agent lifecycle commands that would start or mutate daemon posture are blocked intentionally. Use `goodvibes-agent status`, `goodvibes-agent doctor`, and read-only surface checks for diagnostics.

## Current Baseline Notes

This repository keeps broad TUI-derived foundation code intentionally so Agent can use the mature terminal shell, renderer, input, fullscreen workspace, command registry, and release bones. The active Agent policy is serial/proactive by default, blocks local Agent-owned WRFC/spawn fanout, and delegates explicit build/fix/review work to GoodVibes TUI instead of turning the Agent into a coding TUI.
