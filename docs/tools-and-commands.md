# Tools and Commands

GoodVibes Agent is an operator assistant TUI. Its command set is centered on main-conversation assistant work, isolated Agent Knowledge/Wiki, local memory/notes/routines/skills/personas, approvals, automation visibility, and explicit delegation to GoodVibes TUI for build work.

## Product Boundaries

- Normal chat stays in the main Agent conversation.
- Agent Knowledge/Wiki uses only `/api/goodvibes-agent/knowledge/*`.
- Agent never falls back to default Knowledge/Wiki or arbitrary non-Agent knowledge spaces.
- Local memory, notes, routines, skills, and personas remain Agent-local until a stable shared registry contract exists.
- Runtime hosting is external. Agent connects to it and reports health; it does not start, stop, restart, or install it.
- WRFC is not a default reasoning path. It is requested only when the user explicitly asks for build, implementation, fix, review, or WRFC work.
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
- `/knowledge` for isolated Agent Knowledge/Wiki ask, search, status, source/node/issue inspection, connector inspection, and confirmed ingest/reindex actions.
- `/memory`, `/routines`, `/skills`, and `/personas` for local Agent context and reusable operator behavior.
- `/plan` for Agent-owned workspace planning state in the main conversation.
- `/workplan` for durable task status over public work-plan routes.
- `/approvals` for pending approval visibility and explicit approval actions.
- `/schedule` for schedule visibility plus narrow explicit-user-action flows.
- `/channels` for channel readiness and one-message confirmed channel delivery.
- `/media` for media provider readiness and confirmed image/video artifact generation.
- `/delegate` for explicit build/fix/review handoff to GoodVibes TUI.
- `/mcp`, `/config`, `/settings`, and setup workspaces for local Agent configuration.

The installed `goodvibes-agent` command launches the TUI by default. Subcommands such as `status`, `compat`, `knowledge ...`, `ask <question>`, and `search <query>` are secondary scriptable equivalents for diagnostics and automation over the same Agent workspace features.

Host-management and coding-first commands that would imply connected-host lifecycle ownership, local worker creation, execution-isolation ownership, worktree control, or implicit WRFC must remain blocked, read-only, or delegation-only unless they are intentionally adapted to Agent policy.

The main composer supports inline context references. Type `@path/to/file`, `@path/to/folder`, or `@https://example.test/page` in a normal prompt to add bounded context for that turn. `!@path/to/file` remains the raw file-injection form. These references do not ingest anything into Agent Knowledge unless the user explicitly runs a Knowledge ingest action.

The Research workspace submits web research and URL inspection forms to the normal main conversation. These requests are read-only by default, may use connected web tools when the user asks, and do not ingest sources. Use confirmed Agent Knowledge ingest actions only after a source should become durable Agent-owned knowledge.

Local memory capture/add commands are explicit Agent-local actions. Deletes, imports/exports, record linking, review-state changes, and promotion across memory scopes require `--yes`.

## Agent Knowledge

`/knowledge ask <query>` asks the isolated Agent Knowledge/Wiki environment for a source-backed answer through `/api/goodvibes-agent/knowledge/ask`.

`/knowledge search <query>` searches the same isolated Agent environment through `/api/goodvibes-agent/knowledge/search`.

`/knowledge ingest-url <url> --yes` ingests into Agent Knowledge through `/api/goodvibes-agent/knowledge/ingest/url`. Knowledge ingestion, imports, issue review, reindex, and consolidation are Agent-owned mutations and require `--yes`.

The Knowledge workspace exposes status, source library, connector review, ask, search, and confirmed ingest forms. Scriptable equivalents such as `goodvibes-agent knowledge list --kind sources|nodes|issues`, `goodvibes-agent knowledge get <id>`, `goodvibes-agent knowledge connectors`, and `goodvibes-agent knowledge map` are read-only CLI inspection paths over the same isolated Agent route family.

Workspace ingest forms are the primary user workflow. Scriptable equivalents such as `goodvibes-agent knowledge import-urls <path> --yes`, `goodvibes-agent knowledge import-bookmarks <path> --yes`, and `goodvibes-agent knowledge reindex --yes` are confirmed Agent Knowledge maintenance paths. They call only `/api/goodvibes-agent/knowledge/*`.

The Agent command layer rejects flags that would route knowledge work into another space, including `--space`, `--knowledge-space`, `--knowledge-space-id`, and `--include-all-spaces`. If Agent Knowledge is unavailable, the command fails closed instead of querying a default store.

## Media Artifacts

Agent Workspace -> Voice & Media is the primary media path. Use `Generate media` for a confirmed form that calls configured media providers and stores outputs as GoodVibes artifacts.

`/media providers` lists media provider readiness. `/media generate [--provider <id>] [--model <id>] [--mime <mime>] <prompt> --yes` is the power-user mirror for confirmed image/video generation. Media generation output returns artifact ids and metadata; it does not print inline base64 and does not write to default Knowledge/Wiki or non-Agent knowledge segments.

## Planning

`/plan` inspects or seeds Agent workspace planning state. The planning loop belongs to the main Agent conversation: the Agent asks focused questions, records decisions and gaps, and keeps execution separate until the user gives an explicit action.

The SDK planning service may expose a namespace such as `project:<projectId>` because that is the stable contract shape. In Agent UI and docs this is treated as a planning namespace, not as permission to query default Knowledge/Wiki or another product knowledge segment.

Use `/workplan` when the work already has concrete tasks and needs durable status tracking rather than another planning interview.

## Delegation

`/delegate` is for explicit build, fix, review, or implementation work. It sends a single delegated request to GoodVibes TUI/shared-session routes with the original user ask and execution intent. Agent does not create local coding-role workers and does not run WRFC by default.

Use WRFC only when the user explicitly asks for WRFC or when the delegated build/fix/review request explicitly calls for it.

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

Routine promotion is an explicit scheduling bridge: local routines stay local during normal use, and promotion creates a schedule only after a user runs the exact command with `--yes`. The generated scheduled prompt keeps Agent Knowledge isolated and forbids default Knowledge/Wiki or non-Agent knowledge fallback. Delivery is opt-in with explicit flags such as `--delivery-channel`, `--delivery-route`, `--delivery-webhook`, or `--delivery-link`; no delivery target is inferred from chat.

## Channels

Agent Workspace -> Channels is the primary channel path. It shows readiness, setup, account, policy, and status views without rendering secret values. `Send channel message` opens a confirmed form for one delivery target.

`/channels send --channel <surface[:route[:label]]> --message <text> --yes` sends one explicit message through configured delivery strategies. `--route`, `--webhook`, and `--link` are alternate one-target forms. Channel sends do not create routes, authorize accounts, manage connected-host hosting, use default Knowledge/Wiki, use non-Agent knowledge segments, create local workers, or run WRFC.

## Related Docs

- [Getting started](getting-started.md)
- [Connected host](connected-host.md)
- [Knowledge, artifacts, and multimodal](knowledge-artifacts-and-multimodal.md)
- [Release and publishing](release-and-publishing.md)
