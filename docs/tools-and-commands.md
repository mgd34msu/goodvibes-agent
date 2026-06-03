# Tools and Commands

GoodVibes Agent is an operator assistant TUI. Its command set is centered on main-conversation assistant work, isolated Agent Knowledge, local memory/notes/routines/skills/personas, approvals, automation visibility, and explicit delegation to GoodVibes TUI for build work.

## Product Boundaries

- Normal chat stays in the main Agent conversation.
- Agent Knowledge uses only `/api/goodvibes-agent/knowledge/*`.
- Agent never falls back to default knowledge or arbitrary non-Agent knowledge spaces.
- Local memory, notes, routines, skills, and personas remain Agent-local unless an explicit Agent workflow promotes reviewed material into another Agent-owned surface.
- Runtime hosting is external. Agent connects to it and reports health; it does not start, stop, restart, or install it.
- Delegated review is not a default reasoning path. It is requested only when the user explicitly asks for build, implementation, fix, or review work.
- Code-building work is delegated to GoodVibes TUI through public shared-session/task contracts.

## TUI-First Operator Surface

The Agent workspace is the product surface. Slash commands are power-user routes inside the TUI, and package CLI subcommands are scriptable mirrors. New user-facing features should appear in the workspace first.

High-signal Agent TUI paths:

- `/help` for registry-driven command discovery.
- `/health` and `/auth` for runtime/auth/SDK diagnostics inside the TUI.
- `/model` and `/provider` for provider/model selection and visibility.
- `/agent` for the fullscreen operator workspace: setup, provider/model, Agent Knowledge, memory, notes, personas, skills, routines, channels, MCP/tools, secrets, voice/media, work state, automation, and build delegation.
- Agent Workspace -> Research for read-only web research, URL inspection, source triage, and explicit source-to-Agent-Knowledge handoff.
- Agent Workspace -> Notes for local source-triage notes, temporary decisions, and operator handoff. Notes do not write memory or Agent Knowledge by themselves; reviewed notes can prefill memory, skills, routines, personas, or an isolated Agent Knowledge URL ingest.
- `/knowledge` for isolated Agent Knowledge ask, search, status, source/node/issue inspection, connector inspection, and confirmed ingest/reindex actions.
- `/memory`, `/routines`, `/skills`, and `/personas` for Agent-local context and reusable operator behavior.
- `/plan` for Agent-owned workspace planning state in the main conversation.
- `/workplan` for durable task status over public work-plan routes.
- `/approval` for pending approval visibility and explicit approval actions.
- `/schedule` for schedule visibility plus narrow explicit-user-action flows.
- `/channels` for channel readiness and one-message confirmed channel delivery.
- `/media` for media provider readiness and confirmed image/video artifact generation.
- `/delegate` for explicit build/fix/review handoff to GoodVibes TUI.
- `/mcp`, `/config`, `/settings`, and setup workspaces for Agent-local configuration.

The installed `goodvibes-agent` command launches the TUI by default. Subcommands such as `status`, `compat`, `knowledge ...`, `ask <question>`, and `search <query>` are secondary scriptable equivalents for diagnostics and automation over the same Agent workspace features.

Host-management and coding-first commands that would imply connected-host lifecycle ownership, separate Agent job creation, execution-isolation ownership, worktree control, or implicit delegated review must remain blocked, read-only, or delegation-only unless they are intentionally adapted to Agent policy.

## Model-Visible Harness Surface

The main Agent model has an Agent-owned harness bridge rather than generic SDK settings/context control. Use these model tools as the supported parity layer:

- `agent_harness`: inspect workspace categories/actions and inspect or run one workspace action by action id, command, or lookup text, inspect built-in panels and one panel by id or lookup text, inspect modal/overlay/picker UI surfaces and named operator surfaces by id or lookup text, inspect top-level CLI mirrors and one mirror by command string, command token, or lookup text, inspect fixed shortcuts and configurable keybindings, inspect/change/run one keybinding by action id or lookup text where a shell-safe model route exists, inspect slash commands and one slash command by typed command or lookup text with policy metadata, run concrete slash-command mirrors with confirmation, inspect model tools or one model tool schema, inspect or change Agent settings by exact key or lookup text, inspect connected-host capability boundaries or one connected-host capability, and inspect live connected-host readiness.
- `agent_local_registry`: inspect and maintain Agent-local memory, notes, personas, skills, skill bundles, and routines. Deleting local records requires `confirm:true` and `explicitUserRequest`.
- `agent_knowledge` and `agent_knowledge_ingest`: ask/search and ingest into the isolated Agent Knowledge segment.
- `agent_operator_briefing` and `agent_operator_action`: inspect connected work/approval/automation posture, or run exact confirmed approval/automation actions.
- `agent_work_plan`: keep the visible Agent-local work plan current from the conversation.
- `agent_channel_send`, `agent_notify`, `agent_reminder_schedule`, and `agent_media_generate`: perform confirmed external delivery, notification, reminder, or media actions when the user explicitly asks.

`agent_harness` discovery modes are read-only. `summary` reports the model access map; `panels` lists the built-in panel catalog, and `panel` resolves one panel by `panelId`, `target`, or `query` with current open/focused state plus its matching Agent workspace route; `ui_surfaces` lists modal, overlay, picker, and workspace entrypoints, and `ui_surface` resolves one by `surfaceId`, `target`, or `query` with shell-opener availability and preferred model routes; `cli_commands` lists top-level package CLI mirror metadata, and `cli_command` resolves one mirror by `cliCommand`, `command`, `commandName`, `target`, or `query`, returning parser output for concrete invocations, blocked command tokens, lookup metadata, and preferred in-process model routes; `shortcuts` returns fixed runtime/editor shortcuts plus configurable keybindings; `keybindings` lists the live resolved keybinding table, and `keybinding`, `run_keybinding`, `set_keybinding`, and `reset_keybinding` resolve one action by `actionId`, `target`, `key`, or `query` with default bindings, custom state, config path, lookup metadata, and model-operation route metadata; `commands` lists slash-command descriptions; `command` returns one slash-command detail by `command`, `commandName`, `target`, or `query`, including parsed arguments plus effect/confirmation/preferred-tool/boundary policy metadata; `workspace_actions` lists Agent workspace actions and can inline editor field schemas with `includeParameters:true`; `workspace_action` and `run_workspace_action` resolve one action by `actionId`, `command`, `target`, or `query`, using the same user-facing action-search fields; inspection returns lookup metadata plus editor schema, and execution refuses ambiguous requests with candidate actions before any effect; `tools` lists model tool definitions and can inline JSON schemas with `includeParameters:true`; `tool` returns one model tool schema by `toolName`, `target`, or `query` and refuses ambiguous schema lookup with candidate tools; `settings` returns setting descriptors plus setting policy; `get_setting`, `set_setting`, and `reset_setting` resolve one setting by `key`, `target`, or `query`, return lookup metadata on success, and refuse ambiguous matches with candidate settings; `connected_host` returns the connected-host route families, allowed capabilities, blocked capabilities, and first-class tool availability; `connected_host_capability` returns one allowed or blocked connected-host capability by `capabilityId`, `target`, or `query` with related route families and boundary text and refuses ambiguous capability lookup with candidates; and `connected_host_status` performs a live read-only check of the connected-host status and Agent Knowledge status routes and reports endpoint bindings, token posture, SDK compatibility, route readiness, and findings without printing token values.

`open_ui_surface` is a confirmation-gated visible navigation mode for the same shell surfaces the user can open: Agent workspace, settings, MCP workspace, model/provider/reasoning-effort pickers, TTS provider/voice pickers, session/profile pickers, the panel-picker compatibility route, security/knowledge/subscription operator surfaces, conversation search, prompt-history search, slash-command mode, command browser, file picker, block actions, bookmarks, context inspector, runtime activity monitor, live process output, help, shortcuts, and onboarding. It does not perform hidden operations; use first-class model tools, settings modes, workspace actions, or confirmed slash-command mirrors for actual state changes. Ambiguous UI surface lookup text is refused with candidate surfaces instead of routed.

`cli_command` is a read-only inspection mode. Concrete CLI strings are parsed with redacted config overrides; descriptive lookup text searches the same `cli_commands` catalog and returns one match or candidate mirrors when broad.

`run_keybinding`, `set_keybinding`, and `reset_keybinding` are confirmation-gated control modes. `run_keybinding` executes only keybinding actions with a faithful current-shell route, such as cancel generation, clear screen, open/focus/dismiss visible panel workspace routes, open conversation or prompt-history search, paste through the existing clipboard handler, or open the visible block-action surface. Prompt-editor-only controls, terminal text selection, category cycling, and reserved shortcuts stay visible in descriptors but return unsupported/direct-interaction metadata instead of pretending a hidden model operation exists. `set_keybinding` and `reset_keybinding` write the same Agent `keybindings.json` file exposed by `/keybindings`, reload the runtime keybinding manager, and leave fixed runtime/editor shortcuts read-only. Ambiguous keybinding lookup text is refused with candidate actions instead of guessed.

`open_panel` is a confirmation-gated UI routing mode. It hands a visible panel/workspace route to the current Agent shell bridge and does not mutate connected-host lifecycle, listener posture, or external accounts. Ambiguous panel lookup text is refused with candidate panels instead of routed.

CLI mirror modes are catalog and parser inspection only. When the user asks the model to operate from inside the main conversation, use the returned first-class model tool, workspace action, setting mode, or confirmed slash-command mirror instead of launching a hidden nested `goodvibes-agent` process.

Setting writes, setting resets, supported keybinding actions, keybinding writes/resets, UI surface routing, slash-command invocation, workspace-action invocation, local record deletion, channel sends, notifications, reminders, media generation, and connected-host operator mutations require explicit user request and confirmation. Secret-backed settings are stored through the secret manager, and connected-host lifecycle/listener settings remain read-only in Agent.

Selection-based local workspace actions use the same bridge. `agent_harness` reports the required model tool for each local action; for actions that depend on the TUI selection, call `run_workspace_action` with the selected local `recordId` plus an `actionId`, `command`, `target`, or `query` that resolves to one action. Direct local create editors for memory, notes, personas, skills, and routines can execute from submitted `fields` through `run_workspace_action`; the harness validates required fields, requires `confirm:true` and `explicitUserRequest`, and dispatches through `agent_local_registry`. Note promotion actions can prefill and create memory, personas, skills, routines, or isolated Agent Knowledge URL ingests through the matching first-class model tool. Profile creation schemas include the current runtime starter-template inventory, and routine schedule schemas prefill the selected routine when `recordId` or a `routineId` field matches a local routine.

Use first-class Agent tools before falling back to slash-command mirrors. Slash-command execution is for harness parity and scriptable mirrors, not for bypassing Agent product boundaries.

The main composer supports inline context references. Type `@path/to/file`, `@path/to/folder`, or `@https://example.test/page` in a normal prompt to add bounded context for that turn. `!@path/to/file` remains the raw file-injection form. These references do not ingest anything into Agent Knowledge unless the user explicitly runs a Knowledge ingest action.

The Research workspace submits web research and URL inspection forms to the normal main conversation. These requests are read-only by default, may use connected web tools when the user asks, and do not ingest sources. Use confirmed Agent Knowledge ingest actions only after a source should become durable Agent-owned knowledge.

Local memory capture/add commands are explicit Agent-local actions. Deletes, imports/exports, record linking, review-state changes, and promotion across memory scopes require `--yes`.

## Slash Command Catalog

Every registered slash-command root in the Agent TUI is listed here. Aliases resolve through the same command registry but are intentionally secondary to the canonical roots.

| Command | Purpose |
| --- | --- |
| `/accounts` | Review provider auth routes, subscription windows, and billing-path safety. |
| `/agent` | Open the GoodVibes Agent operator workspace. |
| `/agent-profile` | Manage isolated Agent profiles and starter templates. |
| `/approval` | Review approval classes and run exact confirmed approval actions. |
| `/auth` | Review provider auth posture and export redacted auth review bundles. |
| `/automation` | Run confirmed connected-host automation actions from the Agent TUI. |
| `/bookmarks` | List bookmarked transcript blocks. |
| `/brief` | Show a concise Agent operator briefing and next actions. |
| `/bundle` | Export, inspect, or import redacted Agent support bundles from the TUI. |
| `/channels` | Inspect channel readiness or send one explicitly confirmed delivery message. |
| `/clear` | Clear the conversation display while keeping LLM context. |
| `/collapse` | Collapse rendered blocks by type. |
| `/commands` | Browse all commands in a scrollable list. |
| `/compact` | Summarize the conversation to free context window. |
| `/compat` | Inspect Agent SDK pin, connected-host version, and Agent Knowledge route readiness. |
| `/config` | Open the fullscreen configuration workspace. |
| `/context` | Inspect context-window usage and token breakdown. |
| `/conversation` | Review conversation structure, transcript hotspots, and composer posture. |
| `/delegate` | Explicitly delegate build/fix/review work to GoodVibes TUI. |
| `/effort` | Show or set reasoning effort level. |
| `/expand` | Expand rendered blocks by type. |
| `/export` | Export the current conversation to Markdown. |
| `/health` | Review startup posture, connected-host readiness, provider health, and Agent continuity. |
| `/help` | Show available commands and keyboard shortcuts. |
| `/image` | Attach an image file to the next message. |
| `/keybindings` | List keyboard bindings and the config file path. |
| `/knowledge` | Use isolated Agent Knowledge sources, graph, review queue, ask/search, ingest, and compact prompt packets. |
| `/load` | Load a saved Agent session. |
| `/mcp` | Manage MCP servers, trust posture, and tool inventory. |
| `/media` | Inspect media providers or generate media through configured providers. |
| `/memory` | Add, search, review, stale, or delete Agent-local memory records. |
| `/mode` | Manage Agent interaction mode and per-domain verbosity. |
| `/model` | Select or display the current LLM model. |
| `/next-error` | Jump to the next error message in the conversation. |
| `/notes` | Open Agent-local scratchpad notes in the operator workspace. |
| `/notify` | Manage and send configured Agent webhook notifications. |
| `/paste` | Insert clipboard text or image into the prompt. |
| `/personas` | Manage Agent-local personas. |
| `/pin` | Pin a model to the favorites list. |
| `/plan` | Inspect or seed Agent workspace planning state. |
| `/prev-error` | Jump to the previous error message in the conversation. |
| `/provider` | Switch provider or manage custom providers. |
| `/qrcode` | Print companion pairing details and a QR code. |
| `/quit` | Exit the application. |
| `/redo` | Redo the last undone conversation turn. |
| `/refresh-models` | Refresh model catalog, benchmarks, and token limits. |
| `/reset` | Clear display and conversation context. |
| `/retry` | Re-send the last user message, optionally with modified text. |
| `/routines` | Manage Agent-local routines and explicit routine schedule promotion. |
| `/save` | Save the current session. |
| `/schedule` | Inspect schedules, create confirmed reminders, and promote routines to connected schedules. |
| `/secrets` | Manage hierarchy-aware secrets, external secret refs, and secure/plaintext storage policy. |
| `/security` | Inspect security posture, attack paths, and review state. |
| `/session` | Inspect session continuity and cross-session graph state. |
| `/sessions` | List saved sessions. |
| `/settings` | Open, inspect, set, or reset Agent settings. |
| `/setup` | Open Agent setup with current settings preloaded. |
| `/shortcuts` | Show keyboard shortcuts. |
| `/skills` | Manage Agent-local skills and skill bundles. |
| `/subscription` | Manage provider subscription sessions. |
| `/tasks` | Inspect connected-host tasks without starting or mutating local background work. |
| `/title` | Show or set the conversation title. |
| `/trust` | Review trust posture and export portable trust bundles. |
| `/tts` | Submit a normal prompt and play the assistant response through live TTS. |
| `/undo` | Undo the last conversation turn. |
| `/unpin` | Unpin a model from the favorites list. |
| `/voice` | Review voice posture and package portable voice interaction metadata. |
| `/welcome` | Open or print the Agent setup guide. |
| `/workplan` | Track a persistent workspace-scoped work plan. |

## Agent Knowledge

`/knowledge ask <query>` asks the isolated Agent Knowledge environment for a source-backed answer through `/api/goodvibes-agent/knowledge/ask`.

`/knowledge search <query>` searches the same isolated Agent environment through `/api/goodvibes-agent/knowledge/search`.

`/knowledge ingest-url <url> --yes` ingests into Agent Knowledge through `/api/goodvibes-agent/knowledge/ingest/url`. Knowledge ingestion, imports, issue review, reindex, and consolidation are Agent-owned mutations and require `--yes`.

The Knowledge workspace exposes status, source library, connector review, ask, search, and confirmed ingest forms. Scriptable equivalents such as `goodvibes-agent knowledge list --kind sources|nodes|issues`, `goodvibes-agent knowledge get <id>`, `goodvibes-agent knowledge connectors`, and `goodvibes-agent knowledge map` are read-only CLI inspection paths over the same isolated Agent route family.

Workspace ingest forms are the primary user workflow. Scriptable equivalents such as `goodvibes-agent knowledge import-urls <path> --yes`, `goodvibes-agent knowledge import-bookmarks <path> --yes`, and `goodvibes-agent knowledge reindex --yes` are confirmed Agent Knowledge maintenance paths. They call only `/api/goodvibes-agent/knowledge/*`.

The Agent command layer rejects flags that would route knowledge work into another space, including `--space`, `--knowledge-space`, `--knowledge-space-id`, and `--include-all-spaces`. If Agent Knowledge is unavailable, the command fails closed instead of querying a default store.

## Media Artifacts

Agent Workspace -> Voice & Media is the primary media path. Use `Generate media` for a confirmed form that calls configured media providers and stores outputs as GoodVibes artifacts.

`/media providers` lists media provider readiness. `/media generate [--provider <id>] [--model <id>] [--mime <mime>] <prompt> --yes` is the power-user mirror for confirmed image/video generation. Media generation output returns artifact ids and metadata; it does not print inline base64 and does not write to default knowledge or non-Agent knowledge segments.

## Planning

`/plan` inspects or seeds Agent workspace planning state. The planning loop belongs to the main Agent conversation: the Agent asks focused questions, records decisions and gaps, and keeps execution separate until the user gives an explicit action.

The SDK planning service may expose a namespace such as `project:<projectId>` because that is the stable contract shape. In Agent UI and docs this is treated as a planning namespace, not as permission to query default knowledge or another product knowledge segment.

Use `/workplan` when the work already has concrete tasks and needs durable status tracking rather than another planning interview.

## Delegation

`/delegate` is for explicit build, fix, review, or implementation work. It sends a single delegated request to GoodVibes TUI/shared-session routes with the original user ask and execution intent. Agent does not create coding-role Agent jobs and does not run delegated review by default.

Use `/delegate --review` only when the user explicitly asks for review or when the delegated build/fix/review request explicitly calls for review.

## Approvals And Automation

Approvals and automation are safe by default:

- list/status views are read-only;
- mutating routes require exact commands and explicit confirmation such as `--yes`;
- no chat turn silently runs approval, schedule, or automation mutations;
- unavailable routes return structured errors rather than fallback behavior.

Workspace forms are the primary path for approval and automation actions:

- Agent Workspace -> Work & Approvals -> Approve request / Deny request / Cancel request
- Agent Workspace -> Automation -> Run job now / Pause job / Resume job
- Agent Workspace -> Automation -> Cancel run / Retry run / Run schedule now

Power-user slash mirrors are exact and confirmation-gated:

- `/approval approve <approval-id> [--note <text>] [--remember|--no-remember] --yes`
- `/approval deny <approval-id> [--note <text>] [--remember|--no-remember] --yes`
- `/approval cancel <approval-id> [--note <text>] [--remember|--no-remember] --yes`
- `/automation job run <job-id> --yes`
- `/automation job pause <job-id> --yes`
- `/automation job resume <job-id> --yes`
- `/automation run cancel <run-id> --yes`
- `/automation run retry <run-id> --yes`
- `/automation schedule run <schedule-id> --yes`
- `/schedule run <schedule-id> --yes`

Routine promotion is an explicit scheduling bridge: local routines stay local during normal use, and promotion creates a schedule only after a user runs the exact command with `--yes`. The generated scheduled prompt keeps Agent Knowledge isolated and forbids default knowledge or non-Agent knowledge fallback. Delivery is opt-in with explicit flags such as `--delivery-channel`, `--delivery-route`, `--delivery-webhook`, or `--delivery-link`; no delivery target is inferred from chat.

## Channels

Agent Workspace -> Channels is the primary channel path. It shows readiness, setup, account, policy, and status views without rendering secret values. `Send channel message` opens a confirmed form for one delivery target.

`/channels send --channel <surface[:route[:label]]> --message <text> --yes` sends one explicit message through configured delivery strategies. `--route`, `--webhook`, and `--link` are alternate one-target forms. Channel sends do not create routes, authorize accounts, manage connected-host hosting, use default knowledge, use non-Agent knowledge segments, create separate Agent jobs, or run delegated review.

## Related Docs

- [Getting started](getting-started.md)
- [Connected host](connected-host.md)
- [Knowledge, artifacts, and multimodal](knowledge-artifacts-and-multimodal.md)
- [Release and publishing](release-and-publishing.md)
