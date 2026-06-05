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
GET  /api/goodvibes-agent/knowledge/status
POST /api/goodvibes-agent/knowledge/ask
POST /api/goodvibes-agent/knowledge/search
GET  /api/goodvibes-agent/knowledge/sources
GET  /api/goodvibes-agent/knowledge/nodes
GET  /api/goodvibes-agent/knowledge/issues
GET  /api/goodvibes-agent/knowledge/items/{id}
GET  /api/goodvibes-agent/knowledge/map
GET  /api/goodvibes-agent/knowledge/connectors
GET  /api/goodvibes-agent/knowledge/connectors/{id}
GET  /api/goodvibes-agent/knowledge/connectors/{id}/doctor
POST /api/goodvibes-agent/knowledge/ingest/url
POST /api/goodvibes-agent/knowledge/ingest/artifact
POST /api/goodvibes-agent/knowledge/ingest/urls
POST /api/goodvibes-agent/knowledge/ingest/bookmarks
POST /api/goodvibes-agent/knowledge/ingest/browser-history
POST /api/goodvibes-agent/knowledge/ingest/connector
POST /api/goodvibes-agent/knowledge/reindex
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

If the connected host is unavailable, unauthenticated, or incompatible with Agent, the Agent TUI reports actionable diagnostics without printing token values.

Use the TUI first for those checks:

- Agent Workspace -> Home -> Host compatibility
- Agent Workspace -> Home -> Doctor diagnostics
- Agent Workspace -> Home -> Review health

`goodvibes-agent status --json`, `goodvibes-agent doctor`, and `goodvibes-agent compat` are scriptable equivalents for install checks and automation.

## Product Boundary

Agent owns the operator assistant TUI, local profiles, local memory/notes/routines/skills/personas, isolated Agent Knowledge calls, companion chat, approvals/automation visibility, and explicit build delegation.

Agent does not own connected-host lifecycle. It does not provide commands to install, expose, start, stop, restart, or mutate the connected GoodVibes host.

The model can inspect this boundary with `agent_harness` mode `connected_host`. `daemon` is an alias for the same posture report. By default the report is compact: configured base URL, token posture, ownership, mode hints, capability counts, and a short `modelRoute` for the next safe Agent-owned route. Use `includeParameters:true` for full route families, allowed capabilities, blocked capabilities, and first-class Agent tool availability; those expanded rows also carry compact `modelRoute` hints. Allowed capabilities include read-only operator briefing, explicit allowlisted approval/automation/schedule actions, isolated Agent Knowledge read/ingest, confirmed channel or notification delivery, confirmed reminder schedules, and configured media generation. Blocked capabilities include connected-host lifecycle, listener mutation, default or non-Agent knowledge fallback, hidden background Agent jobs, implicit delegated review, route/account creation, and arbitrary connected-host mutations. To inspect one surface without parsing the full report, use `connected_host_capability` with `capabilityId`, `target`, or `query`; capability results return the allowed or blocked route hint.

The model can inspect the public operator method catalog with `agent_harness` mode `operator_methods`. That report lists the allowlisted read and mutation methods, their public routes, owning first-class model tools, confirmation policy, and boundary. To inspect one method without parsing the full report, use `operator_method` with `methodId`, `target`, or `query`. This is a read-only catalog and does not expose arbitrary route invocation.

The model can inspect service posture with `agent_harness` mode `service_posture`. That report exposes the same read-only endpoint binding, network-facing posture, issue, and redacted-log diagnostics used by status, doctor, and support bundles. Use `includeParameters:true` when reachability probes and redacted log tail are needed. To inspect one endpoint, use `service_endpoint` with `endpointId`, `target`, or `query`; valid endpoint ids are `controlPlane`, `httpListener`, and `web`. These modes are diagnostic only and do not expose host start, stop, restart, install, listener, or account-management operations.

The model can inspect live connected-host readiness with `agent_harness` mode `connected_host_status`. `daemon_status` is an alias. That report uses the same read-only status probe as the CLI: it checks the connected-host status route, verifies host compatibility, checks the isolated Agent Knowledge status route when token and compatibility posture allow it, reports endpoint bindings and token posture without printing token values, returns actionable findings, and includes a compact `modelRoute` for follow-up diagnostics. `includeParameters:true` adds route family and capability detail. It is diagnostic only and does not expose host start, stop, restart, install, listener, or account-management operations.

The model can inspect companion pairing posture with `agent_harness` mode `pairing_posture`, and inspect one pairing/mobile route with `pairing_route`. Those modes report the control-plane endpoint binding, pairing surface id, token presence/fingerprint, and route catalog without returning raw tokens or QR payloads. Pairing display, manual token display, companion connection, channel delivery, task, approval, provider/model, and attachment actions remain visible user flows.

Agent Knowledge is its own product segment. Agent uses `/api/goodvibes-agent/knowledge/*` only and must not fall back to default knowledge or other product-specific knowledge routes. Agent normalizes public Agent-route scope aliases and rejects successful-looking responses that carry known non-Agent payload markers.

Normal assistant chat uses companion chat. Build/fix/review work is delegated explicitly to GoodVibes TUI through public runtime/session contracts, and delegated review is requested only when explicitly asked for build/fix/review work.
