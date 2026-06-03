# GoodVibes Agent Docs

These are the package-facing docs for GoodVibes Agent, the personal operator assistant TUI for GoodVibes.

Current package docs:

- [Getting Started](getting-started.md)
- [Connected Host](connected-host.md)
- [Release And Publishing](release-and-publishing.md)

Important baseline constraints:

- Agent installs one executable: `goodvibes-agent`.
- Agent uses Bun and TypeScript-authored source.
- Agent depends on `@pellux/goodvibes-sdk@0.33.35`.
- Agent connects to a GoodVibes host owned outside this product.
- Agent does not start, stop, restart, install, uninstall, or own the connected GoodVibes host.
- Agent Knowledge uses only `/api/goodvibes-agent/knowledge/*`; there is no default knowledge or non-Agent product fallback.
- Agent supports isolated Agent homes with `GOODVIBES_AGENT_HOME=<path>` and named profile homes with `goodvibes-agent profiles create <name> --template <starter> --yes` plus `--agent-profile <name>`.
- Agent supports connected-host URL overrides with `--runtime-url http://host:port` or `GOODVIBES_AGENT_RUNTIME_URL=http://host:port`; these only change the Agent connection target.
- Agent ships starter profile templates for household, research, travel, operations, and personal productivity local state; `profiles templates export/import` and `/agent-profile guide` support local custom starters.
- First-run setup can seed an initial scratchpad note, local persona, skill, and routine without writing to connected-host knowledge or non-Agent segments.
- Local memory, notes, personas, routines, and Agent skills are stored under the Agent home. Notes are scratchpad records; reviewed memory, personas, routines, and skills are injected only into the serial Agent conversation.
- Normal assistant chat is not coding-session delegation.
- Build/fix/review delegation to GoodVibes TUI must be explicit; WRFC is not the default Agent behavior.

The Agent docs above define the supported alpha behavior.
