# Getting Started

GoodVibes Agent is the installable autonomous operator assistant for GoodVibes.

## Requirements

- Bun `1.3.10` or newer.
- A connected GoodVibes daemon or compatible host with operator routes.
- Token/config state accepted by that daemon.

## Install From Package

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent
```

If `goodvibes-agent` is not on `PATH`:

```sh
export PATH="$(bun pm bin -g):$PATH"
goodvibes-agent --help
```

`goodvibes-agent` starts the interactive TUI. On a fresh Agent home, setup opens first. After setup is applied, the TUI opens directly into the Agent workspace.

## Run From Source

```sh
git clone https://github.com/mgd34msu/goodvibes-agent.git
cd goodvibes-agent
bun install
bun run dev
```

## First Run

Use the interactive workspace first. CLI subcommands are secondary support paths for install checks, setup inspection, and scriptable mirrors.

Primary first-run areas:

- Setup: prioritized first-run plan, provider/model, hardware-scored local model cookbook, connected-host compatibility, Agent Knowledge readiness, profiles, support bundles, subscriptions, and auth review.
- Home: normal chat, operator briefing, model selection, and health.
- Knowledge: isolated Agent Knowledge status, ask/search, inspection, and confirmed ingest.
- Research: read-only web research and URL inspection, project-local visible research runs with log tails, source queue, credibility review, reviewed-source bundles, plus confirmed sourced markdown report artifacts with source maps, citation coverage checks, and repair hints.
- Documents & Compare: versioned markdown document drafts, review comments, AI suggestion review, draft browse/show/create/revise/review/suggest/accept/reject/artifact-attach/artifact-insert/export, uploads, exports, source checks, generated media artifacts, saved artifact browse/show/export/package, reviewed artifact-to-Knowledge promotion, saved text artifact reuse in blind comparison, and confirmed blind model comparison with delayed reveal, durable JSON comparison artifacts, saved review boards, saved judgment artifacts, saved preference analytics, markdown report export, and confirmed winner route updates.
- Personal Ops: inbox/calendar connector readiness plus live records for Agent-owned notes, routines, schedule receipts, and delivery channels.
- Memory & Skills: local memory, notes, personas, skills, routines, learned behavior capture, and a read-only learning curator for review/setup/stale candidates.
- Channels: companion pairing, channel readiness, notification targets, and confirmed sends.
- Voice & Media: TTS setup, image input, and confirmed generated media.
- Work & Automation: work-plan tracking, approvals, schedules, reminders, and explicit operator actions.
- Operator Runtime: daemon status, method discovery, confirmed write/admin routes, visible autonomous agents, and cancellation/status follow-up.

Press `/` inside the Agent workspace to search actions by name, category, command, or detail.

## Model Access

The main Agent model can use the Agent-controlled harness through Agent-owned tools. Use `agent_harness mode:"summary"` for a compact map, `mode:"modes"` to search every harness mode by task or id, and `mode:"mode"` to inspect one mode contract. Then drill into plural catalogs or single-item inspect modes.

Default discovery is intentionally compact:

- plural modes return ids, labels, counts, safe state, effect class, and route hints;
- workspace action, slash-command, CLI, panel, UI surface, shortcut/keybinding, settings, tool, connected-host posture/status/capability, and operator/audit catalogs include short `modelRoute` or `modelAccess` hints for route choice;
- singular modes return detailed policy and lookup metadata;
- `includeParameters:true` adds schemas, editor fields, model routes, parameter hints, release artifact data, redacted log tail, and detail that would be too large for normal discovery.

Common model routes:

| Need | Tool Or Mode |
| --- | --- |
| Harness mode discovery | `agent_harness mode:"modes"`, `mode:"mode"` |
| Workspace actions | `agent_harness mode:"workspace_actions"`, `mode:"workspace_action"`, `mode:"run_workspace_action"` |
| Slash commands | `agent_harness mode:"commands"`, `mode:"command"`, `mode:"run_command"` |
| Settings | `agent_harness mode:"settings"`, `mode:"get_setting"`, `mode:"set_setting"`, `mode:"reset_setting"` |
| Visible UI | `agent_harness mode:"panels"`, `mode:"ui_surfaces"`, `mode:"open_panel"`, `mode:"open_ui_surface"` |
| Keybindings | `agent_harness mode:"shortcuts"`, `mode:"keybindings"`, `mode:"keybinding"`, `mode:"run_keybinding"`, `mode:"set_keybinding"` |
| Tool contracts | `agent_harness mode:"tools"`, `mode:"tool"` |
| Agent Knowledge | `agent_knowledge`, `agent_knowledge_ingest` |
| Research runs, sources, and reports | `agent_harness mode:"research_runs"`, `mode:"research_run"`, `mode:"research_queue"`, `agent_research_runs`, `agent_research_sources`, `agent_research_report` |
| Personal operations | `agent_harness mode:"personal_ops"`, `mode:"personal_ops_lane"` |
| Local model choice | `agent_harness mode:"model_routing" query:"local"`, `mode:"model_route" modelRouteId:"local-model-cookbook"` |
| Documents, artifacts, compare | `agent_harness mode:"document_ops"`, `mode:"document_ops_lane"`, `agent_documents`, `agent_artifacts`, `agent_model_compare` |
| Local memory/notes/personas/skills/routines | `agent_local_registry` or confirmed workspace actions |
| Learning curator | `agent_harness mode:"learning_curator"`, `mode:"learning_candidate"` |
| Work plan | `agent_work_plan` |
| Visible autonomous work | `agent` with `mode:"spawn"`, `mode:"batch-spawn"`, `mode:"status"`, `mode:"message"`, `mode:"wait"`, or `mode:"cancel"` |
| Channels, notifications, reminders, media | `agent_channel_send`, `agent_notify`, `agent_reminder_schedule`, `agent_media_generate` |
| Operator state/actions | `agent_operator_briefing`, `agent_operator_action`, `agent_operator_method`, `agent_harness mode:"operator_methods"` |
| Connected host/daemon posture | `agent_harness mode:"service_posture"`, `mode:"connected_host"`, `mode:"connected_host_capability"`, `mode:"connected_host_status"`, `mode:"daemon"`, `mode:"daemon_status"` |
| First-run setup plan | `agent_harness mode:"setup_posture"`, `mode:"setup_item"` |
| Operator/audit evidence | `agent_harness mode:"release_evidence"`, `mode:"release_evidence_artifact"`, `mode:"release_readiness"`, `mode:"release_readiness_item"` |

All effects require explicit user request and confirmation. Ambiguous lookup is refused with candidates.

Registered tool definitions are intentionally terse. The default model catalog keeps top-level descriptions short, removes nested parameter descriptions, and includes direct harness inspection routes; use `agent_harness mode:"tools"` with `includeParameters:true`, `mode:"tool"`, or the owning harness mode when detailed contracts are needed.

## Isolated Agent Profiles

Use a separate Agent home for isolated local state:

```sh
GOODVIBES_AGENT_HOME=/path/to/agent-home goodvibes-agent
```

Use named Agent profiles from Agent Workspace -> Profiles. Scriptable equivalents:

```sh
goodvibes-agent profiles templates
goodvibes-agent profiles create household --template household --yes
goodvibes-agent profiles use household --yes
goodvibes-agent --agent-profile household
goodvibes-agent profiles templates export research ./research-starter.json --yes
goodvibes-agent profiles templates import ./research-starter.json --yes
```

Named profiles isolate Agent-local config, sessions, memory, notes, personas, skills, routines, and setup state. GoodVibes settings import can bring over existing provider, UI, permission, subscription, surface, tool, and daemon endpoint settings.

## Local Behavior

Memory, notes, personas, routines, and Agent skills are local to GoodVibes Agent. They do not write into default knowledge or other product segments.

Use the workspace first:

- Memory & Skills -> Create memory, Create note, or Capture learned behavior.
- Memory & Skills -> Learning curator to rank stale, low-confidence, missing-setup, and review-needed local behavior records before they silently guide the assistant.
- Notes -> Create notes for source triage, temporary decisions, and operator handoff.
- Personas -> Create, inspect, activate, review, stale, or delete.
- Skills -> Create, enable/disable, review, bundle, or delete.
- Routines -> Create, start in chat, review receipts, or explicitly promote to a connected schedule.
- Work -> Add work item, review work plan, and update status.

Starting a routine records local usage and prints its steps in the main conversation. Promotion to a connected schedule or automation job is separate, explicit, confirmation-gated, visible in the autonomy queue, and keeps Agent Knowledge isolated.

## Knowledge And Artifacts

Use Agent Workspace -> Knowledge for source-backed Agent Knowledge. The valid connected-host route family is:

```text
/api/goodvibes-agent/knowledge/*
```

Agent commands fail closed if the route is unavailable or a successful-looking response carries non-Agent contamination. Parseable public Agent-route scope aliases are normalized before rendering.

The Knowledge workspace also exposes route-backed and command-backed workflows for issue review, prompt packet previews, context-selection explain output, consolidation, and reindex. Read-only ask/search/list/get/map/connector/packet/explain paths do not require mutation confirmation. Ingest, review-issue, consolidation, and reindex paths require explicit confirmation.

Use Agent Workspace -> Research for read-only web research, URL inspection, visible checkpointable research run state, project-local source queue review, reviewed-source bundles, and confirmed sourced markdown report artifacts. Research requests do not ingest sources. Research run records keep the user-facing question, phase, progress, checkpoints, log tails, source ids, next steps, and pause/resume/cancel/complete routes without starting hidden background work. Source queue records keep credibility, score, report-ready source lines, source bundle handoffs, and safe routes; saved report artifacts keep a source map, citation coverage metadata, repair hints, and optional strict body-citation enforcement, and can be inspected or promoted later through explicit artifact and Agent Knowledge routes. Use Agent Workspace -> Documents & Compare when a document needs a versioned markdown draft, review comments, AI suggestion review, review status, saved artifact attachment or insertion, single-artifact export, multi-artifact package export, prompt context, source checks, generated media artifacts, reviewed artifact-to-Knowledge promotion, saved text artifact reuse in blind comparison, or a confirmed blind model comparison with local review and judgment artifacts. Use confirmed Agent Knowledge ingest actions when a reviewed source should become durable.

Use the Artifacts area and Voice & Media workspace for images, source files, generated media, and exported sessions. Generated media returns artifact ids and metadata, not inline base64.

## Connected Host

Connect Agent to a GoodVibes daemon before using daemon-backed features. Agent expects:

```text
http://127.0.0.1:3421
```

Override for one launch:

```sh
goodvibes-agent --runtime-url http://host:port
```

Persistent shell/session override:

```sh
export GOODVIBES_AGENT_RUNTIME_URL=http://host:port
```

Host diagnostics:

- Agent Workspace -> Home -> Host compatibility
- Agent Workspace -> Home -> Doctor diagnostics
- Agent Workspace -> Home -> Review health
- `goodvibes-agent status --json`
- `goodvibes-agent doctor`
- `goodvibes-agent compat`

Model-visible diagnostics are `service_posture`, `service_endpoint`, `connected_host`, `connected_host_status`, `connected_host_capability`, `daemon`, and `daemon_status`. `agent_harness mode:"operator_methods"` inventories the full GoodVibes daemon contract. `agent_operator_method` can run read-only routes directly and write/admin routes only with `confirm:true` plus `explicitUserRequest`.

## Current Product Notes

Agent uses the GoodVibes terminal shell, renderer, input, fullscreen workspace, command registry, and release foundation. Use `agent_harness mode:"execution_posture"` before computer-work handoffs: local read/edit/exec is the preferred route when the current workspace and permissions are sufficient, while delegation is reserved for isolation, parallelism, remote execution, separate worktrees, or user-requested delegated review. The active autonomy policy is visible autonomy: long-running work must have a user-readable task, status/progress, cancellation route, and confirmation gates for external or daemon-mutating effects. Use `agent_harness mode:"autonomy_intake"` to turn an ongoing-work request into the safest visible route and missing fields. Inspect current autonomy cards with `agent_harness mode:"autonomy_queue"` or one card with `mode:"autonomy_queue_item"`; research runs, connected-host tasks, approvals, automation runs, and schedules surface live records with progress/status, source ids, next steps, log tails when available, and exact inspect/checkpoint/cancel/approve/deny/retry/run routes where the owning surface supports them.
