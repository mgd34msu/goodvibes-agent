# GoodVibes Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Version: 1.4.4](https://img.shields.io/badge/version-1.5.0-blue.svg)](#install)

GoodVibes Agent is the installable autonomous operator assistant for GoodVibes. It keeps the existing terminal renderer and workspace bones, but the product goal is different from a vibecoding harness: the user should experience one assistant that can chat, plan, remember, research, schedule, send, generate, run visible agents, and operate the GoodVibes daemon contract with clear confirmation gates.

The GoodVibes daemon is Agent's capability runtime. It provides the operator API, schedules, channels, knowledge, media, remote execution, service posture, and long-running automation routes. Those capabilities stay in their owning packages; Agent consumes published SDK/daemon/TUI contracts and presents the user-first harness, route planning, confirmation gates, and receipts. Agent keeps shared GoodVibes settings import so users can reuse provider selections, UI preferences, permissions, subscriptions, surfaces, tools, and daemon endpoint settings from goodvibes-tui and other published GoodVibes platform stores instead of rebuilding setup by hand.

## Install

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent
```

If the command is not on `PATH`, add Bun's global bin directory:

```sh
export PATH="$(bun pm bin -g):$PATH"
goodvibes-agent --help
```

On a fresh Agent home, `goodvibes-agent` opens setup first. After setup is applied, it opens directly into the Agent workspace.

## Source Usage

```sh
git clone https://github.com/mgd34msu/goodvibes-agent.git
cd goodvibes-agent
bun install
bun run dev
```

Useful local checks:

```sh
bun run typecheck
bun run build
bun run package:install-check
bun run publish:check
```

## Operator Workspace

The fullscreen Agent workspace is the primary product surface. Reopen it with `/agent`, `/home`, or `/operator`.

Workspace areas:

- Home: normal assistant chat, operator briefing, model selection, setup, and health.
- Conversation: context usage, inline `@file`/`@folder`/`@url` references, compaction, title/session save/load/search/export, bookmarks, paste/image/TTS helpers, undo/redo/retry, clear/reset, shortcuts, and keybindings.
- Research: read-only web research, URL inspection, source triage, and explicit handoff into Agent Knowledge.
- Documents & Compare: versioned document drafting, uploads, exports, source checks, generated media artifacts, artifact browsing/export, artifact reuse, and confirmed blind model comparison with delayed reveal, durable JSON comparison artifacts, saved review boards, side-by-side reviewer views, saved judgment artifacts, saved preference analytics/synthesis, markdown report export, reviewer handoff artifacts, one-click reviewer handoff ZIP archives, and confirmed winner route updates.
- Artifacts: image attachment, conversation/session export, source-file ingest, source lookup, bookmark/browser-history import, and generated media artifacts.
- Personal Ops: request intake for inbox, agenda, tasks, reminders, notes, routines, and delivery; inbox/calendar connector readiness; saved review queues; notes, work plans, host tasks, task/reminder workflow cards, connected schedule controls, routines, schedules, and delivery readiness in one daily operations area.
- Setup: provider/model, compatibility, Agent Knowledge readiness, profiles, support bundles, subscriptions, and auth review.
- Tools & MCP: MCP server setup, tool inventory, trust review, secrets, and settings.
- Knowledge: isolated Agent Knowledge status, ask/search, source/node/issue libraries, item lookup, map review, connectors, ingest, review queue, and reindex.
- Memory & Skills: VIBE.md personality, project context files, local memory posture, prompt-active recall, vector/embedding health, scratchpad notes, learned behavior capture, personas, skills, routines, and schedule promotion.
- Channels: companion pairing, channel readiness, confirmed channel delivery, and confirmed webhook notification management.
- Voice & Media: voice review, spoken response setup, image input, confirmed image/video generation, browser-tool posture, and provider readiness.
- Automation: reminders, schedules, visible autonomous agents, routine promotion receipts, reconciliation, and exact confirmed approval/automation/schedule actions.
- Operator Runtime: full GoodVibes daemon method discovery, read-only status routes, confirmed write/admin routes, and service posture.

Press `/` inside the workspace to search actions by name, category, command, or detail. Slash commands and CLI subcommands remain power-user/scriptable mirrors; the workspace is the first-class user path.

## Model-Visible Harness

The main Agent model can inspect and operate the Agent-controlled harness through Agent-owned tools. The important first-run entrypoint is `setup`; the detailed catalog entrypoint is `agent_harness`.

`route action:"plan" query:"..."` is the first stop when a plain user task could map to several GoodVibes surfaces. It returns the preferred visible route, alternatives, missing fields, confirmation boundary, workspace matches, and harness mode matches without running tools; host/daemon health or doctor wording routes to `host action:"status"`, normal settings/configuration wording routes to `settings action:"list"`, model provider/local-cookbook/smoke/route-fit wording routes to `models action:"provider|local|smoke|route"`, Personal Ops briefing/queue/fresh-read/connector wording routes to `personal_ops action:"briefing|queue|intake|lane"`, direct reminders/schedule lifecycle wording routes to `schedule action:"list"` and confirmed schedule actions, command-shaped background work routes to `execution action:"processes"` and the first-class `terminal`/`process` UX, interactive PTY/stdin/sudo wording routes to `execution action:"process_capabilities"` before any start or credential effect, external memory-provider/backend/sync/import/export wording routes to `memory action:"provider"` or the provider contract checklist, browser-backed research runner wording routes to `research action:"runner"`, visual research report rendering routes to `research action:"plan"` plus report artifacts, voice workflow and TTS-provider wording routes to `device action:"voice|provider"`, browser cockpit/PWA wording routes to `computer action:"browser"` before any visible open handoff, channel setup/triage/delivery-receipt/send wording routes to `channels action:"setup|triage|deliveries|channel"` before confirmed external delivery, security permission/status/finding/blocked-action wording routes to `security action:"status|finding|explain"` before policy changes or risky work, support-bundle wording routes to `support action:"status|bundle"` before bundle export/import/share effects, saved-session/bookmark/continuity wording routes to `sessions action:"list|get"` before session lifecycle effects, release readiness/evidence/audit wording routes to `audit action:"readiness|evidence|item|artifact"`, file undo/redo/recovery wording routes to `execution action:"recovery"`, media generation wording routes to provider readiness plus confirmed `agent_media_generate` artifacts, and screenshot, browser-navigation/control, screen-observation, and desktop-control wording routes to `computer action:"plan"` before any live UI tool is considered. `setup action:"repair"` is the first stop for setup or host fix requests; it chooses the safest next token repair, connected-host status, services.status receipt, user-run bootstrap, or no-action route without executing it. `agent_harness mode:"summary"` is compact by default. It returns counts, status, and a short mode guide. `mode:"modes"` searches every harness mode by task, family, effect type, id, alias, or parameter name; `mode:"mode"` inspects one mode contract, and `mode:"route_decision"` remains the lower-level compatibility route for the same user-task planner. Plural catalog modes are also compact by default: they return ids, labels, counts, safe state, effect class, and short route hints. Workspace, command, UI, shortcut, and keybinding discovery should normally use `workspace action:"status|actions|action|run|surfaces|surface|open|commands|command|run_command|shortcuts|keybindings|keybinding"`, while lower-level harness modes remain for compatibility/detail inspection. Connected-host posture/status/capability and operator/audit rows include compact `modelRoute` or `modelAccess` hints so the model can choose the right first-class tool or confirmed harness route without expanding every row. Use `settings action:"list|get|set|reset|import"` for normal configuration work and `host action:"status|capabilities|capability|services|service|methods|method"` for normal connected-host/daemon diagnostics. Use `includeParameters:true` or a singular inspect mode when the model needs schemas, detailed route hints, full policy blocks, redacted log tail, operator/audit artifact data, or editor field definitions.

High-value `agent_harness` mode groups:

- Discovery: `modes` and `tools`; use `workspace action:"status|actions|commands|cli_commands|surfaces|shortcuts|keybindings"` for workspace/UI/command/key discovery and `settings action:"list"` for settings.
- Single-item inspection: `mode` and `tool`; use `workspace action:"action|command|cli_command|surface|keybinding"` and `settings action:"get"` for one item.
- User-visible effects: use `workspace action:"run|run_command|open|run_keybinding|set_keybinding|reset_keybinding"`, `terminal command:"..." background:true`, `process action:"wait|kill|write"`, and `settings action:"set|reset|import"`; all visible/mutating routes remain confirmation-gated.
- Product posture: `channels action:"status|channel|setup|triage|deliveries"`, `notifications`, `provider_accounts`, `mcp_servers`, `setup action:"status|repair"` or detailed `setup_posture`, `host action:"status|capabilities|services|methods"`, `context action:"status|files|file|prompt|receipts|receipt"`, `memory action:"status|provider|curator|candidate|list|search|get"`, `agent_orchestration`, `model_routing`, `execution action:"status|route|history|record|processes|process_capabilities|process|recovery"`, `computer action:"status|plan|control|browser|setup|mcp"`, `personal_ops action:"briefing|status|queue|intake|lane|read"`, `document_ops`, `pairing_posture`, `delegation action:"status|routes|route"`, `security action:"status|finding|explain"`, `support action:"status|bundle"`, `media_posture`, `sessions action:"list|get"`.
- Local long-running commands: `execution action:"processes"` and `execution action:"process"` inspect tracked ProcessManager jobs with bounded redacted output; `execution action:"capabilities"` or `action:"process_capabilities"` reports the same read-only process parity matrix as `process action:"capabilities"` for terminal background start, process list/poll/wait/log/kill/write, PTY, and sudo without overclaiming unsupported interactive routes. Confirmed `terminal command:"..." background:true` starts one visible local process, and `process action:"poll|log|wait|kill|write"` manages it. Lower-level `background_processes`, `background_process`, and confirmed `run_background_process` remain compatibility routes. `setup action:"item" setupItemId:"sudo-execution-posture"` shows SUDO_PASSWORD presence only, blocked background sudo routes, and foreground-supervised escalation guidance without reading or printing raw password values.
- Visible Agent orchestration: `agent_orchestration` lists the live Agent manager, serial-by-default policy, managed multi-agent plan cards with milestones, work-plan links, dispatch receipts, closeout review routes, remote-runner contracts/artifact trails, auto-attached remote artifact review routes, spawn/batch-spawn decision cards, and safe control routes; `agent_orchestration_agent` inspects one visible subagent with its plan card. Approved work-plan items dispatch through confirmed `agent_work_plan action:"dispatch_agents"` into first-class `agent` spawn or batch-spawn calls with saved receipts. Actual spawn, message, wait, and cancel actions stay on the first-class `agent` tool.
- Connected host: prefer `setup action:"repair"` for setup/repair decisions and `host action:"status|capabilities|capability|services|service|methods|method"` for diagnostics; lower-level `setup_repair`, `service_posture`, `service_endpoint`, `connected_host`, `connected_host_status`, `connected_host_capability`, `daemon`, and `daemon_status` remain compatibility/detail routes. The connected browser cockpit/PWA is surfaced through `computer action:"browser|open_browser"` and `workspace action:"surface|open"` with confirmation for visible opens; `computer action:"plan"` picks the safest browser, screenshot, or desktop-control workflow before live control tools are considered.
- Project and prompt context: prefer `context action:"status|files|file|prompt|receipts|receipt"` for secret-scanned `.hermes.md`, `HERMES.md`, `AGENTS.md`, `CLAUDE.md`, `HERMES_HOME/SOUL.md`, `.cursorrules`, `.cursor/rules/*.mdc`, applied prompt composition, and receipt history; lower-level `project_context`, `project_context_file`, and `prompt_context` harness modes remain compatibility/detail routes.
- Operator/audit inspection: `audit action:"readiness|item|evidence|artifact"`; lower-level `release_evidence`, `release_evidence_artifact`, `release_readiness`, and `release_readiness_item` remain compatibility/detail modes.
- Operator methods: prefer `host action:"methods|method"` for inspection; exact execution stays on `agent_operator_method`.

Every mutating or externally visible effect requires `confirm:true` plus `explicitUserRequest` unless a narrower first-class tool has its own confirmation contract. Ambiguous lookups return candidates instead of guessing.

First-class model tools cover common workflows directly:

- `route action:"plan|status"` for choosing the best visible Agent route for a plain user task before asking the user to understand Agent, TUI, host, daemon, or SDK ownership.
- `agent_knowledge` and `agent_knowledge_ingest` for isolated Agent Knowledge reads and confirmed ingest.
- `memory action:"status|provider|curator|candidate|list|search|get"` for Agent-local memory posture, provider readiness, review queues, and memory records; external-memory providers expose provider-specific next routes, missing setup/status/read/write/sync checklist items, and required receipt fields before Agent claims Honcho, Mem0, Supermemory, or similar backends are connected. `agent_local_registry` and `agent_learning_consolidation` remain the detailed routes for notes, personas, skills, bundles, routines, and confirmed duplicate-consolidation phases. Use `memory action:"status"` first when the user asks what memory knows, whether recall is healthy, or whether an external memory provider is actually connected.
- `channels` for channel readiness, setup guide, triage, and delivery receipts; `agent_channel_send` remains the confirmed send route.
- `support`, `sessions`, and `audit` for read-only support-bundle routes, saved-session/bookmark posture, release readiness, and packaged release evidence without requiring harness mode names.
- `workspace` for Agent workspace categories/actions, slash and CLI command discovery, visible UI navigation, shortcuts, keybindings, and confirmed workspace/command/keybinding effects.
- `agent_work_plan` for visible local work-plan tracking and confirmed dispatch of approved plan items to visible agents.
- `personal_ops` for daily briefing, request intake, lane inspection, and one confirmed read-only inbox/calendar connector operation.
- `autonomy action:"intake|queue|item|status"` for ongoing-work route selection and visible autonomous-work queue inspection without requiring harness mode names.
- `agent_operator_briefing` and `agent_operator_action` for connected work/approval/automation/schedule posture and exact confirmed actions.
- `agent_operator_method` for exact GoodVibes daemon contract parity. Read-only routes can run directly; write/admin routes require `confirm:true` and `explicitUserRequest`.
- `agent_channel_send`, `agent_notify`, `agent_reminder_schedule`, `agent_media_generate`, and `agent_model_compare` for confirmed delivery, notification, reminder, media generation, and blind model comparison review/judgment.
- `agent` for visible autonomous work: spawn, batch-spawn, inspect, message, wait, cancel, and report tracked agents. Use `agent_harness mode:"agent_orchestration"` first when deciding whether subagents are useful, reviewing managed milestones, or checking existing agent state.

Registered model tool definitions are compact by default. Top-level descriptions are short, nested parameter descriptions are omitted from the default model catalog, and tool catalog rows include direct harness inspection routes. The model can inspect detailed contracts through `agent_harness mode:"tools"` with `includeParameters:true`, `mode:"tool"`, or the owning harness mode.

## Local Behavior

VIBE.md is the friendly personality file for GoodVibes Agent. Project and global VIBE.md files are discovered, scanned for secret-looking content, surfaced in setup and the learning curator when blocked or truncated, and applied to the serial Agent conversation without requiring persona-registry ceremony. The direct `vibe` tool exposes status/show plus confirmed init and persona import, while `/vibe` remains the visible command surface. Formal Agent-local memory, notes, personas, skills, routines, and profiles remain stored under the Agent home and are injected only into the serial Agent conversation unless an explicit Agent workflow promotes or ingests reviewed material elsewhere.

Project context files are separate from personality. GoodVibes Agent loads secret-scanned workspace instructions from `.hermes.md`, `HERMES.md`, `AGENTS.md`, `CLAUDE.md`, optional `HERMES_HOME/SOUL.md`, `.cursorrules`, and `.cursor/rules/*.mdc`, with target-aware discovery for subdirectory `AGENTS.md` files. These instructions can shape project work, but explicit user requests, tool contracts, confirmation gates, and safety rules override them.

Useful workspace paths:

- Memory & Skills -> Memory posture, Create memory, Create note, or Capture learned behavior.
- Notes -> Create, edit, review, stale, delete, or promote scratchpad notes.
- Personas -> Inspect, create, show, or import VIBE.md; create, inspect, activate, review, stale, or delete local personas.
- Skills -> Create skills, import discovered skills, enable/disable, review, delete, and manage skill bundles.
- Routines -> Create routines, start a routine in chat, review receipts, and explicitly promote one routine to a connected schedule.
- Profiles -> Create isolated Agent profiles from built-in or imported starter templates, with opt-in VIBE.md portability through `--include-vibe`.

Starting a routine prints its steps in the main conversation. Promotion to a connected schedule or automation job is separate, explicit, confirmation-gated, visible in the autonomy queue, and records a redacted local receipt.

## Knowledge And Artifacts

Agent Knowledge is its own product segment. Agent uses only:

```text
/api/goodvibes-agent/knowledge/*
```

Agent does not fall back to default knowledge or other product-specific knowledge routes. Successful connected-host responses normalize public Agent-route scope aliases before checking for non-Agent contamination.

The Knowledge workspace and model tools support status, ask/search, source/node/issue lists, item lookup, map review, connector inspection, URL/file/URL-list/bookmark/browser-history/connector ingest, issue review, prompt packet/explain previews, consolidation, review queue, and reindex.

Artifacts are first-class runtime objects for uploaded files, generated media, and delegated outputs. Saved artifacts can be browsed, previewed, attached to drafts, promoted to Agent Knowledge, or exported to workspace files after confirmation. Generated media is stored as GoodVibes artifacts and reported by artifact id and metadata, not inline base64.

## Connected Host

Connect Agent to a GoodVibes daemon before using daemon-backed features. The default connection is:

```text
http://127.0.0.1:3421
```

Use `--runtime-url http://host:port` for one launch or `GOODVIBES_AGENT_RUNTIME_URL=http://host:port` for a shell/session override. `GOODVIBES_AGENT_BASE_URL` is accepted as a legacy alias. These only change the connection target.

Agent reports unavailable, unauthenticated, or incompatible host state from Agent Workspace -> Home through Host compatibility, Doctor diagnostics, and Review health. Scriptable mirrors are `goodvibes-agent status`, `goodvibes-agent doctor`, and `goodvibes-agent compat`.

Model-visible diagnostics are read-only:

- `host action:"services|service"` exposes endpoint binding, network-facing posture, issues, optional probes, and redacted log tail.
- `host action:"capabilities|capability"` exposes compact posture maps, allowed capabilities, blocked lifecycle/non-Agent surfaces, route families, and first-class tool availability.
- `host action:"status"` runs live readiness checks for host status, host compatibility, token posture, endpoint binding, isolated Agent Knowledge readiness, and the model route to inspect or act on findings.
- `setup action:"repair"` selects the next safe setup repair route without executing it: token repair, connected-host status, services.status receipt, user-run bootstrap commands, or no lifecycle action when the host is reachable.

Service lifecycle and listener changes are available only through explicit setup or confirmed daemon operator routes when the connected daemon supports them. Raw danger toggles stay protected.

## Product Boundary

GoodVibes Agent owns the autonomous assistant harness: the terminal renderer, setup UX, chat, local behavior libraries, Agent Knowledge routes, companion chat, visible agents, work plans, schedules, approvals, channel/media/reminder tools, daemon method access, and user-facing autonomy status.

GoodVibes TUI remains the vibecoding harness and is still useful when the user wants its execution-isolation UX. Agent should use local tools, visible agents, daemon automation, delegation, or remote runners according to what best serves the user, not because package boundaries are exposed as product friction.

## Package Docs

- [Docs Index](docs/README.md)
- [Getting Started](docs/getting-started.md)
- [Connected Host](docs/connected-host.md)
- [Knowledge, Artifacts, and Multimodal](docs/knowledge-artifacts-and-multimodal.md)
- [Tools and Commands](docs/tools-and-commands.md)
- [Channels, Remote Access, and API](docs/channels-remote-and-api.md)
- [Providers and Routing](docs/providers-and-routing.md)
- [Voice and Live TTS](docs/voice-and-live-tts.md)
- [Release And Publishing](docs/release-and-publishing.md)
