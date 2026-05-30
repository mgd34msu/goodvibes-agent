# GoodVibes Agent Docs

These are the package-facing docs for GoodVibes Agent.

GoodVibes Agent is a near-fork of the GoodVibes terminal foundation with a different product brain. It uses the copied terminal shell, renderer, input, fullscreen workspace, command, and release bones while the Agent-specific assistant behavior is being rebuilt.

Current package docs:

- [Getting Started](getting-started.md)
- [Deployment And Services](deployment-and-services.md)
- [Release And Publishing](release-and-publishing.md)

Important baseline constraints:

- Agent installs one executable: `goodvibes-agent`.
- Agent uses Bun and TypeScript-authored source.
- Agent depends on `@pellux/goodvibes-sdk@0.33.35`.
- Agent connects to an externally managed daemon.
- Agent does not start, stop, restart, install, uninstall, or own daemon/listener/web/service lifecycle.
- Normal assistant chat is not coding-session delegation.
- Build/fix/review delegation to GoodVibes TUI must be explicit; WRFC is not the default Agent behavior.

TUI-derived docs that remain outside this package-facing set are reference material during the near-fork foundation work. The Agent docs above define the supported alpha behavior.
