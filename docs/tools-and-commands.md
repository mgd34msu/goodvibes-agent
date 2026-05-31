# Tools and Commands

GoodVibes Agent is an operator assistant, not a coding TUI clone at the product-policy layer. It keeps the GoodVibes TUI terminal foundation, but its command surface is centered on main-conversation assistant work, isolated Agent Knowledge/Wiki, local memory/routines/skills/personas, daemon observability, approvals, automation visibility, and explicit delegation to GoodVibes TUI for build work.

## Product Boundaries

- Normal chat stays in the main Agent conversation.
- Agent Knowledge/Wiki uses only `/api/goodvibes-agent/knowledge/*`.
- Agent never falls back to the default Knowledge/Wiki or arbitrary non-Agent knowledge spaces.
- Local memory, routines, skills, and personas remain Agent-local until a stable shared registry contract exists.
- The daemon is external. Agent connects to it and reports health; it does not start, stop, restart, or install it.
- WRFC is not a default reasoning path. It is requested only when the user explicitly asks for build, implementation, fix, review, or WRFC work.
- Code-building work is delegated to GoodVibes TUI through public shared-session/task contracts.

## Operator Commands

High-signal Agent command families:

- `/help` for registry-driven command discovery.
- `/status`, `/auth`, and `/compat` for daemon/auth/SDK diagnostics.
- `/model` and `/provider` for provider/model selection and visibility.
- `/knowledge` for isolated Agent Knowledge/Wiki ask, search, status, and ingest.
- `goodvibes-agent ask <question>` and `goodvibes-agent search <query>` are CLI shortcuts for the same isolated Agent Knowledge routes.
- `/recall`, `/memory`, `/routines`, `/skills`, and `/personas` for local Agent context and reusable operator behavior.
- `/plan` for Agent-owned workspace planning state in the main conversation.
- `/workplan` for durable task status over public work-plan routes.
- `/approvals` for pending approval visibility and explicit approval actions.
- `/automation` and `/schedule` for automation visibility plus narrow explicit-user-action flows, including `/schedule promote-routine <routine> --cron <expr> [--delivery-surface slack] --yes` for external daemon schedule creation, `/schedule receipts` for redacted local promotion history, and `/schedule reconcile` for live read-only receipt-to-daemon schedule correlation.
- `/delegate` for explicit build/fix/review handoff to GoodVibes TUI.
- `/mcp`, `/config`, `/settings`, and setup workspaces for local Agent configuration.

Copied TUI-era commands that would imply daemon lifecycle ownership, local agent spawning, coding-first execution, sandbox/QEMU ownership, worktree control, or implicit WRFC must remain blocked, read-only, or delegation-only until they are intentionally adapted to Agent policy.

Local recall capture/add commands are explicit Agent-local memory actions. Deletes, imports/exports, record linking, review-state changes, and promotion across memory scopes require `--yes`.

## Agent Knowledge

`/knowledge ask <query>` asks the isolated Agent Knowledge/Wiki environment for a source-backed answer. The daemon route is `/api/goodvibes-agent/knowledge/ask`.

`/knowledge search <query>` searches the same isolated Agent environment through `/api/goodvibes-agent/knowledge/search`.

`/knowledge ingest-url <url> --yes` ingests into Agent Knowledge through `/api/goodvibes-agent/knowledge/ingest/url`. Knowledge ingestion, imports, issue review, reindex, and consolidation are Agent-owned mutations and require `--yes`.

The Agent command layer rejects flags that would route knowledge work into another space, including `--space`, `--knowledge-space`, `--knowledgeSpaceId`, and `--includeAllSpaces`. If Agent Knowledge is unavailable, the command fails closed instead of querying a default store.

## Planning

`/plan` inspects or seeds Agent workspace planning state. The planning loop belongs to the main Agent conversation: the Agent asks focused questions, records decisions and gaps, and keeps execution separate until the user gives an explicit action.

The SDK project-planning service may still expose a project namespace such as `project:<projectId>` because that is the stable contract shape. In Agent UI and docs this is treated as a planning namespace, not as permission to query default Knowledge/Wiki or another product knowledge segment.

Use `/workplan` when the work already has concrete tasks and needs durable status tracking rather than another planning interview.

## Delegation

`/delegate` is for explicit build, fix, review, or implementation work. It sends a single delegated request to GoodVibes TUI/shared-session routes with the original user ask and execution intent. Agent does not create local Engineer/Reviewer/Tester root agents and does not run WRFC by default.

Use WRFC only when the user explicitly asks for WRFC or when the delegated build/fix/review request explicitly calls for it.

## Approvals And Automation

Approvals and automation are safe by default:

- list/status views are read-only;
- mutating routes require exact commands and explicit confirmation such as `--yes`;
- no chat turn silently runs approval, schedule, or automation mutations;
- unavailable routes return structured errors rather than fallback behavior.

Routine promotion is the first Agent-owned scheduling bridge: local routines stay local during normal use, and promotion creates a daemon `schedules.create` record only after a user runs the exact command with `--yes`. The generated scheduled prompt keeps Agent Knowledge isolated and forbids default Knowledge/Wiki or non-Agent knowledge fallback. Delivery is opt-in with explicit flags such as `--delivery-surface`, `--delivery-route`, `--delivery-webhook`, or `--delivery-link`; no delivery target is inferred from chat. Confirmed attempts are written to a local redacted receipt log under the Agent home so the operator can review route, daemon, cadence, delivery posture, status, and returned schedule id without scraping daemon internals. `/schedule reconcile` calls public `schedules.list` to compare those receipts with live externally owned daemon schedules.

## Related Docs

- [Getting started](getting-started.md)
- [Deployment and services](deployment-and-services.md)
- [Knowledge, artifacts, and multimodal](knowledge-artifacts-and-multimodal.md)
- [Release and publishing](release-and-publishing.md)
