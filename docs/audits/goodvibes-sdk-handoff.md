# GoodVibes SDK Handoff

Date: 2026-06-07

This handoff is for the agent working in `github.com/mgd34msu/goodvibes-sdk`.
GoodVibes Agent needs typed SDK contracts for daemon features that are currently
visible as honest gaps or dynamic probes. The SDK should make those features
stable, documented, testable, and consumable from Bun, browser, web, React
Native, Expo, and worker surfaces where appropriate.

## Product Boundary

The SDK should not own Agent's autonomous UX. It should publish durable types,
clients, route helpers, auth behavior, realtime events, and contract artifacts
that let Agent build that UX without stringly typed guesses.

Good SDK work for this effort has three properties:

- Agent can import or discover a typed contract instead of probing random
  methods.
- Browser/mobile/worker clients can consume the same contract safely.
- Every effect or long-running action has receipt, event, redaction, and
  recovery semantics.

## Priority 1: Operator Contract Expansion

Add typed operator methods and generated references for the daemon contracts
requested in `docs/audits/goodvibes-tui-handoff.md`.

The minimum contract groups are:

- browser-backed research runner;
- browser/PWA Agent workspace surface and visual report rendering;
- Personal Ops provider queues and effects;
- process, PTY, live output, and sudo mediation;
- watcher history and provider trigger source records;
- remote runner/worktree evidence;
- local model serving health;
- mobile/voice/device capability records;
- channel delivery outcome receipts;
- external memory-provider setup/status/read/write/sync records.

Acceptance criteria:

- Contract artifacts expose method ids, input schemas, output schemas, effect
  class, auth scope, confirmation expectation, and realtime event family.
- `docs/reference-operator.md` and generated API docs include the new methods.
- Existing clients can list and call read-only methods without unsafe casts.
- Write/admin methods have explicit effect metadata.

## Priority 2: Realtime Event Domains

Agent needs to move from poll-only UX to visible live autonomy where the daemon
can support it.

Publish typed realtime events for:

- `research.run.updated`, `research.source.captured`,
  `research.report.handoff`;
- `personal_ops.queue.updated`, `personal_ops.effect.receipt`;
- `process.output.chunk`, `process.status.updated`, `pty.status.updated`;
- `watcher.run.created`, `watcher.run.updated`;
- `remote.runner.updated`, `remote.artifact.created`;
- `browser.workspace.opened`, `browser.workspace.receipt`;
- `provider.health.updated`, `local_model.smoke.receipt`;
- `channel.delivery.receipt`;
- `memory_provider.sync.receipt`.

Each event should carry correlation id, subject id, timestamp, status, bounded
payload, and redaction/truncation metadata where content exists.

Acceptance criteria:

- Events are documented in `docs/reference-runtime-events.md`.
- Realtime tests cover reconnect and session/subject filtering.
- Browser and React Native clients can subscribe without Node-only imports.

## Priority 3: Deep Research And Visual Report Types

Agent already saves local visual report packets. The SDK should define the
shared runtime shape so daemon, browser, and Agent agree.

Needed types:

- research run request, status, phase, progress, controls, checkpoint, and log
  tail;
- captured source receipt with credibility hints, evidence snippets,
  screenshot/artifact refs, and fetch metadata;
- visual report packet with at-a-glance summary, evidence matrix, findings
  board, dated source/comparison view, open questions, next actions, handoff
  checklist, source map, citation coverage, and repair hints;
- browser rendering receipt and export/archive handoff references.

Acceptance criteria:

- Type tests prove packets are runtime-neutral and browser-safe.
- Invalid citation/source-map coverage fails schema validation.
- Examples show a daemon report handoff and a browser render call.

## Priority 4: Personal Ops Types

Agent needs provider-backed Personal Ops records that are private by default but
actionable.

Needed types:

- provider account summary;
- redacted inbox thread/message card;
- redacted calendar event/agenda/conflict card;
- task/reminder/note card;
- operation schema with required fields, confirmation flag, sample redacted
  input, and effect class;
- refresh/read receipt;
- draft/send/reply/archive/label/edit/RSVP/update receipts.

Acceptance criteria:

- No type exposes raw secrets, raw OAuth tokens, raw webhook URLs, or full
  private message bodies by default.
- Write/effect receipts contain provider outcome ids and inspect routes.
- Tests prove read routes and effect routes are classified distinctly.

## Priority 5: Process, PTY, Sudo, And Live Output Types

Agent currently supports process UX and dynamically detects stdin support. SDK
should publish stable runtime types so Agent can offer PTY and sudo when real.

Needed types:

- background process id/session id aliasing;
- process status, exit code, started/ended timestamps, cwd, command display,
  redacted log tail, and continuation cursor;
- PTY create/write/resize/log/wait/kill request and receipt;
- output chunk with sequence, stream, text bytes/chars, truncation, and cursor;
- sudo credential posture and credential receipt without password material.

Acceptance criteria:

- Type tests prevent raw credential fields.
- Browser/mobile bundles do not pull Node process APIs accidentally.
- Docs explain foreground-supervised sudo fallback separately from credential
  presence.

## Priority 6: Watcher, Remote Runner, And Worktree Types

Needed types:

- watcher record, source record, run receipt, lifecycle receipt, and trusted
  source/scope policy;
- remote runner record, linked task/agent/worktree ids, artifact ids, changed
  file summary, log tail, review/cancel/recovery routes;
- remote artifact review/export receipt.

Acceptance criteria:

- A watcher run can be correlated to a created task/run.
- A remote runner can be correlated to artifacts and worktree evidence.
- Failure/cancel states preserve recovery routes and bounded logs.

## Priority 7: Local Model Health Types

Needed types:

- local provider/server endpoint;
- model inventory item;
- health/smoke/benchmark receipt;
- service lifecycle route posture;
- hardware fit and recipe confidence metadata.

Acceptance criteria:

- Endpoint health can represent unavailable, setup-needed, ready, degraded, and
  blocked states.
- Smoke receipts carry enough evidence for Agent to show last known result
  without rerunning the smoke.

## Priority 8: External Memory Provider Contracts

Agent currently exposes setup maps for Honcho, OpenViking, Mem0, Hindsight,
Holographic, RetainDB, ByteRover, and Supermemory but correctly reports provider
records as not published.

Publish provider-neutral contracts for:

- setup/status;
- account/workspace binding;
- read/search;
- write/upsert;
- sync/import/export;
- review/stale/delete if provider supports it;
- receipts and redaction policy.

Acceptance criteria:

- Providers can report capability differences without pretending unsupported
  writes are available.
- Agent can inspect provider status and recent sync receipts.
- Prompt injection remains Agent-owned; SDK only publishes memory provider
  records and receipts.

## Client Surface Expectations

Update only explicit public entry points. The root SDK README says there is no
wildcard `@pellux/goodvibes-sdk/platform/*` contract; preserve that.

Expected surfaces:

- `@pellux/goodvibes-sdk/contracts` for method ids, schemas, effect metadata,
  event ids, and shared types;
- `@pellux/goodvibes-sdk/operator` for operator client methods;
- `@pellux/goodvibes-sdk/browser` and `@pellux/goodvibes-sdk/web` for browser
  workspace/report/receipt clients;
- `@pellux/goodvibes-sdk/react-native` and `@pellux/goodvibes-sdk/expo` for
  mobile/device/voice-safe client access where supported;
- `@pellux/goodvibes-sdk/daemon` for route dispatch/embedding helpers.

Do not introduce new wildcard imports or Node-only dependencies into browser,
web, React Native, Expo, or worker bundles.

## Documentation And Examples

Update:

- `docs/reference-operator.md`
- `docs/reference-runtime-events.md`
- `docs/browser-integration.md`
- `docs/web-ui-integration.md`
- `docs/react-native-integration.md`
- `docs/expo-integration.md`
- `docs/automation.md`
- `docs/runtime-orchestration.md`
- `docs/media-and-search.md`
- `docs/tools.md`
- `docs/voice.md`
- `docs/security.md`

Add small examples for:

- subscribing to a research run event stream;
- rendering a visual report packet in a browser client;
- listing Personal Ops queue records and executing a confirmed effect;
- creating a PTY session and reading output chunks;
- inspecting watcher run history;
- inspecting remote runner artifacts;
- reading external memory provider status.

## Suggested Validation

Run the SDK project's normal gates after implementation:

```sh
bun run validate
bun run types:check
bun run contracts:check
bun run refresh:contracts:check
bun run docs:check
bun run check:browser
bun run test:rn
bun run test:workers
```

Add focused tests for every new contract family. The Agent integration target is
that `@pellux/goodvibes-sdk/contracts` can be updated in GoodVibes Agent and the
new methods/events can be discovered without ad hoc string probing.
