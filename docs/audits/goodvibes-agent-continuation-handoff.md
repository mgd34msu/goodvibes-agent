# GoodVibes Agent Continuation Handoff

Date: 2026-06-08

This handoff is for the next agent working in `goodvibes-agent`. It starts from
the current repo state and the corrected product boundary.

## Boundary To Preserve

GoodVibes Agent is the user-facing autonomous assistant harness. It imports the
GoodVibes SDK for shared contracts, clients, runtime types, helpers, and stores.
It contacts the GoodVibes daemon as a running connected-host process through
published operator/control-plane transports, read models, events, and receipts.

Do not import, migrate, or copy `goodvibes-tui` or daemon implementation into
Agent. The TUI project is separate product code. The daemon is runtime
infrastructure reached over its published API. The SDK is the importable shared
package.

The user should not need to know any of that during normal use. Agent's job is
to turn SDK and daemon capabilities into one clear assistant experience with
visible status, confirmation, cancellation, recovery, and durable evidence.

## Current State

Recent work established the competitive inventory, user-first route planner,
setup/status surfaces, VIBE.md personality handling, context discovery, Personal
Ops, schedules, autonomy queue, process UX, browser/device readiness, model
routes, local model cookbook, model comparison, review packets, and audit
surfaces.

The inventory source of truth is
`src/agent/competitive-feature-inventory.ts`. The human-readable audit is
`docs/audits/autonomous-agent-competitive-inventory.md`. The platform capability
audit is `docs/audits/goodvibes-platform-capabilities.md`.

Current inventory counts after the latest correction were:

- Leading: one-assistant mental model, security/permissions/recovery.
- Parity: omnichannel setup/delivery posture, documents/model comparison.
- Partial: first-run setup, models/local cookbook, Personal Ops, learning loop,
  autonomy/background work, computer/browser/shell, multi-agent/remote, deep
  research, mobile/voice/device, web/PWA.

Do not reinterpret "partial" as "move code into Agent." For each partial item,
first determine which evidence is missing:

- SDK importable contract/type/helper;
- live daemon operator/read-model/event/receipt path;
- Agent UX consumption/exposure path.

Only the third is Agent-owned implementation.

## Immediate Correction Needed

The model/provider health gap was previously phrased too broadly. The SDK
already defines provider health state and UI enrichment types. The daemon can be
contacted through live operator/control-plane paths such as provider runtime
snapshots. Agent currently has model route readiness and a local model cookbook,
but exact model-route readiness does not consume a live provider-health feed
because the current command context exposes `context.platform.readModels` and
`context.clients.operator`, not a direct provider-health read model.

Correct framing:

- SDK work: publish stable provider-health contracts/types/read-model access if
  they are not already exported through the intended public entry points.
- Daemon/TUI work: publish or feed live provider-health records from the running
  connected host over operator/read-model/event contracts.
- Agent work: once that live path exists in `CommandContext`, consume it in
  `src/tools/agent-harness-model-routing.ts` so latency/status affects exact
  route readiness and missing signals.

## Agent-Owned Remaining Gaps

Setup:

- Auto-advance setup wizard step history from durable daemon setup/auth/service
  receipt ids when those receipts are available.
- Keep first-run finish state tied to evidence, not optimistic status text.

Models:

- Update model readiness wording so it distinguishes SDK provider-health type
  availability, daemon live health publication, and Agent consumption.
- Once live provider health is reachable through context, attach provider
  status, configured state, average/min/max latency, and last error posture to
  exact model route readiness.
- Keep local benchmark evidence separate from provider health. Benchmark
  artifacts prove task fit; provider health proves live route condition.

Personal Ops:

- Keep read-only connector execution and saved redacted review cards.
- When daemon/provider records arrive, add fresh thread/event/task queues and
  confirmed send/edit/RSVP/archive effects as Agent routes over those receipts.

Memory/Learning:

- Keep prompt injection Agent-owned.
- Consume external memory provider status/read/write/sync receipts only when SDK
  and daemon publish concrete provider records.

Autonomy:

- Consume watcher run/source records and live host output chunks when daemon
  publishes them.
- Keep watcher setup as exact confirmed daemon methods with trusted source,
  scope, target, and success criteria.

Computer/Shell/Browser:

- Continue exposing local ProcessManager parity honestly.
- Add typed PTY/sudo/live-output UX only after SDK and daemon publish typed
  contracts.
- Keep browser/desktop command execution behind trusted tool/daemon receipts.

Multi-Agent/Remote:

- Consume remote runner artifact/export/worktree receipts when daemon publishes
  them.
- Keep default chat serial; route to supervised parallel work only when it helps.

Deep Research:

- Agent has planning, local run ledger, source queue, sourced report artifacts,
  and visual report packets. The missing Agent work starts after daemon/browser
  runner events and report-render receipts exist.

Mobile/Web/PWA:

- Keep device/browser readiness honest.
- Consume browser workspace receipts, mobile control records, and permission
  repair records when daemon/companion publishes them.

## Files To Inspect First

- `src/agent/competitive-feature-inventory.ts`
- `docs/audits/autonomous-agent-competitive-inventory.md`
- `docs/audits/goodvibes-platform-capabilities.md`
- `docs/audits/goodvibes-tui-handoff.md`
- `docs/audits/goodvibes-sdk-handoff.md`
- `src/tools/agent-route-planner.ts`
- `src/tools/agent-harness-model-routing.ts`
- `src/tools/agent-harness-setup-posture.ts`
- `src/tools/agent-harness-personal-ops.ts`
- `src/tools/agent-harness-autonomy-intake.ts`
- `src/tools/agent-harness-autonomy-queue.ts`
- `src/tools/agent-harness-execution.ts`
- `src/tools/agent-harness-computer-control.ts`
- `src/tools/agent-operator-method-tool.ts`
- `src/input/command-registry.ts`
- `scripts/check-architecture.ts`

## Verification Commands

Use focused checks after editing:

```sh
bun run ux:inventory
bun test src/test/agent/competitive-feature-inventory.test.ts --timeout 120000
bun test src/test/docs/agent-boundary-docs.test.ts --timeout 120000
bun test src/test/tools/agent-harness-tool.test.ts --timeout 120000
```

Use broader checks before release or before claiming the handoff is complete:

```sh
bun run architecture:check
bun run package:verify
bun test --timeout 120000
```

If tests fail because they encode the old boundary, update the tests to protect
the corrected boundary instead of preserving stale language.

## Do Not Do

- Do not import from `goodvibes-tui/src`.
- Do not copy daemon/TUI implementation into this repo.
- Do not start claiming daemon-backed readiness from SDK types alone.
- Do not hide gaps by changing `partial` to `parity` without current evidence.
- Do not expose package boundaries as user choices in normal assistant routes.
- Do not weaken confirmation, redaction, or recovery semantics to make a feature
  look complete.
