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
- `agent_harness mode:"setup_posture"` now returns a prioritized first-run setup plan with connected-host readiness, live service probe evidence, token-safe connected-host auth posture with exact pairing route ids, confirmed SDK-backed local token create/repair, service status/posture diagnostics, diagnostic/status repair recommendations, inspect-first confirmed service install/start/restart routes, offline GoodVibes host bootstrap commands for missing-host setup, GoodVibes settings import preview/apply, provider/model access, token-safe install smoke checks, confirmed setup smoke execution with durable redacted evidence artifacts, latest-smoke Home/setup summary surfacing, smoke history/trend/frequent blockers, local model readiness with cookbook follow-through, Agent Knowledge, local behavior, channels, automation review, delegation, finish state, and primary handoff cards that route every blocked/check/recommended setup row to the safest visible workspace form, diagnostic, or confirmed route; the visible Start checklist also carries connected-host auth and install smoke next to runtime/model setup.
- `agent_harness mode:"run_workspace_action" actionId:"import-goodvibes-tui-settings"` exposes the same GoodVibes TUI settings import as the workspace: preview is read-only and redacted; apply is confirmation-gated and copies only Agent-owned settings plus provider subscription state.
- `agent_harness mode:"autonomy_intake"` maps ongoing-work requests to the safest visible route and missing fields before any confirmed effect, including webhook/event-trigger setup requests that route to operator-method discovery until confirmed trigger creation exists; `agent_autonomy_schedule` creates one visible connected autonomous schedule when task, cadence, success criteria, and request provenance are explicit; `agent_schedule_edit` updates one existing connected schedule by id with the same confirmation boundary and read-only schedules.list current-state diffs before confirmation.
- `agent_harness mode:"autonomy_queue"` now attaches live research run, connected-host task, approval, automation run, and schedule records with exact inspect/checkpoint/pause/resume/cancel/control routes where supported, task retry/output/correlation diagnostics, automation telemetry/delivery/route diagnostics, and schedule pause/resume aliases over daemon enable/disable lifecycle routes.
- `agent_harness mode:"background_processes"`, `mode:"background_process"`, and confirmed `mode:"run_background_process"` now expose the shared SDK/TUI `ProcessManager` as user-visible start/list/status/log/wait/stop routes with bounded redacted output, process monitor/live-tail handoffs, explicit confirmation for start/wait/stop, honest PTY/stdin-write unsupported responses, and blocked hidden sudo prompts.

## Remaining Product Gaps

- Guided setup wizard polish after repeated install checks; setup already exposes a visible connected-host/auth/model/smoke checklist, live service probe evidence, token-safe connected-host auth posture with exact pairing route ids, confirmed SDK-backed local token create/repair, offline GoodVibes host install/trust/verify/service/reconnect commands, confirmed token-safe setup smoke execution with durable redacted evidence artifacts, latest-smoke summary surfacing, smoke history/trend/frequent blockers, primary handoff cards for every actionable setup row, recommended diagnostics/status cards, setup-state fixtures, and confirmed service install/start/restart routes that stay inspect-first until service status proves need.
- Provider-specific email/calendar read execution into live inbox/agenda records in Personal Ops; Agent-owned notes, routines, schedule receipts, delivery channels, email/calendar-capable MCP connector setup routes, expanded connector read/write tool classification, schema-derived operation records with required fields/sample inputs/confirmation flags, and inbox triage/draft plus calendar agenda/conflict workflow cards already surface in live lane records.
- Deeper host output streams beyond the current task and automation diagnostics when the connected host exposes them.
- Confirmed webhook and event-trigger creation when the connected host exposes scoped trigger records.
- Deep research browser-backed execution and richer report runner output beyond the current visible local run ledger, read-only route planner, run log tails, browser-readiness posture with setup/fallback routes, source queue, credibility scoring, source bundles, citation coverage metadata, repair hints, and saved sourced report artifacts.
- Deeper local provider/server health probes beyond the current readiness scoring, hardware-scored cookbook, setup/download guidance, provider-refresh routes, confirmed model-lane benchmark action, saved benchmark-history surfacing, and revealed winner judgments feeding matching recipe confidence.
- First-class browser/desktop-control adapters, safe PTY/stdin process APIs, richer sudo posture, and richer history-card grouping beyond the current strict browser/desktop ready-attention-setup posture, workflow cards/checklists/fallback routes, local-first execution posture for read/edit/exec, tracked background-process routes, web fetch, supervision routes, bounded execution history records, confirmed file edit recovery, and delegation routing.
- Prompt injection now applies secret-scanned project/global VIBE.md personality files, then uses only reviewed memory at or above the durable confidence threshold plus reviewed setup-ready skills, routines, bundles, and personas; unreviewed or setup-blocked behavior is listed as suppressed review work instead of silently steering the assistant. Learning curator ranks local review/setup/stale candidates, duplicate-consolidation candidates with visible diffs and rollback routes, an ordered duplicate-consolidation batch review plan, first-class confirmed phase helpers with durable receipts, reviewed-note memory/behavior proposals, visible completed-work memory/behavior proposals, completed-research memory/behavior proposals, and saved-session memory/behavior proposals; deeper score-based ordering still needs depth.
