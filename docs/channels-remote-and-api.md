# Channels, Remote Access, and API

GoodVibes Agent can be reached from terminal-first and companion surfaces, but the Agent product does not own transport hosting. It connects to the already-running GoodVibes runtime and uses public operator routes for status, sessions, artifacts, approvals, automation, and Agent Knowledge.

## Channel Posture

Channel setup is explicit. Agent can inspect channel readiness and guide pairing, but it must not silently expose a new public surface or send messages to people without a user action.

Agent channel UX should show:

- which channels are enabled by the owning runtime;
- whether account/token setup is present without printing secret values;
- the default target, if configured;
- delivery risk and public exposure warnings;
- the command or workspace action needed to review pairing.

Agent-local memory, routines, skills, and personas are not automatically broadcast to channels. External delivery is an effect and requires an exact command, an explicit routine promotion, or a user-approved runtime request.

## Companion And Session Routes

Normal assistant chat uses companion chat routes. Build/fix/review delegation uses shared-session or task routes only when the user explicitly asks for implementation work.

Do not use shared coding sessions for ordinary chat. Do not create local background workers for routine assistant work.

## Remote Access

Remote-node and peer capability is runtime-owned. In Agent, remote commands are read-only unless a future Agent-safe route is designed and reviewed. The current Agent behavior should guide the user toward:

- inspecting remote support state;
- checking routes and peer readiness;
- delegating explicit build/fix/review work to GoodVibes TUI when a remote runtime is actually needed.

Agent should not start remote workers, manage peer lifecycle, or fan out hidden local agents from the main conversation.

## Public API Use

Use public SDK/operator routes only. For Agent Knowledge, the only valid family is:

```text
/api/goodvibes-agent/knowledge/*
```

If an Agent-specific route is missing, fail closed or show guidance. Do not substitute the default Knowledge/Wiki, another product segment, or private runtime files.

## Related Docs

- [Getting started](getting-started.md)
- [Knowledge, artifacts, and multimodal](knowledge-artifacts-and-multimodal.md)
- [Tools and commands](tools-and-commands.md)
