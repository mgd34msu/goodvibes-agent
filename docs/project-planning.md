# Project Planning

GoodVibes Agent owns the active planning loop for operator work. The SDK provides passive storage and readiness evaluation only.

## Boundary

The Agent owns:

- natural-language planning intent detection in the main terminal conversation
- the relentless planning interview loop
- one-question-at-a-time clarification
- the project planning panel
- execution approval
- delegation metadata and future assignment UX

The SDK owns:

- durable project-scoped planning artifacts in SDK planning namespaces such as `project:<projectId>`
- readiness evaluation and next-question hints
- project-language records
- decision records
- task, dependency, verification, and assignment metadata
- passive daemon routes and operator methods

Daemon, web, webhook, ntfy, Slack, Discord, and companion surfaces do not enter the Agent planning loop. They can use SDK routes as storage/evaluation APIs where appropriate, but conversation control stays in the Agent surface. Agent planning state is not default Knowledge/Wiki, product-specific graph data, or an arbitrary knowledge space.

## Agent Behavior

The Agent derives a stable `projectId` from the workspace path and passes it to the SDK `ProjectPlanningService`. Planning artifacts are stored under the matching SDK planning namespace, so unrelated workspaces do not share planning state.

Normal conversation can start planning when the user uses planning language such as implementation plan, execution strategy, dependency graph, verification gates, or delegation handoff. The Agent then:

- opens the `Planning` panel
- persists the current planning state through the SDK
- records active open questions and user answers
- calls SDK readiness evaluation for gaps and the suggested next question
- injects a planning-only system instruction for that turn so the assistant asks one focused question instead of executing

The planning loop can be paused with natural language such as "stop planning" or "pause planning".

## Planning Panel

Open the panel through the panel picker or with `/plan panel`.

The panel shows:

- workspace project id and planning namespace
- readiness and approval state
- goal, scope, known context, and current next question
- blocking/advisory readiness gaps
- task graph and verification gates
- agent handoff candidates
- durable decisions
- project language and ambiguity resolutions

Panel keys:

- `r` refreshes SDK-backed planning artifacts.
- `a` marks the current structurally ready plan as approved for execution.
- Up/Down chooses available answer actions when a question is active, or scrolls panel content when there is no active answer list.
- Type while the panel is focused to draft a custom answer.
- `Enter` submits the selected or drafted answer through the normal planning chat path.
- The answer list includes a dismiss action that pauses planning for the workspace and returns focus to normal chat.

## `/plan`

`/plan` is retained as a command surface for inspection and seeding, but it is no longer the primary planning UX.

- `/plan` prints current project-planning readiness and opens the panel.
- `/plan panel` opens the panel.
- `/plan approve` records explicit execution approval.
- `/plan <goal>` seeds project planning state.
- `/plan list` and `/plan show <id>` still inspect older execution-plan records.
- `/plan mode|explain|override|status|clear` still route to the adaptive runtime controls.

Use natural language such as "stop planning" or the panel dismiss action when the Agent has entered planning but the current work should continue as normal chat.

## Work Plan

GoodVibes also has a lightweight persistent work-plan tracker for concrete tasks. It is separate from the planning interview state and is intended for visible, durable checklists while work is in progress.

Commands:

- `/workplan` or `/workplan panel`
- `/workplan add <title> [--owner name] [--source label] [--notes text]`
- `/workplan list`
- `/workplan done|start|block|fail|cancel|pending <id>`
- `/workplan remove <id>`
- `/workplan clear-done`

Agent stores work-plan state under its Agent-owned runtime home and renders it in the `Work Plan` panel.

## SDK Routes And Operator Methods

Agent does not need to call daemon routes for its own local planning loop, but the SDK exposes passive routes and methods:

- `GET /api/projects/planning/status`
- `GET|POST /api/projects/planning/state`
- `POST /api/projects/planning/evaluate`
- `GET|POST /api/projects/planning/decisions`
- `GET|POST /api/projects/planning/language`
- `projectPlanning.status`
- `projectPlanning.state.get`
- `projectPlanning.state.upsert`
- `projectPlanning.evaluate`
- `projectPlanning.decisions.list`
- `projectPlanning.decisions.record`
- `projectPlanning.language.get`
- `projectPlanning.language.upsert`
