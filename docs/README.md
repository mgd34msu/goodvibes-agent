# GoodVibes Agent Docs

These are the package-facing docs for GoodVibes Agent.

GoodVibes Agent is a near-fork of the GoodVibes terminal foundation with a different product brain. It uses the copied terminal shell, renderer, input, fullscreen workspace, command, and release bones while the Agent-specific assistant behavior is being rebuilt.

Current package docs:

- [Getting Started](getting-started.md)
- [Operator Capability Benchmark](operator-capability-benchmark.md)
- [Deployment And Services](deployment-and-services.md)
- [Release And Publishing](release-and-publishing.md)

Important baseline constraints:

- Agent installs one executable: `goodvibes-agent`.
- Agent uses Bun and TypeScript-authored source.
- Agent depends on `@pellux/goodvibes-sdk@0.33.35`.
- Agent connects to an externally managed daemon.
- Agent does not start, stop, restart, install, uninstall, or own daemon/listener/web/service lifecycle.
- Agent Knowledge/Wiki uses only `/api/goodvibes-agent/knowledge/*`; there is no default Knowledge/Wiki, HomeGraph, or Home Assistant fallback.
- Agent exposes `goodvibes-agent capabilities` and `/capabilities` to compare OpenClaw/Hermes capability targets against current Agent readiness and configuration paths.
- Local personas, routines, and Agent skills are stored under the Agent surface root and are injected only into the serial Agent conversation.
- Normal assistant chat is not coding-session delegation.
- Build/fix/review delegation to GoodVibes TUI must be explicit; WRFC is not the default Agent behavior.

Copied TUI release and UAT histories are intentionally not part of this repository. The Agent docs above define the supported alpha behavior.
