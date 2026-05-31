# Project Planning

GoodVibes Agent owns the active planning loop for operator work. Planning is part of the Agent main conversation, not a hidden worker flow and not a default Knowledge/Wiki query.

## Boundary

The Agent owns:

- natural-language planning intent detection in the main terminal conversation;
- one-question-at-a-time clarification;
- the Agent-owned planning loop;
- the planning panel or fullscreen planning view;
- explicit execution approval;
- delegation metadata when work needs GoodVibes TUI.

The SDK/runtime owns durable storage and route contracts:

- planning namespaces such as `project:<projectId>`;
- readiness evaluation and next-question hints;
- decision records;
- task, dependency, verification, and assignment metadata;
- passive operator methods.

Other surfaces can store or inspect planning artifacts, but conversation control stays in Agent. Agent planning state is not default Knowledge/Wiki, another product segment, or arbitrary wiki data.

## Agent Behavior

The Agent derives a stable `projectId` from the workspace path and passes it to the SDK planning service. Planning artifacts are stored under the matching planning namespace so unrelated workspaces do not share state.

Normal conversation can start planning when the user asks for an execution strategy, dependency graph, verification gates, or delegation handoff. The Agent then:

- opens the planning surface;
- persists the current planning state through public SDK/runtime seams;
- records active open questions and user answers;
- calls readiness evaluation for gaps and the suggested next question;
- asks one focused question instead of executing prematurely.

The planning loop can be paused with natural language such as "stop planning" or "pause planning".

## Planning Surface

The planning surface shows:

- workspace project id and planning namespace;
- readiness and approval state;
- goal, scope, known context, and current next question;
- blocking or advisory readiness gaps;
- task graph and verification gates;
- delegation candidates;
- durable decisions;
- project language and ambiguity resolutions.

Keyboard behavior should match the rest of the Agent TUI: predictable focus, scroll, submit, dismiss, and return-to-chat behavior.

## `/plan`

`/plan` remains a command surface for inspection and seeding:

- `/plan` prints current planning readiness and opens the planning surface;
- `/plan panel` opens the planning surface;
- `/plan approve` records explicit execution approval;
- `/plan <goal>` seeds Agent workspace planning state;
- `/plan list` and `/plan show <id>` inspect older execution-plan records.

Use natural language or the surface dismiss action when planning should pause and normal chat should continue.

## Work Plan

The work-plan tracker is for concrete, durable task state after work becomes actionable. It is separate from the planning interview loop.

Use `/workplan` when the work already has tasks and needs status tracking. Use `/delegate` when explicit build/fix/review work should go to GoodVibes TUI.

## Agent Knowledge Boundary

Planning may link to Agent Knowledge evidence, but it must not query or ingest through default Knowledge/Wiki. Source-backed facts for Agent belong under:

```text
/api/goodvibes-agent/knowledge/*
```
