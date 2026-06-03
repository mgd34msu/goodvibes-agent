# Changelog

Product-facing release notes for GoodVibes Agent.

## 1.0.9 - 2026-06-03

- Expose TTS provider and voice pickers through the model-visible harness, make /help and /commands use the live slash-command registry, and refresh package-facing docs and focused coverage for the current 1.0.x surface map.

## 1.0.8 - 2026-06-03

- Added model-visible UI surface entries for the panel-picker compatibility route and the security, knowledge, and subscription operator surfaces.
- Routed those named operator surfaces through Agent Workspace or the existing panel bridge with confirmation.
- Updated package-facing docs and focused harness coverage so the documented 1.0.x model-visible surface map matches the TUI routes.

## 1.0.7 - 2026-06-03

- Refreshed package-facing docs index so the latest 1.0.x release is derived from package.json and the top changelog entry instead of a stale hard-coded patch number.
- Updated the docs baseline constraints to include live connected-host readiness as part of the model-visible Agent-owned harness surface.

## 1.0.6 - 2026-06-03

- Added agent_harness mode connected_host_status for live read-only connected-host readiness: status-route reachability, SDK compatibility, token posture, endpoint bindings, Agent Knowledge route readiness, findings, and lifecycle boundaries.
- Documented the new model-visible connected-host readiness surface and added focused harness coverage proving the raw operator token is not exposed.

## 1.0.5 - 2026-06-03

- Model-visible harness discovery now includes modal, overlay, picker, and workspace UI surfaces with preferred model routes and shell-opener availability.
- open_ui_surface now routes visible Agent shell navigation through the same user-facing openers for settings, MCP, model/provider pickers, session/profile pickers, bookmarks, context, help, shortcuts, onboarding, and Agent workspace.
- The agent_harness tool schema now lives in a focused helper so new harness surface modes stay within architecture size limits.

## 1.0.4 - 2026-06-03

- Model-visible harness control now exposes fixed shortcuts and configurable keybindings through shortcuts, keybindings, keybinding, set_keybinding, and reset_keybinding modes.
- Keybinding edits now write the same Agent keybindings.json file the user edits, reload the runtime keybinding manager, and require explicit confirmation.
- Package-facing docs now describe shortcut and keybinding parity for the current 1.0.x harness surface.

## 1.0.3 - 2026-06-03

- Model-visible harness discovery now includes top-level CLI mirrors with parser output, blocked command tokens, redacted launch overrides, and preferred in-process routes.
- Model-visible harness discovery now includes built-in panel catalog/open-state inspection plus confirmation-gated visible panel routing through the Agent shell bridge.
- Harness metadata was split into focused catalog helpers to keep architecture boundaries and source-size limits intact.
- Documentation now describes CLI mirror and panel harness visibility, including the no-hidden-CLI-process and connected-host boundary rules.

## 1.0.2 - 2026-06-03

- Model-visible harness control now exposes command, settings, workspace, tool, and connected-host surfaces through agent_harness.
- Agent settings access now includes schema-aware list/get/set/reset flows with redaction, secret-manager writes, and host-owned read-only boundaries.
- Workspace profile, routine, persona, and local-library flows now expose editor schemas and scriptable actions to the model.
- Documentation now reflects the current 1.0.x command, tool, settings, provider, channel, knowledge, voice, connected-host, and release behavior.

## 1.0.1 - 2026-06-03

- Preserved Agent Knowledge setup paths with spaces, quoted generated Agent command guidance, and hardened MCP trust and role command validation.
- Blocked MCP allow-all escalation from Agent slash commands while keeping Settings as the explicit allow-all surface.
- Preserved MCP server passthrough arguments after -- and local persona, skill, and routine text that starts with flag-like values.
- Kept the 1.0 release package and install gates green across typecheck, architecture, performance, package build, publish check, packed install smoke, and verification ledger.

## 1.0.0 - 2026-06-03

- Promoted GoodVibes Agent to the release-candidate operator product surface: the fullscreen Agent workspace is the primary TUI, with setup, provider/model routing, status, compatibility, and doctor flows shaped around personal operator use instead of copied host lifecycle controls.
- Completed the Agent-local behavior system for day-one operation: local memory and notes, personas, skills, skill bundles, routines, starter profiles, discovery/import flows, review/stale/delete controls, and secret-looking content rejection all stay under Agent ownership.
- Completed isolated Agent Knowledge coverage across CLI, slash commands, workspace panels, connector/source/node/issue views, URL/file/browser/connector ingest, semantic ask/search, and connected-host `/api/goodvibes-agent/knowledge/*` routes without fallback to default or non-Agent knowledge surfaces.
- Completed connected-host operator integration without taking host lifecycle ownership: compatibility/status checks, authenticated health and model routes, channel readiness, provider-account posture, approvals, automation snapshots, schedules, work plans, media/voice readiness, pairing, and explicit public-route diagnostics are all visible from Agent.
- Completed explicit side-effect boundaries for personal operation: channel sends, notifications, routine schedule promotion, reminders, subscription/auth actions, memory bundle imports/exports, support bundles, MCP configuration, profile changes, and build delegation require explicit confirmation where they mutate state or call external routes.
- Completed package and release hardening for the 1.0 gate: Bun-only install/run instructions, package-facing text verification, package runtime bundling, packed global install smoke, blocked lifecycle command smoke, source/package boundary checks, architecture checks, recorded performance snapshot checks, verification ledger, strict live verification artifacts, and release readiness inventory are now part of the validated release path.

## 0.1.117 - 2026-06-02

- Added TUI workspace entrypoints for Agent Knowledge connectors, source/node/issue list views, review queue, transcript controls, doctor diagnostics, and connected-host compatibility.
- Added a TUI-first command coverage regression so product CLI commands cannot drift into shell-only workflows.
- Updated package-facing docs and help to describe the fullscreen Agent workspace as the primary product surface, with CLI commands only as scriptable mirrors.

## 0.1.116 - 2026-06-02

- Added behavior discovery to first-run setup so local persona, skill, and routine files can be reviewed and imported from the Agent TUI instead of starting from blank records.
- Added profile creation from discovered behavior bundles, including local starter-template creation, profile creation, and in-workspace setup guidance.
- Kept the installed command path simple: `bun add -g @pellux/goodvibes-agent`, then `goodvibes-agent` starts the interactive Agent TUI.
- Preserved the Agent product boundary: connected host required, no Agent-owned host lifecycle, isolated Agent Knowledge only, local memory/skills/personas/routines, and explicit build delegation.

## 0.1.108 - 0.1.115

- Expanded day-one setup with local behavior import, starter profiles, profile templates, Agent workspace forms, and clearer launch/status identity.
- Added Agent Knowledge management for isolated URL, file, connector, bookmark, and browser-history ingest through `/api/goodvibes-agent/knowledge/*`.
- Improved channel readiness, voice/media setup, provider/model visibility, MCP setup, and routine scheduling workflows while keeping side effects behind explicit confirmation.
- Hardened the package runtime bundle and Bun global install smoke so the installed TUI must launch from a packed package.

## 0.1.80 - 0.1.107

- Made the Agent operator workspace the normal TUI landing surface after first-run setup.
- Added Agent-local memory, personas, skills, skill bundles, routines, schedule receipts, and schedule reconciliation.
- Added connected-host diagnostics for status, compatibility, auth presence, Agent Knowledge readiness, approvals, work plans, automation, and schedules.
- Strengthened release gates around Bun-only install, TypeScript-only source, package contents, packed install checks, and single branch-CI test execution.

## 0.1.63 - 0.1.79

- Reworked onboarding, settings, help, docs, and workspace language around the Agent product: operator TUI, local behavior, isolated Agent Knowledge, provider access, channel readiness, automation review, and explicit build delegation.
- Added first-run readiness review covering runtime connection, default model route, profile setup, Agent Knowledge, local behavior, channels, routines, schedules, and delegation.
- Added workspace and renderer improvements for readable setup guidance, wrapped detail text, tiny-terminal behavior, and profile creation flows.

## 0.1.48 - 0.1.62

- Added the first Agent setup checklist, local library workspaces, local library editors, delete confirmations, command-help polish, and Bun global PATH guidance.
- Removed developer-only and coding-intelligence surfaces from the visible Agent product.
- Improved non-TTY launch diagnostics and package install smoke coverage.

## 0.1.2 - 0.1.47

- Added isolated Agent Knowledge CLI and slash-command routing with no fallback to default knowledge/wiki or non-Agent knowledge segments.
- Added Agent-local personas, skills, and routines with create/list/search/show/review/stale/delete workflows and secret-looking value rejection.
- Added explicit build/fix/review delegation to the GoodVibes build environment; delegated review is requested only through explicit delegation.
- Established release checks for package-facing docs, installability, executable bin behavior, and Agent product policy.

## 0.1.0 - 0.1.1

- Published the first public alpha package for `@pellux/goodvibes-agent`.
- Exposed the `goodvibes-agent` executable as the TUI entrypoint.
- Established the core Agent policy: serial/proactive assistant behavior, connected-host dependency, no local worker fanout by default, isolated Agent state, and explicit build delegation.
- Reissued `0.1.1` after the initial registry publish produced an install-blocking package metadata inconsistency.

## 0.0.0 - Private Baseline

- Created the private Agent package baseline with the GoodVibes terminal shell foundation.
- Set package identity to `@pellux/goodvibes-agent`.
- Kept host lifecycle external to the Agent package.
- Started the Agent-specific operator workspace, local behavior registries, and product policy work that led to the public alpha.
