# GoodVibes Platform Capability Audit

This audit records why GoodVibes Agent should use the daemon and SDK as first-class autonomy infrastructure instead of treating them as an external product boundary.

## Local Sources

- `goodvibes-tui` daemon CLI: `/home/buzzkill/Projects/goodvibes-tui/src/daemon/cli.ts`
- GoodVibes TUI operator contract artifact: `/home/buzzkill/Projects/goodvibes-tui/docs/foundation-artifacts/operator-contract.json`
- GoodVibes SDK package: `/home/buzzkill/Projects/goodvibes-sdk`
- SDK operator contract import used by Agent: `@pellux/goodvibes-sdk/contracts`

## Daemon Contract

The current SDK operator contract exposes 279 methods. It includes:

- Automation: job create/list/update/delete/enable/disable/run, run cancel/retry/list/get, schedule create/list/delete/enable/disable/run, heartbeat.
- Sessions and tasks: shared sessions, continuation, task creation, task status, handoffs.
- Channels and delivery: accounts, directories, capabilities, action routes, target resolution, outbound delivery surfaces.
- Knowledge: ask/search/status, URL/bookmark/browser-history/artifact/connector ingest, jobs, reports, refinement, project planning, graph/query routes.
- Media and voice: generation, provider posture, voice routes.
- Remote and services: peer invocation, remote artifacts/review, service status/install/start/stop/restart/uninstall.
- Security and operations: approvals, accounts, auth, telemetry, providers, MCP posture, service/network diagnostics.

## Agent Product Implication

The limiting factor is not raw platform capability. The limiting factor is whether Agent exposes that capability as a coherent user experience:

- The user should see one assistant, not a package boundary.
- Long-running work must be visible, statused, and cancellable.
- Read-only daemon routes should be easy to inspect.
- Write/admin daemon routes should be possible, but confirmation-gated and tied to the user's exact request.
- GoodVibes settings import should remain part of setup so users do not re-enter provider, subscription, permission, UI, and endpoint state.
- The existing terminal renderer should remain the primary shell while Agent gains autonomy-specific controls.

## Current Code Decisions

- `agent_harness mode:"operator_methods"` now inventories the live SDK operator contract instead of a small static shortlist.
- `agent_operator_method` runs exact daemon contract methods with read-only direct execution and write/admin confirmation gates.
- Shared-session follow-up and automation spawn paths now create visible Agent records instead of failing closed.
- The footer reads the active agent read model so autonomous work is visible in the existing renderer.
- Settings visibility no longer hides broad service/control-plane/runtime categories; raw danger toggles stay protected.
- `agent_harness mode:"summary"` and the visible TUI Home view now start with the same assistant-first cockpit for setup, chat/model, project work, Personal Ops, research/docs, background work, and safety/recovery, while host/daemon/provider/MCP/delegation details stay in diagnostics and confirmation boundaries.
- `agent_harness mode:"setup_posture"` now returns a prioritized first-run setup plan with connected-host readiness, live service probe evidence, service status/posture diagnostics, diagnostic/status repair recommendations, inspect-first confirmed service install/start/restart routes, offline GoodVibes host bootstrap commands for missing-host setup, GoodVibes settings import preview/apply, provider/model access, local model readiness with cookbook follow-through, Agent Knowledge, local behavior, channels, automation review, delegation, finish state, and exact follow-up routes.
- `agent_harness mode:"run_workspace_action" actionId:"import-goodvibes-tui-settings"` exposes the same GoodVibes TUI settings import as the workspace: preview is read-only and redacted; apply is confirmation-gated and copies only Agent-owned settings plus provider subscription state.
- `agent_harness mode:"autonomy_intake"` maps ongoing-work requests to the safest visible route and missing fields before any confirmed effect; `agent_autonomy_schedule` creates one visible connected autonomous schedule when task, cadence, success criteria, and request provenance are explicit; `agent_schedule_edit` updates one existing connected schedule by id with the same confirmation boundary.
- `agent_harness mode:"autonomy_queue"` now attaches live research run, connected-host task, approval, automation run, and schedule records with exact inspect/checkpoint/pause/resume/cancel/control routes where supported.

## Remaining Product Gaps

- End-to-end install smoke after the missing-host bootstrap path; setup already exposes live service probe evidence, offline GoodVibes host install/trust/verify/service/reconnect commands, recommended diagnostics/status cards, and confirmed service install/start/restart routes that stay inspect-first until service status proves need.
- Provider-specific email/calendar read execution into live inbox/agenda records in Personal Ops; Agent-owned notes, routines, schedule receipts, delivery channels, email/calendar-capable MCP connector setup routes, expanded connector read/write tool classification, schema-derived operation records with required fields/sample inputs/confirmation flags, and inbox triage/draft plus calendar agenda/conflict workflow cards already surface in live lane records.
- Richer schedule edit before/after diffs when the connected host exposes prior schedule records.
- Deeper host output streams, diagnostics, and pause/resume lifecycle controls in autonomy queue records when the connected host exposes them.
- Deep research browser-backed execution and richer report runner output beyond the current visible local run ledger, read-only route planner, run log tails, browser-readiness posture with setup/fallback routes, source queue, credibility scoring, source bundles, citation coverage metadata, repair hints, and saved sourced report artifacts.
- Live local model benchmark execution beyond the current read-only readiness scoring, hardware-scored cookbook, setup/download guidance, provider-refresh routes, benchmark prompts, and saved benchmark-history surfacing.
- First-class browser/desktop-control adapters and richer history-card grouping beyond the current strict browser/desktop ready-attention-setup posture, workflow cards/checklists/fallback routes, local-first execution posture for read/edit/exec, web fetch, supervision routes, bounded execution history records, confirmed file edit recovery, and delegation routing.
- Prompt injection now uses only reviewed memory at or above the durable confidence threshold plus reviewed setup-ready skills, routines, bundles, and personas; unreviewed or setup-blocked behavior is listed as suppressed review work instead of silently steering the assistant. Learning curator ranks local review/setup/stale candidates, duplicate-consolidation candidates with visible diffs and rollback routes, an ordered duplicate-consolidation batch review plan, reviewed-note memory/behavior proposals, visible completed-work memory/behavior proposals, completed-research memory/behavior proposals, and saved-session memory/behavior proposals; explicit apply helpers and deeper score-based ordering still need depth.
