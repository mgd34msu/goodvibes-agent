# Project Planning

GoodVibes Agent owns the active planning loop for operator work. Planning is part of the Agent main conversation, not a hidden execution flow and not a default knowledge query.

## Boundary

The Agent owns:

- natural-language planning intent detection in the main terminal conversation;
- one-question-at-a-time clarification;
- the Agent-owned planning loop;
- transcript-first planning summaries and the Agent operator workspace planning state;
- explicit execution approval;
- delegation metadata when work needs GoodVibes TUI.

The SDK/runtime owns durable storage and route contracts:

- planning namespaces such as `project:<projectId>`;
- readiness evaluation and next-question hints;
- decision records;
- task, dependency, verification, and assignment metadata;
- passive operator methods.

Other surfaces can store or inspect planning artifacts, but conversation control stays in Agent. Agent planning state is not default knowledge, another product segment, or arbitrary knowledge data.

## Agent Behavior

The Agent derives a stable `projectId` from the workspace path and passes it to the SDK planning service. Planning artifacts are stored under the matching planning namespace so unrelated workspaces do not share state.

Normal conversation can start planning when the user asks for an execution strategy, dependency graph, verification gates, or delegation handoff. The Agent then:

- prints a concise planning summary in the main transcript;
- persists the current planning state through public SDK/runtime seams;
- records active open questions and user answers;
- calls readiness evaluation for gaps and the suggested next question;
- asks one focused question instead of executing prematurely.

The planning loop can be paused with natural language such as "stop planning" or "pause planning".

## Planning View

The planning view is transcript-first. It shows:

- workspace project id and planning namespace;
- readiness and approval state;
- goal, scope, known context, and current next question;
- blocking or advisory readiness gaps;
- task graph and verification gates;
- delegation candidates;
- durable decisions;
- project language and ambiguity resolutions.

Keyboard behavior stays in the main Agent TUI: predictable prompt editing, scroll, submit, dismiss, and return-to-chat behavior.

## `/plan`

`/plan` remains a command workspace for inspection and seeding:

- `/plan` prints current planning readiness and the next planning question;
- `/plan panel` is guidance-only in Agent and points back to `/plan status` or `/plan list`;
- `/plan approve` records explicit execution approval;
- `/plan <goal>` seeds Agent workspace planning state;
- `/plan list` and `/plan show <id>` inspect older execution-plan records.

Use natural language such as "pause planning" or "stop planning" when planning should pause and normal chat should continue.

## Work Plan

The work-plan tracker is for concrete, durable task state after work becomes actionable. It is separate from the planning interview loop.

Use `/workplan` when the work already has tasks and needs status tracking. Use `/delegate` when explicit build/fix/review work should go to GoodVibes TUI.

The model can keep the same visible work plan current with `agent_work_plan`. It can also discover `/plan`, `/workplan`, and delegation workspace actions through `agent_harness`; destructive work-plan changes still require explicit user request and confirmation.

## Agent Knowledge Boundary

Planning may link to Agent Knowledge evidence, but it must not query or ingest through default knowledge. Source-backed facts for Agent belong under:

```text
/api/goodvibes-agent/knowledge/*
```
