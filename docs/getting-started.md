# Getting Started

GoodVibes Agent is the installable `1.0.x` personal operator assistant built on the GoodVibes TUI foundation.

## Requirements

- Bun `1.3.10` or newer
- A connected GoodVibes host compatible with `@pellux/goodvibes-sdk@0.33.36`
- A token/config path accepted by the connected host

Agent does not launch the connected host for you.

Use the interactive TUI first. CLI subcommands are secondary support paths for install checks, setup inspection, and scriptable mirrors of workflows that are already reachable from the workspace.

## Install From Package

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent
```

If the installed command is not found, add Bun's global bin directory to `PATH`:

```sh
export PATH="$(bun pm bin -g):$PATH"
goodvibes-agent --help
```

## Run From Source

```sh
git clone https://github.com/mgd34msu/goodvibes-agent.git
cd goodvibes-agent
bun install
bun run dev
```

`bun run dev` starts the Agent TUI. The same entrypoint backs the installed `goodvibes-agent` command.

`goodvibes-agent` starts the interactive Agent TUI. On a fresh Agent home, the TUI opens Agent setup first.

After setup has been applied once, the TUI opens directly into the Agent operator workspace. You can also reopen it with `/agent`, `/home`, or `/operator`. That fullscreen workspace is the current front door for setup/config, conversation/session controls, provider/model selection, read-only web research, Agent Knowledge, local memory/notes/skills/routines/personas, channel readiness, voice/media setup, read-only work/approval/automation views, and explicit GoodVibes TUI build delegation.

Press `/` inside the Agent workspace to search every workspace action by name, category, command, or detail. Use that finder before reaching for shell commands; CLI subcommands are scriptable mirrors of these TUI workflows.

The model can inspect and use the same harness surface through Agent-owned tools. `agent_harness` exposes workspace category discovery, workspace action discovery, single workspace-action inspection and execution by action id, command, or lookup text, built-in panel discovery/routing by panel id or lookup text, modal/overlay/picker UI surface discovery/routing by surface id or lookup text, top-level CLI mirror discovery and single-mirror lookup by command string, command token, or lookup text, fixed shortcut and configurable keybinding discovery, keybinding inspection/mutation by action id or lookup text, confirmation-gated shell-safe keybinding execution, slash-command discovery, single slash-command inspection by typed command or lookup text, concrete built-in command effect, boundary, and preferred-route policy metadata, single slash-command execution by typed command or lookup text with confirmation, channel readiness discovery and single-channel inspection by id or lookup text, redacted notification target discovery and single-target inspection by id or lookup text, provider account discovery and single-account inspection by provider id or lookup text, MCP server discovery and single-server inspection by id or lookup text, setup/onboarding posture discovery and single setup-item inspection by id or lookup text, provider/model routing discovery and single route-or-model inspection by id or lookup text, companion pairing posture discovery and single pairing-route inspection by id or lookup text, explicit build-delegation posture discovery and single delegation-route inspection by id or lookup text, redacted security posture discovery and single-finding inspection by id or lookup text, support/auth/trust/subscription/voice bundle route discovery and redacted existing-bundle inspection by path, voice/media readiness discovery and single-provider inspection by id or lookup text, session/bookmark posture discovery and single saved-session inspection by id or lookup text, compact model tool discovery with optional schema inlining and single-tool schema inspection, release evidence bundle discovery with summary, search, and single-artifact lookup, release-readiness inventory discovery with summary, search, and single-item lookup, settings catalog filtering plus inspection/mutation by key or lookup text, public operator method catalog and single-method inspection, service posture and single-endpoint inspection, connected-host capability inventory, single connected-host capability inspection, and live connected-host readiness posture.

CLI mirror modes are read-only catalog/parser inspection and point the model to the matching in-process tool, workspace action, setting mode, slash-command mirror, or current-conversation response route. Panel modes expose catalog/open state and route visible panel/workspace changes through the current Agent shell bridge with confirmation. UI surface modes expose help, shortcuts, command browser, conversation search, prompt-history search, slash-command mode, file picker, block actions, context, runtime activity, live process output, bookmarks, model/provider/reasoning-effort pickers, TTS provider/voice pickers, session/profile pickers, the panel-picker compatibility route, security/knowledge/subscription operator surfaces, settings, MCP workspace, onboarding, and Agent workspace entrypoints; `open_ui_surface` is confirmation-gated and only performs visible shell navigation. Shortcut modes expose the fixed runtime/editor shortcuts and the live keybindings table; keybinding descriptors include a model operation route, `run_keybinding` executes supported shell-safe equivalents only with confirmation, prompt-editor-only or terminal-selection shortcuts remain direct user interaction, and confirmed keybinding edits write the same `keybindings.json` file the user edits and reload the runtime manager.

Workspace action discovery can include editor field schemas with `includeParameters:true`, including starter-template defaults for profile creation and selected-routine defaults for routine schedule promotion when `recordId` is supplied; model tool discovery can include JSON schemas with `includeParameters:true`; channel readiness discovery can include target-shape hints with `includeParameters:true`; notification target discovery can include management-route hints with `includeParameters:true`; provider account discovery can include login/logout route hints with `includeParameters:true`; MCP server discovery can include per-server tool inventory with `includeParameters:true`; setup posture discovery can include model route hints with `includeParameters:true`; model routing discovery can include mutation-route hints with `includeParameters:true`; pairing posture discovery can include connected-host/channel route hints with `includeParameters:true`; delegation posture discovery can include delegation route hints with `includeParameters:true`; security posture discovery can include finding detail with `includeParameters:true`; support bundle route discovery can include route parameter hints with `includeParameters:true`; voice/media posture discovery can include model route hints with `includeParameters:true`; session discovery can include saved-session file paths and search snippets with `includeParameters:true`; release evidence discovery can include artifact source/data with `includeParameters:true`; release-readiness discovery can include source and quality detail with `includeParameters:true`; operator method discovery can include parameter hints with `includeParameters:true`; service posture discovery can include reachability probes and redacted log tail with `includeParameters:true`; every editor descriptor reports `modelExecution` route metadata, and single-action lookup and execution use the same user-facing search fields, return lookup metadata where the action result carries descriptors, and refuse ambiguous run requests with candidates.

Single-CLI-mirror, single-panel, single-surface, single-keybinding, single-slash-command, single-channel, single-notification-target, single-provider-account, single-MCP-server, single-setup-item, single-model-route-or-model, single-pairing-route, single-delegation-route, single-security-finding, single-support-bundle, single-voice-media-provider, single-saved-session, single-tool, single-release-evidence-artifact, single-release-readiness-item, single-operator-method, single-service-endpoint, single-setting, and single-connected-host-capability lookup use their catalog search fields, return lookup metadata where the result carries it, and refuse ambiguous route, schema, capability, or mutation requests with candidates; confirmed slash-command execution uses the same slash-command lookup and refuses ambiguous requests before any handler runs. Selection-based local workspace actions accept a local `recordId`, so the model can use the same note promotion and local registry flows as the TUI. Direct local create editors for memory, notes, personas, skills, and routines can execute from submitted fields through `run_workspace_action` and `agent_local_registry` with confirmation. Command-backed editor forms execute through the shared slash-command registry with confirmation, and web research/fetch forms return the main-conversation prompt for the model to use directly. First-class model tools cover the main product workflows directly: Agent Knowledge status/ask/search, source/node/issue lists, item lookup, map summary, connector list/detail/doctor, Agent Knowledge ingest, Agent-local memory/notes/personas/skills/routines, operator actions, notifications, channel sends, reminders, generated media, and work plans.

Use the Artifacts area for concrete files and generated output: attach images to prompts, export conversations or saved sessions, ingest local source files and URL lists into Agent Knowledge, import bookmarks or browser history, inspect source records, and generate media artifacts from confirmed prompts.

The setup workspace scans Agent-local behavior folders and shows importable persona, skill, and routine files before asking you to create blank records. It can also create one initial scratchpad note, local persona, skill, and routine from the setup form. Use the workspace action finder to search for local behavior discovery/import actions, preview files, then import reviewed records from the matching workspace.

Use the Profiles workspace Starter authoring guide to walk through starter-profile authoring. It lists built-in and local starters, exports a JSON starter for editing, imports the edited starter back into this Agent home, and creates isolated profiles from the result.

Use the Profiles workspace form to assemble a local starter template and isolated Agent profile from reviewed discovered persona, skill, and routine files. Scriptable profile commands mirror the same flow for automation; use them only when you intentionally want a shell-driven setup path.

Use the Knowledge area in that workspace to ingest source URLs, local files, URL-list files, bookmarks, browser history, and connector input without leaving the TUI. Every ingest path requires typed confirmation and writes only to the isolated Agent Knowledge segment.

Use the Voice & Media area to review media provider readiness, attach images to conversation prompts, and generate image/video artifacts from a confirmed form. Generated media stays in GoodVibes artifact storage and returns artifact ids for follow-up conversation or delegation; it is not written into default knowledge or non-Agent knowledge segments.

Use the Routines workspace receipt actions to review redacted local routine promotion history and reconcile those receipts with live connected schedules through public `schedules.list`. The `/schedule receipts` and `/schedule reconcile` commands are the power-user equivalents inside the TUI.

The local behavior libraries are configured in the TUI first:

- Memory & Skills -> Create memory, Create note, or Capture learned behavior.
- Notes -> Create note for source triage, temporary decisions, or operator handoff without writing memory or Agent Knowledge.
- Personas -> Create persona, Use selected, Review selected, or Delete selected.
- Skills -> Create skill, Create bundle, Enable selected, Review selected, or Delete selected.
- Routines -> Create routine, Start selected, Enable selected, Promote to schedule, review receipts, or run a confirmed connected schedule.
- Work -> Add work item, Review work plan, or Update work item status.

The installed CLI mirrors these libraries for scripts, but it is not the primary user workflow.

## Isolated Agent Profiles

Use a separate Agent home when you want isolated local state. The normal launch still opens the TUI:

```sh
GOODVIBES_AGENT_HOME=/path/to/agent-home goodvibes-agent
```

Use named Agent profiles for repeatable local identities from Agent Workspace -> Profiles. The workspace can browse starter templates, create isolated Agent profiles, set or clear the default profile for the next launch, and export/import starter JSON.

Scriptable equivalents for automation and setup scripts:

```sh
goodvibes-agent profiles templates
goodvibes-agent profiles create household --template household --yes
goodvibes-agent profiles use household --yes
goodvibes-agent
goodvibes-agent profiles templates export research ./research-starter.json --yes
goodvibes-agent profiles templates import ./research-starter.json --yes
goodvibes-agent --agent-profile household status
goodvibes-agent --agent-profile household
```

Named profiles isolate Agent-local config, sessions, memory, notes, personas, skills, routines, and setup state under a profile-specific home. `profiles use <name> --yes` makes one profile the default for the next plain `goodvibes-agent` launch; `--agent-profile <name>` still overrides it for one launch, and `profiles default clear --yes` returns plain launches to the base Agent home. First-run setup seeds new profiles from a built-in starter by default unless you explicitly choose `No profile`. Starter templates seed local personas, skills, and routines for household, research, travel, operations, and personal productivity profiles; exported starter JSON can be edited and re-imported as a local starter. They do not start or isolate the connected host by themselves.

## Local Memory, Personas, Routines, And Skills

Memory, notes, personas, routines, and reusable Agent skills are local to GoodVibes Agent. First-run setup, TUI workspace forms, and CLI commands all write them to Agent-local registries. They do not write into default knowledge or non-Agent knowledge segments.

Use `Capture learned behavior` in the Agent workspace after reviewing a repeated workflow, lesson, or operating style. It saves one local skill, routine, or persona from the TUI and does not call connected-host mutation routes.

Use Agent Workspace -> Research for web research and URL inspection. Research requests run in the normal main conversation, can use connected read-only web tools when you ask, and do not ingest sources. Use confirmed Agent Knowledge ingest actions only when a reviewed source should become durable Agent-owned knowledge.

Use Agent Workspace -> Notes for source triage and temporary context. Notes are a scratchpad: they are reviewable local records, but they do not become durable memory or Agent Knowledge unless you explicitly promote them into memory/skills/routines/personas or run a confirmed Agent Knowledge ingest action. A reviewed note with a source URL can prefill the Agent Knowledge URL ingest form so you do not have to copy the URL by hand.

Day-one local behavior setup should stay in the fullscreen workspace:

- Personas -> Create persona, then Use selected.
- Routines -> Create routine, Start selected, or Promote to schedule after entering real timing and confirmation.
- Skills -> Create skill, Enable selected, and review setup requirements.
- Memory & Skills -> Create memory, Create note, or Search memory.
- Channels -> inspect readiness, send one explicit channel delivery message, add notification targets, and send notification messages only through confirmed actions.

Typed slash commands are available for repeat users, but they are not required for the first-run workflow.

The active persona plus enabled Agent routines, reviewed memory, and skills are injected into the main serial assistant conversation. Starting a routine records local usage and prints its steps in the main conversation; it does not start background automation. Promoting a routine to a schedule is an explicit `schedules.create` call, requires `--yes`, writes a local redacted promotion receipt, and preserves the rule that Agent Knowledge never falls back to default knowledge or non-Agent knowledge segments.

Use `/channels` inside the TUI for channel readiness and exact confirmed sends. Readiness views show enabled channels, missing config key names, delivery posture, and risk labels without sending messages or rendering token values. The model can inspect the same readiness map through `agent_harness` modes `channels` and `channel`; delivery still goes through `agent_channel_send` only after an explicit user request. Notification target posture is similarly available through `agent_harness` modes `notifications` and `notification_target`, with webhook values redacted; delivery still goes through `agent_notify` only after an explicit user request. Companion pairing is QR-first; `/pair` hides the raw token in text, and manual token display requires `/pair --show-token --yes`. `/channels send --channel <surface[:route[:label]]> --message <text> --yes` sends one explicit delivery through configured strategies.

The main assistant conversation can perform narrow confirmed operator actions when the user explicitly asks for a specific target: approve/deny/cancel one approval, run/pause/resume one automation job, cancel/retry one automation run, or run one schedule. Those calls use only public connected-host routes, require confirmation, and do not create, edit, or delete automation definitions.

When the main assistant conversation needs to change Agent settings, inspect/change/run supported Agent keybindings, open a visible UI surface, or run a user-facing harness action, it should use `agent_harness` rather than generic SDK context/settings tools. Panel, UI surface, keybinding, and setting descriptors report lookup metadata when resolved from `target` or `query`; ambiguous route or mutation requests return candidates instead of guessing. Settings catalog discovery accepts `category`, `prefix`, `query`, `includeHidden:true`, and `limit`, and setting descriptors also report writability, workspace visibility, and lock reasons. Keybinding descriptors report fixed shortcuts, resolved bindings, defaults, custom state, config path, and model-operation route; unsupported prompt-editor-only shortcuts stay direct user interaction instead of hidden model operations. UI surface descriptors report the visible shell opener, preferred model route, and confirmation policy; secret-backed settings store raw values through the secret manager; connected-host lifecycle settings stay read-only in Agent; and destructive local record deletion requires explicit confirmation.

## Connected GoodVibes Host

Start the owning GoodVibes host before using connected Agent features. Agent expects that host to expose the public operator/Agent routes, including:

- `GET /status`
- `GET /api/goodvibes-agent/knowledge/status`
- `POST /api/goodvibes-agent/knowledge/ask`
- `POST /api/goodvibes-agent/knowledge/search`
- `GET /api/goodvibes-agent/knowledge/sources`
- `GET /api/goodvibes-agent/knowledge/nodes`
- `GET /api/goodvibes-agent/knowledge/issues`
- `GET /api/goodvibes-agent/knowledge/items/{id}`
- `GET /api/goodvibes-agent/knowledge/map`
- `GET /api/goodvibes-agent/knowledge/connectors`
- `GET /api/goodvibes-agent/knowledge/connectors/{id}`
- `GET /api/goodvibes-agent/knowledge/connectors/{id}/doctor`
- `POST /api/goodvibes-agent/knowledge/ingest/url`
- `POST /api/goodvibes-agent/knowledge/ingest/artifact`
- `POST /api/goodvibes-agent/knowledge/ingest/urls`
- `POST /api/goodvibes-agent/knowledge/ingest/bookmarks`
- `POST /api/goodvibes-agent/knowledge/ingest/browser-history`
- `POST /api/goodvibes-agent/knowledge/ingest/connector`
- `POST /api/goodvibes-agent/knowledge/reindex`

If the GoodVibes API is not on `http://127.0.0.1:3421`, pass `--runtime-url http://host:port` for a one-off TUI launch or set `GOODVIBES_AGENT_RUNTIME_URL=http://host:port` before launching the TUI.

Agent Knowledge is an Agent-owned product segment. Agent commands must not fall back to default knowledge or other product-specific knowledge spaces. Successful responses that expose default-scope metadata are treated as scope contamination and fail closed.

Host lifecycle commands are not part of GoodVibes Agent. Use Agent Workspace -> Home -> Host compatibility, Doctor diagnostics, and Review health for diagnostics. CLI status/doctor/compat commands are scriptable mirrors for install checks. The model-visible `service_posture` harness report exposes the same read-only endpoint binding, network-facing posture, issue, and redacted-log diagnostics used by status, doctor, and support bundles; `service_endpoint` inspects one endpoint by `endpointId`, `target`, or `query`. The model-visible `connected_host` harness report lists usable Agent route families, first-class tool capabilities, and blocked lifecycle/non-Agent surfaces. `connected_host_capability` inspects one allowed or blocked connected-host capability and returns the matching route families, first-class tools, and boundary reason. The model-visible `connected_host_status` report performs the live read-only connected-host status and isolated Agent Knowledge readiness checks, reports SDK compatibility, token posture, endpoint bindings, route readiness, and actionable findings, and still does not expose host start/stop/restart/install operations.

## Current Product Notes

Agent uses the mature GoodVibes terminal shell, renderer, input, fullscreen workspace, command registry, and release foundation. The active Agent policy is serial/proactive by default, blocks Agent-owned review/job fanout, and delegates explicit build/fix/review work to GoodVibes TUI instead of turning the Agent into a coding TUI.
