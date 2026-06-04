# GoodVibes Agent Docs

These are the package-facing docs for the GoodVibes Agent `1.0.x` release line, the personal operator assistant TUI for GoodVibes.

Current package docs:

- [Getting Started](getting-started.md)
- [Connected Host](connected-host.md)
- [Knowledge, Artifacts, and Multimodal](knowledge-artifacts-and-multimodal.md)
- [Tools and Commands](tools-and-commands.md)
- [Channels, Remote Access, and API](channels-remote-and-api.md)
- [Providers and Routing](providers-and-routing.md)
- [Voice and Live TTS](voice-and-live-tts.md)
- [Project Planning](project-planning.md)
- [Release And Publishing](release-and-publishing.md)

Important baseline constraints:

- Agent installs one executable: `goodvibes-agent`.
- Current package version is recorded in `package.json`; the top `CHANGELOG.md` section is the latest completed `1.0.x` release in this tree.
- Agent uses Bun `1.3.10` or newer and TypeScript-authored source.
- Agent depends on `@pellux/goodvibes-sdk@0.33.36`.
- Agent connects to a GoodVibes host owned outside this product.
- Agent does not start, stop, restart, install, uninstall, or own the connected GoodVibes host.
- User-facing Agent workspace categories/actions, single workspace-action lookup/execution, built-in panels and single-panel lookup, modal/overlay/picker UI surfaces and single-surface lookup, named operator surfaces, top-level CLI mirrors and single-mirror lookup with preferred model routes, fixed shortcuts, configurable keybindings, single-keybinding lookup, shell-safe keybinding execution, slash commands, single-command lookup with effect, boundary, and preferred-route policy metadata, channel readiness summary/search/single-channel lookup, redacted notification target summary/search/single-target lookup, provider account summary/search/single-provider lookup, MCP server summary/search/single-server lookup with trust, role, quarantine, and tool inventory posture, setup/onboarding posture summary/search/single-item lookup, provider/model routing posture summary/search/single-route-or-model lookup, pairing posture summary/search/single-route lookup, delegation posture summary/search/single-route lookup, security posture summary/search/single-finding lookup, support/auth/trust/subscription/voice bundle route discovery and redacted bundle inspection, voice/media posture summary/search/single-provider lookup, session/bookmark posture summary/search/single-session lookup, compact model tools with optional schema inlining and individual model tool schemas, release evidence bundle summary/search/single-artifact lookup, release-readiness inventory summary/search/single-item lookup, settings catalog filtering and single-setting lookup, local registries, public operator method catalog, single operator method inspection, service endpoint posture, single service endpoint inspection, connected-host capability boundaries, single connected-host capability inspection, and live connected-host readiness are model-visible through Agent-owned tools. Visible UI routing includes the command browser, reasoning-effort picker, live process output, runtime activity, settings, workspaces, and pickers the user can open. Every workspace editor descriptor reports model-execution route metadata, and local memory, note, persona, skill, and routine create editors can also run through confirmed workspace actions. Mutations, visible UI routing, keybinding execution, channel delivery, notification delivery, provider auth changes, setup apply/import/profile changes, provider/model selection/refresh/favorite/custom-provider changes, pairing/manual-token/companion connection changes, delegation submissions, security/trust/bundle export-import changes, voice/media generation and voice toggle changes, session/bookmark save/resume/export/delete changes, and MCP server configuration/trust/role/quarantine changes remain explicit and confirmation-gated; prompt-editor-only shortcuts stay direct user interaction; and ambiguous lookup matches are refused with candidates instead of guessed.
- Agent Knowledge uses only `/api/goodvibes-agent/knowledge/*`; there is no default knowledge or non-Agent product fallback.
- Agent supports isolated Agent homes with `GOODVIBES_AGENT_HOME=<path>` and named profile homes with `goodvibes-agent profiles create <name> --template <starter> --yes` plus `--agent-profile <name>`.
- Agent supports connected-host URL overrides with `--runtime-url http://host:port` or `GOODVIBES_AGENT_RUNTIME_URL=http://host:port`; these only change the Agent connection target.
- Agent ships starter profile templates for household, research, travel, operations, and personal productivity local state; `profiles templates export/import` and `/agent-profile guide` support local custom starters.
- First-run setup can seed an initial scratchpad note, local persona, skill, and routine without writing to connected-host knowledge or non-Agent segments.
- Local memory, notes, personas, routines, and Agent skills are stored under the Agent home. Notes are scratchpad records; reviewed memory, personas, routines, and skills are injected only into the serial Agent conversation.
- Normal assistant chat is not coding-session delegation.
- Build/fix/review delegation to GoodVibes TUI must be explicit; delegated review is not the default Agent behavior.

The Agent docs above define supported `1.0.x` behavior.
