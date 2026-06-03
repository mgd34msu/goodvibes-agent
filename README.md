# GoodVibes Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Status: 1.0.x](https://img.shields.io/badge/status-1.0.x-green.svg)](#install)

GoodVibes Agent is the personal operator assistant TUI for GoodVibes. It is built for day-to-day operator work: chat, setup, local profiles, routines, skills, personas, isolated Agent Knowledge, status review, approvals, automation visibility, and explicit build delegation.

The Agent product connects to a GoodVibes host owned outside this package. It does not install, start, stop, restart, or own that host.

Most work happens in the interactive TUI. The installed CLI exists to launch that TUI and provide scriptable mirrors for workflows that are already reachable from the workspace. The main Agent model can inspect the same harness surface through Agent-owned tools: workspace actions, built-in panels, modal/overlay/picker UI surfaces, top-level CLI mirrors, fixed shortcuts, configurable keybindings, slash commands, command policy metadata, settings, model tools, local registries, connected-host capability boundaries, and live connected-host readiness are all discoverable from the conversation without exposing connected-host lifecycle control.

## Install

Install the current `1.0.x` package with Bun:

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent
```

If `goodvibes-agent` is not found after installation, add Bun's global bin directory to `PATH`:

```sh
export PATH="$(bun pm bin -g):$PATH"
goodvibes-agent --help
```

`goodvibes-agent` starts the interactive Agent TUI. On a fresh Agent home, the TUI opens Agent setup first.

## Source Usage

```sh
git clone https://github.com/mgd34msu/goodvibes-agent.git
cd goodvibes-agent
bun install
bun run dev
```

Useful checks:

```sh
bun run typecheck
bun run build
bun run package:install-check
bun run publish:check
```

After setup has been applied once, the Agent TUI opens directly into the operator workspace. You can also reopen it with `/agent`, `/home`, or `/operator`. It is the Agent-first fullscreen workspace for setup, conversation/session controls, model/provider selection, isolated Agent Knowledge, local memory/notes/skills/routines/personas, channel readiness, voice/media setup, work-plan/approval review, automation observability, and explicit build delegation to GoodVibes TUI.

Use the workspace as the primary product surface:

- Home: normal assistant chat, operator briefing, model selection, setup, and health.
- Conversation: context usage, inline `@file`/`@folder`/`@url` references, compaction, title/session save/load/search/export, transcript search, bookmarks, paste/image/TTS helpers, undo/redo/retry, clear/reset, shortcuts, and keybindings.
- Research: read-only web research, URL inspection, source triage, and explicit handoff into isolated Agent Knowledge when a source should become durable.
- Artifacts: image attachment, conversation/session export, source-file ingest, source lookup, bookmark/browser-history import, and generated media artifact handling.
- Setup: provider/model, compatibility, Agent Knowledge readiness, profiles, support bundles, subscriptions, and auth review.
- Tools & MCP: MCP server setup, tool inventory, trust review, secret storage/link/test/delete, and settings.
- Knowledge: isolated Agent Knowledge status, ask/search, URL/URL-list/file/bookmark/browser-history/connector ingest, source library, review queue, and reindex.
- Memory & Skills: local memory, scratchpad notes, learned behavior capture, personas, skills, routines, and schedule promotion.
- Notes: Agent-local scratchpad for source triage, temporary decisions, and operator handoff. Notes do not become memory or Agent Knowledge unless you explicitly promote or ingest something; reviewed notes can prefill memory, skills, routines, personas, or an isolated Agent Knowledge URL ingest.
- Channels: companion pairing, channel readiness, confirmed channel delivery, and confirmed webhook add/remove/test/send.
- Voice & Media: voice review, spoken response setup, image input, confirmed image/video generation, browser-tool posture, MCP inventory, and media provider readiness.
- Automation: reminder creation, schedule status, routine promotion, receipts, reconciliation, and explicitly confirmed approve/deny/cancel/run/pause/resume/retry actions.
- Build Delegation: explicit handoff to GoodVibes TUI for build/fix/review work.

Inside the Agent workspace, press `/` to search every workspace action by name, category, command, or detail. This is the primary discovery path for product actions; slash commands and CLI subcommands remain power-user/scriptable mirrors.

The model has the same harness map through `agent_harness`: it can list Agent workspace actions, list built-in panels and their workspace routes, inspect modal/overlay/picker UI surfaces, list top-level CLI mirrors, inspect fixed shortcuts and configurable keybindings, list slash commands, inspect command policy metadata, inspect model tool definitions, inspect or change Agent settings with confirmation, run concrete workspace or slash-command mirrors with confirmation, and report connected-host capability and live readiness posture. CLI mirror modes are read-only catalog and parser inspection; inside the main conversation, the model uses the returned preferred model tool, workspace action, setting mode, or confirmed slash-command mirror instead of launching hidden nested CLI processes. Panel modes expose catalog/open state and route visible panel/workspace changes through the current Agent shell bridge with confirmation. UI surface modes expose help, shortcuts, context, bookmarks, model/provider pickers, session/profile pickers, settings, MCP workspace, onboarding, and Agent workspace entrypoints; `open_ui_surface` is confirmation-gated and only performs visible shell navigation. Shortcut modes expose fixed runtime/editor controls plus the live resolved keybinding table; `set_keybinding` and `reset_keybinding` write the same `keybindings.json` file the user edits and require confirmation. Workspace action discovery can inline editor field schemas with `includeParameters:true`; profile editors use the current starter-template inventory, and routine schedule editors can prefill a selected local routine from `recordId`. Selection-based local workspace actions accept a local `recordId` so the model can use the same note promotion and local registry flows as the TUI. The `connected_host` report includes route families, allowed capabilities, blocked lifecycle/non-Agent surfaces, and availability for the first-class Agent tools. The `connected_host_status` report performs a read-only live check of the connected-host status route and the isolated Agent Knowledge status route, reports SDK compatibility, token posture, endpoint bindings, route readiness, and actionable findings, and still refuses connected-host lifecycle control. The model uses those first-class tools for product workflows where they exist, such as Agent Knowledge, local memory/notes/personas/skills/routines, channel sends, notifications, reminders, media generation, work plans, and connected-host operator actions.

The setup workspace surfaces discovered Agent-local persona, skill, and routine markdown files so day-one setup can import useful behavior instead of starting from blank records. It can also create one initial scratchpad note, local persona, skill, and routine directly during first-run setup; those records stay in Agent-local registries and never write to default knowledge or non-Agent segments.

In the Profiles workspace, choose Starter authoring guide to author custom profile starters without leaving the Agent TUI. The guided flow lists starters, exports starter JSON, imports edited local starters, and creates isolated Agent profiles from them.

Use the Profiles workspace form to turn reviewed discovered persona, skill, and routine files into a local starter template and isolated Agent profile in one confirmed flow. The scriptable equivalent is `profiles create-from-discovered <name> --yes`; `profiles templates from-discovered <id> --yes` is still available when you only want to save the starter first.

The Knowledge area includes an in-workspace URL ingest form. It writes only to Agent Knowledge, requires typed confirmation, and dispatches the existing isolated `/knowledge ingest-url ... --yes` route.

The Research workspace submits web research and URL inspection requests back to the normal Agent conversation. These requests can use connected read-only web tools when the user asks, but they do not ingest sources into Agent Knowledge. Use the separate confirmed Agent Knowledge ingest actions when a reviewed source should become durable.

The Voice & Media workspace includes `Generate media`, a confirmed form for image/video generation through configured media providers. Generated bytes are stored as GoodVibes artifacts and the transcript shows artifact ids, not inline base64. The power-user mirror is `/media generate [--provider <id>] [--model <id>] [--mime <mime>] <prompt> --yes`; `/media providers` lists readiness.

Use isolated Agent profiles when one machine needs separate operator identities or local state. In the TUI, open Agent Workspace -> Profiles to browse starters, create a profile, use it as the default for the next launch, clear the default, and export/import starter JSON. The same profile selection is available for one launch with `goodvibes-agent --agent-profile <name>`.

Profiles isolate Agent-local config, sessions, local memory, scratchpad notes, personas, skills, routines, and setup state. First-run setup seeds new profiles from a built-in starter by default unless you explicitly choose `No profile`. Starter templates seed local personas, skills, and routines for household, research, travel, operations, and personal productivity profiles; exported starter JSON can be edited and re-imported as a local starter. The connected GoodVibes host remains shared unless that host is separately configured otherwise.

The installed CLI mirrors the same local behavior libraries for scripts and automation, but it is not the primary product path. Personas, skills, memory, and routines are created, reviewed, enabled, exported/imported where relevant, and deleted from the TUI workspace first; destructive actions still require explicit confirmation.

The Agent workspace also has a `Capture learned behavior` form. Use it after reviewing a repeated workflow, lesson, or operating style; it saves one local skill, routine, or persona directly from the TUI and does not write to connected-host routes or non-Agent knowledge.

When the user explicitly asks, the main assistant conversation can perform the same narrow operator actions exposed by the TUI: approve/deny/cancel a named approval, run/pause/resume a named automation job, cancel/retry a named automation run, or run a named schedule. These actions require explicit confirmation, use only public connected-host operator routes, and do not create, edit, or delete automation definitions.

When the user explicitly asks the model to operate the harness itself, it should use Agent-owned harness tools rather than generic SDK settings or context mutators. Setting writes, slash-command invocation, workspace action invocation, local record deletion, external delivery, media generation, reminder scheduling, and connected-host operator actions remain confirmation-gated.

Agent-local behavior is editable from the TUI workspace:

- Agent Workspace -> Personas: create, inspect, activate, review, stale, and delete local personas.
- Agent Workspace -> Skills: create skills, import discovered skills, enable or disable them, and manage skill bundles.
- Agent Workspace -> Routines: create routines, start a routine in the main conversation, review receipts, and explicitly promote one routine to a connected schedule.
- Agent Workspace -> Work: review the visible local work plan, add work items, and update status from the TUI while the main assistant conversation can keep the same plan current.
- Agent Workspace -> Memory & Skills: create memory, search memory, review/stale/delete records, export/import bundles, and rebuild the local vector index.
- Agent Workspace -> Notes: create, edit, review, stale, delete, and promote Agent-local scratchpad notes into memory, skills, routines, or personas.
- Agent Workspace -> Channels: inspect readiness, pair companion clients, send one confirmed channel delivery message, and manage or send configured notification targets with confirmation.

Slash commands remain available inside the TUI for power users, but the fullscreen Agent workspace is the primary path for these workflows.

Starting a routine records local usage and prints its steps in the main conversation; it does not start background automation. Promotion to a connected schedule is separate and explicit: it calls the public `schedules.create` route only after `--yes`, can include explicit delivery targets such as `--delivery-channel slack`, records a redacted local receipt, and the generated scheduled prompt keeps Agent Knowledge isolated from default knowledge and non-Agent knowledge segments. Use `/schedule reconcile` to compare those local receipts against live connected schedules through public `schedules.list`.

Use `/channels` inside the TUI for channel readiness and exact confirmed sends. Readiness views show enabled channels, missing config key names, delivery posture, and risk labels without sending messages or rendering token values. Companion pairing is QR-first; `/pair` hides the raw token in text, and manual token display requires `/pair --show-token --yes`. `/channels send --channel <surface[:route[:label]]> --message <text> --yes` sends one explicit delivery through configured strategies.

## Connected Host

Start the owning GoodVibes host before launching Agent. Agent status and companion/knowledge routes normally connect on `http://127.0.0.1:3421`.

Use `--runtime-url http://host:port` for a one-off launch, or set `GOODVIBES_AGENT_RUNTIME_URL=http://host:port` when the connected host is not on the default local port. The legacy `GOODVIBES_AGENT_BASE_URL` env var is also accepted as an alias. These only change the connection target; Agent still does not host or start it.

Agent reports unavailable, unauthenticated, or incompatible connected-host state from Agent Workspace -> Home through Host compatibility, Doctor diagnostics, and Review health. `goodvibes-agent status`, `goodvibes-agent doctor`, and `goodvibes-agent compat` are scriptable mirrors for install checks. The model-visible `agent_harness` mode `connected_host_status` exposes the same live readiness posture from the conversation without printing token values or exposing host lifecycle operations. Host lifecycle stays outside the Agent product.

## Product Boundary

GoodVibes Agent owns the operator assistant TUI: serial assistant flow, proactive safe actions, local memory/notes/routines/skills/personas, Agent Knowledge routes, companion chat, approvals/automation observability, and explicit build delegation.

Agent Knowledge is its own product segment. Agent uses `/api/goodvibes-agent/knowledge/*` and must not fall back to default knowledge or other product-specific knowledge routes.

Agent Workspace -> Knowledge can ask/search, inspect sources/nodes/issues, inspect connectors, ingest URL/file/bookmark/browser-history/connector input, and reindex the Agent segment. CLI commands mirror those same isolated Agent Knowledge workflows for scripts. Confirmed mutations require explicit confirmation.

GoodVibes TUI owns coding execution: file edits, git/worktree workflows, coding panels, execution isolation UX, and delegated review execution. Agent may delegate explicit build/fix/review work to TUI through public runtime/session contracts; normal assistant chat must not use shared coding sessions.

## Package Docs

Package-facing docs:

- [Getting Started](docs/getting-started.md)
- [Connected Host](docs/connected-host.md)
- [Knowledge, Artifacts, and Multimodal](docs/knowledge-artifacts-and-multimodal.md)
- [Tools and Commands](docs/tools-and-commands.md)
- [Channels, Remote Access, and API](docs/channels-remote-and-api.md)
- [Providers and Routing](docs/providers-and-routing.md)
- [Voice and Live TTS](docs/voice-and-live-tts.md)
- [Project Planning](docs/project-planning.md)
- [Release And Publishing](docs/release-and-publishing.md)

The package-facing Agent documentation is limited to the docs listed above.
