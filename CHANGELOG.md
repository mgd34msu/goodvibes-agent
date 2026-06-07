# Changelog

Product-facing release notes for GoodVibes Agent.

## 1.1.7 - 2026-06-05

- Hardened the Agent model tool surface so goodvibes_context routes to the Agent harness instead of dead-ending.
- Added tool execution and permission safety guards so registered model tools return structured failures instead of aborting turns.
- Added `route action:"plan|status"` and `agent_harness mode:"route_decision"` for read-only user-task route planning across visible Agent surfaces.
- Added `setup action:"repair"` and `agent_harness mode:"setup_repair"` for read-only setup repair decisions that choose token repair, host status, services.status receipt, user-run bootstrap, or no lifecycle action without executing effects.
- Added `execution action:"capabilities|process_capabilities"` so process parity, PTY, stdin, and sudo posture reports are reachable from the first-class execution tool.
- Added `security action:"explain"` and `agent_harness mode:"policy_explain"` for read-only allowed/denied/confirmation-required policy explanations.
- Added registered-tool smoke coverage for the Agent-guarded platform tool roster.

## 1.1.6 - 2026-06-05

- Fixed Import GoodVibes settings so it also imports active and pending provider subscriptions from the GoodVibes TUI user store into Agent-owned subscription state.
- Preserved existing Agent-only subscriptions while merging imported provider sessions by provider id.
- Updated onboarding copy and added regression coverage for subscription import.

## 1.1.5 - 2026-06-05

- Replaced onboarding with the real Agent setup flow for subscription login, provider/model selection, settings persistence, channels, voice, local context, automation, and finish.
- Exposed remaining provider, auth, subscription, and model catalog actions through reachable Agent workspace rows and model-facing harness metadata.
- Split oversized workspace modules so the release architecture gate passes without changing onboarding behavior.

## 1.1.4 - 2026-06-05

- Rebuilt first-run onboarding into actionable Account & Model, Assistant Behavior, Tools & Permissions, Interface, Messaging, Voice & Phone, Context, Verify, and Finish pages with persisted setting actions instead of inert links.
- Added GoodVibes TUI settings import plus conditional channel, telephony, model, permission, display, behavior, voice, and local-context setup rows that write Agent-owned config and saved settings.
- Cleaned the model-facing Agent workspace surface with compact summaries, complete workspace action catalog exposure, unique action and category labels, and unambiguous canonical memory lookup.
- Fixed full-suite temp isolation so exec-tool tests stay stable when other tests clean project temp workspaces.

## 1.1.3 - 2026-06-05

- Add telephony channel support through the updated Agent platform dependency.
- Keep Agent Knowledge scope alias normalization inside Agent CLI, model tools, and live verification while preserving fail-closed non-Agent contamination checks.

## 1.1.2 - 2026-06-05

- Remove the redundant Finish action so onboarding completion presents only Apply & close.

## 1.1.1 - 2026-06-05

- Fix first-run onboarding so clean launches open the fullscreen setup workspace until the user explicitly chooses Finish -> Apply & close.

## 1.1.0 - 2026-06-05

- Add a final onboarding Finish category with Apply & close completion that saves the user onboarding marker and keeps future normal launches in the main conversation.

## 1.0.44 - 2026-06-05

- Compact Agent workspace top-pane copy across every category so the fullscreen onboarding surface keeps settings and actions visible.

## 1.0.43 - 2026-06-05

- Keep the Agent Home and Setup workspace top pane compact so setup actions stay visible.
- Replace noisy setup checklist route text with a concise setup overview and selected-action detail.
- Add renderer coverage for compact setup layout and removed arrow-style checklist output.

## 1.0.42 - 2026-06-05

- Make /agent the sole fullscreen Agent workspace for setup and onboarding entrypoints.
- Route /setup, /onboarding, first-run startup, and model-visible UI surface metadata to plain /agent.
- Remove obsolete onboarding modal renderer and controller paths.

## 1.0.41 - 2026-06-04

- Fixed Agent setup onboarding so the settings-style fullscreen workspace forces a complete terminal redraw and covers the shell input/status rows on packaged installs.
- Hardened terminal size detection so fullscreen shell surfaces use getWindowSize or environment dimensions before falling back.

## 1.0.40 - 2026-06-04

- Onboarding now uses a dedicated fullscreen workspace renderer copied from the settings-style workspace, so setup can be tuned without changing Settings, MCP, or Agent workspaces.
- First-run setup keeps the settings-style left rail, detail pane, field pane, and footer while the shell gives it the full terminal height, hiding the prompt/input area until setup is complete.

## 1.0.39 - 2026-06-04

- Removed the body-scoped onboarding overlay fallback so onboarding can only render through the shell fullscreen composite.
- Added regression coverage for the fullscreen onboarding composite and nested model workspace composite.

## 1.0.38 - 2026-06-04

- Onboarding now uses the shared fullscreen workspace surface so it owns the full terminal height, including the composer area.
- Fullscreen composition now clears stale shell footer rows when overlays replace the normal prompt surface.

## 1.0.37 - 2026-06-04

- Onboarding setup now renders full-bleed across the terminal with no inset edge.
- The Agent workspace rail now uses shared, meaningful section groups instead of one header per workspace.

## 1.0.36 - 2026-06-04

- Workspace navigation now uses distinct category group names instead of repeated setup headings.
- Onboarding now owns the full terminal viewport and blocks composer-adjacent overlays while setup is active.
- Onboarding renderer coverage now guards the bottom row so the setup flow cannot leave the input area visually available.

## 1.0.35 - 2026-06-04

- Added searchable `agent_harness` mode discovery: `mode:"modes"` searches every harness mode by task, family, effect type, id, alias, and parameter name, while `mode:"mode"` inspects one mode contract.
- Added full harness mode descriptors for every model-visible harness operation, with compact summaries, families, effect/read-only classification, confirmation flags, aliases, parameter names, and next-step guidance.
- Compacted registered model tool definitions at runtime: Agent tools now use concise descriptions, generic tool descriptions are capped, and nested JSON-schema descriptions are stripped from the default model-visible catalog while detailed contracts stay inspectable through harness modes.
- Counted the model-visible harness mode catalog in the verification ledger and package metadata gate so release evidence tracks the new discovery surface.
- Cleaned the useful test surface for the changed product shape by consolidating repetitive registration tests and adding focused coverage for mode discovery, task-phrase lookup, tool definition compaction, and release ledger accounting.
- Refreshed package-facing docs, release notes, and readiness evidence for the current model-access contract.

## 1.0.34 - 2026-06-04

- Promoted GoodVibes Agent to the stable 1.0.x operator product surface: the fullscreen Agent workspace is the primary TUI, with setup, provider/model routing, status, compatibility, and doctor flows shaped around personal operator use instead of copied host lifecycle controls.
- Completed the Agent-local behavior system for day-one operation: local memory and notes, personas, skills, skill bundles, routines, starter profiles, discovery/import flows, review/stale/delete controls, and secret-looking content rejection all stay under Agent ownership.
- Completed isolated Agent Knowledge coverage across CLI, slash commands, workspace panels, connector/source/node/issue views, URL/file/browser/connector ingest, semantic ask/search, and connected-host `/api/goodvibes-agent/knowledge/*` routes without fallback to default or non-Agent knowledge surfaces.
- Completed connected-host operator integration without taking host lifecycle ownership: compatibility/status checks, authenticated health and model routes, channel readiness, provider-account posture, approvals, automation snapshots, schedules, work plans, media/voice readiness, pairing, and explicit public-route diagnostics are all visible from Agent.
- Completed explicit side-effect boundaries for personal operation: channel sends, notifications, routine schedule promotion, reminders, subscription/auth actions, memory bundle imports/exports, support bundles, MCP configuration, profile changes, and build delegation require explicit confirmation where they mutate state or call external routes.
- Completed package and release hardening for the release gate: Bun-only install/run instructions, package-facing text verification, package runtime bundling, packed global install smoke, blocked lifecycle command smoke, source/package boundary checks, architecture checks, recorded performance snapshot checks, verification ledger, strict live verification artifacts, and release-quality readiness inventory dimensions are now part of the validated release path.
- Completed the compact model-visible harness pass: `agent_harness` summary and plural catalogs now default to compact rows, with full schemas, policy blocks, route metadata, editor fields, release artifact detail, redacted log tail, and parameter detail behind `includeParameters:true` or singular inspect modes.
- Completed direct model access to Agent harness operations: workspace actions, slash commands, settings, panels, UI surfaces, keybindings, tool catalogs, channel/notification posture, provider/account posture, MCP posture, setup, model routing, pairing, delegation, security/support bundles, media, sessions, operator methods, and connected-host diagnostics are exposed through Agent tools or harness modes; packaged release evidence remains model-inspectable as operator/audit material.
- Completed connected-host daemon aliases for the model: `daemon` maps to connected-host posture and `daemon_status` maps to live connected-host status while lifecycle control stays outside Agent.
- Completed settings parity for the model-facing harness: settings discovery is compact by default, `get_setting` and `includeParameters:true` expose full descriptors, and `set_setting`/`reset_setting` use the same config/secret managers with confirmation and external-host setting locks.
- Completed the tool-description verbosity sweep: first-class Agent tools and wrapped built-in tool definitions now register concise descriptions, while detailed safety rules remain enforced in policy wrappers, confirmation errors, and detailed harness inspection.
- Completed copyable model route hint cleanup: confirmed harness examples now include the required `confirm:true` and `explicitUserRequest` fields so route hints match the actual execution contract.
- Completed resilient shortcut/keybinding discovery: `agent_harness` returns fixed shortcuts and default-fallback keybinding descriptors when the live keybinding manager is absent, while keybinding execution and mutation still fail closed until the runtime manager is available.
- Completed the model-visible operator method catalog: `agent_harness` can now list and inspect allowlisted public operator and Agent Knowledge methods with their owning first-class model tools, confirmation policy, and boundaries, without exposing arbitrary route invocation.
- Expanded first-class Agent Knowledge reads: `agent_knowledge` now covers status, ask, search, source/node/issue lists, item lookup, map summary, connector list/detail, and connector doctor while staying inside `/api/goodvibes-agent/knowledge/*`.
- Added fail-closed Agent Knowledge response-scope validation: CLI, model tools, and live verification reject successful-looking payloads that expose default scope metadata or known non-Agent payload markers.
- Expanded release-route enforcement for Agent Knowledge: architecture/package policy now guards the full route catalog, and live verification definitions include source, node, issue, map, and connector read routes in addition to status, ask, and search.
- Verified the release line against connected-host public Agent routes for Agent Knowledge alias scope normalization and telephony channel surface support.
- Renamed active release evidence artifacts to current-release paths under `release/`, including release notes, readiness inventory, performance snapshot, and live-verification reports, so current release metadata no longer depends on stale historical filenames.

## 1.0.33 - 2026-06-04

- Fixed the release lockfile so frozen CI installs resolve the published connected-host route dependency graph.
- Carries forward the 1.0.32 model-facing harness coverage, compact tool catalog, keybinding discovery fallback, and connected-host release evidence.

## 1.0.32 - 2026-06-04

- Align the Agent release line with connected-host public route support for Agent Knowledge alias scope normalization and telephony channel surface support.
- Refresh release readiness evidence to match the current strict live verification run: 19 pass, 0 warn, 0 fail, 0 skip.
- Treat environment-provisioned connected-host operator tokens as first-class status, doctor, auth, pairing, Agent Knowledge, and model-visible connected-host credentials.
- Expose channel readiness through `agent_harness` with summary/search and single-channel lookup so the model can inspect setup state, delivery posture, risk labels, and safe config-key names before using the explicit confirmed send tool.
- Expose notification target posture through `agent_harness` with redacted summary/search and single-target lookup so the model can inspect configured target readiness without receiving full webhook values.
- Expose provider account posture through `agent_harness` with summary/search and single-provider lookup so the model can inspect auth routes, subscription freshness, usage windows, route issues, and confirmation-gated account actions without receiving tokens.
- Expose MCP server posture through `agent_harness` with summary/search and single-server lookup so the model can inspect connection, trust, role, quarantine, and tool inventory posture before using explicit confirmed workspace or slash-command mutation flows.
- Expose setup/onboarding posture through `agent_harness` with summary/search and single setup-item lookup so the model can inspect onboarding snapshot state, derived capability flags, setup marker state, local behavior discovery, channel/media/setup signals, and setup collection issues without applying setup.
- Expose provider/model routing through `agent_harness` with summary/search and single route/model lookup so the model can inspect current chat route, selectable models, provider ids, pinned models, reasoning support, context windows, and safe route setting keys without changing routes.
- Expose companion pairing posture through `agent_harness` with summary/search and single pairing-route lookup so the model can inspect endpoint binding, pairing surface id, token presence/fingerprint, and route catalog without receiving raw tokens or QR payloads.
- Expose explicit build-delegation posture through `agent_harness` with summary/search and single-route lookup so the model can inspect delegation routes, runtime availability, review policy, main-conversation ownership, and blocked local coding ownership without submitting delegated work.
- Expose security/support posture through `agent_harness` with redacted summary/search, single-finding lookup, bundle route discovery, and existing-bundle inspection by counts and redaction metadata without returning raw config, token, or secret values.
- Expose voice/media posture through `agent_harness` with summary/search and single-provider lookup so the model can inspect provider readiness, selected TTS setup, browser-tool posture, artifact availability, and safe secret-key names before using confirmed media generation or settings routes.
- Expose sessions/bookmarks through `agent_harness` with current-session posture, saved-session metadata/search, bookmark counts, saved bookmark file counts, and single-session lookup while save/resume/export/delete/bookmark changes stay visible user flows.
- Compact model-facing tool registration and schema descriptions, with package verification thresholds to prevent tool-description bloat from returning.
- Compact `agent_harness` summary route hints so the model gets concise mode names and confirmation rules instead of paragraph-length surface guidance.
- Keep shortcut and keybinding discovery available when the live keybinding manager is absent by returning default-fallback descriptors while keybinding execution and mutation still fail closed.

## 1.0.31 - 2026-06-04

- Expose the packaged release evidence bundle through agent_harness so the model can inspect release notes, performance snapshot, readiness inventory, and live-verification artifacts.
- Expose service posture and single-endpoint diagnostics through agent_harness so the model can inspect status/doctor/support-bundle endpoint posture without connected-host lifecycle control.
- Expose the public operator method catalog through agent_harness with preferred first-class tool routes and single-method lookup, without arbitrary route invocation.
- Expand agent_knowledge beyond status/ask/search to cover read-only source, node, issue, item, map, connector, and connector doctor inspection.
- Expand live verification definitions to check isolated Agent Knowledge source, node, issue, map, and connector routes in addition to status, ask, and search.
- Strengthen architecture/package policy so the full Agent Knowledge route catalog remains Agent-specific.
- Reject Agent Knowledge responses that expose default scope metadata or known non-Agent payload markers across CLI, model tools, and live verification.
- Count the packaged release evidence bundle and release-evidence harness modes in the verification ledger.
- Count the model-visible service posture modes and endpoint ids in the verification ledger.
- Count the model-visible operator method catalog modes and sources in the verification ledger.
- Expose settings catalog filters in the agent_harness summary so the model can discover category, prefix, query, includeHidden, and limit before mutating settings.
- Expose model-tool catalog schema inlining in the agent_harness summary and package docs.
- Add focused harness coverage for settings filter guidance and model-tool includeParameters schema inlining.

## 1.0.30 - 2026-06-04

- Surface workspace and workspace_categories modes in the agent_harness summary and package docs so the model can discover the Agent workspace category catalog before action lookup.
- Keep workspace action/editor execution guidance unchanged while documenting the category catalog/action-count route.
- Add focused harness coverage for workspace category discovery and summary guidance.

## 1.0.29 - 2026-06-03

- Add preferred model-route metadata to every built-in slash command policy so command inspection always tells the model which Agent-owned route to use.
- Add preferred route metadata to every supported top-level CLI mirror, including current-conversation handling for non-interactive run mirrors.
- Refresh 1.0.x package docs and focused harness coverage for exhaustive command and CLI preferred-route metadata.

## 1.0.28 - 2026-06-03

- Expose modelExecution metadata for every Agent workspace editor action, including local-registry, command-backed, direct local-create, profile, and prompt-returning editor flows.
- Return editor execution-route metadata in workspace action handoffs so the model can complete forms without guessing the route.
- Refresh 1.0.x package docs and focused harness coverage for workspace editor execution parity.

## 1.0.27 - 2026-06-03

- Classify every built-in slash command with concrete model-visible effect and boundary policy metadata instead of generic unknown policy fallback.
- Document that built-in slash-command inspection returns concrete effect and boundary policy metadata.
- Add focused harness coverage so registered built-in slash commands cannot silently regress to unknown model policy.

## 1.0.26 - 2026-06-03

- Route confirmed agent_harness panel-close and panel-close-all keybinding runs through the same Agent workspace dismiss route as the user shortcut before falling back to panel close handling.
- Refresh model-operation metadata for panel close keybindings so supported keybinding behavior matches visible shell behavior.
- Add focused harness coverage for model-triggered Agent workspace dismissal.

## 1.0.25 - 2026-06-03

- Correct the model-visible fixed shortcut catalog so F2 is reported as the runtime activity monitor instead of the shortcut reference.
- Expose /shortcuts separately as the keyboard shortcut reference route.
- Add focused harness coverage for runtime activity and shortcut-reference discovery.

## 1.0.24 - 2026-06-03

- Resolve confirmed `agent_harness` `mode:"run_command"` requests by the same command, commandName, target, or query lookup used for slash-command inspection.
- Refuse ambiguous slash-command run lookups with candidate commands before any handler runs.
- Refresh package-facing docs, model-facing schema text, and focused harness coverage for slash-command execution parity.

## 1.0.23 - 2026-06-03

- Return ambiguous agent_harness slash-command detail lookups with candidate commands instead of collapsing broad descriptive matches to unknown.
- Keep exact slash command, alias, typed command, target, and unique descriptive lookup behavior unchanged.
- Refresh package-facing docs and focused harness coverage for no-guess slash-command lookup parity.

## 1.0.22 - 2026-06-03

- Refuse ambiguous agent_harness model-tool schema lookup with candidate tools instead of selecting the first partial match.
- Refuse ambiguous connected-host capability lookup with candidate capabilities while preserving exact and unique lookup behavior.
- Refresh model-visible harness parameter descriptions, preferred route hints, package docs, and focused harness coverage for no-guess single-item lookup parity.

## 1.0.21 - 2026-06-03

- Resolve `agent_harness` `mode:"run_workspace_action"` by actionId, command, target, or query using the same lookup contract as `mode:"workspace_action"` inspection.
- Refuse ambiguous workspace action run requests with candidate actions instead of requiring exact action ids or guessing.
- Refresh package-facing docs and focused harness coverage for workspace action run parity.

## 1.0.20 - 2026-06-03

- Add `agent_harness` `mode:"run_keybinding"` for confirmation-gated shell-safe shortcut equivalents such as search, prompt-history search, paste, clear screen, cancel generation, panel focus/close routes, and visible block-action routing.
- Add modelOperation route metadata to every configurable keybinding so the model can distinguish supported shell routes from prompt-editor-only or direct-interaction shortcuts.
- Refresh package-facing docs and focused harness coverage for keybinding operation parity.

## 1.0.19 - 2026-06-03

- Add agent_harness cli_command lookup by cliCommand, command, commandName, target, or query while preserving parsed metadata for concrete invocations.
- Search the top-level CLI mirror catalog for descriptive lookup text and return candidate mirrors instead of treating broad text as a hidden CLI command.
- Redact CLI config override values in lookup metadata and refresh package-facing docs plus focused harness coverage.

## 1.0.18 - 2026-06-03

- Add agent_harness panel lookup by panelId, target, or query, with ambiguity candidates for visible panel routing.
- Add agent_harness UI surface lookup by surfaceId, target, or query, with ambiguity candidates for visible UI routing.
- Add agent_harness keybinding lookup by actionId, target, key, or query, including formatted binding labels and ambiguity candidates for confirmed keybinding edits.

## 1.0.17 - 2026-06-03

- Add agent_harness setting lookup by key, target, or query for get_setting, set_setting, and reset_setting.
- Return setting lookup metadata on successful single-setting operations and refuse ambiguous matches with candidate settings instead of guessing.
- Refresh package-facing docs and focused harness coverage for model-visible setting inspection and confirmed mutation lookup.

## 1.0.16 - 2026-06-03

- Add `agent_harness` `mode:"workspace_action"` lookup by actionId, command, target, or query with resolved lookup metadata.
- Reuse the user-facing workspace action search fields for single-action inspection while reporting ambiguity with candidate actions instead of guessing.
- Refresh package-facing docs and focused harness coverage for the updated model-visible workspace action inspection path.

## 1.0.15 - 2026-06-03

- Add forgiving agent_harness slash-command detail lookup by command, commandName, target, or query with parsed invocation metadata.
- Keep slash-command catalogs lightweight while making one-command inspection work from typed user-style invocations, aliases, case-insensitive roots, and unique description matches.
- Refresh package-facing docs and focused harness coverage for the updated model-visible slash-command inspection path.

## 1.0.14 - 2026-06-03

- Add agent_harness mode tool to inspect one first-class model tool schema by toolName, target, or query.
- Keep broad tools discovery lightweight while making individual model tool parameters, side effects, concurrency, and streaming/progress support directly inspectable.
- Refresh package-facing docs and focused harness coverage for the updated model tool discovery surface.

## 1.0.13 - 2026-06-03

- Add connected_host_capability to inspect one allowed or blocked connected-host capability by id, target, or query with related route families and boundary text.
- Keep connected-host operation model-visible without exposing host lifecycle, listener, non-Agent knowledge, hidden background work, or arbitrary host mutations.
- Refresh package-facing docs and focused harness coverage for the updated connected-host capability map.

## 1.0.12 - 2026-06-03

- Expose command browser, reasoning-effort picker, and live process output as model-visible confirmation-gated harness UI surfaces.
- Allow confirmed run_workspace_action execution for local memory, note, persona, skill, and routine create editors through agent_local_registry with required-field validation.
- Refresh package-facing docs for current 1.0.x harness parity and keep coverage aligned with the completed user-facing and model-facing surface map.

## 1.0.11 - 2026-06-03

- Model-visible harness parity now opens conversation search, prompt history search, slash-command mode, file picker, and nearest-block actions through confirmation-gated visible shell routes.
- Documentation now names the current UI surface inventory for 1.0.x so users and the model share the same harness map.
- Harness assertions cover the new visible surface routes and preserve the existing safety boundary.

## 1.0.10 - 2026-06-03

- Expose the runtime activity monitor as a model-visible, confirmation-gated harness UI surface, wire the shell opener through CommandContext, and refresh package-facing docs and focused coverage for the current 1.0.x surface map.

## 1.0.9 - 2026-06-03

- Expose TTS provider and voice pickers through the model-visible harness, make /help and /commands use the live slash-command registry, and refresh package-facing docs and focused coverage for the current 1.0.x surface map.

## 1.0.8 - 2026-06-03

- Added model-visible UI surface entries for the panel-picker compatibility route and the security, knowledge, and subscription operator surfaces.
- Routed those named operator surfaces through Agent Workspace or the existing panel route with confirmation.
- Updated package-facing docs and focused harness coverage so the documented 1.0.x model-visible surface map matches the TUI routes.

## 1.0.7 - 2026-06-03

- Refreshed package-facing docs index so the latest 1.0.x release is derived from package.json and the top changelog entry instead of a stale hard-coded patch number.
- Updated the docs baseline constraints to include live connected-host readiness as part of the model-visible Agent-owned harness surface.

## 1.0.6 - 2026-06-03

- Added agent_harness mode connected_host_status for live read-only connected-host readiness: status-route reachability, host compatibility, token posture, endpoint bindings, Agent Knowledge route readiness, findings, and lifecycle boundaries.
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
- Model-visible harness discovery now includes built-in panel catalog/open-state inspection plus confirmation-gated visible panel routing through the Agent operator surface.
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

- Promoted GoodVibes Agent to the stable 1.0.x operator product surface: the fullscreen Agent workspace is the primary TUI, with setup, provider/model routing, status, compatibility, and doctor flows shaped around personal operator use instead of copied host lifecycle controls.
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
