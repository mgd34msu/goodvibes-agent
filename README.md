# GoodVibes Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#install)

GoodVibes Agent is the personal operator assistant TUI for GoodVibes. It is built for day-to-day operator work: chat, setup, local profiles, routines, skills, personas, isolated Agent Knowledge, status review, approvals, automation visibility, and explicit build delegation.

The Agent product connects to a GoodVibes host owned outside this package. It does not install, start, stop, restart, or own that host.

Most work happens in the interactive TUI. The installed CLI exists to launch that TUI, inspect setup, and script local Agent libraries when that is useful.

## Install

Install the public alpha package with Bun:

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent
goodvibes-agent status
goodvibes-agent profiles templates
goodvibes-agent personas list
goodvibes-agent skills list
goodvibes-agent memory list
goodvibes-agent knowledge status
goodvibes-agent knowledge list --kind sources
goodvibes-agent knowledge import-urls ./agent-sources.txt --yes
```

If `goodvibes-agent` is not found after installation, add Bun's global bin directory to `PATH`:

```sh
export PATH="$(bun pm bin -g):$PATH"
goodvibes-agent --help
```

`goodvibes-agent` starts the interactive Agent TUI. On a fresh Agent home, the TUI opens Agent setup first.

## Source Usage

```sh
git clone https://github.com/mgd34msu/goodvibes-agent.git
cd goodvibes-agent
bun install
bun run dev
```

Useful checks:

```sh
bun run typecheck
bun run build
bun run package:install-check
bun run publish:check
```

After setup has been applied once, the Agent TUI opens directly into the operator workspace. You can also reopen it with `/agent`, `/home`, or `/operator`. It is the Agent-first fullscreen workspace for setup, model/provider selection, isolated Agent Knowledge, local memory/skills/routines/personas, channel readiness, voice/media setup, work-plan/approval review, automation observability, and explicit build delegation to GoodVibes TUI.

The setup workspace surfaces discovered local Agent persona, skill, and routine markdown files so day-one setup can import useful behavior instead of starting from blank records. It can also create one initial local persona, skill, and routine directly during first-run setup; those records stay in Agent-local registries and never write to default Knowledge/Wiki or non-Agent segments.

Inside the workspace, use `/agent-profile guide` to author custom profile starters without leaving the Agent TUI. The guided flow lists starters, exports starter JSON, imports edited local starters, and creates isolated Agent profiles from them.

Use `profiles create-from-discovered <name> --yes` or the Profiles workspace form to turn reviewed discovered persona, skill, and routine files into a local starter template and isolated Agent profile in one confirmed flow. `profiles templates from-discovered <id> --yes` is still available when you only want to save the starter first.

The Knowledge area includes an in-workspace URL ingest form. It writes only to Agent Knowledge, requires typed confirmation, and dispatches the existing isolated `/knowledge ingest-url ... --yes` route.

Use isolated Agent profiles when one machine needs separate operator identities or local state:

```sh
goodvibes-agent profiles templates
goodvibes-agent profiles create household --template household --yes
goodvibes-agent personas create --name "Travel Planner" --description "Plan trips" --body "Compare options before booking" --use
goodvibes-agent skills create --name "Daily Brief" --description "Summarize operator state" --procedure "Review Agent Knowledge, work plans, approvals, and routines" --enabled
goodvibes-agent memory add fact "Prefers concise morning briefings" --scope project --tags preference
goodvibes-agent profiles templates export research ./research-starter.json --yes
goodvibes-agent profiles templates import ./research-starter.json --yes
goodvibes-agent --agent-profile household status
GOODVIBES_AGENT_HOME=/path/to/agent-home goodvibes-agent status
```

Profiles isolate Agent-local config, sessions, local memory, personas, skills, routines, and setup state. Starter templates seed local personas, skills, and routines for household, research, travel, operations, and personal productivity profiles; exported starter JSON can be edited and re-imported as a local starter. The connected GoodVibes host remains shared unless that host is separately configured otherwise.

The same local behavior libraries are available without opening the TUI: `goodvibes-agent personas ...`, `goodvibes-agent skills ...`, `goodvibes-agent memory ...`, and `goodvibes-agent routines ...` list, create, review, enable, stale, export/import where relevant, and delete local Agent records with explicit confirmation for destructive actions.

The Agent workspace also has a `Capture learned behavior` form. Use it after reviewing a repeated workflow, lesson, or operating style; it saves one local skill, routine, or persona directly from the TUI and does not write to connected-host routes or non-Agent knowledge.

Local Agent behavior is editable from the TUI:

```text
/personas create --name Research --description "Source-backed research" --body "Check sources, call out uncertainty, keep answers concise."
/personas use research
/routines create --name "Evening Review" --description "Review open work before shutdown" --steps "Check work plan, approvals, and Agent Knowledge status before summarizing." --enabled true
/routines start evening-review
/schedule promote-routine evening-review --cron "0 17 * * 1-5" --timezone America/Chicago --delivery-channel slack --yes
/schedule receipts
/schedule reconcile
/channels
/agent-skills create --name "Morning Brief" --description "Daily briefing flow" --procedure "Check tasks, approvals, calendar, and unread state before summarizing." --enabled true
/skills list
/memory add fact "Prefers concise morning briefings" --scope project --tags preference
/memory search morning
```

Starting a routine records local usage and prints its steps; it does not launch local workers or automation jobs. Promotion to a connected schedule is separate and explicit: it calls the public `schedules.create` route only after `--yes`, can include explicit delivery targets such as `--delivery-channel slack`, records a redacted local receipt, and the generated scheduled prompt keeps Agent Knowledge isolated from default Knowledge/Wiki and non-Agent knowledge segments. Use `/schedule reconcile` to compare those local receipts against live connected schedules through public `schedules.list`.

Use `/channels` inside the TUI for a read-only channel readiness matrix. It shows enabled channels, missing config key names, delivery posture, and risk labels without sending messages or rendering token values.

## Connected Host

Start the owning GoodVibes host before launching Agent. Agent status and companion/knowledge routes normally connect on `http://127.0.0.1:3421`.

Use `--runtime-url http://host:port` for a one-off launch, or set `GOODVIBES_AGENT_RUNTIME_URL=http://host:port` when the connected host is not on the default local port. The legacy `GOODVIBES_AGENT_BASE_URL` env var is also accepted as an alias. These only change the connection target; Agent still does not host or start it.

Agent reports unavailable, unauthenticated, or incompatible connected-host state through `goodvibes-agent status`, `goodvibes-agent doctor`, and the TUI status views. Host lifecycle stays outside the Agent product.

## Product Boundary

GoodVibes Agent owns the operator assistant TUI: serial assistant flow, proactive safe actions, local memory/routines/skills/personas, Agent knowledge routes, companion chat, approvals/automation observability, and explicit build delegation.

Agent Knowledge/Wiki is its own product segment. Agent uses `/api/goodvibes-agent/knowledge/*` and must not fall back to default Knowledge/Wiki or other product-specific knowledge routes.

Agent Knowledge CLI commands can ask/search, inspect sources/nodes/issues, inspect connectors, ingest a URL, import URL/bookmark files, and reindex the Agent segment. Confirmed mutations require `--yes`.

GoodVibes TUI owns coding execution: file edits, git/worktree workflows, coding panels, execution isolation UX, and WRFC execution. Agent may delegate explicit build/fix/review work to TUI through public runtime/session contracts; normal assistant chat must not use shared coding sessions.

## Package Docs

Package-facing docs:

- [Getting Started](docs/getting-started.md)
- [Connected Host](docs/connected-host.md)
- [Release And Publishing](docs/release-and-publishing.md)

The package-facing Agent documentation is limited to the docs listed above.
