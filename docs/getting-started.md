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

- Setup: guided first-run wizard with progress, current-step route hints, saved setup checkpoints, backtracking routes, setup-smoke rerun/save routes, and repeated-blocker focus from saved smoke history; visible checklist for runtime, connected-host auth, provider/model, install smoke, and follow-on capabilities; prioritized first-run plan; primary handoffs from every actionable setup row to the safest visible form, diagnostic, or confirmed route; GoodVibes settings import preview/apply; token-safe install smoke checks; confirmed setup smoke execution with saved redacted evidence artifacts and Home/setup latest-result plus history/trend surfacing; model readiness scores; hardware-scored local model cookbook with setup/download guidance; confirmed benchmark action/history; connected-host compatibility; live service probe evidence; token-safe connected-host auth posture with exact pairing route ids; confirmed local token create/repair; offline GoodVibes host bootstrap commands; diagnostic/status repair recommendations; inspect-first confirmed service install/start/restart routes; Agent Knowledge readiness; profiles; support bundles; subscriptions; and auth review.
- Home: assistant cockpit lanes for setup, chat/model choice, project work, Personal Ops, research/docs, background supervision, and safety/recovery, plus briefing, model refresh, health, doctor, and compatibility actions.
- Knowledge: isolated Agent Knowledge status, ask/search, inspection, and confirmed ingest.
- Research: read-only web research and URL inspection, read-only workflow planning, project-local visible research runs with log tails, browser-backed runner readiness/fallback posture, source queue, credibility review, reviewed-source bundles, plus confirmed sourced markdown report artifacts with source maps, citation coverage checks, and repair hints.
- Documents & Compare: versioned markdown document drafts, review comments, AI suggestion review, draft browse/show/create/revise/review/suggest/accept/reject/artifact-attach/artifact-insert/export with reviewer-ready comment and suggestion summaries, chronological review packet timeline across document/comment/suggestion/compare/judgment/route-decision/packet-preset/handoff/archive events with stale preset attention, a read-only review packet wizard with progress/current-step routes/backtracking/final archive review/refreshed-preset lineage/share handoff, visible reviewer-readiness preflight before export/archive/apply, inline readiness badges at document export, reviewer handoff/archive, and route-apply forms, packet defaults that prefill the next export/handoff/archive/apply/leave-unchanged/save-preset/share ids from the latest review packet while falling back to saved preset metadata only when live evidence is missing, uploads, exports, source checks, generated media artifacts, saved artifact browse/show/export/package/archive, reviewed artifact-to-Knowledge promotion, saved packet preset save/list/show/refresh routes with missing/superseded id freshness checks and confirmed refresh into a new preset artifact, confirmed reviewer packet share through `agent_review_packet_share` with channel target preview and no ZIP-byte transcript output, saved text artifact reuse in blind comparison, and confirmed blind model comparison with delayed reveal, durable JSON comparison artifacts, saved review boards, side-by-side reviewer views, split-pane reviewer handoff diffs with section jumps plus recent-handoff defaults and visible recent choices, saved judgment artifacts, confirmed apply and leave-unchanged route-decision receipts, task/document/benchmark-filtered preference analytics/synthesis, markdown report export, reviewer handoff artifacts, one-click reviewer handoff ZIP archives with matching route-decision receipt evidence, and confirmed winner route updates.
- Personal Ops: inbox/calendar connector readiness, request intake that turns "triage my inbox", "brief my calendar", task, reminder, note, routine, and delivery asks into the safest lane/route/fields/confirmation boundary, email/calendar-capable MCP setup routes, expanded connector tool classification for read-only versus write-like inbox/calendar actions, schema-derived operation records with required fields, sample inputs, schema routes, and confirmation flags, inbox triage/draft and calendar agenda/conflict workflow cards with inspect routes and confirmation boundaries, plus live records for Agent-owned notes, routines, schedule receipts, delivery channels, and redacted delivery receipts.
- Memory & Skills: VIBE.md personality, project context files, local memory, notes, personas, skills, routines, learned behavior capture, prompt injection limited to safe VIBE.md, safe project context, and reviewed/confident setup-ready behavior, setup/curator visibility for blocked or truncated VIBE.md files, model-visible context inspection for blocked or truncated project context files, and a learning curator for review/setup/stale/duplicate-consolidation/reviewed-note/completed-work/completed-research/saved-session memory and behavior candidates, including guided duplicate-consolidation phase helpers with receipts.
- Channels: companion pairing, an ordered channel setup guide, channel readiness, channel triage, notification targets, allowlist/status review, redacted confirmed-send receipts, and confirmed sends.
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
| GoodVibes settings import | `agent_harness mode:"run_workspace_action" actionId:"import-goodvibes-tui-settings"` |
| Visible UI | `agent_harness mode:"panels"`, `mode:"ui_surfaces"`, `mode:"open_panel"`, `mode:"open_ui_surface"` |
| Keybindings | `agent_harness mode:"shortcuts"`, `mode:"keybindings"`, `mode:"keybinding"`, `mode:"run_keybinding"`, `mode:"set_keybinding"` |
| Tool contracts | `agent_harness mode:"tools"`, `mode:"tool"` |
| Agent Knowledge | `agent_knowledge`, `agent_knowledge_ingest` |
| Research runs, sources, and reports | `agent_harness mode:"research_workflow"`, `mode:"research_runs"`, `mode:"research_run"`, `mode:"research_queue"`, `agent_research_runs`, `agent_research_sources`, `agent_research_report` |
| Personal operations | `agent_harness mode:"personal_ops_intake"`, `mode:"personal_ops"`, `mode:"personal_ops_lane"` |
| Local model choice | `agent_harness mode:"model_routing" query:"local"`, `mode:"model_route" modelRouteId:"local-model-cookbook"` |
| Local background processes | `agent_harness mode:"background_processes"`, `mode:"background_process"`, `mode:"run_background_process"` |
| Documents, artifacts, compare | `agent_harness mode:"document_ops"`, `mode:"document_ops_lane"`, `agent_documents`, `agent_review_packet_presets`, `agent_review_packet_share`, `agent_artifacts`, `agent_model_compare` |
| VIBE.md, project context, and local memory/notes/personas/skills/routines | `/vibe`, `agent_harness mode:"project_context"`, `mode:"project_context_file"`, `agent_local_registry`, `agent_learning_consolidation`, or confirmed workspace actions |
| Learning curator | `agent_harness mode:"learning_curator"`, `mode:"learning_candidate"`, `agent_learning_consolidation` |
| Work plan | `agent_work_plan` |
| Visible autonomous work | `agent_harness mode:"agent_orchestration"`, `mode:"agent_orchestration_agent"`, then `agent` with `mode:"spawn"`, `mode:"batch-spawn"`, `mode:"status"`, `mode:"message"`, `mode:"wait"`, or `mode:"cancel"` |
| Channels, notifications, reminders, scheduled autonomy, media | `agent_channel_send`, `agent_harness mode:"channel_triage"`, `agent_harness mode:"channel_deliveries"`, `agent_notify`, `agent_reminder_schedule`, `agent_autonomy_schedule`, `agent_schedule_edit`, `agent_media_generate` |
| Operator state/actions | `agent_operator_briefing`, `agent_operator_action`, `agent_operator_method`, `agent_harness mode:"operator_methods"` |
| Connected host/daemon posture | `agent_harness mode:"service_posture"`, `mode:"connected_host"`, `mode:"connected_host_capability"`, `mode:"connected_host_status"`, `mode:"daemon"`, `mode:"daemon_status"` |
| First-run setup plan | `agent_harness mode:"setup_posture"`, `mode:"setup_item"`, `mode:"setup_checkpoint"`, `mode:"mark_setup_checkpoint"`, `mode:"clear_setup_checkpoint"`, `mode:"provision_connected_host_token"`, `mode:"run_setup_smoke"` |
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
goodvibes-agent profiles templates export research ./research-starter.json --include-vibe --yes
goodvibes-agent profiles templates import ./research-starter.json --yes
```

Named profiles isolate Agent-local config, sessions, VIBE.md, memory, notes, personas, skills, routines, and setup state. Starter export/from-discovered flows can include the current safe VIBE.md with `--include-vibe`; blocked VIBE.md files must be repaired first. GoodVibes settings import can bring over existing provider, UI, permission, subscription, surface, tool, and daemon endpoint settings. The workspace action and model route both preview changed counts first, redact secret values, and require confirmation before applying Agent-owned settings or provider subscriptions.

## Local Behavior

VIBE.md is the friendly personality file for GoodVibes Agent. Project and global VIBE.md files are discovered, scanned for secret-looking content, surfaced in setup and the learning curator when blocked or truncated, optionally carried through profile starter export/import with `--include-vibe`, and applied to the serial Agent conversation. They do not write into default knowledge or other product segments.

Project context files are workspace instructions, not personality. GoodVibes Agent discovers `.hermes.md`, `HERMES.md`, `AGENTS.md`, `CLAUDE.md`, optional `HERMES_HOME/SOUL.md`, `.cursorrules`, and `.cursor/rules/*.mdc`, scans them for secret-looking content, applies bounded safe content to the serial Agent prompt, and exposes loaded or blocked files through `agent_harness mode:"project_context"` and `mode:"project_context_file"`. Subdirectory context is discovered when a target path is supplied.

Memory, notes, personas, routines, and Agent skills are local to GoodVibes Agent. Only reviewed, high-confidence local context should steer the assistant. Prompt context includes reviewed memory at or above the durable confidence threshold and reviewed setup-ready skills, routines, bundles, and personas. Enabled but unreviewed, stale, low-confidence, setup-blocked, or blocked context records are surfaced as suppressed review work instead of being applied silently.

Use the workspace first:

- Memory & Skills -> Create memory, Create note, or Capture learned behavior.
- Memory & Skills -> Learning curator to rank stale, low-confidence, missing-setup, VIBE.md personality health, duplicate-consolidation candidates with visible diffs and rollback routes, expose an ordered duplicate-consolidation batch review plan, apply confirmed merge/stale/delete/rollback phases through `agent_learning_consolidation`, surface reviewed-note memory/behavior proposals, completed-work memory/behavior proposals, completed-research memory/behavior proposals, saved-session memory/behavior proposals, and review-needed local behavior records before they silently guide the assistant.
- Notes -> Create notes for source triage, temporary decisions, and operator handoff.
- Personas -> Inspect, create, show, or import VIBE.md; create, inspect, activate, review, stale, or delete personas.
- Skills -> Create, enable/disable, review, bundle, or delete.
- Routines -> Create, start in chat, review receipts, or explicitly promote to a connected schedule.
- Work -> Add work item, review work plan, and update status.

Starting a routine records local usage and prints its steps in the main conversation. Promotion to a connected schedule or automation job is separate, explicit, confirmation-gated, visible in the autonomy queue, and keeps Agent Knowledge isolated. When the user asks for recurring autonomous work directly, `agent_autonomy_schedule` creates one connected schedule only with explicit task, cadence, success criteria, confirmation, and user request provenance.

## Knowledge And Artifacts

Use Agent Workspace -> Knowledge for source-backed Agent Knowledge. The valid connected-host route family is:

```text
/api/goodvibes-agent/knowledge/*
```

Agent commands fail closed if the route is unavailable or a successful-looking response carries non-Agent contamination. Parseable public Agent-route scope aliases are normalized before rendering.

The Knowledge workspace also exposes route-backed and command-backed workflows for issue review, prompt packet previews, context-selection explain output, consolidation, and reindex. Read-only ask/search/list/get/map/connector/packet/explain paths do not require mutation confirmation. Ingest, review-issue, consolidation, and reindex paths require explicit confirmation.

Use Agent Workspace -> Research for read-only web research, URL inspection, visible checkpointable research run state, browser-backed runner readiness, project-local source queue review, reviewed-source bundles, and confirmed sourced markdown report artifacts. Research requests do not ingest sources. Use `agent_harness mode:"research_workflow"` when the model needs one ordered route plan for a research request or existing run; it returns visible-run, source-collection, source-review, report-save, and Knowledge-promotion steps without performing any of them. Research run records keep the user-facing question, phase, progress, checkpoints, log tails, source ids, next steps, pause/resume/cancel/complete routes, and runner posture that tells the model whether browser-backed research is ready, needs setup review, or should fall back to public web/fetch routes without starting hidden background work. Source queue records keep credibility, score, report-ready source lines, source bundle handoffs, and safe routes; saved report artifacts keep a source map, citation coverage metadata, repair hints, and optional strict body-citation enforcement, and can be inspected or promoted later through explicit artifact and Agent Knowledge routes. Use Agent Workspace -> Documents & Compare when a document needs a versioned markdown draft, review comments, AI suggestion review, review status, reviewer-ready document artifact export, chronological review packet timeline with stale-preset attention, guided review packet progress/routes/backtracking/final archive review/refreshed-preset lineage/share handoff, reviewer-readiness preflight for unresolved comments/suggestions/source artifacts/comparison reveal/route decisions/handoff evidence, inline readiness badges at export/archive/apply points, packet-default prefill for the next export/handoff/archive/apply/leave-unchanged/save-preset/share form, a saved packet preset for recurring evidence ids with freshness checks before reuse and confirmed refresh when newer matching evidence exists, saved artifact attachment or insertion, single-artifact export, multi-artifact package directory or ZIP archive export, prompt context, source checks, generated media artifacts, reviewed artifact-to-Knowledge promotion, saved text artifact reuse in blind comparison, or a confirmed blind model comparison with local review, side-by-side reviewer view, split-pane reviewer handoff diff with section jumps and recent-handoff defaults, judgment, confirmed route-decision receipts, task/document/benchmark-filtered analytics, synthesis, reviewer handoff artifacts, one-click reviewer handoff ZIP archives with matching route-decision receipt evidence, and confirmed packet share through `agent_review_packet_share` when the user wants to send an archive reference to a configured channel target. Use confirmed Agent Knowledge ingest actions when a reviewed source should become durable.

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

When no connected host is reachable, inspect `agent_harness mode:"setup_item" setupItemId:"connected-host-readiness"` for the offline bootstrap plan. It returns user-run commands to verify Bun, install and trust the owning GoodVibes host package, verify host entrypoints, start the GoodVibes service, and reconnect Agent. Agent does not run those host install/start commands implicitly. When the host auth token is missing or malformed on the local machine, use `agent_harness mode:"provision_connected_host_token" setupItemId:"connected-host-auth" confirm:true explicitUserRequest:"..."`; it uses the GoodVibes SDK pairing helper to create or repair `~/.goodvibes/daemon/operator-tokens.json`, preserves valid existing tokens, leaves environment tokens untouched, and returns only path/fingerprint metadata.

## Current Product Notes

Agent uses the GoodVibes terminal shell, renderer, input, fullscreen workspace, command registry, and release foundation. Use `agent_harness mode:"execution_posture"` before computer-work handoffs: local read/edit/exec is the preferred route when the current workspace and permissions are sufficient, local shell/edit routes advertise process monitor/live tail/tool inspector supervision, `mode:"background_processes"` and `mode:"background_process"` inspect tracked local background processes with bounded redacted output, confirmed `mode:"run_background_process"` starts, waits on, or stops one tracked process, and process-style `poll`/`log`/`kill` actions plus `sessionId` aliases resolve to the same tracked process lifecycle. `mode:"execution_history"` exposes recent redacted tool/shell/edit records with result summaries, `mode:"file_recovery"` exposes recent file edit/write undo/redo depth, and `mode:"run_file_recovery"` applies one confirmed snapshot recovery. PTY/stdin write is reported as unsupported until the shared process substrate exposes it safely, and background sudo prompts are blocked in favor of visible user-supervised escalation. `agent_harness mode:"setup_posture"` also exposes connected-host setup repair cards with live service probe evidence, token-safe auth posture, exact pairing route ids, confirmed local token provisioning, status, service posture, recommended diagnostic/status routes, and confirmed service install/start/restart routes that stay inspect-first until service status proves need, plus browser/desktop-control readiness with ready, attention, or setup-needed state, workflow cards, setup checklist, fallback routes, and MCP review routes until a trusted browser, desktop, computer-use, screenshot, or screen-recording route is configured. Visible subagents stay serial-by-default unless independent work materially helps the user. `agent_harness mode:"agent_orchestration"` exposes the live Agent manager, spawn/batch-spawn decision cards, templates, and exact `agent` list/inspect/message/wait/cancel routes; `mode:"agent_orchestration_agent"` inspects one visible agent record. Delegation is reserved for isolation, parallelism, remote execution, separate worktrees, or user-requested delegated review. `mode:"delegation_posture"` exposes local-first, TUI handoff, delegated-review, remote-inspection, and hidden-fanout-blocked decision cards; expanded `delegation_route` rows show required fields, success evidence, status routes, and recovery routes. The confirmed `/delegate` and Agent Workspace handoff form preserve the original ask plus delegation reason, success criteria, workspace/worktree hint, priority, and explicit review intent. The active autonomy policy is visible autonomy: long-running work must have a user-readable task, status/progress, cancellation route, success criteria, and confirmation gates for external or daemon-mutating effects. Use `agent_harness mode:"autonomy_intake"` to turn an ongoing-work request into the safest visible route and missing fields; webhook/event-trigger requests get trusted-source/scope/success-criteria setup guidance and operator-method discovery until confirmed trigger creation exists. Confirmed autonomous schedule creation uses `agent_autonomy_schedule`, and confirmed existing-schedule edits use `agent_schedule_edit` with read-only current-state diffs before confirmation. Inspect current autonomy cards with `agent_harness mode:"autonomy_queue"` or one card with `mode:"autonomy_queue_item"`; research runs, connected-host tasks, approvals, automation runs, schedules, and delegated subagents surface live records or exact orchestration routes with progress/status, source ids, next steps, log tails when available, task retry/output/correlation diagnostics, bounded redacted host task output route/preview descriptors, automation telemetry/delivery/route diagnostics, normalized available/unavailable controls with reasons, and exact inspect/checkpoint/pause/resume/cancel/approve/deny/retry/run/edit/enable/disable/delete routes where the owning surface supports them. Schedule records also expose pause/resume aliases over daemon enable/disable lifecycle routes so the queue speaks in user intent instead of scheduler internals. Connected-host task cancel/retry stays on exact confirmed `agent_operator_method` routes, while `/tasks` remains inspection-only.
