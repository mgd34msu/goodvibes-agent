# Channels, Remote Access, and API

GoodVibes Agent can be reached from terminal-first and companion surfaces, but the Agent product does not own transport hosting. It connects to a GoodVibes host owned outside this package and uses public operator routes for status, sessions, artifacts, approvals, automation, and Agent Knowledge.

## Channel Posture

Channel setup is explicit. Agent can inspect channel readiness, guide pairing, and send one confirmed delivery message through configured strategies, including connected-host telephony targets, but it must not silently expose a new public surface or send messages to people without a user action.

Agent channel UX should show:

- which channels are enabled by the owning GoodVibes host;
- whether account/token setup is present without printing secret values;
- the default target, if configured;
- delivery risk and public exposure warnings;
- the command or workspace action needed to pair companion clients through QR-first setup;
- the confirmed `Send channel message` action when the user explicitly wants a one-off delivery.

VIBE.md, project context files, Agent-local memory, routines, skills, and personas are not automatically broadcast to channels. External delivery is an effect and requires an exact command, an explicit routine promotion, or a user-approved connected-host request. Companion pairing uses `/pair` without printing the raw token; manual token display requires `/pair --show-token --yes`. One-off delivery uses Agent Workspace -> Channels -> Send channel message or `/channels send ... --yes`.

The model can inspect pairing posture with `agent_harness` mode `pairing_posture`, and inspect one pairing route with mode `pairing_route` using `pairingRouteId`, `target`, or `query`. Those pairing modes return endpoint binding, pairing surface id, route catalog, and token fingerprint only; raw tokens and QR payloads are never returned by the read-only posture modes. QR display, manual token display, companion connection, channel delivery, task, approval, provider/model, and attachment actions stay visible user flows.

The model can inspect channel-facing workspace actions with `agent_harness`, list the structured channel readiness map with `agent_harness` mode `channels`, and inspect one channel with mode `channel` using `channelId`, `target`, or `query`. Channel discovery is compact by default, and `workspace_actions` rows include `modelRoute` hints for send/setup actions. Use `includeParameters:true` or single-channel inspection when the model needs delivery target shape, read-only connected-route hints, or full route metadata. These modes are read-only: they return setup state, delivery posture, risk labels, safe config-key names, and default-target key names without printing secret values or sending messages. The model can send one explicit configured delivery through `agent_channel_send` only when the user asks for that exact effect. It must not create routes, authorize accounts, infer recipients, or expose new public surfaces from chat.

The model can inspect configured notification target posture with `agent_harness` mode `notifications`, and inspect one redacted target with mode `notification_target` using `notificationTargetId`, `target`, or `query`. Notification discovery is compact by default, while `workspace_actions` distinguishes direct `agent_notify` sends/tests from confirmed workspace routes for add/remove/clear management. Use `includeParameters:true` or single-target inspection when management route hints are needed. These modes return target count, validity, protocol/host posture, and fingerprints, but not full webhook URLs. Use `agent_notify` for one explicit confirmed notification. Use confirmed `/notify` mirrors for target management only when the user supplies the exact add/remove/clear/test intent.

## Companion And Session Routes

Normal assistant chat uses companion chat routes. Build/fix/review delegation uses shared-session or task routes only when the user explicitly asks for implementation work.

Do not use shared coding sessions for ordinary chat. Do not start background automation for routine assistant work.

## Remote Access

Remote-node and peer capability is owned by the connected GoodVibes host. In Agent, remote commands are read-only unless the user explicitly delegates build/fix/review work to GoodVibes TUI. The current Agent behavior should guide the user toward:

- inspecting remote support state;
- checking routes and peer readiness;
- delegating explicit build/fix/review work to GoodVibes TUI when remote execution is actually needed.

Agent should not start remote build hosts, manage peer lifecycle, or fan out separate Agent jobs from the main conversation.

## Public API Use

Use public connected-host/operator routes only. For Agent Knowledge, the only valid family is:

```text
/api/goodvibes-agent/knowledge/*
```

If an Agent-specific route is missing, fail closed or show guidance. Do not substitute the default knowledge, another product segment, or private connected-host files. Normalize parseable public Agent-route scope aliases before rendering, and fail the call when the response carries known non-Agent contamination.

Harness and settings operations use the Agent-owned `agent_harness` tool. Generic settings/context mutators are not the model-facing Agent contract.

## Related Docs

- [Getting started](getting-started.md)
- [Knowledge, artifacts, and multimodal](knowledge-artifacts-and-multimodal.md)
- [Tools and commands](tools-and-commands.md)
