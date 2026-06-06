# Connected Host

GoodVibes Agent is the autonomous TUI harness for a connected GoodVibes daemon. The package exposes one executable:

```sh
goodvibes-agent
```

The installed command is backed by TypeScript-authored source with a Bun shebang. Package install smoke verifies the executable path:

- `goodvibes-agent --help`
- `goodvibes-agent --version`
- `goodvibes-agent status --json`
- `goodvibes-agent` launches the TUI in a real PTY

## Daemon Prerequisite

Connect to a GoodVibes daemon before using daemon-backed features. Agent expects that daemon to expose public operator routes and the isolated Agent Knowledge routes:

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

`GOODVIBES_AGENT_BASE_URL` is accepted as a legacy alias. These values select the connected GoodVibes API root.

If the connected host is unavailable, unauthenticated, or incompatible with Agent, the Agent TUI reports actionable diagnostics without printing token values.

Use the TUI first for those checks:

- Agent Workspace -> Home -> Host compatibility
- Agent Workspace -> Home -> Doctor diagnostics
- Agent Workspace -> Home -> Review health

`goodvibes-agent status --json`, `goodvibes-agent doctor`, and `goodvibes-agent compat` are scriptable equivalents for install checks and automation.

## Product Boundary

Agent owns the user-facing autonomous harness: terminal renderer, setup, chat, profiles, local memory/notes/routines/skills/personas, isolated Agent Knowledge calls, companion chat, visible agents, approvals, schedules, automation posture, daemon method access, channel delivery, reminders, and media workflows.

The GoodVibes daemon owns the platform capabilities. Agent should expose those capabilities through the easiest safe user path: simple first-class tools for common tasks, dynamic operator method discovery for exact contract parity, and confirmation gates for write/admin routes.

The model can inspect this boundary with `agent_harness` mode `connected_host`. `daemon` is an alias for the same posture report. By default the report is compact: configured base URL, token posture, ownership, mode hints, capability counts, and a short `modelRoute` for the next safe Agent-owned route. Use `includeParameters:true` for full route families, allowed capabilities, blocked capabilities, and first-class Agent tool availability; those expanded rows also carry compact `modelRoute` hints. Allowed capabilities include read-only operator briefing, explicit allowlisted approval/automation/schedule actions, isolated Agent Knowledge read/ingest, confirmed channel or notification delivery, confirmed reminder schedules, and configured media generation. Blocked capabilities include connected-host lifecycle, listener mutation, default or non-Agent knowledge fallback, hidden background Agent jobs, implicit delegated review, route/account creation, and arbitrary connected-host mutations. To inspect one surface without parsing the full report, use `connected_host_capability` with `capabilityId`, `target`, or `query`; capability results return the allowed or blocked route hint.

The model can inspect the public operator method catalog with `agent_harness` mode `operator_methods`. That report is generated from the GoodVibes SDK contract, not a stale hand-maintained shortlist. To inspect one method without parsing the full report, use `operator_method` with `methodId`, `target`, or `query`. Execute exact daemon methods with `agent_operator_method`: read-only routes can run directly; write/admin routes require `confirm:true` and `explicitUserRequest`.

The model can inspect service posture with `agent_harness` mode `service_posture`. That report exposes endpoint binding, network-facing posture, issues, and redacted-log diagnostics used by status, doctor, and support bundles. Use `includeParameters:true` when reachability probes and redacted log tail are needed. To inspect one endpoint, use `service_endpoint` with `endpointId`, `target`, or `query`; valid endpoint ids are `controlPlane`, `httpListener`, and `web`. Service lifecycle and listener changes must use setup or confirmed daemon operator methods.

The model can inspect live connected-host readiness with `agent_harness` mode `connected_host_status`. `daemon_status` is an alias. That report uses the same status probe as the CLI: it checks the connected-host status route, verifies host compatibility, checks isolated Agent Knowledge when token and compatibility posture allow it, reports endpoint bindings and token posture without printing token values, returns actionable findings, and includes a compact `modelRoute` for follow-up diagnostics. `includeParameters:true` adds route family and capability detail.

The model can inspect companion pairing posture with `agent_harness` mode `pairing_posture`, and inspect one pairing/mobile route with `pairing_route`. Those modes report the control-plane endpoint binding, pairing surface id, token presence/fingerprint, and route catalog without returning raw tokens or QR payloads. Pairing display, manual token display, companion connection, channel delivery, task, approval, provider/model, and attachment actions remain visible user flows.

Agent Knowledge is its own product segment. Agent uses `/api/goodvibes-agent/knowledge/*` only and must not fall back to default knowledge or other product-specific knowledge routes. Agent normalizes public Agent-route scope aliases and rejects successful-looking responses that carry known non-Agent payload markers.

Normal assistant chat can use local tools, visible Agent jobs, daemon automation, shared sessions, delegation, or remote runners. GoodVibes TUI remains the vibecoding harness; Agent should choose it when that UX is best for the user rather than exposing package ownership as friction.
