# Connected Host

GoodVibes Agent is a TUI client for a connected GoodVibes host owned outside this package. The package exposes one executable:

```sh
goodvibes-agent
```

The installed command is backed by TypeScript-authored source with a Bun shebang. Package install smoke verifies the executable path:

- `goodvibes-agent --help`
- `goodvibes-agent --version`
- `goodvibes-agent status --json`
- `goodvibes-agent` launches the TUI in a real PTY

## Host Prerequisite

Start the owning GoodVibes host before launching Agent. Agent expects that host to expose public operator routes and the isolated Agent Knowledge routes:

```text
http://127.0.0.1:3421
/api/goodvibes-agent/knowledge/status
/api/goodvibes-agent/knowledge/ask
/api/goodvibes-agent/knowledge/search
```

If the GoodVibes API is on a different host or port, use a one-off override when launching the TUI:

```sh
goodvibes-agent --runtime-url http://127.0.0.1:3421
```

For a persistent shell/session override, set:

```sh
export GOODVIBES_AGENT_RUNTIME_URL=http://127.0.0.1:3421
```

`GOODVIBES_AGENT_BASE_URL` is accepted as a legacy alias. These values only select the connected GoodVibes API root; they do not make Agent own host processes.

If the connected host is unavailable, unauthenticated, or on an incompatible SDK version, the Agent TUI reports actionable diagnostics without printing token values.

Use the TUI first for those checks:

- Agent Workspace -> Home -> Host compatibility
- Agent Workspace -> Home -> Doctor diagnostics
- Agent Workspace -> Home -> Review health

`goodvibes-agent status --json`, `goodvibes-agent doctor`, and `goodvibes-agent compat` are scriptable equivalents for install checks and automation.

## Product Boundary

Agent owns the operator assistant TUI, local profiles, local memory/notes/routines/skills/personas, isolated Agent Knowledge calls, companion chat, approvals/automation visibility, and explicit build delegation.

Agent does not own connected-host lifecycle. It does not provide commands to install, expose, start, stop, restart, or mutate the connected GoodVibes host.

The model can inspect this boundary with `agent_harness` mode `connected_host`. That report includes the configured base URL, token presence, token path, allowed route families, first-class Agent tool capabilities, tool availability, and blocked capabilities. Allowed capabilities are limited to read-only operator briefing, explicit allowlisted approval/automation/schedule actions, isolated Agent Knowledge read/ingest, confirmed channel or notification delivery, confirmed reminder schedules, and configured media generation. Blocked capabilities include connected-host lifecycle, listener mutation, default or non-Agent knowledge fallback, hidden background Agent jobs, implicit delegated review, route/account creation, and arbitrary connected-host mutations.

Agent Knowledge is its own product segment. Agent uses `/api/goodvibes-agent/knowledge/*` only and must not fall back to default knowledge or other product-specific knowledge routes.

Normal assistant chat uses companion chat. Build/fix/review work is delegated explicitly to GoodVibes TUI through public runtime/session contracts, and delegated review is requested only when explicitly asked for build/fix/review work.
