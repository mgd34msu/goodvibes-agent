# GoodVibes Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Status: 1.0.x](https://img.shields.io/badge/status-1.0.x-green.svg)](#install)

GoodVibes Agent is the installable autonomous operator assistant for GoodVibes. It keeps the existing terminal renderer and workspace bones, but the product goal is different from a vibecoding harness: the user should experience one assistant that can chat, plan, remember, research, schedule, send, generate, run visible agents, and operate the GoodVibes daemon contract with clear confirmation gates.

The GoodVibes daemon is Agent's capability runtime. It provides the operator API, schedules, channels, knowledge, media, remote execution, service posture, and long-running automation routes. Agent keeps GoodVibes settings import so users can bring over providers, UI preferences, permissions, subscriptions, surfaces, tools, and daemon endpoint settings instead of rebuilding setup by hand.

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
- Documents & Compare: versioned document drafting, uploads, exports, source checks, generated media artifacts, artifact browsing/export, artifact reuse, and confirmed blind model comparison with delayed reveal, durable JSON comparison artifacts, saved review boards, saved judgment artifacts, saved preference analytics, markdown report export, and confirmed winner route updates.
- Artifacts: image attachment, conversation/session export, source-file ingest, source lookup, bookmark/browser-history import, and generated media artifacts.
- Personal Ops: inbox/calendar connector readiness, notes, work plans, host tasks, reminders, routines, schedules, and delivery readiness in one daily operations area.
- Setup: provider/model, compatibility, Agent Knowledge readiness, profiles, support bundles, subscriptions, and auth review.
- Tools & MCP: MCP server setup, tool inventory, trust review, secrets, and settings.
- Knowledge: isolated Agent Knowledge status, ask/search, source/node/issue libraries, item lookup, map review, connectors, ingest, review queue, and reindex.
- Memory & Skills: local memory, scratchpad notes, learned behavior capture, personas, skills, routines, and schedule promotion.
- Channels: companion pairing, channel readiness, confirmed channel delivery, and confirmed webhook notification management.
- Voice & Media: voice review, spoken response setup, image input, confirmed image/video generation, browser-tool posture, and provider readiness.
- Automation: reminders, schedules, visible autonomous agents, routine promotion receipts, reconciliation, and exact confirmed approval/automation/schedule actions.
- Operator Runtime: full GoodVibes daemon method discovery, read-only status routes, confirmed write/admin routes, and service posture.

Press `/` inside the workspace to search actions by name, category, command, or detail. Slash commands and CLI subcommands remain power-user/scriptable mirrors; the workspace is the first-class user path.

## Model-Visible Harness

The main Agent model can inspect and operate the Agent-controlled harness through Agent-owned tools. The important entrypoint is `agent_harness`.

`agent_harness mode:"summary"` is compact by default. It returns counts, status, and a short mode guide. `mode:"modes"` searches every harness mode by task, family, effect type, id, alias, or parameter name; `mode:"mode"` inspects one mode contract. Plural catalog modes are also compact by default: they return ids, labels, counts, safe state, effect class, and short route hints. `workspace_actions`, `commands`, `cli_commands`, `panels`, `ui_surfaces`, `shortcuts`, `keybindings`, `tools`, `settings`, connected-host posture/status/capability, and operator/audit rows include compact `modelRoute` or `modelAccess` hints so the model can choose the right first-class tool or confirmed harness route without expanding every row. Use `includeParameters:true` or a singular inspect mode when the model needs schemas, detailed route hints, full policy blocks, redacted log tail, operator/audit artifact data, or editor field definitions.

High-value `agent_harness` mode groups:

- Discovery: `modes`, `workspace_categories`, `workspace_actions`, `commands`, `cli_commands`, `panels`, `ui_surfaces`, `shortcuts`, `keybindings`, `tools`, `settings`.
- Single-item inspection: `mode`, `workspace_action`, `command`, `cli_command`, `panel`, `ui_surface`, `keybinding`, `tool`, `get_setting`.
- User-visible effects: `run_workspace_action`, `run_command`, `open_panel`, `open_ui_surface`, `run_keybinding`, `set_keybinding`, `reset_keybinding`, `set_setting`, `reset_setting`.
- Product posture: `channels`, `notifications`, `provider_accounts`, `mcp_servers`, `setup_posture`, `model_routing`, `personal_ops`, `document_ops`, `pairing_posture`, `delegation_posture`, `security_posture`, `support_bundles`, `media_posture`, `sessions`.
- Connected host: `service_posture`, `service_endpoint`, `connected_host`, `connected_host_status`, `connected_host_capability`; `daemon` and `daemon_status` are aliases for connected-host posture/status.
- Operator/audit inspection: `release_evidence`, `release_evidence_artifact`, `release_readiness`, `release_readiness_item`.
- Operator methods: `operator_methods`, `operator_method`.

Every mutating or externally visible effect requires `confirm:true` plus `explicitUserRequest` unless a narrower first-class tool has its own confirmation contract. Ambiguous lookups return candidates instead of guessing.

First-class model tools cover common workflows directly:

- `agent_knowledge` and `agent_knowledge_ingest` for isolated Agent Knowledge reads and confirmed ingest.
- `agent_local_registry` for Agent-local memory, notes, personas, skills, bundles, and routines.
- `agent_work_plan` for visible local work-plan tracking.
- `agent_operator_briefing` and `agent_operator_action` for connected work/approval/automation/schedule posture and exact confirmed actions.
- `agent_operator_method` for exact GoodVibes daemon contract parity. Read-only routes can run directly; write/admin routes require `confirm:true` and `explicitUserRequest`.
- `agent_channel_send`, `agent_notify`, `agent_reminder_schedule`, `agent_media_generate`, and `agent_model_compare` for confirmed delivery, notification, reminder, media generation, and blind model comparison review/judgment.
- `agent` for visible autonomous work: spawn, batch-spawn, inspect, message, wait, cancel, and report tracked agents.

Registered model tool definitions are compact by default. Top-level descriptions are short, nested parameter descriptions are omitted from the default model catalog, and tool catalog rows include direct harness inspection routes. The model can inspect detailed contracts through `agent_harness mode:"tools"` with `includeParameters:true`, `mode:"tool"`, or the owning harness mode.

## Local Behavior

Agent-local memory, notes, personas, skills, routines, and profiles are stored under the Agent home. They are injected only into the serial Agent conversation unless an explicit Agent workflow promotes or ingests reviewed material elsewhere.

Useful workspace paths:

- Memory & Skills -> Create memory, Create note, or Capture learned behavior.
- Notes -> Create, edit, review, stale, delete, or promote scratchpad notes.
- Personas -> Create, inspect, activate, review, stale, or delete local personas.
- Skills -> Create skills, import discovered skills, enable/disable, review, delete, and manage skill bundles.
- Routines -> Create routines, start a routine in chat, review receipts, and explicitly promote one routine to a connected schedule.
- Profiles -> Create isolated Agent profiles from built-in or imported starter templates.

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

- `service_posture` and `service_endpoint` expose endpoint binding, network-facing posture, issues, optional probes, and redacted log tail.
- `connected_host` and `daemon` are compact posture maps by default with direct `modelRoute` hints; `includeParameters:true` adds route families, allowed capabilities, blocked lifecycle/non-Agent surfaces, and first-class tool availability. `connected_host_capability` inspects one capability and returns the matching allowed or blocked route hint.
- `connected_host_status` and `daemon_status` run live readiness checks for host status, host compatibility, token posture, endpoint binding, isolated Agent Knowledge readiness, and the model route to inspect or act on findings.

Service lifecycle and listener changes are available only through explicit setup or confirmed daemon operator routes when the connected daemon supports them. Raw danger toggles stay protected.

## Product Boundary

GoodVibes Agent owns the autonomous assistant harness: the terminal renderer, setup UX, chat, local behavior libraries, Agent Knowledge routes, companion chat, visible agents, work plans, schedules, approvals, channel/media/reminder tools, daemon method access, and user-facing autonomy status.

GoodVibes TUI remains the vibecoding harness and is still useful when the user wants its coding panels or execution-isolation UX. Agent should use local tools, visible agents, daemon automation, delegation, or remote runners according to what best serves the user, not because package boundaries are exposed as product friction.

## Package Docs

- [Docs Index](docs/README.md)
- [Getting Started](docs/getting-started.md)
- [Connected Host](docs/connected-host.md)
- [Knowledge, Artifacts, and Multimodal](docs/knowledge-artifacts-and-multimodal.md)
- [Tools and Commands](docs/tools-and-commands.md)
- [Channels, Remote Access, and API](docs/channels-remote-and-api.md)
- [Providers and Routing](docs/providers-and-routing.md)
- [Voice and Live TTS](docs/voice-and-live-tts.md)
- [Project Planning](docs/project-planning.md)
- [Release And Publishing](docs/release-and-publishing.md)
