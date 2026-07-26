# GoodVibes Agent

[![CI](https://github.com/mgd34msu/goodvibes-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/mgd34msu/goodvibes-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.17.0-blue.svg)](https://github.com/mgd34msu/goodvibes-agent)

GoodVibes Agent is an installable autonomous operator assistant. You run `goodvibes-agent` and get one workspace for chat, planning, memory, research, scheduling, and confirmation-gated automation, backed by a connected GoodVibes host that supplies the operator API, schedules, channels, knowledge, media, and remote-execution routes. Agent presents that capability as a user-first harness — route planning, plain-language confirmations, and redacted receipts for anything it sends, spends, or writes — instead of exposing raw daemon plumbing. It can also reuse provider, permission, and other shared settings already configured for goodvibes-tui or another published GoodVibes platform store, so setup does not start from zero.

<img src="docs/assets/operator-workspace.png" alt="The fullscreen GoodVibes Agent operator workspace. A left column lists operator areas under an Onboarding heading, with Start and Models flagged for attention. The right pane is headed Start, 16 actions, and summarises setup state: 3 of 13 done, 4 need attention, the current chat route, a count of local personas, skills, routines, and memories, and a next step reading Connected-host auth, blocked. Below, a Setting / Default / Current table lists the available actions — use a local model with no sign-in, sign in to a provider, choose main model, import GoodVibes settings, reasoning effort medium, save history true, and a Finish setup row. A footer shows the workspace key hints." width="900">

---

## Install

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
goodvibes-agent
```

If `goodvibes-agent` is not on `PATH` after a global install:

```sh
export PATH="$(bun pm bin -g):$PATH"
```

On a fresh Agent home, `goodvibes-agent` opens setup first; once setup is applied it opens directly into the Agent workspace.

Each GitHub release also attaches standalone compiled binaries (`goodvibes-agent-linux-x64`, `goodvibes-agent-linux-arm64`, `goodvibes-agent-macos-x64`, `goodvibes-agent-macos-arm64`) and a `SHA256SUMS.txt` manifest, for environments that download a binary directly rather than through Bun. A directly-downloaded binary self-updates at launch — a bounded check against the latest GitHub release, then a checksum-verified download-and-swap when one is newer, with the replaced file always kept beside it as `<file>.previous` so `/update rollback` can undo it. Package-managed installs never self-swap; they defer to `bun add -g` instead. `update.autoUpdateAtLaunch: false` in `settings.json` turns the launch check off.

The semantic (embedding-backed) memory index depends on a native `sqlite-vec` addon that Bun cannot embed in a compiled binary, so each release ships it separately as `sqlite-vec-<os>-<arch>.tar.gz`. A binary with no co-located addon still runs; memory search falls back to literal matching until the matching archive is extracted next to it. This addon stays unavailable on macOS regardless of co-location, because the system SQLite that macOS links refuses to load extensions.

Connect Agent to a GoodVibes daemon before using daemon-backed features — the default target is `http://127.0.0.1:3421`. `goodvibes-agent status --json`, `goodvibes-agent doctor`, and `goodvibes-agent compat` are scriptable checks for that connection and for the install itself. Deeper install notes, the full workspace tour, and CLI diagnostics are in [docs/getting-started.md](docs/getting-started.md) and [docs/connected-host.md](docs/connected-host.md).

---

## A short tour

**The workspace is the product.** `goodvibes-agent` opens straight into a fullscreen operator workspace (reopen it any time with `/agent`, `/home`, or `/operator`); slash commands and CLI subcommands are power-user and scriptable mirrors of the same actions. Press `/` inside the workspace to search every action by name, category, command, or detail.

**One assistant, several jobs.** Beyond normal chat, the workspace gives you read-only web research with explicit hand-off into Agent Knowledge, versioned document drafting with blind model comparison, a Personal Ops area for inbox/agenda/task/reminder/note requests, and an Operator Runtime view of the connected host's own methods and service posture.

<img src="docs/assets/chat.png" alt="A chat turn in the Agent workspace. The header carries the user's question, what can you help me do on this machine. The answer renders as markdown with numbered sections — File and Work Management, Research and Discovery, Agent Configuration, and Personal Operations — each with a short bulleted list, followed by three clarifying questions and a closing suggestion to inspect current status before making changes. A Recent panel on the right lists three timestamped activity entries. The footer shows the active route openrouter:openrouter/free, context at 17 percent, and the turn's up and down token counts." width="900">

**Local behavior is yours to shape.** A friendly `VIBE.md` personality file, separate from project instruction files (`AGENTS.md`, `CLAUDE.md`, and similar), plus local memory, notes, personas, and skills all live under the Agent home and are scanned for secret-looking content before they ever reach a prompt. Personas capture a reusable voice or role; skills capture a reusable capability; routines capture a reusable sequence you can start in chat and, as a separate explicit and confirmation-gated step, promote to a connected schedule.

**Automation stays visible and confirmed.** Reminders, schedules, channel sends, media generation, and visible background agents all show up in one autonomy queue, and every one of them requires an explicit user request plus confirmation before anything actually sends, spends, or runs unattended.

**The model can plan its own route.** Ask a plain question like "email the team a summary" or "what's blocked in setup" and the underlying model can call a route planner that maps the request to the right tool and confirmation boundary before doing anything — it does not have to guess at internal tool names, and ambiguous requests come back as candidates instead of a wrong guess.

<img src="docs/assets/model-picker.png" alt="The Model Workspace, headed Providers And Models. A left column lists the routing targets: Main Chat set, Helper Model off, Tool LLM off, and TTS LLM inherit. The right pane shows the selected target with its current route, the highlighted model and its context window and capabilities, and a filter row for search, price, capability, grouping, and availability. Below, a table of 1906 catalogued models lists model key, display name, provider, context window, tier, and capability flags, with a row indicating 1883 more models below and a footer of list shortcuts including search, price, capabilities, availability, benchmark, and grouping." width="900">

**Isolated by design.** Agent Knowledge is its own segment — Agent only talks to `/api/goodvibes-agent/knowledge/*` and never falls back to another product's knowledge store. Named Agent profiles (`goodvibes-agent profiles create ...`) give you separate, isolated config, sessions, memory, and personas per household, project, or role.

---

## What's in the box

Each row links to the page that documents it. The workspace's own `/` search and `/help` are always the current authority.

| Area | What you get | Docs |
| --- | --- | --- |
| Getting started | Requirements, install paths, first-run areas, model-visible route table, isolated profiles | [getting-started.md](docs/getting-started.md) |
| Connected host | The one required daemon dependency, its knowledge routes, override env vars, product-boundary rules | [connected-host.md](docs/connected-host.md) |
| Providers and routing | Provider/model visibility, local provider definitions, the local model cookbook | [providers-and-routing.md](docs/providers-and-routing.md) |
| Tools and commands | Workspace actions, slash commands, CLI mirrors, model-tool catalog, settings and keybinding writes | [tools-and-commands.md](docs/tools-and-commands.md) |
| Knowledge, artifacts, and multimodal | Isolated Agent Knowledge, document/image/media artifacts, ingest and review routes | [knowledge-artifacts-and-multimodal.md](docs/knowledge-artifacts-and-multimodal.md) |
| Channels, remote access, and API | Slack, Discord, Telegram, Matrix, webhook, and other configured channels; setup/triage/delivery; companion pairing; the operator method catalog | [channels-remote-and-api.md](docs/channels-remote-and-api.md) |
| Voice and live TTS | Spoken playback, TTS/STT provider setup | [voice-and-live-tts.md](docs/voice-and-live-tts.md) |
| Release and publishing | Package identity, release asset layout, the publish-check text and metadata gates | [release-and-publishing.md](docs/release-and-publishing.md) |

Full index: [docs/README.md](docs/README.md).

---

## Configuration

Settings live in a layered `settings.json`, editable through the `/settings` workspace or by hand:

- global — `~/.goodvibes/agent/settings.json`
- project — `.goodvibes/agent/settings.json`

A few keys worth knowing up front:

| Key | Default | What it does |
| --- | --- | --- |
| `update.autoUpdateAtLaunch` | `true` | Check for and install a newer release at launch (standalone binaries only) |
| `update.launchCheckTimeoutMs` | `2500` | How long that launch check may take before it is skipped; clamped to 250–30000 |
| `checkpoints.preferGitRoot` | `true` | Snapshot the enclosing git repository's root rather than the raw working directory |
| `checkpoints.allowBroadRoot` | `false` | Opt in to snapshotting a broad root such as the filesystem root or home directory |
| `checkpoints.autoRetention` | `true` | Run a retention sweep automatically after each checkpoint |

Other useful overrides:

- `GOODVIBES_AGENT_HOME=/path/to/agent-home` — run with an isolated Agent home instead of the default one.
- `GOODVIBES_AGENT_RUNTIME_URL=http://host:port` (or the `--runtime-url` flag) — point at a GoodVibes host on a different address; `GOODVIBES_AGENT_BASE_URL` is accepted as a legacy alias.
- `~/.goodvibes/agent/providers/*.json` — local, hot-reloaded custom provider definitions.
- `/settings action:"import"` (or `import_goodvibes_settings`) — preview, then apply, provider/UI/permission/subscription/surface/tool/daemon-endpoint settings already configured for goodvibes-tui or another published GoodVibes platform store, without mutating the source.

The full settings catalog, the checkpoint-guard keys, and the shared-settings-import contract are in [docs/tools-and-commands.md](docs/tools-and-commands.md) and [docs/getting-started.md](docs/getting-started.md).

---

## Development

Agent builds on the existing terminal renderer and workspace foundations of the GoodVibes platform; what differs is the product layer composed on top of them.

```sh
git clone https://github.com/mgd34msu/goodvibes-agent.git
cd goodvibes-agent
bun install
bun run dev
```

| Command | Does |
| --- | --- |
| `bun run dev` | Run the Agent TUI from source |
| `bun test` | Run the test suite |
| `bun run typecheck` | Type-check the source tree |
| `bun run build` | Compile `src/main.ts` into `dist/goodvibes-agent` |
| `bun run package:install-check` | Verify the packaged CLI actually installs and runs |
| `bun run publish:check` | Run the package-facing text, metadata, and tarball-contents gates |

Source layout, in brief:

```text
src/
├── main.ts, core/       terminal entrypoint, orchestrator
├── agent/               channel, calendar, document, and automation domain logic
├── tools/               agent-owned model tools (harness, workspace, channels, knowledge, ...)
├── work-plans/          visible local work-plan tracking
├── permissions/         approval posture and confirmation prompts
├── input/               slash commands, workspace actions, command routing
├── renderer/            terminal UI
├── cli/, cli-flags.ts   CLI subcommands and flags, package verification
├── config/              settings, secrets, checkpoint and update policy
├── runtime/             update checks, release-artifact resolution
├── audio/               spoken-turn playback and routing
├── mcp/, plugins/       MCP server discovery, plugin loading
└── verification/        release-readiness and evidence checks
```

Tests live under `src/test/`, mirroring the source tree, and cover contracts, release gates, package-facing text policy, security boundaries, and the workspace/tool/CLI surfaces above. `bun run publish:check` and `bun run package:install-check` are the same gates the release pipeline runs before a version is published.

The Agent consumes the bundled GoodVibes platform runtime, pinned in `package.json`, for shared contracts, daemon routes, and transports, and keeps the workspace, local behavior library, and Agent Knowledge boundary here. GoodVibes Agent owns the autonomous assistant harness; the connected GoodVibes host owns the platform capabilities Agent presents.

---

## Stability

Documentation always describes the **current** behavior, not historical behavior. Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
