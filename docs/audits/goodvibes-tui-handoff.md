# GoodVibes TUI And Daemon Handoff

Date: 2026-06-08

This handoff is for the agent working in `github.com/mgd34msu/goodvibes-tui`.
GoodVibes Agent will own the autonomous-assistant UX. GoodVibes TUI and the
daemon should publish the runtime substrate that lets Agent honestly turn its
current route plans into visible, cancellable, resumable work.

## Product Boundary

The user should experience one assistant. Package boundaries should not leak
into normal use.

GoodVibes TUI keeps:

- the existing terminal renderer and coding/operations harness;
- the daemon/API host;
- service lifecycle, runtime panels, browser/PWA host surfaces, remote peers,
  channels, automation, tasks, watchers, knowledge, media, and provider
  runtime;
- typed operator method publication backed by the SDK contract artifact.

GoodVibes Agent keeps:

- autonomous assistant conversation UX;
- Agent-first setup/import of GoodVibes settings;
- local Agent memory/personality/context/workspace records;
- model-facing routes that turn daemon capabilities into user-first actions;
- confirmation, redaction, recovery, and visible queue semantics for the
  autonomous assistant.

Do not move Agent's product-specific route planning back into TUI. Publish clean
daemon contracts and evidence, then Agent will consume them.

## Current Agent Consumption Points

Agent already exposes user-first routes for the capabilities below. The TUI and
daemon work should publish durable records, receipts, and event streams behind
these routes instead of adding new user-facing topology:

- setup/host health: `setup action:"status|repair"` and
  `host action:"status|services|methods"`;
- Personal Ops: `personal_ops action:"briefing|status|queue|intake|lane|read"`;
- channels: `channels action:"status|channel|setup|triage|deliveries"` and
  confirmed `agent_channel_send`;
- research: `research action:"briefing|plan|runner|runs|sources|reports"`;
- browser/PWA: `computer action:"browser|open_browser"` and
  `workspace action:"surface" surfaceId:"connected-browser-cockpit"`;
- computer/process: `computer action:"plan|control|setup|mcp"` and
  `execution action:"processes|process_capabilities|process|history|recovery"`;
- mobile/voice/device: `device action:"status|capability|voice|provider"`;
- local models: `models action:"status|route|local|providers|provider|smoke"`;
- external memory posture: `memory action:"provider|status"`.

The missing work is not another Agent UI. It is making those routes turn from
honest readiness/setup guidance into durable daemon-backed execution where the
host can prove readiness, progress, cancellation, receipts, and recovery.

## Agent Release Handoff Matrix

GoodVibes Agent now marks these competitive items as `handoff`: Agent-owned UX,
route planning, confirmation, redaction, and recovery posture are present in
this repo; the remaining release depth belongs to `goodvibes-tui` and the
daemon runtime.

| Agent inventory item | TUI/daemon work required | Agent consumption route |
|---|---|---|
| `first-run-and-always-on-setup` | Durable service/auth/smoke receipt records with ids, timestamps, stale-state signals, and setup-step correlation. | `setup action:"status|repair|smoke|finish"` |
| `models-and-local-model-cookbook` | Local serving health records for provider endpoints, model inventory, latency, degradation, setup-needed state, and last smoke evidence. | `models action:"status|route|local|smoke"` |
| `email-calendar-notes-and-tasks` | Fresh provider-backed inbox, calendar, task, reminder, and note records with durable provider ids plus confirmed effect receipts. | `personal_ops action:"briefing|queue|intake|lane|read"` |
| `closed-learning-loop` | External memory provider setup/status/read/write/sync records and redacted sync receipts from the daemon where runtime mediation is needed. | `memory action:"provider|status"` |
| `autonomous-schedules-and-background-work` | Live output chunk streams, durable watcher run history, provider source records, redacted event descriptors, and queue correlation. | `autonomy action:"intake|queue|item"` |
| `computer-use-browser-and-shell` | Typed PTY sessions, live output records, safe sudo mediation, and browser/desktop command execution receipts. | `execution action:"process_capabilities|processes|history"` and `computer action:"plan|control"` |
| `multi-agent-and-remote-execution` | Remote runner capture/export receipts, workspace/worktree isolation evidence, changed-file summaries, and recovery/cancel records. | `agent_orchestration`, `agent_work_plan`, `delegation action:"routes"` |
| `deep-research-and-knowledge-reports` | Browser-backed research executor, source capture events, bounded logs, report handoff receipts, and visual report browser rendering. | `research action:"runner|runs|sources|reports"` |
| `mobile-voice-and-device-nodes` | Companion command records, permission repair, push-to-talk receipts, wake/speak readiness, camera/screen/notification/location route certification. | `device action:"status|capability|voice"` |
| `web-dashboard-and-pwa` | Browser-native Agent workspace category routes, mobile controls, PWA open/completion receipts, and first-run browser readiness receipts. | `computer action:"browser|open_browser"` and `workspace action:"surface"` |

These requirements should be implemented in `goodvibes-tui`/daemon and then
published through the SDK contract. Agent should only consume the published
records; it should not copy runtime implementations into this package.

## Priority 0: Durable Setup Receipt Records

Agent already has setup checkpoints, smoke evidence artifacts, service repair
decisions, and finish markers. The daemon should publish durable receipt records
so Agent can auto-advance individual setup steps from source-owned proof instead
of inferring readiness from one live probe.

Publish records for:

- service status/install/start/restart outcomes;
- operator token/auth pairing status and repair outcomes;
- setup smoke execution, first assistant turn proof, and failure blockers;
- browser/PWA cockpit open readiness when it participates in setup closeout.

Required fields:

- `receiptId`, `kind`, `subjectId`, `correlationId`, `status`;
- `createdAt`, `startedAt`, `completedAt`, `lastCheckedAt`;
- `setupStepId`, `sourcePackage`, `sourceRoute`, `redaction`;
- `summary`, `blockers`, `nextRoute`, `recoveryRoute`.

Acceptance tests:

- Re-running setup status returns the same latest receipt ids until source state
  changes.
- Failed receipts preserve blocker detail without raw tokens, command output, or
  secrets.
- A ready service/auth/smoke receipt can be correlated to one setup wizard step.
- Browser/PWA readiness receipts are explicit and never inferred from a URL
  string alone.

## Priority 1: Deep Research Live Runner

Agent already has a visible local research run ledger, source queue, reviewed
source bundles, sourced report artifacts, visual-report packets, and read-only
runner readiness/route planning. The missing daemon work is the live
browser-backed executor and event stream.

Publish a browser-backed research runner contract that can:

- start a research job from a user-facing question, optional plan, and visible
  run id/correlation id supplied by Agent;
- emit bounded progress events with phase, percent, current URL/title, current
  action, log tail, captured source ids, and error/recovery state;
- pause, resume, cancel, and fail a run by exact id;
- capture source receipts with title, URL, fetched timestamp, quote/evidence
  snippets, credibility hints, screenshot/artifact references when available,
  and redacted browser action history;
- hand off final report material as saved artifacts or explicit report input
  packets, not inline unbounded transcript text;
- expose setup/readiness state when browser automation is unavailable.

Suggested operator methods, using the repo's existing naming conventions:

- `research.runner.status`
- `research.runner.start`
- `research.runner.pause`
- `research.runner.resume`
- `research.runner.cancel`
- `research.runner.logs`
- `research.sources.capture`
- `research.sources.list`
- `research.reports.handoff`

Acceptance tests:

- Starting a run returns a stable run id, user question, status, cancel route,
  and correlation id.
- Polling/logging returns bounded output with truncation metadata.
- Cancelling a run stops browser work and emits a terminal cancelled receipt.
- Captured sources include enough metadata for Agent to create or update its
  source queue without refetching.
- Browser unavailable state returns setup/fallback guidance, not a fake success.

## Priority 2: Browser/PWA Agent Workspace Surface

Agent now exposes the connected browser cockpit/PWA as a route, but the host
does not yet publish browser-native completion receipts or category rendering
for Agent workspaces.

Publish browser/PWA host support for:

- workspace categories matching Agent's user-facing cockpit: Home, Setup,
  Chat/Model, Work, Personal Ops, Research, Documents, Knowledge, Voice/Media,
  Local Context, Safety/Recovery, and Settings;
- route open receipts with surface id, URL/path, category id, auth posture,
  mobile readiness, and completion status;
- mobile/touch-safe action forms that preserve Agent confirmation boundaries;
- visual report rendering for saved research visual-report packets, with
  source-map/citation coverage visible and export routes available;
- reconnect/session state so refreshing the browser does not lose active run
  status.

Acceptance tests:

- A browser open route returns a receipt Agent can inspect later.
- Each published category reports ready, attention, setup-needed, or
  not-published.
- A saved visual research report renders with all required sections and source
  coverage, and refuses to render as complete when required citations are
  missing.
- Mobile viewport smoke checks prove core controls do not overlap and action
  confirmation is still explicit.

## Priority 3: Personal Ops Provider Queues And Effects

Agent can now route daily/calendar briefings to
`personal_ops action:"briefing"`, saved review queues to
`action:"queue"`, fresh inbox/calendar reads to `action:"intake"` with
confirmation boundaries, connector setup posture to `action:"lane"`, and one
confirmed read-only connector operation to `action:"read"` with redacted review
cards. The missing daemon work is fresh, durable provider-backed records and
confirmed effects.

Publish durable provider records for:

- inbox threads/messages;
- calendar events/agenda/conflicts;
- tasks/reminders/notes when backed by an external provider;
- delivery attempts and replies.

Records must include stable provider ids, account/surface ids, freshness,
redacted display fields, exact refresh/read routes, and allowed confirmed effect
routes. Effects should include draft/send/reply/archive/label, event edit/RSVP,
task update, reminder update, and note create/update where the provider supports
them.

Acceptance tests:

- Listing inbox/calendar queues returns redacted records with stable provider
  ids and freshness metadata.
- Refreshing an item writes a new receipt without exposing raw secrets or full
  private bodies.
- Write-like actions require confirmation and explicit user request.
- Send/edit/RSVP/archive effects return durable provider outcome receipts that
  Agent can show in Personal Ops and Channels.

## Priority 4: Process, PTY, And Sudo Contracts

Agent already has `terminal` and `process` UX over background commands and can
probe for stdin support. It still reports PTY and sudo as unsupported unless a
typed substrate exists.

Publish typed process contracts for:

- background start/list/poll/wait/log/kill/write;
- PTY session create/write/resize/poll/log/wait/kill;
- live output chunks with sequence numbers and truncation metadata;
- safe sudo mediation that never prints or stores raw passwords, supports
  foreground prompt guidance, and returns credential posture/receipt ids.

Acceptance tests:

- PTY mode can run an interactive command and accept input.
- Resize events are accepted and reflected in terminal output behavior.
- `sudo` paths either complete with a credential receipt or return a clear
  foreground-supervised escalation path.
- Logs are bounded/redacted and include continuation cursors.

## Priority 5: Watcher History And Autonomous Triggers

Agent can call published watcher methods and surface certified receipts, but it
does not yet have durable provider-specific watcher source records.

Publish watcher run history with:

- watcher id, source type, trusted source/scope, trigger target, status, and
  last run;
- provider-specific source ids for Gmail/email/webhook/event-stream triggers;
- run receipts with matched event metadata, task/run correlation ids, logs,
  delivery outcomes, and retry/failure state;
- start/stop/delete lifecycle receipts.

Acceptance tests:

- Creating a watcher returns an inspectable durable record.
- A manual run writes a run receipt with event/source metadata.
- Start/stop/delete update state and emit events.
- Agent can list recent watcher runs without using raw audit logs.

## Priority 6: Remote Runner And Worktree Evidence

Agent exposes multi-agent orchestration and remote-runner evidence slots. The
daemon should publish stable receipts so Agent can close out delegated or remote
work without guessing.

Publish remote runner records with:

- runner id, workspace/worktree id, task id, agent id, status, current step,
  log tail, artifact ids, changed-file summary, review route, cancel route, and
  recovery route;
- artifact export/review receipts tied to runner id;
- failure state with retry and cleanup guidance.

Acceptance tests:

- A remote task creates a runner record with workspace/worktree evidence.
- Completed tasks include artifact ids and changed-file summaries.
- Cancelled/failed tasks preserve logs and recovery routes.

## Priority 7: Local Model Serving Health

Agent already has a local model cookbook, endpoint inspection, smoke routes, and
benchmark evidence. The daemon should deepen live provider health.

Publish provider/local server records for Ollama, llama.cpp, vLLM, LM Studio,
and OpenAI-compatible endpoints:

- process/service posture, endpoint URL, model inventory, context limits,
  health, latency, last smoke result, install/start/stop routes where supported;
- hardware fit hints and recommended model recipes when available;
- benchmark receipt linkage.

Acceptance tests:

- A disconnected local endpoint returns actionable setup state.
- A connected endpoint returns model inventory and last smoke evidence.
- Start/stop actions are inspect-first and confirmation-gated.

## Priority 8: Mobile, Voice, Device, And Delivery Receipts

Agent currently exposes honest readiness maps for companion devices, voice
workflows, and channels. It routes channel setup to
`channels action:"setup"`, triage/retries/errors to `action:"triage"`,
delivery history to `action:"deliveries"`, and sends to target readiness before
confirmed `agent_channel_send`. Publish concrete records only where the host can
back them.

Needed daemon records:

- companion device capability records for camera/location/files/notifications
  when supported;
- push-to-talk, voice memo transcription, spoken-response, and wake-word
  readiness/receipt records;
- delivery outcome receipts for channels with external message ids, status,
  retry/failure, and redacted target info.

Acceptance tests:

- Unsupported sensors report `not-published`, not `ready`.
- Voice workflows return setup/readiness/action receipts by workflow id.
- Channel delivery receipts are inspectable without raw webhook URLs or secrets.

## Event And Evidence Requirements

Every long-running or external-effect contract should emit or expose:

- stable ids and correlation ids;
- read-only inspect route;
- explicit lifecycle controls where supported;
- bounded redacted logs with truncation metadata;
- terminal receipt status: completed, failed, cancelled, blocked, or expired;
- recovery/next route;
- no raw secrets, tokens, credentials, webhook URLs, or full private message
  bodies.

Agent will treat missing fields as unsupported and will keep showing setup or
fallback guidance until the contract proves readiness.

## Suggested Validation

Run the TUI project's normal gates after implementation:

```sh
bun run test
bun run architecture:check
bun run foundation:artifacts
bun run smoke:daemon
```

Also add focused contract tests that export the updated operator contract JSON
and prove Agent can discover the new methods through the existing
`host action:"methods|method"` path.
