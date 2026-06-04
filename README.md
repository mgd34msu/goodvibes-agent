# GoodVibes Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Status: 1.0.x](https://img.shields.io/badge/status-1.0.x-green.svg)](#install)

GoodVibes Agent is the installable personal operator assistant TUI for GoodVibes. It is built for day-to-day operator work: chat, setup, profiles, routines, skills, personas, Agent-local memory and notes, isolated Agent Knowledge, channel readiness, voice/media setup, work-plan tracking, approvals, automation visibility, and explicit build delegation.

Agent connects to a GoodVibes host owned outside this package. It does not install, start, stop, restart, expose, or own that host.

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
- Artifacts: image attachment, conversation/session export, source-file ingest, source lookup, bookmark/browser-history import, and generated media artifacts.
- Setup: provider/model, compatibility, Agent Knowledge readiness, profiles, support bundles, subscriptions, and auth review.
- Tools & MCP: MCP server setup, tool inventory, trust review, secrets, and settings.
- Knowledge: isolated Agent Knowledge status, ask/search, source/node/issue libraries, item lookup, map review, connectors, ingest, review queue, and reindex.
- Memory & Skills: local memory, scratchpad notes, learned behavior capture, personas, skills, routines, and schedule promotion.
- Channels: companion pairing, channel readiness, confirmed channel delivery, and confirmed webhook notification management.
- Voice & Media: voice review, spoken response setup, image input, confirmed image/video generation, browser-tool posture, and provider readiness.
- Automation: reminders, schedule status, routine promotion receipts, reconciliation, and exact confirmed approval/automation/schedule actions.
- Build Delegation: explicit handoff to GoodVibes TUI for build, fix, implementation, or review work.

Press `/` inside the workspace to search actions by name, category, command, or detail. Slash commands and CLI subcommands remain power-user/scriptable mirrors; the workspace is the first-class user path.

## Model-Visible Harness

The main Agent model can inspect and operate the same user-facing harness through Agent-owned tools. The important entrypoint is `agent_harness`.

`agent_harness mode:"summary"` is compact by default. It returns counts, status, and a short mode guide. Plural catalog modes are also compact by default: they return ids, labels, counts, safe state, and route hints. Use `includeParameters:true` or a singular inspect mode when the model needs schemas, detailed route hints, full policy blocks, redacted log tail, release artifact data, or editor field definitions.

High-value `agent_harness` mode groups:

- Discovery: `workspace_categories`, `workspace_actions`, `commands`, `cli_commands`, `panels`, `ui_surfaces`, `shortcuts`, `keybindings`, `tools`, `settings`.
- Single-item inspection: `workspace_action`, `command`, `cli_command`, `panel`, `ui_surface`, `keybinding`, `tool`, `get_setting`.
- User-visible effects: `run_workspace_action`, `run_command`, `open_panel`, `open_ui_surface`, `run_keybinding`, `set_keybinding`, `reset_keybinding`, `set_setting`, `reset_setting`.
- Product posture: `channels`, `notifications`, `provider_accounts`, `mcp_servers`, `setup_posture`, `model_routing`, `pairing_posture`, `delegation_posture`, `security_posture`, `support_bundles`, `media_posture`, `sessions`.
- Connected host: `service_posture`, `service_endpoint`, `connected_host`, `connected_host_status`, `connected_host_capability`; `daemon` and `daemon_status` are aliases for connected-host posture/status.
- Release evidence: `release_evidence`, `release_evidence_artifact`, `release_readiness`, `release_readiness_item`.
- Operator methods: `operator_methods`, `operator_method`.

Every mutating or externally visible effect requires `confirm:true` plus `explicitUserRequest` unless a narrower first-class tool has its own confirmation contract. Ambiguous lookups return candidates instead of guessing.

First-class model tools cover common workflows directly:

- `agent_knowledge` and `agent_knowledge_ingest` for isolated Agent Knowledge reads and confirmed ingest.
- `agent_local_registry` for Agent-local memory, notes, personas, skills, bundles, and routines.
- `agent_work_plan` for visible local work-plan tracking.
- `agent_operator_briefing` and `agent_operator_action` for connected work/approval/automation/schedule posture and exact confirmed actions.
- `agent_channel_send`, `agent_notify`, `agent_reminder_schedule`, and `agent_media_generate` for confirmed delivery, notification, reminder, and media generation.

## Local Behavior

Agent-local memory, notes, personas, skills, routines, and profiles are stored under the Agent home. They are injected only into the serial Agent conversation unless an explicit Agent workflow promotes or ingests reviewed material elsewhere.

Useful workspace paths:

- Memory & Skills -> Create memory, Create note, or Capture learned behavior.
- Notes -> Create, edit, review, stale, delete, or promote scratchpad notes.
- Personas -> Create, inspect, activate, review, stale, or delete local personas.
- Skills -> Create skills, import discovered skills, enable/disable, review, delete, and manage skill bundles.
- Routines -> Create routines, start a routine in chat, review receipts, and explicitly promote one routine to a connected schedule.
- Profiles -> Create isolated Agent profiles from built-in or imported starter templates.

Starting a routine prints its steps in the main conversation. It does not start background automation. Promotion to a connected schedule is separate, explicit, confirmation-gated, and records a redacted local receipt.

## Knowledge And Artifacts

Agent Knowledge is its own product segment. Agent uses only:

```text
/api/goodvibes-agent/knowledge/*
```

Agent does not fall back to default knowledge or other product-specific knowledge routes. Successful connected-host responses are checked for scope contamination before rendering.

The Knowledge workspace and model tools support status, ask/search, source/node/issue lists, item lookup, map review, connector inspection, URL/file/URL-list/bookmark/browser-history/connector ingest, review queue, and reindex.

Artifacts are first-class runtime objects for uploaded files, generated media, and delegated outputs. Generated media is stored as GoodVibes artifacts and reported by artifact id and metadata, not inline base64.

## Connected Host

Start the owning GoodVibes host before launching Agent. The default connection is:

```text
http://127.0.0.1:3421
```

Use `--runtime-url http://host:port` for one launch or `GOODVIBES_AGENT_RUNTIME_URL=http://host:port` for a shell/session override. `GOODVIBES_AGENT_BASE_URL` is accepted as a legacy alias. These only change the connection target.

Agent reports unavailable, unauthenticated, or incompatible host state from Agent Workspace -> Home through Host compatibility, Doctor diagnostics, and Review health. Scriptable mirrors are `goodvibes-agent status`, `goodvibes-agent doctor`, and `goodvibes-agent compat`.

Model-visible diagnostics are read-only:

- `service_posture` and `service_endpoint` expose endpoint binding, network-facing posture, issues, optional probes, and redacted log tail.
- `connected_host` and `daemon` are compact posture maps by default; `includeParameters:true` adds route families, allowed capabilities, blocked lifecycle/non-Agent surfaces, and first-class tool availability. `connected_host_capability` inspects one capability.
- `connected_host_status` and `daemon_status` run live readiness checks for host status, SDK compatibility, token posture, endpoint binding, and isolated Agent Knowledge readiness.

Host lifecycle stays outside GoodVibes Agent.

## Product Boundary

GoodVibes Agent owns the operator assistant TUI, serial assistant flow, local behavior libraries, Agent Knowledge routes, companion chat, work-plan tracking, approvals/automation observability, channel/media/reminder tools, and explicit build delegation.

GoodVibes TUI owns coding execution: file edits, git/worktree workflows, coding panels, execution isolation UX, and delegated review execution. Agent may delegate explicit build/fix/review work; normal assistant chat does not use shared coding sessions.

## Package Docs

- [Getting Started](docs/getting-started.md)
- [Connected Host](docs/connected-host.md)
- [Knowledge, Artifacts, and Multimodal](docs/knowledge-artifacts-and-multimodal.md)
- [Tools and Commands](docs/tools-and-commands.md)
- [Channels, Remote Access, and API](docs/channels-remote-and-api.md)
- [Providers and Routing](docs/providers-and-routing.md)
- [Voice and Live TTS](docs/voice-and-live-tts.md)
- [Project Planning](docs/project-planning.md)
- [Release And Publishing](docs/release-and-publishing.md)
