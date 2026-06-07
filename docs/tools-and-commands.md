# Tools and Commands

GoodVibes Agent is a TUI-first operator assistant. The workspace is the primary user surface; slash commands are power-user routes inside the TUI; CLI subcommands are scriptable mirrors.

## Boundaries

- Normal chat stays in the main Agent conversation.
- Agent Knowledge uses only `/api/goodvibes-agent/knowledge/*`.
- Agent does not query default knowledge or other product knowledge spaces.
- Connected-host lifecycle is external. Agent reports and uses public routes, but does not start, stop, restart, install, expose, or mutate the host listener.
- Local read/edit/exec is available for explicit work in the current Agent workspace when permissions are sufficient. `execution_posture` exposes process monitor, live tail, tool inspector, browser/desktop ready-attention-setup state, workflow cards, setup checklists, fallback routes, sudo posture, execution history, file recovery routes, tracked background-process routes, and delegation decision cards for local work. `background_processes` and `background_process` inspect tracked local processes and bounded redacted output; confirmed `run_background_process` starts, waits on, stops/kills, polls, logs, or rejects writes with honest unsupported guidance for one tracked process. `execution_history` returns activity cards with grouped outcomes, verification evidence, bounded process-output summaries, exact inspect routes, and file-recovery handoffs before exposing raw redacted records. File edit/write recovery is inspectable through `file_recovery` and applied only through confirmed `run_file_recovery`. Visible Agent subagents stay serial-by-default unless parallelism helps the user; `agent_orchestration` and `agent_orchestration_agent` expose live Agent state, managed multi-agent plan cards, work-plan links, dispatch receipts, closeout review cards, remote-runner evidence, auto-attached remote artifact review routes, spawn/batch-spawn policy, and safe first-class `agent` control routes, while confirmed `agent_work_plan action:"dispatch_agents"` converts approved plan items into visible agent jobs with saved receipts. Delegation is for isolation, parallelism, remote execution, separate worktrees, or user-requested delegated review; `delegation_posture` and `delegation_route` expose local-first, TUI handoff, delegated-review, remote-inspection, and hidden-fanout-blocked lanes with required fields, success evidence, status routes, and recovery routes.
- External delivery, notifications, reminders, media generation, setting writes, keybinding writes, UI routing, slash-command execution, workspace-action execution, local destructive changes, and connected-host operator actions require explicit user request and confirmation.
- Autonomous scheduled work uses `agent_autonomy_schedule` and requires an explicit task, cadence, success criteria, and user request. Simple notification/reminder follow-ups stay on `agent_reminder_schedule`.

## User-Facing Surfaces

High-signal TUI routes:

| Surface | Purpose |
| --- | --- |
| `/agent` | Open the fullscreen operator workspace. |
| `/help` and `/commands` | Discover registered slash commands. |
| `/health`, `/compat`, `/auth` | Inspect runtime, connected-host, compatibility, and auth posture. |
| `/model`, `/provider`, `/effort` | Inspect or change provider/model/reasoning routes. |
| `/knowledge` | Use isolated Agent Knowledge. |
| `/vibe`, `/memory`, `/notes`, `/personas`, `/skills`, `/routines` | Manage VIBE.md personality and Agent-local behavior libraries. |
| `/plan`, `/workplan` | Planning and durable visible work tracking. |
| `/approval`, `/automation`, `/schedule` | Read posture and run exact confirmed operator actions. |
| `/channels`, `/notify`, `/qrcode` | Pair companions, inspect channel readiness, review delivery receipts, and send confirmed messages. |
| `/media`, `/voice`, `/tts` | Inspect media/voice readiness, generate media, and run spoken turns. |
| `/mcp`, `/secrets`, `/settings`, `/config` | Inspect or update Agent-local configuration. |
| `/delegate` | Hand explicit build/fix/review work to GoodVibes TUI with a confirmed handoff brief. |

## Model Tools

| Tool | Use |
| --- | --- |
| `agent` | Spawn, batch-spawn, inspect, message, wait, cancel, and report visible Agent subagents. |
| `agent_harness` | Discover and operate Agent harness routes, including visible surfaces and operator/audit inspection. |
| `agent_knowledge` | Read isolated Agent Knowledge: status, ask/search, lists, item, map, connectors. |
| `agent_knowledge_ingest` | Confirmed URL, file, artifact-id, browser, bookmark, or connector ingest into isolated Agent Knowledge. |
| `agent_learning_consolidation` | Preview or apply one confirmed Agent-local duplicate-consolidation phase with receipts. |
| `agent_local_registry` | Inspect or update Agent-local memory, notes, personas, skills, bundles, and routines. |
| `agent_work_plan` | Keep the visible Agent-local work plan current and dispatch approved plan items to visible agents with confirmation and receipts. |
| `agent_operator_briefing` | Read connected work, approvals, automation, schedules, and capacity posture. |
| `agent_operator_action` | Run exact confirmed approval/automation/schedule actions. |
| `agent_schedule_edit` | Edit one confirmed connected schedule by id. |
| `agent_documents` | Create, revise, review, comment on, suggest changes to, list, show, attach saved artifacts to, insert saved artifacts into, and export project-scoped drafts with reviewer appendices. |
| `agent_review_packet_presets` | Save, list, show, freshness-check, and refresh reusable Document Ops review packet presets without changing drafts, routes, handoffs, archives, or source presets. |
| `agent_review_packet_share` | Share one confirmed reviewer handoff archive reference through a configured channel target without printing or attaching ZIP bytes. |
| `agent_artifacts` | Browse, preview, export, package, and archive saved Agent artifacts. |
| `agent_research_runs` | Create, checkpoint, pause, resume, cancel, complete, fail, list, and show log tails for project-local visible research run records. |
| `agent_research_sources` | Capture, review, reject, mark used, list, and bundle project-local research source queue records. |
| `agent_research_report` | Save one confirmed sourced markdown research report artifact with source map, citation coverage metadata, and repair hints. |
| `agent_channel_send` | Send one confirmed channel message and return a receipt id when receipt storage is available. |
| `agent_notify` | Send one confirmed notification through configured webhook targets. |
| `agent_autonomy_schedule` | Create one confirmed visible autonomous Agent schedule. |
| `agent_reminder_schedule` | Create one confirmed connected reminder/schedule. |
| `agent_media_generate` | Generate one confirmed image/video artifact. |
| `agent_model_compare` | Run, review, side-by-side view, handoffDiff with section jumps, judge, routeDecision receipts, task/document/benchmark-filtered analytics/synthesis, apply, export, handoff, handoffArchive, or reveal one blind model comparison, optionally from a saved text artifact. |

## `agent_harness`

Use `agent_harness mode:"summary"` first. It starts with an assistant cockpit for setup, chat/model, project work, Personal Ops, research/docs, background work, and safety/recovery before implementation counters. Use `mode:"modes"` to search every harness mode by task, family, effect type, id, alias, or parameter name. Use `mode:"mode"` to inspect one mode contract. Summary and plural catalog modes are compact by default. They return counts, ids, labels, state, effect class, and short `modelRoute` or `modelAccess` hints when a route decision is needed. Use `includeParameters:true` or a singular inspect mode when the model needs full schemas, policy detail, editor fields, redacted log tail, release artifact data, route hints, or tool parameters.

Discovery modes:

| Mode | What It Lists |
| --- | --- |
| `summary` | Assistant cockpit lanes, compact counts, status, and drill-in guide. |
| `modes` | Searchable catalog of every `agent_harness` mode and its task fit. |
| `workspace`, `workspace_categories`, `workspace_actions` | Workspace categories and actions. |
| `commands`, `cli_commands` | Slash commands and top-level package CLI mirrors with compact policy and route hints. |
| `panels`, `ui_surfaces` | Built-in panels and visible modal/overlay/picker/workspace surfaces. |
| `shortcuts`, `keybindings` | Fixed shortcuts and configurable keybindings with direct route/access metadata. |
| `settings` | Compact Agent setting rows with category, prefix, query, hidden, and limit filters. |
| `tools` | First-class model tool definitions with compact harness inspection routes; schema details require `includeParameters:true` or `tool`. |
| `channels`, `channel_triage`, `channel_deliveries`, `notifications` | Channel readiness, ordered setup guide state, blockers/retry triage, redacted confirmed-send receipts, and redacted notification targets. |
| `project_context` | Secret-scanned `.hermes.md`, `HERMES.md`, `AGENTS.md`, `CLAUDE.md`, `HERMES_HOME/SOUL.md`, `.cursorrules`, and `.cursor/rules/*.mdc` files, including target-aware subdirectory context. |
| `agent_orchestration` | Live visible Agent records, managed multi-agent plan cards with milestones, work-plan links, dispatch receipt counts, closeout cards, remote-runner evidence, auto-attached remote artifact review routes, serial-by-default policy, approved work-plan dispatch route, spawn/batch-spawn decision cards, templates, and first-class `agent` routes for list/inspect/message/wait/cancel. |
| `provider_accounts`, `model_routing`, `execution_posture`, `background_processes`, `background_process`, `run_background_process`, `execution_history`, `file_recovery` | Provider auth, provider/model route posture, readiness scores, hardware-scored local model cookbook with setup plans, confirmed benchmark action/history, local-vs-delegated execution routing, tracked local background process lifecycle, grouped execution activity cards with redacted records, and file edit recovery. |
| `personal_ops`, `personal_ops_intake`, `personal_ops_lane`, `run_personal_ops_read` | Inbox/calendar connector readiness, request intake that chooses the safest lane/route/fields/confirmation boundary, classified MCP read/write tool hints, schema-derived operation records, triage/draft/agenda/conflict workflow cards, ordered connector-read/local-compose/confirmed-effect execution plans, confirmed read-only MCP inbox/calendar reads with bounded redacted output, normalized review cards, optional saved redacted review-card artifacts surfaced as durable inbox/calendar lane records with normalized labels, matching MCP setup routes, and live Agent-owned note, routine, schedule-receipt, and delivery records. |
| `autonomy_intake`, `autonomy_queue`, `autonomy_queue_item` | Ongoing-work route selection, visible autonomous work owners, schedule/watcher trigger posture, status, live records, log tails, task/run diagnostics, host task output routes/previews, inspect routes, and normalized checkpoint/pause/resume/cancel/recovery controls. |
| `learning_curator`, `learning_candidate` | Ranked local memory, note, persona, skill, bundle, routine, VIBE.md personality health, duplicate-consolidation batch review, completed-work, completed-research, and saved-session review/proposal candidates. |
| `document_ops`, `document_ops_lane` | Documents, review packet timeline, review packet wizard, packet presets/defaults/freshness, reviewer-readiness checks, uploads, exports, sources, artifact browse/promotion, media artifacts, and blind model comparison. |
| `mcp_servers`, `setup_posture`, `pairing_posture`, `delegation_posture` | MCP, first-run setup wizard with progress/current-step/checkpoint/backtracking routes and repeated-smoke-blocker focus, setup plan with probe-fed connected-host repair/auth cards, sudo execution posture, primary handoffs for actionable setup rows, confirmed local token provisioning, token-safe install smoke checks, confirmed setup smoke execution, saved redacted smoke evidence artifacts with history/trend surfacing, local model readiness, pairing/device capability posture, and build-delegation posture. |
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
| `channel`, `channel_setup_guide`, `channel_triage`, `notification_target`, `provider_account`, `mcp_server` | Exact id or `target`/`query`; `channel_triage` also accepts `limit` |
| `project_context_file` | `contextFileId`, `target`, or `query` |
| `agent_orchestration_agent` | `agentId`, `target`, or `query` |
| `setup_item`, `model_route`, `execution_route`, `pairing_route`, `delegation_route` | Exact id/model key or `target`/`query` |
| `setup_checkpoint` | Saved setup wizard checkpoint and current resume step, no lookup required |
| `personal_ops_intake` | `query` or `target` |
| `personal_ops_lane`, `document_ops_lane` | `laneId`, `target`, or `query` |
| `learning_candidate` | `candidateId`, `target`, or `query` |
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
| `provision_connected_host_token` | Creates or repairs the local canonical connected-host token after confirmation without returning the raw token. |
| `mark_setup_checkpoint`, `clear_setup_checkpoint` | Saves or clears the Agent-owned setup wizard resume checkpoint after confirmation. |
| `run_setup_smoke` | Collects redacted first-run setup smoke evidence and can save user-run output as an artifact without implicit shell or host commands. |
| `open_panel`, `open_ui_surface` | Routes visible shell navigation. |
| `run_keybinding` | Runs supported shell-safe keybinding actions only. |
| `set_keybinding`, `reset_keybinding` | Writes the same Agent `keybindings.json` file exposed to the user. |
| `set_setting`, `reset_setting` | Writes Agent settings through the config/secret managers. |
| `run_file_recovery` | Applies one local file undo or redo snapshot from the FileUndoManager. |

Every effect mode requires `confirm:true` and `explicitUserRequest`. Ambiguous lookups return candidates before any effect runs.

Registered model tool definitions are compact by default. Tool descriptions use short curated summaries or a tight fallback cap, nested JSON-schema descriptions are stripped from the default registered catalog, and catalog rows include direct harness inspection routes. Use `agent_harness mode:"tools"` with `includeParameters:true`, `mode:"tool"`, or a specific harness mode when detailed contracts are needed.

## Workspace Action Execution

`workspace_actions` returns compact action rows with short `modelRoute` hints. `workspace_action` inspection returns editor schemas and `modelExecution` detail. `workspace_actions` can include the same detail with `includeParameters:true`.

`panels` returns compact built-in panel rows with workspace route metadata and a short `modelRoute` for visible navigation or matching workspace operation. `panel` inspection adds policy detail and current open/focus state.

`ui_surfaces` returns compact modal, picker, overlay, and workspace rows with a short `modelRoute`. `ui_surface` inspection and `includeParameters:true` add the longer `preferredModelRoute` and confirmation policy. The connected browser cockpit/PWA is `surfaceId:"connected-browser-cockpit"`; it resolves the configured connected-host web URL, opens only through confirmed `open_ui_surface`, and returns service/web setup routes when disabled.

Execution routes:

- GoodVibes settings import previews changed setting/subscription counts without mutation; confirmed execution copies only Agent-owned settings and provider subscription state, redacts secret values, and stores raw secret-backed values through the secret manager.
- VIBE.md personality files are discovered from project/global locations, secret-scanned, surfaced in setup and the learning curator when blocked or truncated, and applied to the serial Agent prompt through `/vibe` and the Personas workspace.
- Project context files are discovered from `.hermes.md`, `HERMES.md`, `AGENTS.md`, `CLAUDE.md`, optional `HERMES_HOME/SOUL.md`, `.cursorrules`, and `.cursor/rules/*.mdc`, secret-scanned, bounded, target-aware for subdirectory work, and inspectable through `agent_harness mode:"project_context"` and `mode:"project_context_file"`.
- Local memory, notes, personas, skills, routines, and bundles dispatch through `agent_local_registry`.
- Runtime prompt context applies safe VIBE.md files, safe project context files, and only reviewed, high-confidence memory plus reviewed setup-ready behavior. Blocked or truncated VIBE.md/context files and enabled but unreviewed, stale, low-confidence, or setup-blocked local behavior are surfaced as suppressed review work and should be inspected through setup, project context inspection, or the learning curator before relying on them.
- Read-only learning review uses `agent_harness mode:"learning_curator"` and `mode:"learning_candidate"`; duplicate-consolidation candidates expose survivor ids, visible field diffs, low-level update/stale/delete/rollback routes, and first-class `agent_learning_consolidation` preview/merge/stale/delete/rollback phase routes. Merge and stale write durable receipts with rollback routes, delete refuses records that have not already been staged stale, and post-delete receipts preserve snapshots for review rather than pretending exact-id automatic restore is always possible. Reviewed-note, completed-work, completed-research, and saved-session memory/behavior proposals reuse selected-note promotion, memory-create, or learned-behavior capture routes. Non-consolidation writes stay on `agent_local_registry` or visible workspace actions.
- Agent document draft browse/show/create/revise/review/comment/suggest/accept-suggestion/reject-suggestion/artifact-insert/export dispatches through `agent_documents`; export artifacts include reviewer-ready comment and suggestion summaries. Reviewer-readiness checks are visible through Agent Workspace -> Documents & Compare -> Review readiness preflight and read-only through `agent_harness mode:"document_ops"` or `mode:"document_ops_lane" laneId:"reviewer_readiness"`; they return exact routes for resolving comments, accepting/rejecting suggestions, attaching evidence, revealing comparisons, applying or leaving model-route decisions, and repairing handoff evidence before export/archive/apply. The review packet wizard is visible through Agent Workspace -> Documents & Compare -> Review packet wizard and read-only through `mode:"document_ops_lane" laneId:"review_packet_wizard"`; it reports six-step progress, the current user/model route, backtracking routes, refreshed-preset lineage when a packet preset was repaired, final archive review guidance, and the confirmed share route. Agent Workspace -> Documents & Compare -> Save packet preset and `agent_review_packet_presets mode:"save"` store one reusable local packet preset artifact with document/export/comparison/judgment/route-decision/handoff/archive/related artifact ids; `mode:"list"` and `mode:"show"` inspect presets, flag missing or superseded saved ids, and recommend newer matching reuse routes when metadata is sufficient, without mutation. Agent Workspace -> Documents & Compare -> Refresh packet preset and `mode:"refresh"` save a new local preset artifact from those freshness recommendations after confirmation, preserving the source preset for audit history and never mutating documents, model routes, handoffs, or archives. Agent Workspace -> Documents & Compare -> Share review packet and `agent_review_packet_share` validate one saved handoff archive artifact, preview the delivery target and packet evidence ids, and send only a plain-text archive reference after explicit confirmation; ZIP bytes still move through `agent_artifacts mode:"export"` or package/archive routes. `agent_model_compare mode:"apply"` saves an apply-winner route-decision receipt after a confirmed route update, while `mode:"routeDecision" decision:"left-unchanged"` saves a receipt without changing the selected model; `mode:"handoffArchive"` carries matching route-decision receipt artifacts into the ZIP, README, archive metadata, and redacted manifest. Review packet defaults use the latest document/export/comparison/judgment/route-decision/handoff evidence, falling back to saved preset metadata only when live packet evidence is missing, to prefill document export, compare handoff/archive, winner-apply, leave-unchanged decision, save-preset, and share forms while preserving editable fields and confirmation gates.
- Start deep research routing with `agent_harness mode:"research_workflow"` when the model needs one ordered read-only plan across visible run state, public web/fetch or browser posture, source capture/review, report saving, and optional Knowledge promotion. Visible research run creation/checkpoint/pause/resume/cancel/complete and log-tail inspection dispatch through `agent_research_runs`; source capture, credibility review, and reviewed-source bundles dispatch through `agent_research_sources`; confirmed sourced research report artifact saves, citation coverage checks, and repair hints dispatch through `agent_research_report`.
- Confirmed Agent Knowledge URL/file/artifact-id/bookmark/browser-history/connector ingest dispatches through `agent_knowledge_ingest`.
- Command-backed editors dispatch through `run_command`.
- Learned-behavior and profile creation use the Agent-local or slash-command route.
- Web research/fetch forms return a main-conversation prompt instead of starting hidden nested work.
- Selection-based actions accept `recordId` so the model can use the same selected-record flows as the TUI.

## Background Processes

Use `background_processes` for a compact list of tracked local processes and `background_process` for one process with bounded redacted stdout/stderr tails. Use confirmed `run_background_process` when the user explicitly asks for a long-running local command to be tracked in the shared ProcessManager. The route accepts process-tool wording: `start`, `wait`, `stop`, `kill`, `poll`, `log`, and `write`; `poll` maps to status, `log` maps to output, `kill` maps to stop, and `write` returns unsupported guidance until the SDK exposes stdin. `processId`, `processSessionId`, `sessionId`, or `session_id` all resolve the tracked process id.

Foreground `exec` remains the default for tests, builds, and one-shot commands. Raw exec background flags and `bg_*` controls are blocked in Agent so long-running work has a visible process id, process monitor/live-tail routes, timeout, and cancellation path. PTY mode and stdin write return unsupported guidance until the SDK/daemon process substrate exposes a safe interactive API. Background sudo prompts are blocked; privileged commands should stay visible and user-supervised. `agent_harness mode:"setup_item" setupItemId:"sudo-execution-posture"` shows SUDO_PASSWORD presence only, the expected `~/.goodvibes/.env` location for future mediated support, blocked background sudo/stdin password routes, missing SDK/daemon contracts, and the foreground shell route without printing or storing raw password values.

## Settings And Keybindings

Settings discovery accepts `category`, `prefix`, `query`, `includeHidden:true`, and `limit`. It is compact by default and each row includes a short `modelRoute` that distinguishes read-only settings from set/reset-capable settings; use `includeParameters:true` or `get_setting` for full descriptions/defaults. Single setting reads/writes resolve by `key`, `target`, or `query`; ambiguous matches are refused. Secret-backed setting writes store raw values through the secret manager and return redacted output. The GoodVibes TUI settings import route is `agent_harness mode:"run_workspace_action" actionId:"import-goodvibes-tui-settings"`; without confirmation it returns a redacted preview, and with `confirm:true` plus `explicitUserRequest` it applies the migration. Connected-host lifecycle/listener settings are read-only in Agent.

Keybinding discovery returns fixed shortcuts plus the live resolved binding table. Fixed shortcuts and configurable bindings include direct `modelRoute` and `modelAccess` metadata so the model can distinguish supported harness routes from direct-user-only controls. `run_keybinding` only executes actions with faithful current-shell routes. Prompt-editor-only shortcuts, terminal text selection, category cycling, and reserved shortcuts stay direct user interaction.

## Connected Host And Daemon

The connected host is external. Agent can inspect it through:

- `service_posture` and `service_endpoint` for endpoint binding, network-facing posture, issues, optional probes, and redacted log tail.
- `connected_host` and `daemon` for compact connected-host posture and direct `modelRoute` hints; use `includeParameters:true` for route families, allowed capabilities, blocked lifecycle/non-Agent surfaces, and first-class tool availability.
- `connected_host_capability` for one allowed or blocked capability with the matching route hint.
- `connected_host_status` and `daemon_status` for live read-only readiness checks and the next diagnostic route.
- `setup_item` with `setupItemId:"connected-host-readiness"` for the missing-host bootstrap plan: user-run Bun, GoodVibes host install/trust, binary verification, service start, and Agent reconnect commands before operator methods are reachable.
- `operator_methods` and `operator_method` for the public method catalog.

None of those modes expose host start, stop, restart, install, expose-listener, account creation, arbitrary route mutation, default knowledge access, hidden background Agent jobs, or implicit delegated review.

## Visible Autonomy

Use `agent_harness mode:"autonomy_intake"` first when the user asks for ongoing work and the safest route is not obvious. It is read-only and returns the likely route, missing fields, confirmation boundary, and trigger workflow posture for time-based wakeups/schedules, incoming webhooks/watchers, Gmail/email connector triggers, and control-plane event streams. Webhook, watcher, Gmail, or event-trigger requests now point to the published `watchers.create` contract when applicable, but watcher creation is an admin connected-host mutation: require trusted source/scope, task or run target, success criteria, `confirm:true`, and `explicitUserRequest`. `agent_autonomy_schedule` creates one visible connected schedule only when the user gives task, cadence, success criteria, confirmation, and request provenance. `agent_schedule_edit` edits one existing schedule by id when the user explicitly asks for a name, cadence, prompt, or autonomous-task change; unconfirmed previews may read `schedules.list` to show current-state before/after diffs, then confirmed writes stay on `automation.jobs.patch`. Use `agent_harness mode:"autonomy_queue"` before creating recurring autonomous work, reminders, routine schedules, delegated work, run controls, schedule edits, approval decisions, watcher triggers, or follow-up delivery. The queue is read-only and normalizes work-plan, research-run, connected task, approval, automation, schedule, reminder, routine-promotion, delegated-agent, and delivery cards. Research runs, connected-host tasks, approvals, automation runs, and schedules include live records with status/progress, source ids, next steps, log tails when available, task retry/output/correlation diagnostics, bounded redacted host task output route/preview descriptors, automation telemetry/delivery/route diagnostics, available controls, unavailable controls with reasons, and exact inspect/checkpoint/pause/resume/cancel/approve/deny/retry/run/edit/enable/disable/delete routes where supported. Schedule records expose pause/resume aliases over daemon enable/disable lifecycle routes so users do not have to translate scheduler terminology. Connected-host task cancel/retry uses `agent_operator_method` exact daemon methods with `confirm:true` plus `explicitUserRequest`; slash `/tasks` remains inspection-only. Inspect one card with `mode:"autonomy_queue_item"`; create, edit, run, pause, resume, cancel, approve, deny, send, schedule, and schedule lifecycle effects stay on the owning confirmed route returned by that card.

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
/automation schedule <run|enable|disable|delete> <schedule-id> --yes
/schedule run <schedule-id> --yes
/schedule enable <schedule-id> --yes
/schedule disable <schedule-id> --yes
/schedule delete <schedule-id> --yes
/schedule edit <schedule-id> [--cron <expr>|--every <interval>|--at <iso-time>] [--timezone <tz>] [--name <text>] [--prompt <text>|--task <text> --success-criteria <text>] --yes
```

Routine promotion is an explicit scheduling route. Local routines stay local until a user confirms promotion. Delivery targets are opt-in with explicit channel/route/webhook/link flags.

## Slash Command Catalog

| Command | Purpose |
| --- | --- |
| `/accounts` | Review provider auth routes, subscription windows, and billing-path safety. |
| `/agent` | Open the GoodVibes Agent operator workspace. |
| `/agent-profile` | Manage isolated Agent profiles and starter templates, including opt-in VIBE.md starter export/import with `--include-vibe`. |
| `/approval` | Review approval classes and run exact confirmed approval actions. |
| `/auth` | Review provider auth posture and export redacted auth review bundles. |
| `/automation` | Run confirmed connected-host automation actions from the Agent TUI. |
| `/bookmarks` | List bookmarked transcript blocks. |
| `/brief` | Show a concise Agent operator briefing and next actions. |
| `/bundle` | Export, inspect, or import redacted Agent support bundles from the TUI. |
| `/channels` | Inspect channel readiness, delivery receipts, or send one explicitly confirmed delivery message. |
| `/clear` | Clear the conversation display while keeping LLM context. |
| `/collapse` | Collapse rendered blocks by type. |
| `/commands` | Browse all commands in a scrollable list. |
| `/compact` | Summarize the conversation to free context window. |
| `/compat` | Inspect connected-host compatibility and Agent Knowledge route readiness. |
| `/config` | Open the fullscreen configuration workspace. |
| `/context` | Inspect context-window usage and token breakdown. |
| `/conversation` | Review conversation structure, transcript hotspots, and composer posture. |
| `/delegate` | Explicitly delegate build/fix/review work to GoodVibes TUI with reason, success criteria, workspace hint, priority, and explicit review intent. |
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
| `/vibe` | Inspect, create, show, or import VIBE.md personality files. |
| `/voice` | Review voice posture and portable voice metadata. |
| `/welcome` | Open or print the Agent setup guide. |
| `/workplan` | Track a persistent workspace-scoped work plan. |

## Related Docs

- [Getting Started](getting-started.md)
- [Connected Host](connected-host.md)
- [Knowledge, Artifacts, and Multimodal](knowledge-artifacts-and-multimodal.md)
- [Channels, Remote Access, and API](channels-remote-and-api.md)
- [Release And Publishing](release-and-publishing.md)
