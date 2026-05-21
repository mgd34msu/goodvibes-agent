# goodvibes-agent

`goodvibes-agent` is the proactive serial assistant/operator surface for the GoodVibes ecosystem.

It talks to the GoodVibes daemon through public SDK/daemon contracts, owns assistant-local memory, skills, and personas, and delegates real build/fix/review work to GoodVibes TUI sessions instead of becoming a second coding TUI.

## Product Boundary

- Assistant/operator work is serial by default: chat, inspect, remember, schedule, query knowledge, use safe daemon tools, and route tasks.
- WRFC is not a default reasoning mode. It is requested only for explicit build/implementation/fix/review/check work.
- Coding UX, file edits, git/worktrees, QEMU/sandbox command UX, and WRFC execution stay owned by `goodvibes-tui`.
- This package must not import from `goodvibes-tui/src/*`; use `@pellux/goodvibes-sdk`, daemon REST/operator routes, and published contracts.
- The codebase is strongly typed TypeScript. Explicit `any` is not allowed.

## Quick Start

```sh
bun install
bun run dev tui
```

`goodvibes-agent` connects to an already-running GoodVibes daemon. It does not start, stop, install, or supervise the daemon.

For a packed/global install smoke, use the release smoke instead of publishing:

```sh
bun run smoke:release
```

After an intentional publish, Bun global install should look like:

```sh
bun install -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent status
```

Do not use the global install path until the package has been deliberately released.

Common commands:

```sh
bun run dev status
bun run dev config
bun run dev compat
bun run dev smoke
bun run dev auth
bun run dev policy "summarize my current work plan"
bun run dev chat "What do you remember about my Home Assistant setup?"
bun run dev ask "GoodVibes project planning status"
bun run dev ask "GoodVibes project planning status" --json
bun run dev search "GoodVibes Agent"
bun run dev workplan
bun run dev approvals
bun run dev approvals approve <approval-id> --yes
bun run dev automation
bun run dev automation jobs --json
bun run dev automation capacity
bun run dev automation run <job-id> --yes
bun run dev automation cancel <run-id> --yes
bun run dev schedules
bun run dev schedules run <schedule-id> --yes
bun run dev delegations
bun run dev memory add "We use Bun for goodvibes-agent" --class constraint --tags runtime,typescript
bun run dev skills create weekly-plan --description "Plan the week from durable context" --triggers "plan week,weekly planning"
bun run dev skills enable weekly-plan
bun run dev personas create travel --description "Travel planning mode" --body "Plan travel carefully using known preferences."
bun run dev personas use travel
bun run dev delegate --wrfc "Build the first version of the assistant inbox"
bun run dev delegations status <receipt-id>
```

Terminal controls:

- `Enter` submits.
- `Ctrl-J` inserts a newline.
- `Left` / `Right` moves the input cursor.
- `Home` / `End` moves to the start/end of the current input line.
- `Delete` removes the character under the cursor.
- `Up` / `Down` navigates input history and preserves multiline drafts.
- `Ctrl-U` clears the current input.
- `Ctrl-R` refreshes the read-only operator status panes.
- `Ctrl-C`, `Esc`, `/quit`, or `/exit` exits and restores the terminal.

Daemon connection defaults:

- Base URL: `GOODVIBES_AGENT_BASE_URL`, `GOODVIBES_BASE_URL`, or `http://127.0.0.1:3421`
- Token: `GOODVIBES_AGENT_TOKEN`, `GOODVIBES_HTTP_TOKEN`, `GOODVIBES_DAEMON_TOKEN`, or `~/.goodvibes/daemon/operator-tokens.json`
- Companion chat routing: optional `GOODVIBES_AGENT_PROVIDER` and `GOODVIBES_AGENT_MODEL`

When both provider and model are configured, the agent follows daemon runtime provider-row semantics. For example, `GOODVIBES_AGENT_PROVIDER=openai-subscriber` with `GOODVIBES_AGENT_MODEL=openai:gpt-5.5` creates companion chat sessions with provider `openai-subscriber` and model `gpt-5.5`.

Local assistant state is stored under `~/.goodvibes/agent/`.

`compat` reports the exact pinned SDK contract, the daemon version seen through `control.status`, and the current Agent knowledge isolation state. It is read-only and does not switch routes.

Human-facing `ask`, `search`, `workplan`, `approvals`, `delegate`, and `delegations` output is concise by default. Use `--json` on those commands when you need structured output for inspection or tooling. Auth and config diagnostics report token source, presence, and fingerprints, never token values.

Delegation receipts are stored under the agent home so build handoffs remain inspectable even before daemon routes expose origin-filtered delegation history. `delegations` uses public session, task, and work-plan routes opportunistically and shows warnings instead of hiding route failures.

`policy` explains the local safe-action decision for a request. Safe read/format/summarize and non-secret local memory/skill/persona lifecycle actions can proceed; workspace writes, daemon mutations, service changes, package installs, secret handling, deletes, network effects, and external side effects require explicit approval or an explicit command flow. Active persona and skill selections are local agent state and are included in the assistant prompt.

`automation` and `schedules` use public daemon operator routes for snapshots, jobs, runs, heartbeat, schedules, and scheduler capacity. The first side-effecting flows are intentionally narrow and exact-command only: approvals `approve`/`deny`/`cancel`, automation job `run`/`pause`/`resume`, automation run `cancel`/`retry`, and schedule `run`. Every side-effecting route requires `--yes`; without it the command returns `confirmation_required` before calling the daemon. Create/delete/update definitions, schedule enable/disable, heartbeat execution, and daemon lifecycle ownership are intentionally not wired here.

Smoke checks:

```sh
bun run smoke:cli
bun run smoke:release
bun run check:sdk
bun run check:source
bun run check:release
```

`smoke:cli` checks source-tree commands from a temporary agent home. `smoke:release` also runs `npm pack`, installs the packed artifact into a temporary global prefix, verifies the `goodvibes-agent` bin and Bun shebang, then runs installed help/status/smoke checks. Both scripts connect to an already-running daemon; they do not start or stop it.

`check:source` and `check:release` compose the release gates without publishing. Manual PTY smoke steps live in `docs/manual-smoke.md`, and the full release checklist lives in `docs/release-checklist.md`.

## Packaging Notes

While private and unreleased, the package version stays at `0.0.0`. The first intentionally published usable alpha should become `0.1.0`; SDK compatibility is expressed through the exact `@pellux/goodvibes-sdk` dependency pin, not by mirroring SDK or TUI versions.

During pre-1.0 near-fork development, `@pellux/goodvibes-sdk` is pinned exactly to the daemon-compatible version instead of using a caret range. This package does not currently ship a binary postinstall or trust native lifecycle packages it does not directly exercise.

The distributed package must install a real `goodvibes-agent` executable through `package.json` `bin`. The bin is TypeScript-authored and Bun-backed; release smoke must verify `goodvibes-agent --help` and `goodvibes-agent smoke` from a fresh install.

Keep `CHANGELOG.md` current before any version bump. Publishing requires a deliberate release commit that bumps to `0.1.0`, removes `private`, and follows `docs/release-checklist.md`.

## Current Limitations

- Agent knowledge still uses the default `knowledge.ask` and `knowledge.search` routes until SDK/TUI confirm a newer published Agent-specific knowledge seam. This can reflect default-wiki contamination from unrelated GoodVibes domains.
- The agent does not own daemon lifecycle. A compatible daemon must already be running.
- Memory, skills, and personas are local Agent registries until stable shared SDK registries exist.
- The package is private `0.0.0`; do not publish until the release checklist, TUI review, SDK handoff, and manual PTY smoke are complete.

SDK upgrade notes live in `docs/sdk-upgrade.md`.
