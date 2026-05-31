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
goodvibes-agent capabilities daemon
goodvibes-agent capabilities daemon --json
goodvibes-agent capabilities daemon gaps
goodvibes-agent capabilities daemon risk
goodvibes-agent capabilities daemon inventory
goodvibes-agent capabilities daemon coverage
goodvibes-agent capabilities daemon knowledge
```

Inside the TUI:

```text
/capabilities
/capabilities openclaw
/capabilities knowledge
/capabilities daemon
/capabilities daemon gaps
/capabilities daemon inventory
/capabilities daemon coverage
/approval risk
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
- GoodVibes daemon: `@pellux/goodvibes-sdk@0.33.35` public operator contract plus `/api/goodvibes-agent/knowledge/*`

The benchmark measures two different GoodVibes layers:

- daemon capability: what the externally owned GoodVibes daemon can already expose through public operator routes;
- Agent usability: what GoodVibes Agent makes configurable, visible, safe, and usable from day one.

If the daemon already has a route but Agent lacks a good setup/workspace/CLI surface, the gap is treated as an Agent product gap rather than a missing platform capability.

Use `goodvibes-agent capabilities daemon` for the live read-only daemon audit. It checks the public control-plane method catalog, route risk posture, and the isolated Agent Knowledge status route. Use `goodvibes-agent capabilities daemon inventory` for the full public daemon method inventory grouped by category, access, HTTP method, and dangerous flag. Use `goodvibes-agent capabilities daemon coverage` to map every public daemon method to Agent UX posture: usable, read-only observable, explicit-confirmation, blocked by product boundary, or not surfaced yet. Use `goodvibes-agent capabilities daemon gaps` to convert that daemon-measured audit into a prioritized gap plan with `version_mismatch`, `agent_route_missing`, `required_method_missing`, `route_risk_review`, and `agent_ux_gap` rows. Use `goodvibes-agent capabilities daemon risk` or `/approval risk` for a route-risk-aware approval-center view over read-only, mutating, dangerous, and authenticated route metadata. These commands intentionally avoid default `/api/knowledge/*`, HomeGraph, and Home Assistant routes.

## Capability Targets

| Area | OpenClaw/Hermes Baseline | GoodVibes Agent Position |
| --- | --- | --- |
| Terminal operator UI | Interactive CLI/TUI, commands, sessions | Near-fork GoodVibes TUI compositor/input/fullscreen foundation |
| Always-on gateway | Gateway/service owns channels, sessions, tools, events | External GoodVibes daemon exposes sessions, companion chat, channels, remote peers, approvals, automation, schedules, artifacts, MCP, providers, voice, media, web search, and isolated Agent Knowledge; Agent never owns daemon lifecycle |
| Channels | WhatsApp, Telegram, Slack, Discord, Signal, iMessage, web chat | GoodVibes daemon channel and companion surfaces with Agent-side policy, a Channels operator workspace, and per-channel readiness/risk labels |
| Knowledge/memory | Durable memory, semantic search, wiki/claim layers | Isolated `/api/goodvibes-agent/knowledge/*` routes with workspace ask/search/ingest/review flows plus local memory/skills/personas/routines |
| Skills/procedural memory | Skills directories, registries, skill lifecycle | Local Agent skills with review/stale/source/provenance fields |
| Scheduling | Natural-language cron, run/pause/resume/edit/remove, delivery | Local routines can be explicitly promoted to external daemon `schedules.create` with `--yes` and optional explicit delivery targets; redacted local promotion receipts are reviewable and can be reconciled with live `schedules.list`; hidden model scheduling and local scheduler spawns are blocked |
| Tools/MCP | Broad toolsets, MCP, browser, media, terminal, files | GoodVibes daemon exposes MCP, artifacts, web search, providers, media, multimodal, and channel tool routes; Agent adds policy guards and operator setup surfaces |
| Voice/media/canvas/nodes | Voice, TTS, mobile nodes, live canvas, browser automation | GoodVibes daemon exposes voice, media, multimodal, artifacts, and remote/node routes; Agent workspace makes setup and posture visible without daemon ownership |
| Build/code work | Direct terminal/file/code tools and subagents | Explicit delegation to GoodVibes TUI; local WRFC/spawn fanout blocked |
| Profiles | Independent profiles with own config/memory/skills/gateway | `GOODVIBES_AGENT_HOME` and named `--agent-profile` homes isolate Agent-local state; starter templates seed local personas/skills/routines; starter JSON can be exported/imported for local custom lanes; `/agent-profile guide` brings starter authoring into the Agent workspace; daemon remains external |
| Security | DM pairing, approvals, sandboxing, allowlists | Daemon approvals, auth diagnostics, secret refs, confirmation gates, model-tool policy |

## Exceed Targets

GoodVibes Agent should exceed OpenClaw/Hermes by making these properties true from day one:

- Capability surfaces are discoverable through `goodvibes-agent capabilities`, `goodvibes-agent capabilities daemon`, `goodvibes-agent capabilities daemon inventory`, `goodvibes-agent capabilities daemon coverage`, `goodvibes-agent capabilities daemon gaps`, `goodvibes-agent capabilities daemon risk`, `/capabilities`, `/capabilities daemon`, `/approval risk`, onboarding, and the operator workspace.
- Agent Knowledge isolation is a release gate, not a convention.
- Routine-to-schedule promotion preserves Agent Knowledge isolation, uses only public external daemon schedule routes, supports explicit delivery targets, and stores redacted receipts.
- Model-visible tools are policy-gated for serial, non-secret, non-destructive use.
- Personal assistant state is Agent-local unless an explicit Agent Knowledge ingest route is used.
- Build work is delegated to the product that owns coding execution instead of turning the personal operator into a second coding TUI.
- Release gates prove package installability, Bun/TypeScript-only source, external-daemon posture, no authored JavaScript, no explicit `any`, and no forbidden default wiki/HomeGraph package-facing docs.

## Current Gaps To Close

- Live daemon account health and last delivery errors in the Channels workspace once a stable read-only route is available.
- Artifact and multimodal Agent Knowledge ingest affordances once Agent-specific routes are stable.
- Visual starter-template editing inside the fullscreen Agent workspace after the command-guided authoring path.
- Artifact and multimodal Agent Knowledge ingestion when the isolated Agent route accepts artifact-backed media.
- Deeper live run/delivery history and delivery error surfacing for promoted routines.
- Delegation receipts and artifact review inside the operator workspace.
- Saved policy presets for the route-risk-aware approval center.
- Intent-gated tool exposure so the model sees fewer irrelevant tools per turn while retaining broad capability coverage.
