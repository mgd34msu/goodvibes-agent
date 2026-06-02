# Getting Started

GoodVibes Agent is the installable public alpha of the personal operator assistant built on the GoodVibes TUI foundation.

## Requirements

- Bun `1.3.10` or newer
- A connected GoodVibes host compatible with `@pellux/goodvibes-sdk@0.33.35`
- A token/config path accepted by the connected host

Agent does not launch the connected host for you.

Use the interactive TUI first. CLI subcommands are secondary support paths for install checks, setup inspection, and scriptable mirrors of workflows that are already reachable from the workspace.

## Install From Package

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent
```

If the installed command is not found, add Bun's global bin directory to `PATH`:

```sh
export PATH="$(bun pm bin -g):$PATH"
goodvibes-agent --help
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

After setup has been applied once, the TUI opens directly into the Agent operator workspace. You can also reopen it with `/agent`, `/home`, or `/operator`. That fullscreen workspace is the current front door for setup/config, conversation/session controls, provider/model selection, Agent Knowledge, local memory/skills/routines/personas, channel readiness, voice/media setup, read-only work/approval/automation views, and explicit GoodVibes TUI build delegation.

Press `/` inside the Agent workspace to search every workspace action by name, category, command, or detail. Use that finder before reaching for shell commands; CLI subcommands are scriptable mirrors of these TUI workflows.

The setup workspace scans local Agent behavior folders and shows importable persona, skill, and routine files before asking you to create blank records. It can also create one initial local persona, skill, and routine from the setup form. Use the workspace action finder to search for local behavior discovery/import actions, preview files, then import reviewed records from the matching workspace.

Use the Profiles workspace Starter authoring guide to walk through starter-profile authoring. It lists built-in and local starters, exports a JSON starter for editing, imports the edited starter back into this Agent home, and creates isolated profiles from the result.

Use the Profiles workspace form to assemble a local starter template and isolated Agent profile from reviewed discovered persona, skill, and routine files. Scriptable profile commands mirror the same flow for automation; use them only when you intentionally want a shell-driven setup path.

Use the Knowledge area in that workspace to ingest a source URL without leaving the TUI. The form requires typed confirmation and writes only to the isolated Agent Knowledge segment.

Use the Routines workspace receipt actions to review redacted local routine promotion history and reconcile those receipts with live connected schedules through public `schedules.list`. The `/schedule receipts` and `/schedule reconcile` commands are the power-user equivalents inside the TUI.

The local behavior libraries are configured in the TUI first:

- Memory & Skills -> Create memory or Capture learned behavior.
- Personas -> Create persona, Use selected, Review selected, or Delete selected.
- Skills -> Create skill, Create bundle, Enable selected, Review selected, or Delete selected.
- Routines -> Create routine, Start selected, Enable selected, Promote to schedule, or Review receipts.

The installed CLI mirrors these libraries for scripts, but it is not the primary user workflow.

## Isolated Agent Profiles

Use a separate Agent home when you want isolated local state. The normal launch still opens the TUI:

```sh
GOODVIBES_AGENT_HOME=/path/to/agent-home goodvibes-agent
```

Use named Agent profiles for repeatable local identities from Agent Workspace -> Profiles. The workspace can browse starter templates, create isolated Agent profiles, set or clear the default profile for the next launch, and export/import starter JSON.

Scriptable equivalents for automation and setup scripts:

```sh
goodvibes-agent profiles templates
goodvibes-agent profiles create household --template household --yes
goodvibes-agent profiles use household --yes
goodvibes-agent
goodvibes-agent profiles templates export research ./research-starter.json --yes
goodvibes-agent profiles templates import ./research-starter.json --yes
goodvibes-agent --agent-profile household status
goodvibes-agent --agent-profile household
```

Named profiles isolate Agent-local config, sessions, memory, personas, skills, routines, and setup state under a profile-specific home. `profiles use <name> --yes` makes one profile the default for the next plain `goodvibes-agent` launch; `--agent-profile <name>` still overrides it for one launch, and `profiles default clear --yes` returns plain launches to the base Agent home. Starter templates seed local personas, skills, and routines for household, research, travel, operations, and personal productivity profiles; exported starter JSON can be edited and re-imported as a local starter. They do not start or isolate the connected host by themselves.

## Local Memory, Personas, Routines, And Skills

Memory, personas, routines, and reusable Agent skills are local to GoodVibes Agent. First-run setup, TUI workspace forms, and CLI commands all write them to Agent-local registries. They do not write into default Knowledge/Wiki or non-Agent knowledge segments.

Use `Capture learned behavior` in the Agent workspace after reviewing a repeated workflow, lesson, or operating style. It saves one local skill, routine, or persona from the TUI and does not call connected-host mutation routes.

Day-one local behavior setup should stay in the fullscreen workspace:

- Personas -> Create persona, then Use selected.
- Routines -> Create routine, Start selected, or Promote to schedule after entering real timing and confirmation.
- Skills -> Create skill, Enable selected, and review setup requirements.
- Memory & Skills -> Create memory or Search memory.
- Channels -> inspect readiness before enabling notification delivery.

Typed slash commands are available for repeat users, but they are not required for the first-run workflow.

The active persona plus enabled Agent routines, reviewed memory, and skills are injected into the main serial assistant conversation. Starting a routine records local usage and prints its steps; it does not launch local workers or automation jobs. Promoting a routine to a schedule is an explicit `schedules.create` call, requires `--yes`, writes a local redacted promotion receipt, and preserves the rule that Agent Knowledge never falls back to default Knowledge/Wiki or non-Agent knowledge segments.

Use `/channels` inside the TUI for a read-only channel readiness matrix. It shows enabled channels, missing config key names, delivery posture, and risk labels without sending messages or rendering token values.

## Connected GoodVibes Host

Start the owning GoodVibes host before using connected Agent features. Agent expects that host to expose the public operator/Agent routes, including:

- `/status`
- `/api/goodvibes-agent/knowledge/status`
- `/api/goodvibes-agent/knowledge/ask`
- `/api/goodvibes-agent/knowledge/search`
- `/api/goodvibes-agent/knowledge/ingest/url`

If the GoodVibes API is not on `http://127.0.0.1:3421`, pass `--runtime-url http://host:port` for a one-off TUI launch or set `GOODVIBES_AGENT_RUNTIME_URL=http://host:port` before launching the TUI.

Agent Knowledge/Wiki is an Agent-owned product segment. Agent commands must not fall back to default Knowledge/Wiki or other product-specific knowledge spaces.

Host lifecycle commands are not part of GoodVibes Agent. Use Agent Workspace -> Home -> Host compatibility, Doctor diagnostics, and Review health for diagnostics. CLI status/doctor/compat commands are scriptable mirrors for install checks.

## Current Product Notes

Agent uses the mature GoodVibes terminal shell, renderer, input, fullscreen workspace, command registry, and release foundation. The active Agent policy is serial/proactive by default, blocks local Agent-owned WRFC/spawn fanout, and delegates explicit build/fix/review work to GoodVibes TUI instead of turning the Agent into a coding TUI.
