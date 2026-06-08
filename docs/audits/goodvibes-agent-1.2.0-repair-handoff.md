# GoodVibes Agent 1.2.0 Repair Handoff

Date: 2026-06-08

This is the continuation handoff for a new coding session. It replaces the old
deleted audit handoffs. Do not restore the old audit docs unless the user
explicitly asks for them.

## Correct Goal

Create a fresh goal in the next session:

> Repair GoodVibes Agent 1.2.0 and the GoodVibes platform until all competitive
> gaps against OpenClaw, Hermes Agent, and Odysseus are closed with code, tests,
> and release evidence. UX first. Start with first-run onboarding.

Do not mark this goal complete while any inventory row remains `partial` or
`gap`, or while a row is only claimed by docs. A row is done only when the
feature works through the user-facing Agent experience, has tests, and has
release evidence.

## Current Situation

`@pellux/goodvibes-agent@1.2.0` was published, but that release did not satisfy
the real goal. It shipped a large amount of Agent code and release scaffolding,
then incorrectly treated the competitive inventory as complete enough to
release. The user is correcting that: the target was never "write audits"; the
target is best-in-class autonomous-agent capability.

Current repo facts:

- Repo: `/home/buzzkill/Projects/goodvibes-agent`
- Branch: `main`
- Published release commit: `7f3f8388 chore: release v1.2.0`
- Product commit before release: `bd11b6c6 chore: prepare 1.2.0 release gates`
- Current package version: `1.2.0`
- Current SDK dependency: `@pellux/goodvibes-sdk@0.33.37`
- The old docs under `docs/audits/` were intentionally deleted by the user.
- One code file was already edited after release:
  `src/agent/competitive-feature-inventory.ts`

The current edit in `src/agent/competitive-feature-inventory.ts` adds onboarding
back to the first-run gap list:

- Replace vague onboarding labels and columns with a compact setting preview
  that shows the setting name/key and current -> new value before applying it.
- Remove slash-command-looking routes from first-run onboarding cards;
  onboarding must present visible controls, not command syntax.

Do not expand this into a huge metadata pane. The UX requirement is compact:
show the setting being changed and the current -> proposed value. UX first.

## Product Boundary

GoodVibes Agent is a sister project to GoodVibes TUI and GoodVibes SDK. It is
not a child of TUI and should not import daemon/TUI implementation code.

GoodVibes Agent owns:

- the user-facing autonomous assistant experience;
- first-run setup/onboarding UX;
- settings UX for Agent-owned configuration;
- route planning from normal user language into visible assistant actions;
- local Agent memory/personality/context/workspace records;
- confirmation, redaction, recovery, and visible queue semantics;
- consumption of SDK contracts and daemon receipts/events/read models.

GoodVibes SDK owns:

- importable shared contracts, types, schemas, helpers, stores, and clients;
- operator/control-plane contracts;
- runtime event and receipt types;
- browser/mobile/web-safe public entry points.

GoodVibes TUI/daemon owns:

- the connected-host runtime process;
- daemon APIs, operator methods, read models, events, receipts;
- service lifecycle and always-on host state;
- browser/PWA host surfaces;
- channel, provider, watcher, task, remote-runner, and device runtime records.

The user should experience one assistant. Package boundaries belong in
diagnostics and implementation notes, not in normal onboarding or daily use.

## Competitor Baseline

This project is competing with OpenClaw, Hermes Agent, and PewDiePie's Odysseus.
Before declaring a feature done, verify the current upstream projects again.
The working baseline from the prior audit is:

OpenClaw:

- always-on gateway/control plane;
- broad channels and companion/device surfaces;
- browser, screen, camera, location, notifications, and system commands;
- cron, wakeups, webhooks, Gmail/event triggers;
- memory, skills, project knowledge, sessions;
- web/control UI and WebChat;
- secure defaults, pairing, allowlists, sandboxing, doctor checks.

Hermes Agent:

- CLI/TUI/gateway/messaging surfaces that feel like one assistant;
- installer/setup wizard for dependencies and gateway;
- broad model provider support including OpenRouter/local endpoints;
- messaging/email gateway;
- cron scheduler for unattended work;
- subagents, kanban/orchestration, per-task worktrees;
- terminal, browser, code execution, computer-use tooling;
- closed learning loop with memory, skill creation/improvement, session search,
  user model, custom personality;
- observability/dashboard posture.

Odysseus:

- self-hosted web workspace/PWA as the primary experience;
- Docker/native bootstrap and admin setup;
- IMAP/SMTP email triage and CalDAV calendar;
- notes, tasks, reminders, scheduled tasks;
- persistent vector/keyword memory and skills;
- Deep Research that gathers, reads, and synthesizes sources into a visual
  report;
- Documents and blind Compare workflows;
- local model cookbook for Ollama, llama.cpp, vLLM, and similar local serving;
- opencode-backed web/files/shell/MCP execution.

GoodVibes should beat these on UX, safety, continuity, evidence, recovery, and
feature depth. Parity is not enough for rows whose target is `better`.

## Source Of Truth

Use `src/agent/competitive-feature-inventory.ts` as the source of truth. Do not
invent a separate gap list in docs and then work from the doc. The inventory
currently has:

- `leading`: one-assistant mental model, security/permissions/recovery.
- `parity`: omnichannel inbox/delivery, documents/files/model comparison.
- `partial`: first-run setup, models/local cookbook, Personal Ops,
  learning/memory, autonomy/background work, computer/browser/shell,
  multi-agent/remote execution, deep research/reports, mobile/voice/device,
  web dashboard/PWA.

Run this to print the current inventory:

```sh
bun run ux:inventory
```

## Active Repair: Onboarding UX

The first code task is first-run onboarding. This was explicitly put back on
the gap list because the current UX is not acceptable.

Known bad behavior:

- Onboarding action tables show vague headers: `Action` and `Does`.
- Selected action context says `Does: ...`.
- Setting actions show route-ish text such as `setting surfaces.ntfy.enabled`
  instead of the setting being changed.
- Local Context onboarding shows command syntax:
  `/vibe status`, `context action:"files"`, `context action:"file"`,
  `context action:"prompt"`.
- Action results can show `Command: ...` inside onboarding panes.

Required UX:

- No slash-command-looking strings in first-run onboarding cards, rows, context,
  or result panes.
- Replace `Action` / `Does` in onboarding with user-facing labels such as
  `Option` / `Change`.
- For setting actions, show a compact preview like:
  `surfaces.ntfy.enabled: false -> true`
- For secret-ish settings, do not display secret material. Use a compact redacted
  value such as `(secret)` or `(set)`.
- Do not add a giant metadata table in the lower pane. The user asked to see the
  setting, not source/default/owner/secret-ref essays.
- Keep confirmation and writes safe, but do not turn onboarding into ceremony.

Files to edit first:

- `src/renderer/agent-workspace.ts`
- `src/input/agent-workspace-settings.ts`
- `src/input/agent-workspace.ts`
- `src/input/agent-workspace-onboarding-categories.ts`
- `src/renderer/agent-workspace-context-lines.ts`
- `src/test/renderer/agent-workspace.test.ts`

Suggested implementation:

1. Add a compact setting preview helper in
   `src/input/agent-workspace-settings.ts`.
   It should read the current value, compute the proposed value from the
   selected setting action, redact secret-ish values, and return:
   `<settingKey>: <current> -> <proposed>`.

2. Add a public method on `AgentWorkspace` in `src/input/agent-workspace.ts`
   so the renderer can ask for that setting preview without duplicating config
   logic.

3. In `src/renderer/agent-workspace.ts`, detect onboarding categories
   (`category.group === 'ONBOARDING'`, plus setup/finish if needed) and:
   - render table headers as `Option` / `Change`;
   - render selected meta as `Change: ...`, not `Does: ...`;
   - use the compact setting preview for setting actions;
   - render non-setting onboarding actions as visible UI actions, not commands;
   - suppress `Command: ...` in onboarding action results.

4. In `src/input/agent-workspace-onboarding-categories.ts`, remove command
   strings from Local Context onboarding actions. The labels can stay:
   `Inspect VIBE.md`, `Inspect project context`, `Inspect one context file`,
   `Prompt context`. They should be visible controls/guidance, not
   slash-command instructions.

5. In `src/renderer/agent-workspace-context-lines.ts`, remove any onboarding
   copy that prints command syntax such as `Context routes: ... /vibe status`.

6. Update/add renderer tests so they fail if onboarding leaks:
   - `/vibe status`
   - `context action:"`
   - `Action` / `Does` onboarding headers
   - `Command:` in onboarding panes

7. Add a renderer test that proves an onboarding setting row shows the compact
   current -> proposed preview.

Focused verification after this repair:

```sh
bun test src/test/renderer/agent-workspace.test.ts --timeout 120000
bun test src/test/agent/competitive-feature-inventory.test.ts --timeout 120000
bun run ux:inventory
bun run typecheck
```

## Remaining Competitive Gaps

Do not close these by changing words. Close them with code, tests, and runtime
evidence across Agent, SDK, TUI/daemon, and companion where required.

### First-Run And Always-On Setup

Remaining:

- onboarding UX repair above;
- durable connected-host setup/auth/service/smoke receipt ids;
- setup wizard step history with stable ids and timestamps;
- finish state tied to evidence, not optimistic text;
- browser/PWA first-run readiness folded into finish only after receipts exist.

### Models And Local Model Cookbook

Remaining:

- daemon-fed local provider health and local serving diagnostics;
- model inventory and local endpoint health beyond confirmed model-list smoke;
- per-candidate latency carried into exact route readiness;
- benchmark evidence linked to stable route ids;
- clear separation between benchmark task fit and provider health.

### Omnichannel Inbox And Delivery

Status is `parity`, but do not treat it as release-depth best-in-class yet.

Remaining:

- provider-specific unread inbox polling when a safe message feed exists;
- real delivery outcome certification per channel;
- structured host setup-schema/account/policy/status/doctor receipts;
- stable redacted receipt history for delivery failures and retries.

### Email, Calendar, Notes, Tasks

Remaining:

- fresh provider-backed email thread queues;
- labels and confirmed send/reply/archive/label execution;
- fresh CalDAV/calendar event queues;
- conflict detection and confirmed edit/RSVP execution;
- provider-backed task/reminder/note records beyond current local cards.

### Closed Learning Loop

Remaining:

- external memory provider status/read/write/sync records;
- durable sync/import/export receipts for Honcho, Mem0, Supermemory, and similar
  providers;
- cross-session provider receipt parity;
- keep prompt injection Agent-owned and raw-body-free.

### Autonomous Schedules And Background Work

Remaining:

- true live host output chunk streams;
- durable watcher run history;
- provider-specific Gmail/email/webhook/event source records;
- watcher create/run/start/stop/delete lifecycle receipts;
- queue correlation across triggers, tasks, logs, deliveries, and retries.

### Computer Use, Browser, Shell

Remaining:

- true live process ids and host output chunks in history cards;
- typed PTY sessions;
- typed sudo credential mediation without raw password exposure;
- browser/desktop command execution adapters with trusted receipts;
- visible user control for interactive sessions.

### Multi-Agent And Remote Execution

Remaining:

- remote runner capture/export receipts;
- per-task workspace/worktree evidence;
- completed artifact capture in closeout cards;
- cancellation/failure recovery records;
- default chat stays serial, but complex work should route to supervised
  parallel execution when it helps.

### Deep Research And Knowledge Reports

Remaining:

- live browser-backed research executor;
- progress events, pause/resume/cancel, bounded logs;
- source capture receipts;
- report draft handoff;
- browser/PWA rendering for visual report packets;
- Knowledge promotion from reviewed report artifacts.

### Documents, Files, Model Comparison

Status is `parity`, but still has release-depth follow-up:

- certify reviewer packet delivery outcomes across configured channel targets;
- carry packet wizard, lineage, and archive-share workflow into future
  browser/PWA surfaces without weakening confirmation or ZIP-byte boundaries.

### Mobile, Voice, Device Nodes

Remaining:

- companion app command depth;
- permission repair flows;
- push-to-talk execution;
- wake/speak contracts after scoped runtime permission exists;
- camera/screen/notification/location/local-command route certification by
  platform.

### Web Dashboard And PWA

Remaining:

- browser-native Agent workspace category routes;
- mobile-friendly chat/setup/automation/approval/memory/channel controls;
- browser/PWA completion receipts;
- visual report rendering route;
- first-run finish integration after receipts prove readiness.

### Security, Permissions, Recovery

Status is `leading`, but keep improving:

- reduce unnecessary confirmations for already-approved low-risk workflows;
- attach every autonomous task to audit logs, artifacts, rollback, cancel, or
  recovery affordances.

## Platform Work Required Outside This Repo

Full gap closure is platform-wide. If the next session can work in sibling
repos, do so. If it can only work in `goodvibes-agent`, complete the Agent-owned
pieces and leave explicit failing inventory evidence for unavailable SDK/daemon
contracts.

SDK work needed:

- typed operator contracts for research runner, browser/PWA workspace,
  Personal Ops records/effects, process/PTTY/sudo/live output, watcher history,
  remote runner/worktree, provider/local model health, channel delivery
  receipts, mobile/device/voice, external memory providers;
- realtime event domains with correlation ids, subject ids, timestamps, bounded
  payloads, redaction/truncation metadata;
- browser/web/React Native/Expo-safe client entry points where relevant;
- no wildcard imports and no daemon/TUI implementation in SDK clients.

TUI/daemon work needed:

- publish live runtime records, read models, events, and receipts over the
  connected host;
- no Agent product UX moved into TUI;
- every external effect needs stable ids, inspect routes, lifecycle controls,
  bounded logs, terminal receipts, and recovery routes;
- no raw secrets, tokens, credentials, webhook URLs, or full private bodies.

Companion/mobile work needed:

- permission-scoped device capability records;
- camera/screen/location/notification/local command routes where supported;
- voice workflow records for push-to-talk, transcription, spoken response, and
  wake-word readiness;
- mobile/PWA touch-safe controls and receipts.

## Working Rules For The Next Agent

- UX first, always.
- Code closes gaps. Docs can record state, but docs do not make a feature done.
- Do not hide missing behavior by changing `partial` to `parity`.
- Do not restore deleted old audit documents.
- Do not import from `goodvibes-tui/src`.
- Do not copy daemon implementation into Agent.
- Do not claim SDK type availability as daemon-backed runtime readiness.
- Do not expose slash commands in onboarding.
- Do not add bloated lower-pane metadata when a compact setting preview solves
  the UX problem.
- Keep user-facing routes plain-language and visible.
- Keep confirmation, redaction, cancellation, rollback, and recovery semantics.

## Suggested Next Commands

Start by checking the exact current working tree:

```sh
git status -sb
git diff -- src/agent/competitive-feature-inventory.ts
```

Then repair onboarding code and tests:

```sh
bun test src/test/renderer/agent-workspace.test.ts --timeout 120000
bun test src/test/agent/competitive-feature-inventory.test.ts --timeout 120000
bun run ux:inventory
bun run typecheck
```

Before any future release claim:

```sh
bun run architecture:check
bun run package:verify
bun test --timeout 120000
bun run publish:check
```

Do not release again until the competitive inventory proves the actual product
goal is met.
