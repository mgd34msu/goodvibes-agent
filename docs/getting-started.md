# Getting Started

GoodVibes Agent is the installable public alpha of the personal operator assistant built on the GoodVibes TUI foundation.

## Requirements

- Bun `1.3.10` or newer
- An already-running GoodVibes runtime compatible with `@pellux/goodvibes-sdk@0.33.35`
- A runtime token/config path accepted by connected GoodVibes services

Agent does not launch the runtime for you.

Use the interactive TUI first. CLI subcommands are secondary support paths for install checks, setup inspection, and scriptable local Agent libraries.

## Install From Package

```sh
bun add -g --trust @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent
goodvibes-agent status
goodvibes-agent personas list
goodvibes-agent skills list
goodvibes-agent memory list
```

If the installed command is not found, add Bun's global bin directory to `PATH`:

```sh
export PATH="$(bun pm bin -g):$PATH"
goodvibes-agent --help
```

`--trust` lets Bun run the lifecycle scripts required by the shipped SDK and parser dependencies. A clean global install should leave no pending lifecycle scripts:

```sh
bun pm -g untrusted
```

If you previously installed without `--trust`, run the targeted trust command once and then re-check:

```sh
bun pm trust -g @pellux/goodvibes-agent @pellux/goodvibes-sdk core-js tree-sitter-css tree-sitter-javascript tree-sitter-json tree-sitter-python tree-sitter-typescript
bun pm -g untrusted
```

## Run From Source

```sh
git clone https://github.com/mgd34msu/goodvibes-agent.git
cd goodvibes-agent
bun install
bun run dev
```

`bun run dev` starts the Agent TUI. The same entrypoint backs the installed `goodvibes-agent` command.

`goodvibes-agent` starts the interactive Agent TUI. On a fresh Agent home, the TUI opens Agent setup first.

After setup has been shown once, the TUI opens directly into the Agent operator workspace. You can also reopen it with `/agent`, `/home`, or `/operator`. That fullscreen workspace is the current front door for setup/config, provider/model selection, Agent Knowledge, local memory/skills/routines/personas, channel readiness, voice/media setup, read-only work/approval/automation views, and explicit GoodVibes TUI build delegation.

Use `/agent-profile guide` inside that workspace to walk through starter-profile authoring. It lists built-in and local starters, exports a JSON starter for editing, imports the edited starter back into this Agent home, and creates isolated profiles from the result.

Use the Knowledge area in that workspace to ingest a source URL without leaving the TUI. The form requires typed confirmation and writes only to the isolated Agent Knowledge segment.

Use `/schedule receipts` to review redacted local routine promotion history and `/schedule reconcile` to compare those receipts with live connected schedules through public `schedules.list`.

The local behavior libraries are also available from the installed CLI:

```sh
goodvibes-agent personas create --name "Research Analyst" --description "Source-backed research" --body "Check sources and call out uncertainty" --use
goodvibes-agent skills create --name "Morning Brief" --description "Daily briefing flow" --procedure "Check tasks, approvals, routines, and Agent Knowledge before summarizing" --enabled
goodvibes-agent memory add fact "Prefers concise morning briefings" --scope project --tags preference
goodvibes-agent routines list
```

## Isolated Agent Profiles

Use a separate Agent home when you want isolated local state:

```sh
GOODVIBES_AGENT_HOME=/path/to/agent-home goodvibes-agent status
```

Use named Agent profiles for repeatable local identities:

```sh
goodvibes-agent profiles templates
goodvibes-agent profiles create household --template household --yes
goodvibes-agent profiles templates export research ./research-starter.json --yes
goodvibes-agent profiles templates import ./research-starter.json --yes
goodvibes-agent --agent-profile household status
goodvibes-agent --agent-profile household
```

Named profiles isolate Agent-local config, sessions, memory, personas, skills, routines, and setup state under a profile-specific home. Starter templates seed local personas, skills, and routines for household, research, travel, operations, and personal productivity profiles; exported starter JSON can be edited and re-imported as a local starter. They do not start or isolate connected GoodVibes services by themselves.

## Local Memory, Personas, Routines, And Skills

Memory, personas, routines, and reusable Agent skills are local to GoodVibes Agent. They do not write into default Knowledge/Wiki or non-Agent knowledge segments.

```text
/personas list
/personas create --name Research --description "Source-backed research" --body "Check sources, call out uncertainty, keep answers concise."
/personas use research
/routines create --name "Evening Review" --description "Review open work before shutdown" --steps "Check work plan, approvals, and Agent Knowledge status before summarizing." --enabled true
/routines start evening-review
/schedule promote-routine evening-review --cron "0 17 * * 1-5" --timezone America/Chicago --yes
/channels
/agent-skills create --name "Morning Brief" --description "Daily briefing flow" --procedure "Check tasks, approvals, calendar, and unread state before summarizing." --enabled true
/agent-skills enabled
/skills local list
/recall add fact Prefers concise morning briefings --scope project --tags preference
/recall search morning
```

The active persona plus enabled Agent routines, reviewed memory, and skills are injected into the main serial assistant conversation. Starting a routine records local usage and prints its steps; it does not spawn background agents or automation jobs. Promoting a routine to a schedule is an explicit `schedules.create` call, requires `--yes`, writes a local redacted promotion receipt, and preserves the rule that Agent Knowledge never falls back to default Knowledge/Wiki or non-Agent knowledge segments.

Use `/channels` inside the TUI for a read-only channel readiness matrix. It shows enabled channels, missing config key names, delivery posture, and risk labels without sending messages or rendering token values.

## Connected GoodVibes Services

Start connected GoodVibes services from GoodVibes TUI or the owning host before using service-backed Agent features. Agent expects those services to expose the public operator/Agent routes, including:

- `/status`
- `/api/goodvibes-agent/knowledge/status`
- `/api/goodvibes-agent/knowledge/ask`
- `/api/goodvibes-agent/knowledge/search`
- `/api/goodvibes-agent/knowledge/ingest/url`

If the GoodVibes API is not on `http://127.0.0.1:3421`, use `goodvibes-agent --runtime-url http://host:port status` for a one-off check or set `GOODVIBES_AGENT_RUNTIME_URL=http://host:port` before launching the TUI.

Agent Knowledge/Wiki is an Agent-owned product segment. Agent commands must not fall back to default Knowledge/Wiki or other product-specific knowledge spaces.

Service-hosting commands are not part of GoodVibes Agent. Use `goodvibes-agent status`, `goodvibes-agent doctor`, and the Agent TUI status views for diagnostics.

## Current Product Notes

Agent uses the mature GoodVibes terminal shell, renderer, input, fullscreen workspace, command registry, and release foundation. The active Agent policy is serial/proactive by default, blocks local Agent-owned WRFC/spawn fanout, and delegates explicit build/fix/review work to GoodVibes TUI instead of turning the Agent into a coding TUI.
