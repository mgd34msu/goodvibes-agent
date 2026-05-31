# Operator Capability Benchmark

GoodVibes Agent is built to compete directly with OpenClaw and Hermes Agent in the personal-operator assistant space, while keeping the GoodVibes product boundary explicit:

- Agent uses the GoodVibes TUI shell, renderer, input, fullscreen workspace, command registry, and release bones.
- Agent connects to an externally managed GoodVibes daemon.
- Agent Knowledge/Wiki uses only `/api/goodvibes-agent/knowledge/*`.
- Agent never falls back to default Knowledge/Wiki, HomeGraph, or Home Assistant routes.
- Agent keeps ordinary work serial in the main conversation.
- Agent delegates explicit build/fix/review work to GoodVibes TUI; WRFC is never default.

Use the live benchmark from the package:

```sh
goodvibes-agent capabilities
goodvibes-agent capabilities --json
goodvibes-agent capabilities hermes
```

Inside the TUI:

```text
/capabilities
/capabilities openclaw
/capabilities knowledge
```

## Research Baseline

Primary sources used for the benchmark:

- OpenClaw README: https://github.com/openclaw/openclaw/blob/main/README.md
- OpenClaw Docs: https://docs.openclaw.ai/
- OpenClaw Features: https://docs.openclaw.ai/concepts/features
- OpenClaw FAQ: https://docs.openclaw.ai/help/faq
- OpenClaw Memory: https://docs.openclaw.ai/concepts/memory
- Hermes README: https://github.com/NousResearch/hermes-agent
- Hermes Features Overview: https://hermes-agent.nousresearch.com/docs/user-guide/features/overview/
- Hermes Tools: https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/
- Hermes Skills: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/
- Hermes Cron: https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/
- Hermes MCP: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/
- Hermes Voice: https://hermes-agent.nousresearch.com/docs/user-guide/features/voice-mode/
- Hermes API Server: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/
- Hermes Profiles: https://hermes-agent.nousresearch.com/docs/user-guide/profiles/

## Capability Targets

| Area | OpenClaw/Hermes Baseline | GoodVibes Agent Position |
| --- | --- | --- |
| Terminal operator UI | Interactive CLI/TUI, commands, sessions | Near-fork GoodVibes TUI compositor/input/fullscreen foundation |
| Always-on gateway | Gateway/service owns channels, sessions, tools, events | External GoodVibes daemon, never Agent-owned lifecycle |
| Channels | WhatsApp, Telegram, Slack, Discord, Signal, iMessage, web chat | GoodVibes daemon channel and companion surfaces with Agent-side policy, a Channels operator workspace, and per-channel readiness/risk labels |
| Knowledge/memory | Durable memory, semantic search, wiki/claim layers | Isolated Agent Knowledge routes with workspace ask/search/ingest/review flows plus local memory/skills/personas/routines |
| Skills/procedural memory | Skills directories, registries, skill lifecycle | Local Agent skills with review/stale/source/provenance fields |
| Scheduling | Natural-language cron, run/pause/resume/edit/remove, delivery | Guarded automation/schedule routes plus local routines; hidden model scheduling blocked |
| Tools/MCP | Broad toolsets, MCP, browser, media, terminal, files | GoodVibes SDK tools with Agent policy guards and MCP/provider integrations |
| Voice/media/canvas/nodes | Voice, TTS, mobile nodes, live canvas, browser automation | GoodVibes media/voice/browser/node primitives with an Agent workspace for setup, image input, browser posture, MCP, and remote/node inspection |
| Build/code work | Direct terminal/file/code tools and subagents | Explicit delegation to GoodVibes TUI; local WRFC/spawn fanout blocked |
| Profiles | Independent profiles with own config/memory/skills/gateway | `GOODVIBES_AGENT_HOME` and named `--agent-profile` homes isolate Agent-local state; starter templates seed local personas/skills/routines; the Agent workspace exposes profile and portability flows; daemon remains external |
| Security | DM pairing, approvals, sandboxing, allowlists | Daemon approvals, auth diagnostics, secret refs, confirmation gates, model-tool policy |

## Exceed Targets

GoodVibes Agent should exceed OpenClaw/Hermes by making these properties true from day one:

- Capability surfaces are discoverable through `goodvibes-agent capabilities`, `/capabilities`, onboarding, and the operator workspace.
- Agent Knowledge isolation is a release gate, not a convention.
- Model-visible tools are policy-gated for serial, non-secret, non-destructive use.
- Personal assistant state is Agent-local unless an explicit Agent Knowledge ingest route is used.
- Build work is delegated to the product that owns coding execution instead of turning the personal operator into a second coding TUI.
- Release gates prove package installability, Bun/TypeScript-only source, external-daemon posture, no authored JavaScript, no explicit `any`, and no forbidden default wiki/HomeGraph package-facing docs.

## Current Gaps To Close

- Live daemon account health and last delivery errors in the Channels workspace once a stable read-only route is available.
- Artifact and multimodal Agent Knowledge ingest affordances once Agent-specific routes are stable.
- Custom starter profile authoring/import for teams and repeatable operator lanes.
- Artifact and multimodal Agent Knowledge ingestion when the isolated Agent route accepts artifact-backed media.
- Delegation receipts and artifact review inside the operator workspace.
- Approval center with route risk labels and saved policy presets.
- Intent-gated tool exposure so the model sees fewer irrelevant tools per turn while retaining broad capability coverage.
