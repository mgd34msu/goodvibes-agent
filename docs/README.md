# GoodVibes Agent Docs

These are the package-facing docs for the GoodVibes Agent `1.0.x` release line.

## Current Docs

- [Docs Index](README.md)
- [Getting Started](getting-started.md)
- [Connected Host](connected-host.md)
- [Knowledge, Artifacts, and Multimodal](knowledge-artifacts-and-multimodal.md)
- [Tools and Commands](tools-and-commands.md)
- [Channels, Remote Access, and API](channels-remote-and-api.md)
- [Providers and Routing](providers-and-routing.md)
- [Voice and Live TTS](voice-and-live-tts.md)
- [Project Planning](project-planning.md)
- [Release And Publishing](release-and-publishing.md)

## Baseline

- Package executable: `goodvibes-agent`.
- Install/runtime: Bun `1.3.10` or newer.
- Agent version source: exact `package.json` semver, kept in sync with `CHANGELOG.md` and `src/version.ts` during release.
- Connected-host compatibility: public Agent routes report readiness through the `compat` and `status` CLI commands plus `connected_host_status`.
- Connected host: owned outside Agent; Agent reports and uses it but does not manage lifecycle.
- Agent Knowledge: only `/api/goodvibes-agent/knowledge/*`; no default knowledge fallback.
- Local state: VIBE.md personality, project context files, memory, notes, personas, skills, routines, sessions, setup, and profiles live under the Agent home or current project.
- Computer work: local read/edit/exec routes are allowed when the current Agent workspace and permissions are sufficient; process monitor/live tail/tool inspector supervision and local file edit/write recovery are inspectable and confirmation-gated; delegation is for isolation, parallelism, remote execution, separate worktrees, or user-requested delegated review.

## Model Access Baseline

Agent-owned model tools expose Agent-controlled product surfaces plus operator/audit inspection routes:

- `agent_harness` for the same assistant-first cockpit shown in TUI Home, searchable mode discovery, workspace actions, GoodVibes settings import preview/apply, first-run setup wizard progress/current-step/checkpoint/backtracking/repeated-smoke-blocker focus, ordered channel setup guide, channel triage, redacted channel delivery receipts, slash commands, settings, panels, UI surfaces including the confirmed connected browser cockpit/PWA route with category coverage, mobile/PWA controls, and receipt-gap reporting, keybindings, tool schemas, model readiness scores, visible model-route readiness inspection, hardware-scored local model cookbook with setup plans, local endpoint candidates with exact endpoint inspection, model-list smoke commands, success criteria, failure triage, and confirmed benchmark action/history/evidence review, local-vs-delegated execution posture, process monitor/live tail/tool inspector supervision routes, file edit recovery, ongoing-work intake, visible autonomy queue with live research run, connected-host task, approval, automation run, and schedule records/log tails, service/daemon posture, connected-host capability/status, posture catalogs, and operator/audit release artifact inspection.
- `agent_knowledge` and `agent_knowledge_ingest` for isolated Agent Knowledge.
- `agent_local_registry` and `agent_learning_consolidation` for Agent-local memory, notes, personas, skills, bundles, routines, confirmed duplicate-consolidation phases with receipts, and `agent_harness` learning-curator modes for ranked review/setup/stale, duplicate-consolidation, reviewed-note, completed-work, completed-research, and saved-session memory/behavior proposals.
- `agent_work_plan` for visible local work-plan state and confirmed dispatch of approved plan items to visible agents, with linked receipts surfaced in orchestration closeout.
- `agent_operator_briefing` and `agent_operator_action` for public connected operator state and exact confirmed actions.
- `agent_documents`, `agent_review_packet_presets`, `agent_review_packet_share`, `agent_artifacts`, `agent_research_runs`, `agent_research_sources`, and `agent_research_report` for versioned Agent document drafts, review comments, AI suggestion review, saved artifact attachment/insertion, reviewer-ready markdown artifact export with comment and suggestion summaries, reusable review packet preset save/list/show/refresh routes with freshness checks, confirmed reviewer packet archive-reference sharing, saved artifact browsing/export/package/archive, project-local visible research run state with log tails, `agent_harness mode:"research_workflow"` route planning with browser-runner and visual-report packet contracts, research source review, reviewed-source bundles, sourced research report artifacts with citation coverage repair hints and optional visual report packets, and reviewed artifact-to-Knowledge promotion.
- `agent_channel_send`, `agent_notify`, `agent_autonomy_schedule`, `agent_reminder_schedule`, `agent_schedule_edit`, `agent_media_generate`, and `agent_model_compare` for explicit confirmed effects, including channel send receipt ids, connected autonomous schedules, and blind comparison from saved text artifacts with side-by-side reviewer views, split-pane reviewer handoff diffs with section jumps and recent-handoff choices, chronological review packet timeline state including packet presets and preset freshness attention, review packet wizard progress/routes/refreshed-preset lineage/share handoff, route-decision receipt artifacts for apply/leave-unchanged evidence, packet-default form prefill for export/handoff/archive/apply/save-preset/share workflows, inline reviewer-readiness badges before export/archive/apply, task/document/benchmark-filtered saved judgment analytics/synthesis, reviewer handoff artifacts, and one-click handoff ZIP archives with matching route-decision receipt evidence.

Catalog modes are compact by default. `agent_harness mode:"modes"` searches all harness modes; `mode:"mode"` inspects one mode contract. Plural catalog rows keep summaries short and expose effect class, `modelRoute`, or `modelAccess` hints where the model needs an immediate route decision. Detailed schemas, route hints, redacted log tail, release artifact data, and editor fields require `includeParameters:true` or a singular inspect mode. The slash-command and CLI catalogs mirror every registered built-in command with policy and preferred model route metadata available to the model. Keybinding and fixed-shortcut rows identify direct model routes versus direct-user-only controls. Registered tool definitions use short top-level descriptions, omit nested parameter descriptions from the default model catalog, and carry direct harness inspection routes. Mutations, external delivery, UI routing, keybinding changes, setting writes, local destructive actions, media generation, reminders, and connected-host operator actions remain confirmation-gated and refuse ambiguous lookup.
