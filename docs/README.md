# GoodVibes Agent Docs

These are the package-facing docs for the GoodVibes Agent `1.0.x` release line.

## Current Docs

- [Getting Started](getting-started.md)
- [Connected Host](connected-host.md)
- [Knowledge, Artifacts, and Multimodal](knowledge-artifacts-and-multimodal.md)
- [Tools and Commands](tools-and-commands.md)
- [Channels, Remote Access, and API](channels-remote-and-api.md)
- [Providers and Routing](providers-and-routing.md)
- [Voice and Live TTS](voice-and-live-tts.md)
- [Project Planning](project-planning.md)
- [Release And Publishing](release-and-publishing.md)

## Baseline

- Package executable: `goodvibes-agent`.
- Install/runtime: Bun `1.3.10` or newer.
- Current Agent version: `package.json`.
- SDK pin: exact `@pellux/goodvibes-sdk@0.33.36` version in `package.json`.
- Connected host: owned outside Agent; Agent reports and uses it but does not manage lifecycle.
- Agent Knowledge: only `/api/goodvibes-agent/knowledge/*`; no default knowledge fallback.
- Local state: memory, notes, personas, skills, routines, sessions, setup, and profiles live under the Agent home.
- Build/fix/review work: explicit delegation to GoodVibes TUI, not normal chat behavior.

## Model Access Baseline

Agent-owned model tools expose the same user-facing harness surfaces:

- `agent_harness` for searchable mode discovery, workspace actions, slash commands, settings, panels, UI surfaces, keybindings, tool schemas, service/daemon posture, connected-host capability/status, release evidence, and posture catalogs.
- `agent_knowledge` and `agent_knowledge_ingest` for isolated Agent Knowledge.
- `agent_local_registry` for Agent-local memory, notes, personas, skills, bundles, and routines.
- `agent_work_plan` for visible local work-plan state.
- `agent_operator_briefing` and `agent_operator_action` for public connected operator state and exact confirmed actions.
- `agent_channel_send`, `agent_notify`, `agent_reminder_schedule`, and `agent_media_generate` for explicit confirmed effects.

Catalog modes are compact by default. `agent_harness mode:"modes"` searches all harness modes; `mode:"mode"` inspects one mode contract. Detailed schemas, route hints, redacted log tail, release artifact data, and editor fields require `includeParameters:true` or a singular inspect mode. Registered tool definitions use short top-level descriptions and omit nested parameter descriptions from the default model catalog. Mutations, external delivery, UI routing, keybinding changes, setting writes, local destructive actions, media generation, reminders, and connected-host operator actions remain confirmation-gated and refuse ambiguous lookup.
