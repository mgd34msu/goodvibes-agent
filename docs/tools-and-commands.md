# Tools and Commands

GoodVibes Agent is a TUI-first operator assistant. The workspace is the primary user surface; slash commands are power-user routes inside the TUI; CLI subcommands are scriptable mirrors.

## Boundaries

- Normal chat stays in the main Agent conversation.
- Agent Knowledge uses only `/api/goodvibes-agent/knowledge/*`.
- Agent does not query default knowledge or other product knowledge spaces.
- Connected-host lifecycle is external. Agent reports and uses public routes, but does not start, stop, restart, install, expose, or mutate the host listener.
- Code-building work is explicit delegation to GoodVibes TUI. Delegated review is never the default reasoning path.
- External delivery, notifications, reminders, media generation, setting writes, keybinding writes, UI routing, slash-command execution, workspace-action execution, local destructive changes, and connected-host operator actions require explicit user request and confirmation.

## User-Facing Surfaces

High-signal TUI routes:

| Surface | Purpose |
| --- | --- |
| `/agent` | Open the fullscreen operator workspace. |
| `/help` and `/commands` | Discover registered slash commands. |
| `/health`, `/compat`, `/auth` | Inspect runtime, connected-host, compatibility, and auth posture. |
| `/model`, `/provider`, `/effort` | Inspect or change provider/model/reasoning routes. |
| `/knowledge` | Use isolated Agent Knowledge. |
| `/memory`, `/notes`, `/personas`, `/skills`, `/routines` | Manage Agent-local behavior libraries. |
| `/plan`, `/workplan` | Planning and durable visible work tracking. |
| `/approval`, `/automation`, `/schedule` | Read posture and run exact confirmed operator actions. |
| `/channels`, `/notify`, `/qrcode` | Pair companions, inspect channel readiness, and send confirmed messages. |
| `/media`, `/voice`, `/tts` | Inspect media/voice readiness, generate media, and run spoken turns. |
| `/mcp`, `/secrets`, `/settings`, `/config` | Inspect or update Agent-local configuration. |
| `/delegate` | Hand explicit build/fix/review work to GoodVibes TUI. |

## Model Tools

| Tool | Use |
| --- | --- |
| `agent_harness` | Discover and operate Agent harness routes, including visible surfaces and operator/audit inspection. |
| `agent_knowledge` | Read isolated Agent Knowledge: status, ask/search, lists, item, map, connectors. |
| `agent_knowledge_ingest` | Confirmed URL, file, artifact-id, browser, bookmark, or connector ingest into isolated Agent Knowledge. |
| `agent_local_registry` | Inspect or update Agent-local memory, notes, personas, skills, bundles, and routines. |
| `agent_work_plan` | Keep the visible Agent-local work plan current. |
| `agent_operator_briefing` | Read connected work, approvals, automation, schedules, and capacity posture. |
| `agent_operator_action` | Run exact confirmed approval/automation/schedule actions. |
| `agent_documents` | Create, revise, review, comment on, list, show, insert saved artifacts into, and export project-scoped versioned Agent document drafts. |
| `agent_artifacts` | Browse saved Agent artifacts and preview text-like content with redacted metadata. |
| `agent_channel_send` | Send one confirmed channel message. |
| `agent_notify` | Send one confirmed notification through configured webhook targets. |
| `agent_reminder_schedule` | Create one confirmed connected reminder/schedule. |
| `agent_media_generate` | Generate one confirmed image/video artifact. |
| `agent_model_compare` | Run, review, judge, analytics, apply, export, or reveal one blind model comparison. |

## `agent_harness`

Use `agent_harness mode:"summary"` first. Use `mode:"modes"` to search every harness mode by task, family, effect type, id, alias, or parameter name. Use `mode:"mode"` to inspect one mode contract. Summary and plural catalog modes are compact by default. They return counts, ids, labels, state, effect class, and short `modelRoute` or `modelAccess` hints when a route decision is needed. Use `includeParameters:true` or a singular inspect mode when the model needs full schemas, policy detail, editor fields, redacted log tail, release artifact data, route hints, or tool parameters.

Discovery modes:

| Mode | What It Lists |
| --- | --- |
| `summary` | Compact counts, status, and a short guide for where to drill in next. |
| `modes` | Searchable catalog of every `agent_harness` mode and its task fit. |
| `workspace`, `workspace_categories`, `workspace_actions` | Workspace categories and actions. |
| `commands`, `cli_commands` | Slash commands and top-level package CLI mirrors with compact policy and route hints. |
| `panels`, `ui_surfaces` | Built-in panels and visible modal/overlay/picker/workspace surfaces. |
| `shortcuts`, `keybindings` | Fixed shortcuts and configurable keybindings with direct route/access metadata. |
| `settings` | Compact Agent setting rows with category, prefix, query, hidden, and limit filters. |
| `tools` | First-class model tool definitions with compact harness inspection routes; schema details require `includeParameters:true` or `tool`. |
| `channels`, `notifications` | Channel readiness and redacted notification targets. |
| `provider_accounts`, `model_routing` | Provider auth and provider/model route posture. |
| `personal_ops`, `personal_ops_lane` | Inbox/calendar connector gaps plus notes, tasks, reminders, routines, and delivery readiness. |
| `document_ops`, `document_ops_lane` | Documents, uploads, exports, sources, artifact browse/promotion, media artifacts, and blind model comparison. |
| `mcp_servers`, `setup_posture`, `pairing_posture`, `delegation_posture` | MCP, setup, pairing, and build-delegation posture. |
| `security_posture`, `support_bundles`, `media_posture`, `sessions` | Security, bundle route, voice/media, and session/bookmark posture. |
| `operator_methods` | Public operator and Agent Knowledge method catalog. |
| `service_posture`, `connected_host`, `daemon` | Endpoint, connected-host, and daemon alias posture. |
| `release_evidence`, `release_readiness` | Operator/audit release artifacts and release-quality inventory. |

Single-item inspect modes:

| Mode | Lookup Fields |
| --- | --- |
| `mode` | `target` or `query` |
| `workspace_action` | `actionId`, `command`, `target`, `query` |
| `command`, `cli_command` | `command`, `commandName`, `cliCommand`, `target`, `query` |
| `panel`, `ui_surface`, `keybinding`, `tool` | Exact id/name or `target`/`query` |
| `channel`, `notification_target`, `provider_account`, `mcp_server` | Exact id or `target`/`query` |
| `setup_item`, `model_route`, `pairing_route`, `delegation_route` | Exact id/model key or `target`/`query` |
| `personal_ops_lane`, `document_ops_lane` | `laneId`, `target`, or `query` |
| `security_finding`, `support_bundle`, `media_provider`, `session` | Exact id/path or `target`/`query` |
| `get_setting`, `service_endpoint`, `operator_method` | Exact key/id or `target`/`query` |
| `connected_host_capability` | `capabilityId`, `target`, `query` |
| `connected_host_status`, `daemon_status` | Live read-only status, no lookup required |
| `release_evidence_artifact`, `release_readiness_item` | `artifactId`/`itemId`, `target`, `query` |

Effect modes:

| Mode | Effect |
| --- | --- |
| `run_workspace_action` | Executes one resolved workspace action through the same editor, command, or local route as the TUI. |
| `run_command` | Executes one resolved slash command through the shared command registry. |
| `open_panel`, `open_ui_surface` | Routes visible shell navigation. |
| `run_keybinding` | Runs supported shell-safe keybinding actions only. |
| `set_keybinding`, `reset_keybinding` | Writes the same Agent `keybindings.json` file exposed to the user. |
| `set_setting`, `reset_setting` | Writes Agent settings through the config/secret managers. |

Every effect mode requires `confirm:true` and `explicitUserRequest`. Ambiguous lookups return candidates before any effect runs.

Registered model tool definitions are compact by default. Tool descriptions use short curated summaries or a tight fallback cap, nested JSON-schema descriptions are stripped from the default registered catalog, and catalog rows include direct harness inspection routes. Use `agent_harness mode:"tools"` with `includeParameters:true`, `mode:"tool"`, or a specific harness mode when detailed contracts are needed.

## Workspace Action Execution

`workspace_actions` returns compact action rows with short `modelRoute` hints. `workspace_action` inspection returns editor schemas and `modelExecution` detail. `workspace_actions` can include the same detail with `includeParameters:true`.

`panels` returns compact built-in panel rows with workspace route metadata and a short `modelRoute` for visible navigation or matching workspace operation. `panel` inspection adds policy detail and current open/focus state.

`ui_surfaces` returns compact modal, picker, overlay, and workspace rows with a short `modelRoute`. `ui_surface` inspection and `includeParameters:true` add the longer `preferredModelRoute` and confirmation policy.

Execution routes:

- Local memory, notes, personas, skills, routines, and bundles dispatch through `agent_local_registry`.
- Agent document draft browse/show/create/revise/review/comment/artifact-insert/export dispatches through `agent_documents`.
- Confirmed Agent Knowledge URL/file/artifact-id/bookmark/browser-history/connector ingest dispatches through `agent_knowledge_ingest`.
- Command-backed editors dispatch through `run_command`.
- Learned-behavior and profile creation use the Agent-local or slash-command route.
- Web research/fetch forms return a main-conversation prompt instead of starting hidden nested work.
- Selection-based actions accept `recordId` so the model can use the same selected-record flows as the TUI.

## Settings And Keybindings

Settings discovery accepts `category`, `prefix`, `query`, `includeHidden:true`, and `limit`. It is compact by default and each row includes a short `modelRoute` that distinguishes read-only settings from set/reset-capable settings; use `includeParameters:true` or `get_setting` for full descriptions/defaults. Single setting reads/writes resolve by `key`, `target`, or `query`; ambiguous matches are refused. Secret-backed setting writes store raw values through the secret manager and return redacted output. Connected-host lifecycle/listener settings are read-only in Agent.

Keybinding discovery returns fixed shortcuts plus the live resolved binding table. Fixed shortcuts and configurable bindings include direct `modelRoute` and `modelAccess` metadata so the model can distinguish supported harness routes from direct-user-only controls. `run_keybinding` only executes actions with faithful current-shell routes. Prompt-editor-only shortcuts, terminal text selection, category cycling, and reserved shortcuts stay direct user interaction.

## Connected Host And Daemon

The connected host is external. Agent can inspect it through:

- `service_posture` and `service_endpoint` for endpoint binding, network-facing posture, issues, optional probes, and redacted log tail.
- `connected_host` and `daemon` for compact connected-host posture and direct `modelRoute` hints; use `includeParameters:true` for route families, allowed capabilities, blocked lifecycle/non-Agent surfaces, and first-class tool availability.
- `connected_host_capability` for one allowed or blocked capability with the matching route hint.
- `connected_host_status` and `daemon_status` for live read-only readiness checks and the next diagnostic route.
- `operator_methods` and `operator_method` for the public method catalog.

None of those modes expose host start, stop, restart, install, expose-listener, account creation, arbitrary route mutation, default knowledge access, hidden background Agent jobs, or implicit delegated review.

## Agent Knowledge

Use the Knowledge workspace first. Scriptable mirrors:

```sh
goodvibes-agent ask "<query>"
goodvibes-agent search "<query>"
goodvibes-agent knowledge list --kind sources
goodvibes-agent knowledge get <id>
goodvibes-agent knowledge map
goodvibes-agent knowledge connectors
goodvibes-agent knowledge connector <connector-id>
goodvibes-agent knowledge connector-doctor <connector-id>
goodvibes-agent knowledge ingest-url <url> --yes
goodvibes-agent knowledge ingest-file <path> --yes
goodvibes-agent knowledge ingest-connector <connector-id> --yes
goodvibes-agent knowledge import-urls <path> --yes
goodvibes-agent knowledge import-bookmarks <path> --yes
goodvibes-agent knowledge import-browser-history --yes
goodvibes-agent knowledge reindex --yes
/knowledge queue
/knowledge review-issue <issue-id> resolve --yes
/knowledge packet <task>
/knowledge explain <task>
/knowledge consolidate light --yes
```

Agent rejects route-selection flags that would target another knowledge space, including `--space`, `--knowledge-space`, `--knowledge-space-id`, and `--include-all-spaces`. Parseable public Agent-route scope aliases are normalized; contaminated connected-host responses return `scope_contamination`.

## Approvals, Automation, And Schedules

Read views are safe by default. Mutations require exact target ids and confirmation:

```text
/approval approve <approval-id> [--note <text>] [--remember|--no-remember] --yes
/approval deny <approval-id> [--note <text>] [--remember|--no-remember] --yes
/approval cancel <approval-id> [--note <text>] [--remember|--no-remember] --yes
/automation job run <job-id> --yes
/automation job pause <job-id> --yes
/automation job resume <job-id> --yes
/automation run cancel <run-id> --yes
/automation run retry <run-id> --yes
/automation schedule run <schedule-id> --yes
/schedule run <schedule-id> --yes
```

Routine promotion is an explicit scheduling route. Local routines stay local until a user confirms promotion. Delivery targets are opt-in with explicit channel/route/webhook/link flags.

## Slash Command Catalog

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
| `/compat` | Inspect connected-host compatibility and Agent Knowledge route readiness. |
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
| `/knowledge` | Use isolated Agent Knowledge. |
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
| `/refresh-models` | Refresh model catalog, metadata, and token limits. |
| `/reset` | Clear display and conversation context. |
| `/retry` | Re-send the last user message, optionally with modified text. |
| `/routines` | Manage Agent-local routines and explicit routine schedule promotion. |
| `/save` | Save the current session. |
| `/schedule` | Inspect schedules, create confirmed reminders, and promote routines to connected schedules. |
| `/secrets` | Manage secrets, external secret refs, and storage policy. |
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
| `/voice` | Review voice posture and portable voice metadata. |
| `/welcome` | Open or print the Agent setup guide. |
| `/workplan` | Track a persistent workspace-scoped work plan. |

## Related Docs

- [Getting Started](getting-started.md)
- [Connected Host](connected-host.md)
- [Knowledge, Artifacts, and Multimodal](knowledge-artifacts-and-multimodal.md)
- [Channels, Remote Access, and API](channels-remote-and-api.md)
- [Release And Publishing](release-and-publishing.md)
