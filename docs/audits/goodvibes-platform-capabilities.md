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

## Remaining Product Gaps

- First-class email and calendar connectors and live Personal Ops queue.
- Deep research source queue, credibility scoring, cancellation, and checkpoint/resume beyond saved sourced report artifacts.
- Local model serving cookbook and hardware-aware setup.
- Browser/computer-use setup and recovery.
- Learning curator for memory, skill, routine, and preference updates.
