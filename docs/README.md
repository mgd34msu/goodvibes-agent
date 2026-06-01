# GoodVibes Agent Docs

These are the package-facing docs for GoodVibes Agent, the personal operator assistant TUI for GoodVibes.

Current package docs:

- [Getting Started](getting-started.md)
- [Deployment And Services](deployment-and-services.md)
- [Release And Publishing](release-and-publishing.md)

Important baseline constraints:

- Agent installs one executable: `goodvibes-agent`.
- Agent uses Bun and TypeScript-authored source.
- Agent depends on `@pellux/goodvibes-sdk@0.33.35`.
- Agent connects to an externally managed GoodVibes runtime.
- Agent does not start, stop, restart, install, uninstall, or own runtime connectivity or service lifecycle.
- Agent Knowledge/Wiki uses only `/api/goodvibes-agent/knowledge/*`; there is no default Knowledge/Wiki or non-Agent product fallback.
- Agent supports isolated runtime homes with `GOODVIBES_AGENT_HOME=<path>` and named profile homes with `goodvibes-agent profiles create <name> --template <starter> --yes` plus `--agent-profile <name>`.
- Agent ships starter profile templates for household, research, travel, operations, and personal productivity local state; `profiles templates export/import` and `/agent-profile guide` support local custom starters.
- Local personas, routines, and Agent skills are stored under the Agent surface root and are injected only into the serial Agent conversation.
- Normal assistant chat is not coding-session delegation.
- Build/fix/review delegation to GoodVibes TUI must be explicit; WRFC is not the default Agent behavior.

The Agent docs above define the supported alpha behavior.
