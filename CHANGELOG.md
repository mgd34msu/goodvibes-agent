# Changelog

Product-facing release notes for GoodVibes Agent.

## 1.5.1 - 2026-06-14

- v1.5.1 is a patch on the 1.5 line. The fullscreen Agent workspace, Agent-local behavior, isolated Agent Knowledge, connected-host operator integration, and explicit side-effect boundaries all stay in force; this release restores the inline shell escape and refreshes release verification.
- Restored the inline shell escape in the prompt: type an exclamation mark followed by a command (for example, exclamation-mark git status) to run it in your working directory without leaving Agent. The command output appears inline, and the result is carried into your next message as context so you can run something and immediately ask about it. The composer already showed this as shell mode, but the command never actually ran since the workspace fork; it executes again now.
- The exclamation-hash memory pin is unchanged and still takes precedence, so pinning a note keeps working exactly as before.
- Release hygiene: regenerated the strict live-verification attestation against the running connected host so the published package carries current evidence.
- Test suite: 7931 pass / 0 fail / 2 skip across 554 files.

## 1.5.0 - 2026-06-11

- v1.5.0 opens the 1.5 minor line: the fullscreen Agent workspace remains the primary user surface, Agent-local behavior, isolated Agent Knowledge, connected-host operator integration, explicit side-effect boundaries, and release hardening from 1.3.x and 1.4.x all stay in force. This release replaces the split-pane panel system with the Activity sidebar, rebuilds first-run onboarding around readiness, and adds local calendar, direct email, hardware-aware model recommendations, and skill import/export.
- Replaced the 21-panel split-pane system with a single Activity sidebar. Live activity, process output, and runtime state now surface in one consistent lane instead of stacked panels; the footer was slimmed and tool calls show human-readable labels.
- Rewrote the workspace Home as plain-language lanes and merged duplicate categories. The slash-command long tail moved behind /commands so the prompt surface stays focused on what users actually run.
- Added a While you were away digest on return plus a live Coming up sidebar fed by the local calendar, so upcoming commitments stay visible without asking.
- Rebuilt first-run onboarding around a readiness model: setup steps sequence themselves by what is actually configured, the flow can be resumed midway, and a completion recap shows what was set up. The first screen leads with a working path, the first-run model picker opens with a hardware-fit recommendation, and a plain-language hint appears in conversation while setup is incomplete.
- Competitive parity wave: local calendar support, direct email send and read over SMTP and IMAP with TLS or STARTTLS, hardware-aware model recommendations, and automatic skill drafts.
- Skills now import and export in the open skill standard. Exports are lossless, and skills discovered from imports stay disabled until explicitly enabled.
- Hardened the email and calendar surfaces: SMTP and IMAP commands validate addresses and reject control characters, STARTTLS upgrades verify no data arrives before negotiation completes, and calendar parsing is stricter about malformed input.
- Reliability fixes across the TUI: closed a text-wrap hang, made wide-character rendering consistent, fixed webhook notifier reuse, routed the benchmark editor to its real action, and made command failures surface user-visible errors everywhere.
- Release and verification hygiene: the operator token is redacted from release artifacts, the coverage ledger reports honest numbers, release evidence is checked for existence, and operator-facing copy passes a plain-language gate.
- Test suite: 7931 pass / 0 fail / 2 skip across 554 files.

## 1.4.4 - 2026-06-09

- v1.4.4 continues the stable 1.x line: the fullscreen Agent workspace remains the primary user surface, Agent-local behavior, isolated Agent Knowledge, connected-host operator integration, explicit side-effect boundaries, and release hardening from 1.3.x and 1.4.x all stay in force. This patch finishes the onboarding-modal cleanup begun in 1.4.0–1.4.3.
- Trimmed Model Routing from 23 rows down to a cleaner first-run set. Removed duplicates (account-main-model duplicated provider-use), removed three guidance rows that leaked model-tool syntax in their detail strings (`models action:"status|local|smoke"` etc.), removed the model-only secondary pickers that duplicated provider+model pickers for helper / tool / spoken-turn routes, and grouped the rest into Essentials → Helper/tool/spoken-turn (advanced) → System prompt / custom provider / benchmark (advanced) → Prompt cache (advanced).
- Trimmed Tools & Permissions from 24 rows to 14. Dropped 9 granular per-tool permission settings (find, analyze, inspect, state, registry, mcp, agent, workflow, delegate) that defaulted to safe values and overwhelmed first-time users; the broader policy controls (Permission mode, Auto-approve, file reads / writes / edits, shell, network) stay. Also moved the advanced runtime limits to the bottom of the page.
- Renamed labels to plain English across Start, Model Routing, and Tools & Permissions: "Enable helper model" → "Use a dedicated helper model", "Add MCP server" → "Add an MCP server", etc., so the modal reads like an onboarding wizard, not a configuration dump.
- Trimmed the Model Routing summary and detail so the description fits the harness-text length budget and reads as plain operator UX.
- Tests covering the removed rows are skipped rather than rewritten; the removed settings still exist in the config schema and can be reached via the prompt or future advanced surfaces.
- Test suite: 7553 pass / 0 fail / 67 skip across 548 files. The fullscreen Agent workspace, Agent-local behavior, isolated Agent Knowledge, connected-host operator integration, side-effect boundaries, and release hardening guarantees all remain in force.

## 1.4.3 - 2026-06-09

- v1.4.3 continues the stable 1.x line: the fullscreen Agent workspace remains the primary user surface, Agent-local behavior, isolated Agent Knowledge, connected-host operator integration, explicit side-effect boundaries, and release hardening from 1.3.x and 1.4.x all stay in force. This patch finishes the workspace cleanup.
- Every workspace category now renders the consistent Setting/Default/Current 3-column table. The old Option/Does fallback was confusing users who saw two different page styles across the same modal. Non-setting rows (editors, model pickers, settings modals, guidance) show their label in Setting and a placeholder dash in Default/Current.
- Removed every `kind: 'command'` slash-command row from the workspace categories — 145 rows gone. The modal is not a redundant slash-command launcher; the slash commands themselves still work in the main prompt. This applies across the full category list, not just the ONBOARDING group.
- Reordered the Start (setup) category so a first-time user sees the essentials first: sign in to a provider, finish sign-in, choose main model, then optional settings import, reasoning effort, and save-history toggle. The advanced rows (custom provider, stored credentials, secret storage policy, resume-point controls) moved to the bottom of the page where they don't clutter first-run.
- Renamed several Start rows to plain English: "Start subscription login" → "Sign in to a provider", "Finish subscription login" → "Finish provider sign-in", "Logout subscription" → "Sign out of a provider", "Setup checkpoint show/save/clear" → "Show/Save/Clear saved resume point".
- Tests covering the removed command-row dispatch paths are skipped rather than rewritten; the slash commands still exist as commands, just not as workspace rows.
- Test suite: 7556 pass / 0 fail / 64 skip across 548 files.

## 1.4.2 - 2026-06-08

- v1.4.2 continues the stable 1.x line: the fullscreen Agent workspace remains the primary user surface, Agent-local behavior, isolated Agent Knowledge, connected-host operator integration, explicit side-effect boundaries, and release hardening from 1.3.x and 1.4.x all stay in force; 1.4.2 removes a planning feature that did not belong in this product and finishes the onboarding-modal cleanup.
- Removed the project planning subsystem entirely. The `/plan` and `/workplan` slash commands, the project-planning panel, the work-plan panel, the planning runtime coordinator, and all related workspace categories are gone. This is an operator assistant, not a coding planning harness, and the planning interceptor at `src/planning/project-planning-coordinator.ts` was matching the word `plan` in any user prompt and auto-opening a panel that captured keyboard focus.
- Stopped the onboarding modal from exiting the user mid-flow. The Phase 1 default dispatch behavior was `compose`, which closed the modal before running the slash command. The new default is `inline`: editor submissions, settings imports, and ad-hoc commands now stay inside the workspace and surface their output in the result pane. Only `commandBehavior: 'compose'` (explicit) or `'exit'` (only `/quit`) closes the modal.
- Forced the consistent Setting/Default/Current 3-column table layout on every ONBOARDING category. Pages with mixed-kind action lists (editor + setting + guidance) previously fell back to the old two-column Option/Does layout, so users saw two different page styles across the onboarding flow. Now every onboarding page uses the same 3-column header, and non-setting rows show their action label in the Setting column with placeholder dashes for Default and Current.
- Removed every onboarding workspace row that referenced the deleted planning feature: `personal-ops-workplan`, `personal-ops-workplan-add`, `workplan`, `workplan-show`, `workplan-add`, `workplan-status`, `workplan-delete`, `workplan-clear-completed`, `planning-status`, `planning-mode`, `planning-explain`, `planning-list`, `plan-seed`, `plan-show`, `plan-approve`, `plan-override`, `plan-clear`. Help overlay and docs cleaned of `/plan` and `/workplan` mentions.
- Trimmed the agent-boundary docs test that previously asserted on the deleted 1.2.0 repair handoff doc, plus the release-evidence test now targets a stable required theme instead of a 1.3.0-specific phrase.
- Test suite: 7601 pass / 0 fail / 19 skip across 548 files.

## 1.4.1 - 2026-06-08

- v1.4.0 was cut but its publish step never ran; v1.4.1 ships the same onboarding rebuild as the first publicly published version of the 1.4.x line. The fullscreen Agent workspace, Agent-local behavior, isolated Agent Knowledge, connected-host operator integration, explicit side-effect boundaries, and release hardening from 1.3.x all stay in force.
- Fixed a release-evidence test that hardcoded a 1.3.0-specific phrase (`compact model-visible harness pass`) and prevented the v1.4.0 publish workflow from completing. The assertion now targets the stable required-theme `fullscreen Agent workspace`, so future release-notes rotations no longer break release CI.
- Rebuilt the Agent Workspace onboarding modal so first-time users land in a focused ONBOARDING-only category list, no longer see HOME and post-onboarding categories competing for attention, and never get kicked out of the modal when activating a slash-command row.
- Added typed `commandBehavior` (inline | compose | exit) on workspace actions so safe read-only commands can run inside the onboarding modal with their captured output rendered into the result pane, instead of forcing the modal closed to dispatch through the composer.
- Guarded the new inline dispatch path so a missing `executeCommand` no longer clobbers `context.print`; the modal surfaces a clear "command unavailable" result and stays open.
- Replaced release-engineering vocabulary (smoke history, receipt gaps, durable receipt, closeout policy, schema status, event cursor, publication guarantee, step history, repeated blocker, setup checkpoint summary) with a tight progress + single next-action summary in the onboarding right pane.
- Closed a leak where channel-guide context lines could expose internal `userRoute` strings containing model-tool-call syntax; the channels guide now shows only human-readable labels.
- Trimmed the user-facing setup checklist from fifteen items to thirteen by removing the `install-smoke` and `browser-pwa` release-engineering items; both remain available to model-facing routes but no longer appear in the onboarding flow.
- Renamed the misleading `command` field on `AgentWorkspaceSetupChecklistItem` to `breadcrumb` so the field's purpose (UI navigation hint) no longer collides with the `kind: 'command'` action type.
- Added clear verb-led row labels in the onboarding modal so users can see exactly what activating a row does: "Choose provider and model", "Edit MCP server", "Switch to <category>", "Run: <command>", "Open: <command>", "Finish setup", and so on, replacing generic labels like "Open option" and "Open guided form".
- Added a sticky "Finish setup" footer row visible on every ONBOARDING category, colored green when prerequisites (provider/model, connected-host auth, runtime) are ready and warn-colored with the unmet items listed otherwise; the row is wired through the real activation path so pressing Enter triggers `completeOnboarding()`.
- Added per-category readiness glyphs in the onboarding left pane: a green checkmark for categories whose mapped checklist items are all ready, a warn glyph for categories with blockers or recommended items, and no glyph for optional-only categories.
- Relocated the diagnostic fields on `AgentSetupWizard` (smokeHistory, stepHistory, receiptGaps, closeout, checkpoint, repeatedBlocker) under a `_diagnostic` subkey so model-facing wizard mechanics are cleanly separated from user-facing wizard state, while preserving the existing model-tool surface.
- Tightened `AgentWorkspaceCategory.group` and the workspace `_onlyGroup` filter to a literal union `AgentWorkspaceCategoryGroup`, so category-group typos fail at compile time instead of producing silent navigation bugs.
- Added end-to-end acceptance tests for the new behavior: inline command dispatch keeps the workspace active and populates `lastActionResult` with captured output, first-run filter restricts the modal to ONBOARDING categories only, and the jargon allowlist guarantees no banned vocabulary leaks back into user-facing copy.

## 1.4.0 - 2026-06-08

- Continued the stable 1.x line: the fullscreen Agent workspace remains the primary TUI surface, Agent-local behavior, isolated Agent Knowledge, connected-host operator integration, explicit side-effect boundaries, and release hardening all stay in force; 1.4.0 sharpens the onboarding flow inside that surface.
- Rebuilt the Agent Workspace onboarding modal so first-time users land in a focused ONBOARDING-only category list, no longer see HOME and post-onboarding categories competing for attention, and never get kicked out of the modal when activating a slash-command row.
- Added typed `commandBehavior` (inline | compose | exit) on workspace actions so safe read-only commands can run inside the onboarding modal with their captured output rendered into the result pane, instead of forcing the modal closed to dispatch through the composer.
- Guarded the new inline dispatch path so a missing `executeCommand` no longer clobbers `context.print`; the modal surfaces a clear "command unavailable" result and stays open.
- Replaced release-engineering vocabulary (smoke history, receipt gaps, durable receipt, closeout policy, schema status, event cursor, publication guarantee, step history, repeated blocker, setup checkpoint summary) with a tight progress + single next-action summary in the onboarding right pane.
- Closed a leak where channel-guide context lines could expose internal `userRoute` strings containing model-tool-call syntax; the channels guide now shows only human-readable labels.
- Trimmed the user-facing setup checklist from fifteen items to thirteen by removing the `install-smoke` and `browser-pwa` release-engineering items; both remain available to model-facing routes but no longer appear in the onboarding flow.
- Renamed the misleading `command` field on `AgentWorkspaceSetupChecklistItem` to `breadcrumb` so the field's purpose (UI navigation hint) no longer collides with the `kind: 'command'` action type.
- Added clear verb-led row labels in the onboarding modal so users can see exactly what activating a row does: "Choose provider and model", "Edit MCP server", "Switch to <category>", "Run: <command>", "Open: <command>", "Finish setup", and so on, replacing generic labels like "Open option" and "Open guided form".
- Added a sticky "Finish setup" footer row visible on every ONBOARDING category, colored green when prerequisites (provider/model, connected-host auth, runtime) are ready and warn-colored with the unmet items listed otherwise; the row is wired through the real activation path so pressing Enter triggers `completeOnboarding()`.
- Added per-category readiness glyphs in the onboarding left pane: a green checkmark for categories whose mapped checklist items are all ready, a warn glyph for categories with blockers or recommended items, and no glyph for optional-only categories.
- Relocated the diagnostic fields on `AgentSetupWizard` (smokeHistory, stepHistory, receiptGaps, closeout, checkpoint, repeatedBlocker) under a `_diagnostic` subkey so model-facing wizard mechanics are cleanly separated from user-facing wizard state, while preserving the existing model-tool surface.
- Tightened `AgentWorkspaceCategory.group` and the workspace `_onlyGroup` filter to a literal union `AgentWorkspaceCategoryGroup`, so category-group typos fail at compile time instead of producing silent navigation bugs.
- Added end-to-end acceptance tests for the new behavior: inline command dispatch keeps the workspace active and populates `lastActionResult` with captured output, first-run filter restricts the modal to ONBOARDING categories only, and the jargon allowlist guarantees no banned vocabulary leaks back into user-facing copy.

## 1.3.0 - 2026-06-08

- Promoted GoodVibes Agent to the stable 1.0.x operator product surface: the fullscreen Agent workspace is the primary TUI, with setup, provider/model routing, status, compatibility, and doctor flows shaped around personal operator use instead of copied host lifecycle controls.
- Completed the Agent-local behavior system for day-one operation: VIBE.md personality, project context files, local memory posture, prompt-active recall, vector/embedding health, notes, personas, skills, skill bundles, routines, starter profiles, discovery/import flows, review/stale/delete controls, and secret-looking content rejection all stay under Agent ownership.
- Completed isolated Agent Knowledge coverage across CLI, slash commands, workspace panels, connector/source/node/issue views, URL/file/browser/connector ingest, semantic ask/search, issue review, packet/explain previews, consolidation, reindex, and connected-host `/api/goodvibes-agent/knowledge/*` routes without fallback to default or non-Agent knowledge surfaces.
- Completed connected-host operator integration without taking host lifecycle ownership: compatibility/status checks, authenticated health and model routes, channel readiness, provider-account posture, approvals, automation snapshots, schedules, work plans, media/voice readiness, pairing, and explicit public-route diagnostics are all visible from Agent.
- Completed explicit side-effect boundaries for personal operation: channel sends, notifications, autonomous schedule creation, schedule enable/disable/delete, routine schedule promotion, reminders, subscription/auth actions, memory bundle imports/exports, support bundles, MCP configuration, profile changes, and build delegation require explicit confirmation where they mutate state or call external routes.
- Added first-class user-task route planning: `route action:"plan|status"` and lower-level `agent_harness mode:"route_decision"` turn a plain request into the preferred visible Agent route, alternatives, missing fields, confirmation boundary, workspace matches, and harness mode matches without running tools or creating hidden work, including screenshot/browser-control requests that now route to `computer action:"plan"`.
- Host/daemon health, doctor, readiness, service, and compatibility requests now route to `host action:"status"` first before setup repair or service lifecycle effects.
- Normal settings/configuration requests now route to `settings action:"list"` first so setting changes start with Agent-owned discovery and explicit confirmation boundaries.
- Direct reminders, schedules, cron, and schedule lifecycle requests now route to `schedule action:"list"` first, while broader ongoing work remains on autonomy intake.
- Plain command-shaped background work now routes to `execution action:"processes"` and the first-class `terminal`/`process` UX, while scheduled or watcher-like background work stays on autonomy intake.
- Interactive terminal, PTY, stdin, and sudo requests now route to `execution action:"process_capabilities"` first so users see current support, setup posture, and confirmation boundaries before any hidden process start or credential effect.
- External memory-provider, backend, cross-session sync, import/export, and named-provider requests now route to `memory action:"provider"` or the external provider checklist before Agent promises provider writes, sync, credentials, or import/export effects; provider detail also exposes next-route packets, missing setup/status/read/write/sync checks, and required receipt fields for SDK/daemon records Agent can consume.
- Model provider, local-cookbook, local server smoke, and route-fit requests now route to `models action:"provider|local|smoke|route"` before Agent attempts credential, smoke, benchmark, or route-change effects.
- Browser-backed research runner requests now route to `research action:"runner"`, and visual research report rendering requests route to `research action:"plan"` plus report artifacts before Agent claims browser/PWA rendering readiness.
- Voice workflow, TTS-provider, browser cockpit, and PWA requests now route to `device action:"voice|provider"` or `computer action:"browser"` before Agent attempts capture, playback, picker, or browser-open effects.
- Personal Ops briefing, saved queue, fresh inbox/calendar read, and connector setup requests now route to `personal_ops action:"briefing|queue|intake|lane"` before Agent attempts live provider reads or effects.
- Channel setup, triage, delivery receipt, and send requests now route to `channels action:"setup|triage|deliveries|channel"` before Agent attempts confirmed external delivery.
- Plain file undo/redo/recovery requests now route to `execution action:"recovery"` so users inspect available snapshots before confirming a local file mutation.
- Media generation requests now route to provider readiness and confirmed `agent_media_generate` saved-artifact output instead of inline bytes or silent Knowledge promotion.
- Permission posture, security finding, and blocked-action questions now route to `security action:"status|finding|explain"` so users get active permission state, exact redacted findings, or read-only policy preflight without knowing security harness mode names.
- Support-bundle, saved-session/bookmark, and release/audit evidence requests now route to first-class read-only `support action:"status|bundle"`, `sessions action:"list|get"`, and `audit action:"readiness|evidence|item|artifact"` before bundle export/import/share, session lifecycle, or audit drill-in effects.
- Added first-class setup repair decisions: `setup action:"repair"` and lower-level `agent_harness mode:"setup_repair"` choose the next safe token repair, connected-host status, services.status receipt, user-run bootstrap, or no lifecycle action without executing lifecycle, token, import, or UI effects.
- Added first-class policy explanations: `security action:"explain"` and lower-level `agent_harness mode:"policy_explain"` show why one model action is allowed, denied, or waiting on confirmation across the Agent route guard, permission mode, and typed tool confirmation, with secret-looking args redacted and no tool execution.
- Added user-first delegation decision cards and structured handoff briefs: execution and delegation posture now distinguish local-first work, TUI handoff, delegated review, remote inspection, and blocked hidden fanout, while `/delegate` and the Agent Workspace form preserve reason, success criteria, workspace hints, priority, and explicit review intent.
- Added the first-class `delegation` tool: `action:"status|routes|route"` exposes delegation policy, route catalogs, and exact confirmed handoff contracts without requiring harness mode names.
- Added the first-class `execution` tool: `action:"status|route|history|record|processes|process_capabilities|process|recovery"` exposes local-vs-delegated work posture, exact route inspection, activity cards, tracked process inspection, direct process parity/doctor reporting, and file recovery without requiring harness mode names.
- Added the first-class `computer` tool: `action:"status|plan|control|browser|setup|mcp|open_browser"` exposes browser/PWA readiness, browser/screenshot/desktop-control route planning, repair/setup rows, trusted MCP/tool discovery, and confirmed browser cockpit opens without requiring harness mode names.
- Added normalized autonomy queue controls: research runs, connected-host tasks, approvals, automation runs, and schedules now expose available/unavailable controls with reasons plus exact confirmed routes for checkpoint, pause, resume, cancel, approve, deny, retry, run, edit, enable, disable, and delete actions; host task cancel/retry stays on confirmed `agent_operator_method` routes while `/tasks` remains inspection-only.
- Added the first-class `autonomy` tool: `action:"intake|queue|item|status"` exposes ongoing-work route selection and visible autonomy queue inspection without requiring harness mode names.
- Added trigger workflow posture: `autonomy action:"intake"` now maps time-based wakeups/schedules, incoming webhook/event watchers through published `watchers.*` daemon routes, Gmail/email connector-gated triggers, and read-only control-plane event streams, with watcher creation kept admin-confirmed and source-scoped.
- Added certified watcher receipts: `autonomy action:"intake"` now exposes watcher success criteria, and `agent_operator_method` summarizes `watchers.create/patch/run/start/stop/delete` receipts into certified or follow-up outcomes without exposing operator tokens.
- Added a source-owned watcher evidence contract: `autonomy action:"intake"` now tells users and models which SDK/daemon-owned durable run-history receipts, provider source records, redacted event payload descriptors, and queue correlation records are needed before Agent claims persisted webhook/Gmail watcher history.
- Added live watcher run/source read-model consumption: the autonomy queue now ingests SDK/daemon watcher run history, automation watcher runs, Gmail/email provider sources, bounded redacted watcher output chunks, source/checkpoint/correlation diagnostics, read-only source inspect/refresh controls, and exact confirmed watcher controls only when the owning host publishes those routes.
- Added host task output posture: autonomy queue connected-host task records now expose `/tasks output` routes plus bounded redacted result/error previews when the host publishes them, and route-only status when true output text is not in the read model.
- Completed package and release hardening for the release gate: Bun-only install/run instructions, package-facing text verification, package runtime bundling, packed global install smoke, blocked lifecycle command smoke, source/package boundary checks, architecture checks, recorded performance snapshot checks, verification ledger, strict live verification artifacts, and release-quality readiness inventory dimensions are now part of the validated release path.
- Completed the compact model-visible harness pass: `agent_harness` summary now starts with an assistant-first cockpit before technical counters, plural catalogs default to compact rows, `mode:"modes"` searches every harness mode by task/id/effect/parameter, and `mode:"mode"` inspects one mode contract with full schemas, policy blocks, route metadata, editor fields, release artifact detail, redacted log tail, and parameter detail behind `includeParameters:true` or singular inspect modes.
- Added a first-class `workspace` adapter for workspace actions, panels, UI surfaces, slash commands, CLI mirrors, keybindings, and fixed shortcuts, so the model can inspect or confirm visible workspace operations without memorizing harness mode names; lower-level harness modes remain for detailed route inspection and compatibility.
- Added ordered channel setup guide: Agent Workspace -> Channels, `/channels guide`, and `channels action:"setup"` now rank the next channel and walk through setup schema, secret-backed settings, delivery target, allowlist policy, live status/doctor checks, and explicit confirmed test-send boundaries.
- Added channel triage: Agent Workspace -> Channels, `/channels triage`, and `channels action:"triage"` now unify setup blockers, daemon delivery attempts, visible surface messages, route bindings, and redacted Agent receipts without claiming provider-specific unread inbox polling.
- Added channel delivery receipts: confirmed `/channels send` and `agent_channel_send` deliveries now write Agent-owned redacted receipt history, visible through Agent Workspace -> Channels, `/channels deliveries`, and `channels action:"deliveries"`.
- Added route-backed browser and desktop control setup posture: `setup action:"status|item"` plus `execution action:"status|route"` now show ready, attention, or setup-needed state, workflow cards, setup checklists, fallback routes, and MCP review routes for browser, desktop, computer-use, screenshot, or screen-recording tooling; lower-level `setup_posture`, `setup_item`, `execution_posture`, and `execution_route` remain compatibility routes.
- Added connected browser cockpit routing: Home, `computer action:"browser|open_browser"`, `workspace action:"surface|open"`, and lower-level UI surface detail routes now expose the configured connected-host browser cockpit/PWA URL with service/web setup fallback, workspace-category coverage, mobile/PWA controls, Agent onboarding marker status, and an honest browser/PWA first-run receipt contract that can be satisfied by artifact or live setup read-model receipts when the host publishes them.
- Added certified browser/PWA read-model consumption: `computer action:"browser"` and the connected browser cockpit surface now consume SDK/daemon browser-native Agent workspace category routes and browser/PWA first-run receipts with schema/version/publication/publisher/provenance/freshness-cursor/receipt metadata, exact inspect/open routes, mobile/touch controls, manifest/service-worker/install/offline evidence, redacted URLs/summaries, and missing-signal surfacing before reporting `browser-native-ready`.
- Added companion device capability mapping: `device action:"status|capability"` and lower-level `pairing_posture` / `pairing_route pairingRouteId:"device-capability-map"` now show ready/attention/setup-needed/not-published posture for companion pairing, mobile command routing, browser/PWA, voice controls, spoken responses, notifications, browser/desktop control, and camera/screen/location sensors without returning raw tokens or claiming unpublished device APIs.
- Added certified companion device read-model consumption: device capability and voice workflow posture now consume SDK/daemon permission-scoped camera, screen, location, local device command, and wake-word records with schema/version/publication/publisher/provenance/freshness-cursor/receipt metadata, exact inspect/control routes, redacted summaries, and missing certification signals.
- Added voice workflow posture: `device action:"voice"` and lower-level `media_posture` now map push-to-talk input, voice memo transcription, spoken responses, and wake-word capture with ready/attention/setup-needed/not-published state, setup routes, runtime evidence, and explicit policy that always-listening capture requires certified permission-scoped runtime evidence.
- Surfaced voice/device/browser posture in Voice & Media: the workspace now has Voice workflows, Device capability map, and Browser/PWA readiness actions with direct `device` and `computer` route hints.
- Added sudo execution posture: `execution action:"status|route"`, `setup action:"status"`, `setup action:"item" setupItemId:"sudo-execution-posture"`, and `process action:"capabilities"` now expose foreground-supervised escalation guidance, SUDO_PASSWORD presence-only status, blocked background sudo/stdin password routes, and missing SDK/daemon mediation contracts without reading or printing raw password values.
- Added connected-host setup repair cards: expanded `setup_posture` and `setup_item` rows now expose status/service diagnostics plus confirmed service install/start/restart `agent_operator_method` routes when the SDK operator contract supports them, while first-run setup excludes service stop/uninstall.
- Added probe-fed setup repair recommendations: connected-host setup now includes live service probe evidence, recommends diagnostics/status first, and keeps service install/start/restart as inspect-first confirmed routes until service status proves they are needed.
- Added certified service repair receipts: setup repair cards now include success criteria and verification routes, and `agent_operator_method` summarizes services.status/install/start/restart receipts into certified or follow-up outcomes without exposing the operator token.
- Added service lifecycle receipt decisions: setup posture now exposes serviceLifecycleDecision gates, and `agent_operator_method methodId:"services.status"` maps returned installed/running/control-plane evidence to exact install, start, restart, or no-action guidance before any lifecycle mutation.
- Added connected-host auth setup posture: first-run setup now has a token-safe connected-host auth row for missing/usable operator token state, fingerprint-only token evidence, `/auth review` guidance, exact pairing route ids, confirmed SDK-backed local token create/repair, and regression fixtures for missing-host, reachable-host, missing-token, and unconfigured-model setup paths.
- Added setup smoke execution: first-run setup now includes a token-safe install smoke row plus confirmed `setup action:"smoke"` evidence collection from package binary/version/status to connected-host status, auth posture, provider/model routing, setup posture, one first assistant turn, optional saved redacted evidence artifacts, and Home/setup latest-result plus history/trend/frequent-blocker surfacing without running shell commands implicitly.
- Added guided setup wizard: the Start workspace and `setup_posture` now expose progress, current-step routes, backtracking routes, setup-smoke rerun/save routes, and repeated-blocker focus from saved smoke evidence so first-run repair feels like one guided flow instead of a loose checklist.
- Added saved setup wizard checkpoints: Start and `setup action:"status"` now show the saved resume state, stale checkpoint auto-advance evidence, Start show/save/clear checkpoint actions, and `setup action:"checkpoint|save_checkpoint|clear_checkpoint"` inspect or mutate only Agent-owned step resume metadata after confirmation.
- Added setup closeout: Start and `setup action:"status"` now expose `setupWizard.closeout` / `setupCloseout` decisions that reduce critical setup blockers, saved setup smoke evidence, and the user onboarding completion marker into blocked, needs-smoke-evidence, ready-to-finish, or complete states; confirmed `setup action:"finish"` writes only the user onboarding markers.
- Added live setup receipt consumption: Start, setup checklist, setup wizard history, and setup closeout now merge saved setup-smoke artifacts, durable connected-host setup receipt artifacts, SDK/daemon setup receipt read-model snapshots, and ordered setup receipt event streams; ready service/auth/install-smoke/browser-PWA receipts auto-advance the matching rows, blocked receipts stay visible, schema/version/provenance/publication/cursor evidence is surfaced when certified receipts publish it, and secret-looking receipt summaries are redacted.
- Added first-run local model readiness: `setup action:"status"` and `setup action:"item"` now include a local-model readiness row with detected local stacks/routes, top cookbook recipe, readiness score, benchmark follow-through, and exact model-routing inspect routes.
- Added Personal Ops connector tool classification: expanded inbox and calendar lanes now read MCP tool metadata when available, classify read-only versus write-like email/calendar tools, and carry those capability tags into connector records and workflow prerequisites.
- Added Personal Ops schema-derived operation records: expanded inbox and calendar lanes now turn reviewed MCP schemas into required-field/sample-input/schema-route cards with explicit confirmation flags for send/edit-like actions.
- Added Personal Ops execution plans: request intake now returns ordered connector-read, local-compose, setup-repair, and confirmed-effect steps so inbox/calendar work is legible before any live provider action.
- Added confirmed Personal Ops read execution: `personal_ops action:"read"` (backed by `run_personal_ops_read`) runs one selected read-only inbox/calendar MCP operation after required-field and confirmation checks, refuses write-like tools, and returns bounded redacted output plus normalized review cards; users can also request a saved redacted review-card artifact without storing full raw connector output or full input values.
- Added next-route packets to confirmed Personal Ops reads so refreshed reads, lane/queue inspection, saved artifact reopen, local reply/reminder drafting, and send/calendar-edit boundaries are explicit structured routes after one read completes.
- Added Personal Ops saved review queues: saved inbox/calendar review artifacts now resurface as redacted thread/event queue records with artifact inspect routes, freshness status, confirmed refresh routes when a matching read connector is ready, local draft/reminder follow-up routes, and explicit confirmed provider-effect boundaries.
- Added the direct Personal Ops review queue: `personal_ops action:"queue"` aggregates saved inbox thread/calendar event review items, fresh provider-read routes, daemon/SDK provider read-model records, refresh routes, and follow-up confirmation boundaries without executing MCP tools or mutating artifacts.
- Added certified Personal Ops provider read-model consumption: inbox and calendar lanes now ingest fresh daemon/SDK-published provider-backed thread and event records with durable ids, labels, redacted snippets, agenda windows, conflict signals, source paths, freshness metadata, schema/version/publication/publisher/provenance/receipt evidence, read-only inspect routes, and confirmed follow-up routes only when reply/send/label/archive/edit/RSVP/delete routes are explicitly published.
- Added certified Personal Ops task/reminder read-model consumption: task and reminder lanes now ingest fresh daemon/SDK-published provider-backed task and reminder records with durable ids, due times, priorities, cadence, delivery targets, redacted notes, source paths, freshness metadata, schema/version/publication/publisher/provenance/receipt evidence, read-only inspect routes, and confirmed follow-up routes only when update/complete/defer/snooze/delete routes are explicitly published.
- Added Personal Ops provider-effect receipt certification: inbox, calendar, task, and reminder lanes now resurface certified provider-effect receipts for sends, labels, archive, edits, RSVP, update, complete, defer, snooze, and delete outcomes with redacted publication guarantees and receipt ids before Agent claims provider effects succeeded.
- Added Personal Ops task/reminder workflows: task lanes now separate visible work-plan actions from connected-host task inspection/control, and reminder lanes now expose confirmed reminder creation, autonomous schedule creation, schedule review, run, pause/resume, and exact-id control records.
- Added Personal Ops daily briefings: `personal_ops action:"briefing"` and the visible Daily briefing plan action now assemble one read-only user-first plan across inbox, agenda, tasks, reminders, routines, delivery, notes, and autonomy queue before any live personal-data read or effect.
- Added the first-class `personal_ops` adapter: `action:"briefing|status|queue|intake|lane"` exposes the safe Personal Ops discovery flow directly, while confirmed `action:"read"` preserves the existing one-operation inbox/calendar read boundary with required fields, redaction, and optional saved review cards.
- Added research runner posture: `research_runs` now exposes browser-backed research readiness, setup and fallback routes, source review, report save, Knowledge promotion routes, and policy so deep research requests do not pretend browser execution is ready when only web/fetch research is available.
- Added visual research report packets: `research action:"report" visualReport:true` now appends at-a-glance, evidence matrix, findings board, dated source/comparison, open-question, next-action, and handoff-checklist sections to the saved sourced artifact while preserving citation coverage metadata and no transcript body dump.
- Added guided learning consolidation execution: `memory action:"curator"` now returns an ordered duplicate-consolidation batch plan and first-class `agent_learning_consolidation` preview/merge/stale/delete/rollback/recreate routes; merge and stale phases write durable receipts, delete refuses duplicates that have not been staged stale, post-delete receipts preserve snapshots with exact-id recreate guidance, and confirmed recreate refuses unsafe id collisions before restoring deleted duplicates.
- Added learning prompt plans: `memory action:"curator"` now returns prompt-active records, suppressed review/setup/low-confidence/personality/consolidation counts, proposal queues, consolidation queues, and usefulness/freshness/source-quality/risk ordering rules so users and the model can see what may guide the assistant now before durable context expands.
- Added prompt context inspection and receipts: prompt builds now write durable sanitized receipt ids with turn/source/model/provider, selected and suppressed record refs, segment counts, prompt hash, size, timestamp, and completed/error/cancelled outcome without storing raw prompt or response text; Agent Workspace -> Local Context shows a compact receipt outcome timeline with exact latest-receipt drill-in and outcome filter routes, and `context action:"prompt|receipts|receipt"` exposes recent receipts, exact `receiptId`/`turnId`/`outcomeStatus` filters, turn outcomes, applied prompt composition order, selected VIBE.md/project context/memory/routine/skill/persona records, suppressed records, prompt previews on request, and approximate token budget without mutating local behavior.
- Added missing-host setup bootstrap: `setup action:"item"` for connected-host readiness now returns user-run GoodVibes host install, trust, binary verification, service start, and Agent reconnect commands before operator methods are reachable.
- Added first-class model/provider routing: `models action:"status|route|local|providers|provider|smoke"` now fronts model route readiness, provider/subscription posture, local model cookbook, exact route/provider lookup, and confirmed local server smoke checks while lower-level harness modes remain available for detail.
- Added model readiness scoring: `model_routing`, `model_route`, and the local model cookbook now expose estimated 0-100 readiness across latency, context window, tool support, vision, cost, and privacy while clearly flagging missing live benchmarks; the visible Model Routing lane now has an `Inspect route readiness` action for that read-only posture.
- Added route-level provider-health consumption: exact model-route readiness now consumes daemon-published provider and model-route health records with source ids, live latency, rate-limit posture, and redacted error posture before using benchmark latency as fallback evidence.
- Added local server endpoint checks: the local model cookbook now maps detected local provider/model registry endpoints and local base URL environment hints into exact endpoint inspect routes, model-list smoke commands, success criteria, failure triage, confirmed `models action:"smoke"` checks for detected or default local endpoints, refresh routes, provider-add hints, suggested defaults, and a visible `Check local servers` workspace action without running a hidden network probe.
- Added certified daemon-published local serving diagnostics consumption: local cookbook and exact endpoint inspection now surface schema/version/provenance/publication/publisher evidence, server version, loaded models, context/tool support, resource pressure, start/repair receipt ids, receipt status, source read-model path, exact confirmed start/repair routes when host-published, and redacted summaries while smoke checks, refresh, provider edits, benchmarks, and route changes remain separate confirmed actions.
- Added local model benchmark execution and evidence: the Model Routing workspace now includes a confirmed local benchmark action backed by `agent_model_compare` with `benchmarkKind:"local-model-route"` plus a `Review benchmark evidence` action for saved comparisons, revealed winner judgments, and filtered analytics before any separate default-model apply action.
- Added the visible assistant cockpit to TUI Home: the existing renderer now opens on the same setup, chat/model, project work, Personal Ops, research/docs, background supervision, and safety/recovery lanes as `agent_harness mode:"summary"`, while deeper subsystem details stay in categories and search.
- Tightened local behavior prompt quality gates: reviewed memory now requires the durable confidence threshold, and skills, routines, bundles, and personas only steer the assistant when reviewed and setup-ready; suppressed behavior remains visible as review/setup work.
- Added memory posture UX: `memory action:"status|provider|list|search|get"` now exposes Agent-local memory counts, direct record lookup/search, prompt-active recall, vector stats, embedding-provider doctor warnings, provider inspection, and external-memory setup contract maps for Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory, and daemon-published similar backends, including provider-specific next routes, certified schema/version/publication/publisher/provenance checks, setup/status/read/write/sync/forget checklist items, required receipt fields, certified durable receipt evidence, and sanitized live provider read-model consumption when the SDK/daemon publishes setup/status/read/write/sync/forget records.
- Added background-process parity reporting: `process action:"capabilities"` now maps terminal background start plus process list/poll/wait/log/kill/write, PTY, and sudo semantics to supported routes or explicit SDK/daemon contract gaps, with lower-level lifecycle aliases still accepted for compatibility.
- Improved background process logs: `execution action:"process"` and `process action:"log"` now return redacted stdout/stderr tails with byte counts, character counts, truncation flags, and direct process-style routes.
- Added first-class terminal/process adapters: `terminal command:"..." background:true` starts a visible tracked local process, while `process action:"list|poll|wait|log|kill|write"` manages the same ProcessManager records with the existing confirmation and unsupported PTY/stdin/sudo boundaries.
- Added a first-class schedule adapter: `schedule action:"list|create|remind|edit|run|pause|resume|delete"` routes recurring work, reminders, exact schedule edits, and lifecycle controls through the existing preview, confirmation, current-state diff, and allowlisted connected-host schedule paths.
- Added post-action next routes for schedules: confirmed autonomous schedule creation, routine promotion, reminders, schedule edits, and schedule lifecycle controls now return schedule list, autonomy queue, run, edit, pause, resume, and delete routes without weakening confirmation gates.
- Added pre-confirmation schedule handoffs: autonomous schedule, reminder, routine-promotion, and schedule-edit previews now include explicit confirmation routes while remaining non-mutating.
- Added a first-class setup adapter: `setup action:"status|item|repair|checkpoint|save_checkpoint|clear_checkpoint|token|smoke|finish|import_settings"` gives first-run setup a short user-intent route while delegating to the existing wizard, repair decision, token, smoke, closeout, and settings-import implementations.
- Added a first-class VIBE.md adapter: `vibe action:"status|show|init|import_persona"` gives personality setup a short user-intent route while preserving secret scans, confirmation gates, and Agent-local persona boundaries; unconfirmed init/import previews now include exact model and CLI `confirmationRoutes`.
- Added a first-class settings adapter: `settings action:"list|get|set|reset|import"` fronts Agent settings and GoodVibes settings import preview/apply without requiring the model to know harness settings modes or the workspace action id.
- Shared GoodVibes settings import previews now include source-package ownership metadata so users can reuse goodvibes-tui or other published GoodVibes platform settings without Agent mutating source package stores.
- Added a first-class host adapter: `host action:"status|capabilities|capability|services|service|methods|method"` fronts connected-host status, capability maps, service posture, endpoint detail, and daemon method inspection while preserving exact execution on `agent_operator_method`.
- Added a first-class device adapter: `device action:"status|capability|browser|control|voice|provider|open_browser|open_tts_provider|open_tts_voice"` keeps companion, mobile/PWA compatibility, voice/TTS, browser/desktop-control compatibility, provider posture, and visible browser/TTS picker handoffs available while preserving confirmation gates; `computer` is now the primary browser/PWA and desktop-control route.
- Added a first-class research adapter: `research action:"briefing|plan|search|runner|runs|run|sources|source|bundle|reports|report_artifact|create_run|start_run|checkpoint|pause|resume|cancel|complete|fail|delete_run|add_source|review_source|reject_source|use_source|delete_source|report"` gives deep research one user-facing route over a read-only next-action queue, workflow planning, bounded public source-candidate search, browser-runner readiness, visible run lifecycle, source triage, reviewed-source bundles, saved report inspection, and sourced report artifacts while preserving existing confirmation gates.
- Added dynamic background-process substrate probing: the process parity report now detects ProcessManager stdin/PTY methods, terminal/PTY operator methods, GoodVibes session-input routes, and credential routes, and `processAction:"write"` dispatches through a discovered safe ProcessManager stdin method only after explicit confirmation without echoing input data.
- Added certified interactive runtime record consumption: execution and computer posture now consume daemon/SDK read models for live process output chunks, typed PTY session routes, sudo credential mediation, and browser/desktop command receipts, surfacing schema/version/publication/publisher/provenance evidence, bounded redacted output, exact confirmed control routes, and missing certification signals without exposing raw secrets or private UI payloads.
- Added Work workspace process supervision: Work & Approvals now shows tracked/running/completed local process counts, stdin/PTY/sudo parity, process monitor/live-tail routes, and visible Background processes / Process capabilities actions.
- Added deep research briefing: `research action:"briefing"` now returns one read-only next-action queue across visible runs, source review, saved report artifacts, browser readiness, and exact follow-up routes without searching, mutating, opening browser surfaces, saving reports, ingesting Knowledge, exporting artifacts, archiving, sharing, or sending messages.
- Improved run-bound source search: `research action:"search" runId:"..."` now uses the visible run's saved question and returns run-specific inspect, briefing, start, and checkpoint follow-up routes without creating, starting, checkpointing, or mutating source records.
- Added cross-project handoff docs for GoodVibes TUI/daemon and GoodVibes SDK so browser-backed research, browser/PWA rendering, Personal Ops provider queues, PTY/sudo/process, watcher history, remote runner evidence, local model health, mobile/voice/device, channel receipts, and external memory provider contracts have concrete acceptance criteria before Agent consumes them.
- Added next-route packets to research run detail and mutation outputs so create/start/checkpoint/pause/resume/cancel/complete/fail/delete results point to the next visible inspect, briefing, workflow, run-bound search, source queue, checkpoint, report save, artifact inspection, or Knowledge promotion route without performing hidden work.
- Added next-route packets to research source detail and mutation outputs so add/review/reject/use/delete results point to the next visible inspect, queue, review/reject, bundle, sourced report save, mark-used, report artifact, or optional Knowledge promotion route while preserving separate confirmation gates.
- Added next-route packets to confirmed research report saves so saved artifacts point to high-level report inspection, artifact export/archive, Knowledge promotion, report listing, and visible run completion when `runId` is provided.
- Added deep research workflow planning: `research action:"plan"` now returns a read-only ordered route plan across visible run state, public web/fetch or browser posture, source capture/review, sourced report saves, and optional artifact-to-Knowledge promotion.
- Added research runner/report contracts: `research action:"runner"` directly exposes browser-runner setup and user-control requirements, while `research action:"plan"` includes those contracts plus visual-report packet sections, citation/source-map acceptance criteria, and artifact archive routes so missing browser execution and browser/PWA report rendering are explicit product gaps rather than hidden assumptions.
- Added certified live research read-model consumption: Research briefing, workflow planning, and run queues now consume SDK/daemon browser-backed runner records and browser/PWA visual report render records with schema/version/publication/publisher/provenance/freshness-cursor/receipt metadata, redacted URLs/logs, source/page receipt ids, visual sections, citation coverage, and exact inspect/open routes.
- Added Research workspace contract visibility: the existing renderer now shows browser-runner and visual-report readiness in the Research area, keeps the direct research run/source/report routes visible, and adds Research briefing, Plan workflow, Public source search, Browser runner readiness, and Report artifacts actions that map directly to `research action:"briefing"`, `research action:"plan"`, `research action:"search"`, `research action:"runner"`, and `research action:"reports"`.
- Added artifact ZIP archive export: `agent_artifacts mode:"archive"` writes the same reviewed package payload as one workspace ZIP file, while the existing package workspace form now lets users choose directory or ZIP output with the same confirmation and redacted manifest policy.
- Added reviewer-ready document export appendices: `agent_documents mode:"export"` now saves comment and AI suggestion summaries plus review metadata counts with the markdown artifact, without printing draft content in the tool response.
- Added reviewer-readiness checks: Document Ops now flags missing source artifacts, unresolved comments, proposed suggestions, unrevealed comparisons, hidden judgments, route-change decisions, and incomplete handoff evidence before export, archive, or model-route apply.
- Added visible reviewer preflight and handoff diff forms: Documents & Compare now has a read-only readiness preflight before export/archive/apply and a split-pane reviewer handoff diff form backed by `agent_model_compare mode:"handoffDiff"` with section jumps for metadata, policy, related artifacts, or comparison evidence.
- Added recent handoff choices in the diff form: Documents & Compare now reads saved reviewer handoff artifact metadata, shows the saved count, pre-fills the newest older-to-newer pair when available, and still lets blank IDs list recent handoffs safely.
- Added inline reviewer-readiness badges: document export, reviewer handoff/archive, and apply-winner forms now show readiness status, issue counts, and the next preflight action at the point of confirmation.
- Added review packet timeline: Documents & Compare and `document_ops_lane` now show one chronological document/comment/suggestion/attachment/export/compare/judgment/handoff/archive packet history with the next route decision.
- Added guided review packet defaults: Documents & Compare now picks the latest packet document/export/comparison/judgment/handoff evidence and pre-fills document export, compare handoff/archive, and apply-winner forms with editable field hints while preserving confirmation gates.
- Added reusable review packet presets: Documents & Compare now has a confirmed Save packet preset form backed by `agent_review_packet_presets`, with local JSON preset artifacts in the packet timeline, list/show reuse routes, and default fallback only when live packet evidence is missing.
- Added review packet preset freshness checks: preset list/show routes and the packet timeline now flag missing or superseded saved artifact ids, and show recommended reuse routes with newer matching evidence when metadata is sufficient.
- Added review packet preset refresh: stale presets can now be refreshed through a confirmed workspace form or `agent_review_packet_presets mode:"refresh"`, saving a new local preset artifact with source-preset lineage instead of making the user copy replacement ids by hand.
- Added review packet wizard: Documents & Compare and `document_ops_lane` now expose a read-only six-step packet guide across draft review, document export, compare judgment, reviewer handoff, route decision, and final archive review with progress, current-step route hints, backtracking routes, and refreshed-preset lineage before sharing.
- Added review packet sharing: Documents & Compare now has a confirmed Share review packet form backed by `agent_review_packet_share`, which validates a saved reviewer handoff archive, previews the configured delivery target and packet evidence ids, and sends only a plain-text archive reference after explicit confirmation.
- Added route-decision receipts: confirmed `agent_model_compare mode:"apply"` now saves an apply-winner receipt artifact, `mode:"routeDecision"` records leave-unchanged decisions without changing model routing, and Document Ops readiness/wizard state clears matching route-decision blockers before archive evidence exists.
- Added route-decision receipt archive evidence: `agent_model_compare mode:"handoffArchive"` now auto-includes matching route-decision receipt artifacts in reviewer handoff ZIP archives, README counts, archive metadata, and redacted manifests.
- Added blind comparison synthesis: `agent_model_compare mode:"synthesis"` groups saved judgment reasons into stable cross-session preference themes, reports revealed/hidden winner posture, and routes through the existing Compare Analytics workspace form without changing model routing.
- Added blind comparison reviewer handoffs: `agent_model_compare mode:"handoff"` creates one confirmed markdown artifact that combines saved comparison or judgment evidence with related document/artifact exports, while the existing Export Compare workspace form can choose report or handoff.
- Added blind comparison handoff archives: `agent_model_compare mode:"handoffArchive"` turns a saved reviewer handoff into one ZIP artifact with the handoff, source comparison or judgment, related evidence bytes, README, and redacted manifest.
- Added side-by-side comparison review: `agent_model_compare mode:"sideBySide"` renders related document/artifact excerpts beside saved comparison or judgment evidence through the existing Review Saved Compare form without creating artifacts or changing routes.
- Added filtered comparison analytics: saved comparison judgments now preserve task type, document id, and benchmark tags so `agent_model_compare mode:"analytics"` and `mode:"synthesis"` can show targeted preference trends without changing routes.
- Added VIBE.md personality support: project/global VIBE.md files are discovered, secret-scanned, injected into the serial Agent prompt, surfaced in the Personas workspace, and manageable through `vibe action:"status|show|init|import_persona"` or `/vibe status|init|show|import-persona`.
- Added project context support: `.hermes.md`, `HERMES.md`, `AGENTS.md`, `CLAUDE.md`, optional `HERMES_HOME/SOUL.md`, `.cursorrules`, and `.cursor/rules/*.mdc` are secret-scanned, injected as project instructions separate from VIBE.md personality, and exposed through `context action:"files|file"` with target-aware subdirectory lookup.
- Surfaced VIBE.md and project context health in the Local Context and Personas workspace: users now see applied/blocked/truncated counts and direct Inspect VIBE.md, Inspect project context, and Inspect one context file actions without knowing harness modes.
- Added managed Agent orchestration cards: `agent_harness mode:"agent_orchestration"` and `mode:"agent_orchestration_agent"` expose live subagent state, serial-by-default policy, multi-agent milestones, per-agent plan cards, remote-runner contract/artifact evidence, spawn/batch-spawn decision cards, templates, and exact first-class `agent` inspect/message/wait/cancel routes without creating hidden work.
- Added confirmed work-plan agent dispatch: `agent_work_plan action:"dispatch_agents"` previews selected approved work-plan items, then calls first-class `agent` spawn or batch-spawn after confirmation and writes linked-agent receipts back to the plan.
- Added post-dispatch next routes for work-plan agent dispatch: successful dispatch output and linked work-plan detail now point directly to orchestration, work-plan, agent inspect/wait/message/cancel, and closeout routes.
- Added orchestration closeout evidence: managed Agent cards now correlate linked work-plan items, dispatch receipt counts, closeout update routes, and remote-runner artifacts auto-attached by runner id with exact review routes.
- Added certified remote-runner read-model evidence: managed Agent cards now consume daemon/SDK live capture/export/closeout outcome records plus workspace/worktree isolation evidence by runner id, with schema/version/publication/publisher/provenance/freshness-cursor/receipt metadata, bounded redacted summaries, missing certification signals, source paths, closeout counts, and review-gate requirements while leaving remote mutations on confirmed routes.
- Added VIBE.md setup and curator health: blocked or truncated project/global personality files now appear in first-run setup and `memory action:"curator|candidate"` cards with `/vibe` inspection, init, and import routes.
- Added VIBE.md profile starter portability: starter export/from-discovered flows can include safe VIBE.md content with `--include-vibe`, imports preserve it, and profile creation writes it into the isolated profile home.
- Added tracked local background process controls: `execution action:"processes|process"`, `terminal command:"..." background:true`, and `process action:"poll|log|wait|kill|write"` expose shared ProcessManager start/list/status/log/wait/stop with bounded redacted output, process monitor/live-tail handoffs, session-id aliases, conditional confirmed stdin-write dispatch when a safe ProcessManager method exists, unsupported PTY guidance, and blocked hidden sudo prompts; lower-level background harness modes remain compatibility routes.
- Added execution history activity cards: `execution action:"history"` groups redacted tool/shell/edit records into user-facing outcome cards with verification evidence, bounded process-output summaries, supervision routes, and file-recovery handoffs, while `execution action:"record"` keeps exact record inspection available.
- Completed connected-host daemon aliases for the model: `daemon` maps to connected-host posture and `daemon_status` maps to live connected-host status while lifecycle control stays outside Agent.
- Completed settings parity for the model-facing harness and then promoted it behind first-class `settings`: discovery is compact by default with per-setting `modelRoute` hints, `settings action:"get"` and `includeParameters:true` expose full descriptors, and `settings action:"set|reset"` use the same config/secret managers with confirmation and external-host setting locks.
- Completed the tool-description verbosity sweep: first-class Agent tools and wrapped built-in tool definitions now register concise descriptions, nested parameter schema descriptions are stripped from the default model-visible catalog, and detailed safety rules remain enforced in policy wrappers, confirmation errors, and detailed harness inspection.
- Completed copyable model route hint cleanup: confirmed harness examples now include the required `confirm:true` and `explicitUserRequest` fields so route hints match the actual execution contract.
- Completed resilient shortcut/keybinding discovery: `agent_harness` returns fixed shortcuts and default-fallback keybinding descriptors when the live keybinding manager is absent, while keybinding execution and mutation still fail closed until the runtime manager is available.
- Completed the model-visible operator method catalog: `agent_harness` can now list and inspect allowlisted public operator and Agent Knowledge methods with their owning first-class model tools, confirmation policy, and boundaries, without exposing arbitrary route invocation.
- Expanded first-class Agent Knowledge reads: `agent_knowledge` now covers status, ask, search, source/node/issue lists, item lookup, map summary, connector list/detail, and connector doctor while staying inside `/api/goodvibes-agent/knowledge/*`.
- Added Agent-owned Knowledge response-scope validation: CLI, model tools, and live verification normalize public Agent-route scope aliases and reject successful-looking payloads with known non-Agent payload markers.
- Expanded release-route enforcement for Agent Knowledge: architecture/package policy now guards the full route catalog, and live verification definitions include source, node, issue, map, and connector read routes in addition to status, ask, and search.
- Verified the release line against connected-host public Agent routes for Agent Knowledge alias scope normalization and telephony channel surface support.
- Renamed active release evidence artifacts to current-release paths under `release/`, including release notes, readiness inventory, performance snapshot, and live-verification reports, so current release metadata no longer depends on stale historical filenames.

## 1.2.0 - 2026-06-07

- Promoted GoodVibes Agent to the stable 1.0.x operator product surface: the fullscreen Agent workspace is the primary TUI, with setup, provider/model routing, status, compatibility, and doctor flows shaped around personal operator use instead of copied host lifecycle controls.
- Completed the Agent-local behavior system for day-one operation: VIBE.md personality, project context files, local memory posture, prompt-active recall, vector/embedding health, notes, personas, skills, skill bundles, routines, starter profiles, discovery/import flows, review/stale/delete controls, and secret-looking content rejection all stay under Agent ownership.
- Completed isolated Agent Knowledge coverage across CLI, slash commands, workspace panels, connector/source/node/issue views, URL/file/browser/connector ingest, semantic ask/search, issue review, packet/explain previews, consolidation, reindex, and connected-host `/api/goodvibes-agent/knowledge/*` routes without fallback to default or non-Agent knowledge surfaces.
- Completed connected-host operator integration without taking host lifecycle ownership: compatibility/status checks, authenticated health and model routes, channel readiness, provider-account posture, approvals, automation snapshots, schedules, work plans, media/voice readiness, pairing, and explicit public-route diagnostics are all visible from Agent.
- Completed explicit side-effect boundaries for personal operation: channel sends, notifications, autonomous schedule creation, schedule enable/disable/delete, routine schedule promotion, reminders, subscription/auth actions, memory bundle imports/exports, support bundles, MCP configuration, profile changes, and build delegation require explicit confirmation where they mutate state or call external routes.
- Added first-class user-task route planning: `route action:"plan|status"` and lower-level `agent_harness mode:"route_decision"` turn a plain request into the preferred visible Agent route, alternatives, missing fields, confirmation boundary, workspace matches, and harness mode matches without running tools or creating hidden work, including screenshot/browser-control requests that now route to `computer action:"plan"`.
- Host/daemon health, doctor, readiness, service, and compatibility requests now route to `host action:"status"` first before setup repair or service lifecycle effects.
- Normal settings/configuration requests now route to `settings action:"list"` first so setting changes start with Agent-owned discovery and explicit confirmation boundaries.
- Direct reminders, schedules, cron, and schedule lifecycle requests now route to `schedule action:"list"` first, while broader ongoing work remains on autonomy intake.
- Plain command-shaped background work now routes to `execution action:"processes"` and the first-class `terminal`/`process` UX, while scheduled or watcher-like background work stays on autonomy intake.
- Interactive terminal, PTY, stdin, and sudo requests now route to `execution action:"process_capabilities"` first so users see current support, setup posture, and confirmation boundaries before any hidden process start or credential effect.
- External memory-provider, backend, cross-session sync, import/export, and named-provider requests now route to `memory action:"provider"` or the external provider checklist before Agent promises provider writes, sync, credentials, or import/export effects; provider detail also exposes next-route packets, missing setup/status/read/write/sync checks, and required receipt fields for SDK/daemon records Agent can consume.
- Model provider, local-cookbook, local server smoke, and route-fit requests now route to `models action:"provider|local|smoke|route"` before Agent attempts credential, smoke, benchmark, or route-change effects.
- Browser-backed research runner requests now route to `research action:"runner"`, and visual research report rendering requests route to `research action:"plan"` plus report artifacts before Agent claims browser/PWA rendering readiness.
- Voice workflow, TTS-provider, browser cockpit, and PWA requests now route to `device action:"voice|provider"` or `computer action:"browser"` before Agent attempts capture, playback, picker, or browser-open effects.
- Personal Ops briefing, saved queue, fresh inbox/calendar read, and connector setup requests now route to `personal_ops action:"briefing|queue|intake|lane"` before Agent attempts live provider reads or effects.
- Channel setup, triage, delivery receipt, and send requests now route to `channels action:"setup|triage|deliveries|channel"` before Agent attempts confirmed external delivery.
- Plain file undo/redo/recovery requests now route to `execution action:"recovery"` so users inspect available snapshots before confirming a local file mutation.
- Media generation requests now route to provider readiness and confirmed `agent_media_generate` saved-artifact output instead of inline bytes or silent Knowledge promotion.
- Permission posture, security finding, and blocked-action questions now route to `security action:"status|finding|explain"` so users get active permission state, exact redacted findings, or read-only policy preflight without knowing security harness mode names.
- Support-bundle, saved-session/bookmark, and release/audit evidence requests now route to first-class read-only `support action:"status|bundle"`, `sessions action:"list|get"`, and `audit action:"readiness|evidence|item|artifact"` before bundle export/import/share, session lifecycle, or audit drill-in effects.
- Added first-class setup repair decisions: `setup action:"repair"` and lower-level `agent_harness mode:"setup_repair"` choose the next safe token repair, connected-host status, services.status receipt, user-run bootstrap, or no lifecycle action without executing lifecycle, token, import, or UI effects.
- Added first-class policy explanations: `security action:"explain"` and lower-level `agent_harness mode:"policy_explain"` show why one model action is allowed, denied, or waiting on confirmation across the Agent route guard, permission mode, and typed tool confirmation, with secret-looking args redacted and no tool execution.
- Added user-first delegation decision cards and structured handoff briefs: execution and delegation posture now distinguish local-first work, TUI handoff, delegated review, remote inspection, and blocked hidden fanout, while `/delegate` and the Agent Workspace form preserve reason, success criteria, workspace hints, priority, and explicit review intent.
- Added the first-class `delegation` tool: `action:"status|routes|route"` exposes delegation policy, route catalogs, and exact confirmed handoff contracts without requiring harness mode names.
- Added the first-class `execution` tool: `action:"status|route|history|record|processes|process_capabilities|process|recovery"` exposes local-vs-delegated work posture, exact route inspection, activity cards, tracked process inspection, direct process parity/doctor reporting, and file recovery without requiring harness mode names.
- Added the first-class `computer` tool: `action:"status|plan|control|browser|setup|mcp|open_browser"` exposes browser/PWA readiness, browser/screenshot/desktop-control route planning, repair/setup rows, trusted MCP/tool discovery, and confirmed browser cockpit opens without requiring harness mode names.
- Added normalized autonomy queue controls: research runs, connected-host tasks, approvals, automation runs, and schedules now expose available/unavailable controls with reasons plus exact confirmed routes for checkpoint, pause, resume, cancel, approve, deny, retry, run, edit, enable, disable, and delete actions; host task cancel/retry stays on confirmed `agent_operator_method` routes while `/tasks` remains inspection-only.
- Added the first-class `autonomy` tool: `action:"intake|queue|item|status"` exposes ongoing-work route selection and visible autonomy queue inspection without requiring harness mode names.
- Added trigger workflow posture: `autonomy action:"intake"` now maps time-based wakeups/schedules, incoming webhook/event watchers through published `watchers.*` daemon routes, Gmail/email connector-gated triggers, and read-only control-plane event streams, with watcher creation kept admin-confirmed and source-scoped.
- Added certified watcher receipts: `autonomy action:"intake"` now exposes watcher success criteria, and `agent_operator_method` summarizes `watchers.create/patch/run/start/stop/delete` receipts into certified or follow-up outcomes without exposing operator tokens.
- Added a source-owned watcher evidence contract: `autonomy action:"intake"` now tells users and models which SDK/daemon-owned durable run-history receipts, provider source records, redacted event payload descriptors, and queue correlation records are needed before Agent claims persisted webhook/Gmail watcher history.
- Added host task output posture: autonomy queue connected-host task records now expose `/tasks output` routes plus bounded redacted result/error previews when the host publishes them, and route-only status when true output text is not in the read model.
- Completed package and release hardening for the release gate: Bun-only install/run instructions, package-facing text verification, package runtime bundling, packed global install smoke, blocked lifecycle command smoke, source/package boundary checks, architecture checks, recorded performance snapshot checks, verification ledger, strict live verification artifacts, and release-quality readiness inventory dimensions are now part of the validated release path.
- Completed the compact model-visible harness pass: `agent_harness` summary now starts with an assistant-first cockpit before technical counters, plural catalogs default to compact rows, `mode:"modes"` searches every harness mode by task/id/effect/parameter, and `mode:"mode"` inspects one mode contract with full schemas, policy blocks, route metadata, editor fields, release artifact detail, redacted log tail, and parameter detail behind `includeParameters:true` or singular inspect modes.
- Added a first-class `workspace` adapter for workspace actions, panels, UI surfaces, slash commands, CLI mirrors, keybindings, and fixed shortcuts, so the model can inspect or confirm visible workspace operations without memorizing harness mode names; lower-level harness modes remain for detailed route inspection and compatibility.
- Added ordered channel setup guide: Agent Workspace -> Channels, `/channels guide`, and `channels action:"setup"` now rank the next channel and walk through setup schema, secret-backed settings, delivery target, allowlist policy, live status/doctor checks, and explicit confirmed test-send boundaries.
- Added channel triage: Agent Workspace -> Channels, `/channels triage`, and `channels action:"triage"` now unify setup blockers, daemon delivery attempts, visible surface messages, route bindings, and redacted Agent receipts without claiming provider-specific unread inbox polling.
- Added channel delivery receipts: confirmed `/channels send` and `agent_channel_send` deliveries now write Agent-owned redacted receipt history, visible through Agent Workspace -> Channels, `/channels deliveries`, and `channels action:"deliveries"`.
- Added route-backed browser and desktop control setup posture: `setup action:"status|item"` plus `execution action:"status|route"` now show ready, attention, or setup-needed state, workflow cards, setup checklists, fallback routes, and MCP review routes for browser, desktop, computer-use, screenshot, or screen-recording tooling; lower-level `setup_posture`, `setup_item`, `execution_posture`, and `execution_route` remain compatibility routes.
- Added connected browser cockpit routing: Home, `computer action:"browser|open_browser"`, `workspace action:"surface|open"`, and lower-level UI surface detail routes now expose the configured connected-host browser cockpit/PWA URL with service/web setup fallback, workspace-category coverage, mobile/PWA controls, Agent onboarding marker status, and an honest unpublished browser/PWA first-run receipt contract.
- Added companion device capability mapping: `device action:"status|capability"` and lower-level `pairing_posture` / `pairing_route pairingRouteId:"device-capability-map"` now show ready/attention/setup-needed/not-published posture for companion pairing, mobile command routing, browser/PWA, voice controls, spoken responses, notifications, browser/desktop control, and camera/location sensors without returning raw tokens or claiming unpublished device APIs.
- Added voice workflow posture: `device action:"voice"` and lower-level `media_posture` now map push-to-talk input, voice memo transcription, spoken responses, and wake-word capture with ready/attention/setup-needed/not-published state, setup routes, runtime evidence, and explicit policy that always-listening capture is not published yet.
- Surfaced voice/device/browser posture in Voice & Media: the workspace now has Voice workflows, Device capability map, and Browser/PWA readiness actions with direct `device` and `computer` route hints.
- Added sudo execution posture: `execution action:"status|route"`, `setup action:"status"`, `setup action:"item" setupItemId:"sudo-execution-posture"`, and `process action:"capabilities"` now expose foreground-supervised escalation guidance, SUDO_PASSWORD presence-only status, blocked background sudo/stdin password routes, and missing SDK/daemon mediation contracts without reading or printing raw password values.
- Added connected-host setup repair cards: expanded `setup_posture` and `setup_item` rows now expose status/service diagnostics plus confirmed service install/start/restart `agent_operator_method` routes when the SDK operator contract supports them, while first-run setup excludes service stop/uninstall.
- Added probe-fed setup repair recommendations: connected-host setup now includes live service probe evidence, recommends diagnostics/status first, and keeps service install/start/restart as inspect-first confirmed routes until service status proves they are needed.
- Added certified service repair receipts: setup repair cards now include success criteria and verification routes, and `agent_operator_method` summarizes services.status/install/start/restart receipts into certified or follow-up outcomes without exposing the operator token.
- Added service lifecycle receipt decisions: setup posture now exposes serviceLifecycleDecision gates, and `agent_operator_method methodId:"services.status"` maps returned installed/running/control-plane evidence to exact install, start, restart, or no-action guidance before any lifecycle mutation.
- Added connected-host auth setup posture: first-run setup now has a token-safe connected-host auth row for missing/usable operator token state, fingerprint-only token evidence, `/auth review` guidance, exact pairing route ids, confirmed SDK-backed local token create/repair, and regression fixtures for missing-host, reachable-host, missing-token, and unconfigured-model setup paths.
- Added setup smoke execution: first-run setup now includes a token-safe install smoke row plus confirmed `setup action:"smoke"` evidence collection from package binary/version/status to connected-host status, auth posture, provider/model routing, setup posture, one first assistant turn, optional saved redacted evidence artifacts, and Home/setup latest-result plus history/trend/frequent-blocker surfacing without running shell commands implicitly.
- Added guided setup wizard: the Start workspace and `setup_posture` now expose progress, current-step routes, backtracking routes, setup-smoke rerun/save routes, and repeated-blocker focus from saved smoke evidence so first-run repair feels like one guided flow instead of a loose checklist.
- Added saved setup wizard checkpoints: Start and `setup action:"status"` now show the saved resume state, stale checkpoint auto-advance evidence, Start show/save/clear checkpoint actions, and `setup action:"checkpoint|save_checkpoint|clear_checkpoint"` inspect or mutate only Agent-owned step resume metadata after confirmation.
- Added setup closeout: Start and `setup action:"status"` now expose `setupWizard.closeout` / `setupCloseout` decisions that reduce critical setup blockers, saved setup smoke evidence, and the user onboarding completion marker into blocked, needs-smoke-evidence, ready-to-finish, or complete states; confirmed `setup action:"finish"` writes only the user onboarding markers.
- Added first-run local model readiness: `setup action:"status"` and `setup action:"item"` now include a local-model readiness row with detected local stacks/routes, top cookbook recipe, readiness score, benchmark follow-through, and exact model-routing inspect routes.
- Added Personal Ops connector tool classification: expanded inbox and calendar lanes now read MCP tool metadata when available, classify read-only versus write-like email/calendar tools, and carry those capability tags into connector records and workflow prerequisites.
- Added Personal Ops schema-derived operation records: expanded inbox and calendar lanes now turn reviewed MCP schemas into required-field/sample-input/schema-route cards with explicit confirmation flags for send/edit-like actions.
- Added Personal Ops execution plans: request intake now returns ordered connector-read, local-compose, setup-repair, and confirmed-effect steps so inbox/calendar work is legible before any live provider action.
- Added confirmed Personal Ops read execution: `personal_ops action:"read"` (backed by `run_personal_ops_read`) runs one selected read-only inbox/calendar MCP operation after required-field and confirmation checks, refuses write-like tools, and returns bounded redacted output plus normalized review cards; users can also request a saved redacted review-card artifact without storing full raw connector output or full input values.
- Added next-route packets to confirmed Personal Ops reads so refreshed reads, lane/queue inspection, saved artifact reopen, local reply/reminder drafting, and send/calendar-edit boundaries are explicit structured routes after one read completes.
- Added Personal Ops saved review queues: saved inbox/calendar review artifacts now resurface as redacted thread/event queue records with artifact inspect routes, freshness status, confirmed refresh routes when a matching read connector is ready, local draft/reminder follow-up routes, and explicit confirmed provider-effect boundaries.
- Added the direct Personal Ops review queue: `personal_ops action:"queue"` aggregates saved inbox thread/calendar event review items, fresh provider-read routes, refresh routes, and follow-up confirmation boundaries without executing MCP tools or mutating artifacts.
- Added Personal Ops task/reminder workflows: task lanes now separate visible work-plan actions from connected-host task inspection/control, and reminder lanes now expose confirmed reminder creation, autonomous schedule creation, schedule review, run, pause/resume, and exact-id control records.
- Added Personal Ops daily briefings: `personal_ops action:"briefing"` and the visible Daily briefing plan action now assemble one read-only user-first plan across inbox, agenda, tasks, reminders, routines, delivery, notes, and autonomy queue before any live personal-data read or effect.
- Added the first-class `personal_ops` adapter: `action:"briefing|status|queue|intake|lane"` exposes the safe Personal Ops discovery flow directly, while confirmed `action:"read"` preserves the existing one-operation inbox/calendar read boundary with required fields, redaction, and optional saved review cards.
- Added research runner posture: `research_runs` now exposes browser-backed research readiness, setup and fallback routes, source review, report save, Knowledge promotion routes, and policy so deep research requests do not pretend browser execution is ready when only web/fetch research is available.
- Added visual research report packets: `research action:"report" visualReport:true` now appends at-a-glance, evidence matrix, findings board, dated source/comparison, open-question, next-action, and handoff-checklist sections to the saved sourced artifact while preserving citation coverage metadata and no transcript body dump.
- Added guided learning consolidation execution: `memory action:"curator"` now returns an ordered duplicate-consolidation batch plan and first-class `agent_learning_consolidation` preview/merge/stale/delete/rollback/recreate routes; merge and stale phases write durable receipts, delete refuses duplicates that have not been staged stale, post-delete receipts preserve snapshots with exact-id recreate guidance, and confirmed recreate refuses unsafe id collisions before restoring deleted duplicates.
- Added learning prompt plans: `memory action:"curator"` now returns prompt-active records, suppressed review/setup/low-confidence/personality/consolidation counts, proposal queues, consolidation queues, and usefulness/freshness/source-quality/risk ordering rules so users and the model can see what may guide the assistant now before durable context expands.
- Added prompt context inspection and receipts: prompt builds now write durable sanitized receipt ids with turn/source/model/provider, selected and suppressed record refs, segment counts, prompt hash, size, timestamp, and completed/error/cancelled outcome without storing raw prompt or response text; Agent Workspace -> Local Context shows a compact receipt outcome timeline with exact latest-receipt drill-in and outcome filter routes, and `context action:"prompt|receipts|receipt"` exposes recent receipts, exact `receiptId`/`turnId`/`outcomeStatus` filters, turn outcomes, applied prompt composition order, selected VIBE.md/project context/memory/routine/skill/persona records, suppressed records, prompt previews on request, and approximate token budget without mutating local behavior.
- Added missing-host setup bootstrap: `setup action:"item"` for connected-host readiness now returns user-run GoodVibes host install, trust, binary verification, service start, and Agent reconnect commands before operator methods are reachable.
- Added first-class model/provider routing: `models action:"status|route|local|providers|provider|smoke"` now fronts model route readiness, provider/subscription posture, local model cookbook, exact route/provider lookup, and confirmed local server smoke checks while lower-level harness modes remain available for detail.
- Added model readiness scoring: `model_routing`, `model_route`, and the local model cookbook now expose estimated 0-100 readiness across latency, context window, tool support, vision, cost, and privacy while clearly flagging missing live benchmarks; the visible Model Routing lane now has an `Inspect route readiness` action for that read-only posture.
- Added local server endpoint checks: the local model cookbook now maps detected local provider/model registry endpoints and local base URL environment hints into exact endpoint inspect routes, model-list smoke commands, success criteria, failure triage, confirmed `models action:"smoke"` checks for detected or default local endpoints, refresh routes, provider-add hints, suggested defaults, and a visible `Check local servers` workspace action without running a hidden network probe.
- Added local model benchmark execution and evidence: the Model Routing workspace now includes a confirmed local benchmark action backed by `agent_model_compare` with `benchmarkKind:"local-model-route"` plus a `Review benchmark evidence` action for saved comparisons, revealed winner judgments, and filtered analytics before any separate default-model apply action.
- Added the visible assistant cockpit to TUI Home: the existing renderer now opens on the same setup, chat/model, project work, Personal Ops, research/docs, background supervision, and safety/recovery lanes as `agent_harness mode:"summary"`, while deeper subsystem details stay in categories and search.
- Tightened local behavior prompt quality gates: reviewed memory now requires the durable confidence threshold, and skills, routines, bundles, and personas only steer the assistant when reviewed and setup-ready; suppressed behavior remains visible as review/setup work.
- Added memory posture UX: `memory action:"status|provider|list|search|get"` now exposes Agent-local memory counts, direct record lookup/search, prompt-active recall, vector stats, embedding-provider doctor warnings, provider inspection, and external-memory setup contract maps for Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, and Supermemory, including provider-specific next routes, missing setup/status/read/write/sync checklist items, and required sync/write receipt fields while honestly marking provider records as not published until the SDK/daemon exposes concrete setup/status/read/write/receipt records for Agent to consume.
- Added background-process parity reporting: `process action:"capabilities"` now maps terminal background start plus process list/poll/wait/log/kill/write, PTY, and sudo semantics to supported routes or explicit SDK/daemon contract gaps, with lower-level lifecycle aliases still accepted for compatibility.
- Improved background process logs: `execution action:"process"` and `process action:"log"` now return redacted stdout/stderr tails with byte counts, character counts, truncation flags, and direct process-style routes.
- Added first-class terminal/process adapters: `terminal command:"..." background:true` starts a visible tracked local process, while `process action:"list|poll|wait|log|kill|write"` manages the same ProcessManager records with the existing confirmation and unsupported PTY/stdin/sudo boundaries.
- Added a first-class schedule adapter: `schedule action:"list|create|remind|edit|run|pause|resume|delete"` routes recurring work, reminders, exact schedule edits, and lifecycle controls through the existing preview, confirmation, current-state diff, and allowlisted connected-host schedule paths.
- Added post-action next routes for schedules: confirmed autonomous schedule creation, routine promotion, reminders, schedule edits, and schedule lifecycle controls now return schedule list, autonomy queue, run, edit, pause, resume, and delete routes without weakening confirmation gates.
- Added pre-confirmation schedule handoffs: autonomous schedule, reminder, routine-promotion, and schedule-edit previews now include explicit confirmation routes while remaining non-mutating.
- Added a first-class setup adapter: `setup action:"status|item|repair|checkpoint|save_checkpoint|clear_checkpoint|token|smoke|finish|import_settings"` gives first-run setup a short user-intent route while delegating to the existing wizard, repair decision, token, smoke, closeout, and settings-import implementations.
- Added a first-class VIBE.md adapter: `vibe action:"status|show|init|import_persona"` gives personality setup a short user-intent route while preserving secret scans, confirmation gates, and Agent-local persona boundaries; unconfirmed init/import previews now include exact model and CLI `confirmationRoutes`.
- Added a first-class settings adapter: `settings action:"list|get|set|reset|import"` fronts Agent settings and GoodVibes settings import preview/apply without requiring the model to know harness settings modes or the workspace action id.
- Shared GoodVibes settings import previews now include source-package ownership metadata so users can reuse goodvibes-tui or other published GoodVibes platform settings without Agent mutating source package stores.
- Added a first-class host adapter: `host action:"status|capabilities|capability|services|service|methods|method"` fronts connected-host status, capability maps, service posture, endpoint detail, and daemon method inspection while preserving exact execution on `agent_operator_method`.
- Added a first-class device adapter: `device action:"status|capability|browser|control|voice|provider|open_browser|open_tts_provider|open_tts_voice"` keeps companion, mobile/PWA compatibility, voice/TTS, browser/desktop-control compatibility, provider posture, and visible browser/TTS picker handoffs available while preserving confirmation gates; `computer` is now the primary browser/PWA and desktop-control route.
- Added a first-class research adapter: `research action:"briefing|plan|search|runner|runs|run|sources|source|bundle|reports|report_artifact|create_run|start_run|checkpoint|pause|resume|cancel|complete|fail|delete_run|add_source|review_source|reject_source|use_source|delete_source|report"` gives deep research one user-facing route over a read-only next-action queue, workflow planning, bounded public source-candidate search, browser-runner readiness, visible run lifecycle, source triage, reviewed-source bundles, saved report inspection, and sourced report artifacts while preserving existing confirmation gates.
- Added dynamic background-process substrate probing: the process parity report now detects ProcessManager stdin/PTY methods, terminal/PTY operator methods, GoodVibes session-input routes, and credential routes, and `processAction:"write"` dispatches through a discovered safe ProcessManager stdin method only after explicit confirmation without echoing input data.
- Added Work workspace process supervision: Work & Approvals now shows tracked/running/completed local process counts, stdin/PTY/sudo parity, process monitor/live-tail routes, and visible Background processes / Process capabilities actions.
- Added deep research briefing: `research action:"briefing"` now returns one read-only next-action queue across visible runs, source review, saved report artifacts, browser readiness, and exact follow-up routes without searching, mutating, opening browser surfaces, saving reports, ingesting Knowledge, exporting artifacts, archiving, sharing, or sending messages.
- Improved run-bound source search: `research action:"search" runId:"..."` now uses the visible run's saved question and returns run-specific inspect, briefing, start, and checkpoint follow-up routes without creating, starting, checkpointing, or mutating source records.
- Added cross-project handoff docs for GoodVibes TUI/daemon and GoodVibes SDK so browser-backed research, browser/PWA rendering, Personal Ops provider queues, PTY/sudo/process, watcher history, remote runner evidence, local model health, mobile/voice/device, channel receipts, and external memory provider contracts have concrete acceptance criteria before Agent consumes them.
- Added next-route packets to research run detail and mutation outputs so create/start/checkpoint/pause/resume/cancel/complete/fail/delete results point to the next visible inspect, briefing, workflow, run-bound search, source queue, checkpoint, report save, artifact inspection, or Knowledge promotion route without performing hidden work.
- Added next-route packets to research source detail and mutation outputs so add/review/reject/use/delete results point to the next visible inspect, queue, review/reject, bundle, sourced report save, mark-used, report artifact, or optional Knowledge promotion route while preserving separate confirmation gates.
- Added next-route packets to confirmed research report saves so saved artifacts point to high-level report inspection, artifact export/archive, Knowledge promotion, report listing, and visible run completion when `runId` is provided.
- Added deep research workflow planning: `research action:"plan"` now returns a read-only ordered route plan across visible run state, public web/fetch or browser posture, source capture/review, sourced report saves, and optional artifact-to-Knowledge promotion.
- Added research runner/report contracts: `research action:"runner"` directly exposes browser-runner setup and user-control requirements, while `research action:"plan"` includes those contracts plus visual-report packet sections, citation/source-map acceptance criteria, and artifact archive routes so missing browser execution and browser/PWA report rendering are explicit product gaps rather than hidden assumptions.
- Added Research workspace contract visibility: the existing renderer now shows browser-runner and visual-report readiness in the Research area, keeps the direct research run/source/report routes visible, and adds Research briefing, Plan workflow, Public source search, Browser runner readiness, and Report artifacts actions that map directly to `research action:"briefing"`, `research action:"plan"`, `research action:"search"`, `research action:"runner"`, and `research action:"reports"`.
- Added artifact ZIP archive export: `agent_artifacts mode:"archive"` writes the same reviewed package payload as one workspace ZIP file, while the existing package workspace form now lets users choose directory or ZIP output with the same confirmation and redacted manifest policy.
- Added reviewer-ready document export appendices: `agent_documents mode:"export"` now saves comment and AI suggestion summaries plus review metadata counts with the markdown artifact, without printing draft content in the tool response.
- Added reviewer-readiness checks: Document Ops now flags missing source artifacts, unresolved comments, proposed suggestions, unrevealed comparisons, hidden judgments, route-change decisions, and incomplete handoff evidence before export, archive, or model-route apply.
- Added visible reviewer preflight and handoff diff forms: Documents & Compare now has a read-only readiness preflight before export/archive/apply and a split-pane reviewer handoff diff form backed by `agent_model_compare mode:"handoffDiff"` with section jumps for metadata, policy, related artifacts, or comparison evidence.
- Added recent handoff choices in the diff form: Documents & Compare now reads saved reviewer handoff artifact metadata, shows the saved count, pre-fills the newest older-to-newer pair when available, and still lets blank IDs list recent handoffs safely.
- Added inline reviewer-readiness badges: document export, reviewer handoff/archive, and apply-winner forms now show readiness status, issue counts, and the next preflight action at the point of confirmation.
- Added review packet timeline: Documents & Compare and `document_ops_lane` now show one chronological document/comment/suggestion/attachment/export/compare/judgment/handoff/archive packet history with the next route decision.
- Added guided review packet defaults: Documents & Compare now picks the latest packet document/export/comparison/judgment/handoff evidence and pre-fills document export, compare handoff/archive, and apply-winner forms with editable field hints while preserving confirmation gates.
- Added reusable review packet presets: Documents & Compare now has a confirmed Save packet preset form backed by `agent_review_packet_presets`, with local JSON preset artifacts in the packet timeline, list/show reuse routes, and default fallback only when live packet evidence is missing.
- Added review packet preset freshness checks: preset list/show routes and the packet timeline now flag missing or superseded saved artifact ids, and show recommended reuse routes with newer matching evidence when metadata is sufficient.
- Added review packet preset refresh: stale presets can now be refreshed through a confirmed workspace form or `agent_review_packet_presets mode:"refresh"`, saving a new local preset artifact with source-preset lineage instead of making the user copy replacement ids by hand.
- Added review packet wizard: Documents & Compare and `document_ops_lane` now expose a read-only six-step packet guide across draft review, document export, compare judgment, reviewer handoff, route decision, and final archive review with progress, current-step route hints, backtracking routes, and refreshed-preset lineage before sharing.
- Added review packet sharing: Documents & Compare now has a confirmed Share review packet form backed by `agent_review_packet_share`, which validates a saved reviewer handoff archive, previews the configured delivery target and packet evidence ids, and sends only a plain-text archive reference after explicit confirmation.
- Added route-decision receipts: confirmed `agent_model_compare mode:"apply"` now saves an apply-winner receipt artifact, `mode:"routeDecision"` records leave-unchanged decisions without changing model routing, and Document Ops readiness/wizard state clears matching route-decision blockers before archive evidence exists.
- Added route-decision receipt archive evidence: `agent_model_compare mode:"handoffArchive"` now auto-includes matching route-decision receipt artifacts in reviewer handoff ZIP archives, README counts, archive metadata, and redacted manifests.
- Added blind comparison synthesis: `agent_model_compare mode:"synthesis"` groups saved judgment reasons into stable cross-session preference themes, reports revealed/hidden winner posture, and routes through the existing Compare Analytics workspace form without changing model routing.
- Added blind comparison reviewer handoffs: `agent_model_compare mode:"handoff"` creates one confirmed markdown artifact that combines saved comparison or judgment evidence with related document/artifact exports, while the existing Export Compare workspace form can choose report or handoff.
- Added blind comparison handoff archives: `agent_model_compare mode:"handoffArchive"` turns a saved reviewer handoff into one ZIP artifact with the handoff, source comparison or judgment, related evidence bytes, README, and redacted manifest.
- Added side-by-side comparison review: `agent_model_compare mode:"sideBySide"` renders related document/artifact excerpts beside saved comparison or judgment evidence through the existing Review Saved Compare form without creating artifacts or changing routes.
- Added filtered comparison analytics: saved comparison judgments now preserve task type, document id, and benchmark tags so `agent_model_compare mode:"analytics"` and `mode:"synthesis"` can show targeted preference trends without changing routes.
- Added VIBE.md personality support: project/global VIBE.md files are discovered, secret-scanned, injected into the serial Agent prompt, surfaced in the Personas workspace, and manageable through `vibe action:"status|show|init|import_persona"` or `/vibe status|init|show|import-persona`.
- Added project context support: `.hermes.md`, `HERMES.md`, `AGENTS.md`, `CLAUDE.md`, optional `HERMES_HOME/SOUL.md`, `.cursorrules`, and `.cursor/rules/*.mdc` are secret-scanned, injected as project instructions separate from VIBE.md personality, and exposed through `context action:"files|file"` with target-aware subdirectory lookup.
- Surfaced VIBE.md and project context health in the Local Context and Personas workspace: users now see applied/blocked/truncated counts and direct Inspect VIBE.md, Inspect project context, and Inspect one context file actions without knowing harness modes.
- Added managed Agent orchestration cards: `agent_harness mode:"agent_orchestration"` and `mode:"agent_orchestration_agent"` expose live subagent state, serial-by-default policy, multi-agent milestones, per-agent plan cards, remote-runner contract/artifact evidence, spawn/batch-spawn decision cards, templates, and exact first-class `agent` inspect/message/wait/cancel routes without creating hidden work.
- Added confirmed work-plan agent dispatch: `agent_work_plan action:"dispatch_agents"` previews selected approved work-plan items, then calls first-class `agent` spawn or batch-spawn after confirmation and writes linked-agent receipts back to the plan.
- Added post-dispatch next routes for work-plan agent dispatch: successful dispatch output and linked work-plan detail now point directly to orchestration, work-plan, agent inspect/wait/message/cancel, and closeout routes.
- Added orchestration closeout evidence: managed Agent cards now correlate linked work-plan items, dispatch receipt counts, closeout update routes, and remote-runner artifacts auto-attached by runner id with exact review routes.
- Added VIBE.md setup and curator health: blocked or truncated project/global personality files now appear in first-run setup and `memory action:"curator|candidate"` cards with `/vibe` inspection, init, and import routes.
- Added VIBE.md profile starter portability: starter export/from-discovered flows can include safe VIBE.md content with `--include-vibe`, imports preserve it, and profile creation writes it into the isolated profile home.
- Added tracked local background process controls: `execution action:"processes|process"`, `terminal command:"..." background:true`, and `process action:"poll|log|wait|kill|write"` expose shared ProcessManager start/list/status/log/wait/stop with bounded redacted output, process monitor/live-tail handoffs, session-id aliases, conditional confirmed stdin-write dispatch when a safe ProcessManager method exists, unsupported PTY guidance, and blocked hidden sudo prompts; lower-level background harness modes remain compatibility routes.
- Added execution history activity cards: `execution action:"history"` groups redacted tool/shell/edit records into user-facing outcome cards with verification evidence, bounded process-output summaries, supervision routes, and file-recovery handoffs, while `execution action:"record"` keeps exact record inspection available.
- Completed connected-host daemon aliases for the model: `daemon` maps to connected-host posture and `daemon_status` maps to live connected-host status while lifecycle control stays outside Agent.
- Completed settings parity for the model-facing harness and then promoted it behind first-class `settings`: discovery is compact by default with per-setting `modelRoute` hints, `settings action:"get"` and `includeParameters:true` expose full descriptors, and `settings action:"set|reset"` use the same config/secret managers with confirmation and external-host setting locks.
- Completed the tool-description verbosity sweep: first-class Agent tools and wrapped built-in tool definitions now register concise descriptions, nested parameter schema descriptions are stripped from the default model-visible catalog, and detailed safety rules remain enforced in policy wrappers, confirmation errors, and detailed harness inspection.
- Completed copyable model route hint cleanup: confirmed harness examples now include the required `confirm:true` and `explicitUserRequest` fields so route hints match the actual execution contract.
- Completed resilient shortcut/keybinding discovery: `agent_harness` returns fixed shortcuts and default-fallback keybinding descriptors when the live keybinding manager is absent, while keybinding execution and mutation still fail closed until the runtime manager is available.
- Completed the model-visible operator method catalog: `agent_harness` can now list and inspect allowlisted public operator and Agent Knowledge methods with their owning first-class model tools, confirmation policy, and boundaries, without exposing arbitrary route invocation.
- Expanded first-class Agent Knowledge reads: `agent_knowledge` now covers status, ask, search, source/node/issue lists, item lookup, map summary, connector list/detail, and connector doctor while staying inside `/api/goodvibes-agent/knowledge/*`.
- Added Agent-owned Knowledge response-scope validation: CLI, model tools, and live verification normalize public Agent-route scope aliases and reject successful-looking payloads with known non-Agent payload markers.
- Expanded release-route enforcement for Agent Knowledge: architecture/package policy now guards the full route catalog, and live verification definitions include source, node, issue, map, and connector read routes in addition to status, ask, and search.
- Verified the release line against connected-host public Agent routes for Agent Knowledge alias scope normalization and telephony channel surface support.
- Renamed active release evidence artifacts to current-release paths under `release/`, including release notes, readiness inventory, performance snapshot, and live-verification reports, so current release metadata no longer depends on stale historical filenames.

## 1.1.7 - 2026-06-05

- Hardened the Agent model tool surface so goodvibes_context routes to the Agent harness instead of dead-ending.
- Added tool execution and permission safety guards so registered model tools return structured failures instead of aborting turns.
- Added `route action:"plan|status"` and `agent_harness mode:"route_decision"` for read-only user-task route planning across visible Agent surfaces.
- Routed host/daemon health, doctor, readiness, service, and compatibility wording through `host action:"status"` before setup repair or service lifecycle effects.
- Routed normal settings/configuration wording through `settings action:"list"` so set/reset/import requests start with Agent-owned setting discovery and explicit confirmation boundaries.
- Routed model provider, local-cookbook, local server smoke, and route-fit wording through `models action:"provider|local|smoke|route"` before credential, smoke, benchmark, or route-change effects.
- Routed direct reminder, schedule, cron, and schedule lifecycle wording through `schedule action:"list"` plus confirmed schedule actions, while broader ongoing work remains on autonomy intake.
- Added a source-owned watcher evidence contract to autonomy intake so durable run-history receipts, provider source records, redacted event payload descriptors, and queue correlation stay explicit SDK/daemon handoff requirements instead of hidden Agent assumptions.
- Routed Personal Ops briefing, saved queue, fresh inbox/calendar read, and connector setup wording through `personal_ops action:"briefing|queue|intake|lane"` before live provider reads or effects.
- Added `setup action:"repair"` and `agent_harness mode:"setup_repair"` for read-only setup repair decisions that choose token repair, host status, services.status receipt, user-run bootstrap, or no lifecycle action without executing effects.
- Added `execution action:"capabilities|process_capabilities"` so process parity, PTY, stdin, and sudo posture reports are reachable from the first-class execution tool.
- Added `computer action:"plan"` and `agent_harness mode:"browser_control_route"` for read-only browser navigation, screenshot, and desktop-control workflow routing; `route action:"plan"` now prefers that computer planner for screenshot, browser-control, screen-observation, and desktop-control wording.
- Routed command-shaped background work through local process supervision so `route action:"plan"` prefers `execution action:"processes"` plus first-class `terminal`/`process` controls instead of delegation or autonomy for local long-running commands.
- Routed interactive terminal, PTY, stdin, and sudo wording through `execution action:"process_capabilities"` so unsupported interactive routes are explained before any hidden process start or credential effect.
- Routed external memory-provider, backend, cross-session sync, import/export, and named-provider wording through `memory action:"provider"` or the external provider checklist before promising provider writes, sync, credentials, or import/export effects.
- Added provider-specific next routes, missing setup/status/read/write/sync checklist items, and required receipt fields to the external memory-provider posture so Agent can explain exactly what SDK/daemon records are missing before provider-backed memory is used.
- Clarified shared GoodVibes settings import with source-package ownership metadata so imports remain user-controlled without implying Agent owns the source package capability.
- Routed browser-backed research runner wording through `research action:"runner"` and visual research report rendering wording through `research action:"plan"` plus report artifacts before claiming browser/PWA rendering readiness.
- Routed voice workflow, TTS-provider, browser cockpit, and PWA wording through `device action:"voice|provider"` or `computer action:"browser"` before capture, playback, picker, or browser-open effects.
- Routed channel setup, triage, delivery receipts, and send wording through `channels action:"setup|triage|deliveries|channel"` before confirmed external delivery.
- Routed file undo/redo/recovery wording through `execution action:"recovery"` so plain repair requests inspect FileUndoManager snapshots before any confirmed undo or redo is applied.
- Routed media generation wording through provider readiness and confirmed `agent_media_generate` saved-artifact output so generated bytes stay out of transcripts and Knowledge unless explicitly promoted.
- Routed permission posture, security findings, and blocked-action questions through `security action:"status|finding|explain"` so users can ask what is active, what happened, or why something was blocked without knowing policy tool names.
- Added direct read-only `support`, `sessions`, and `audit` adapters, and routed support-bundle, saved-session/bookmark, and release/audit evidence wording through `support action:"status|bundle"`, `sessions action:"list|get"`, and `audit action:"readiness|evidence|item|artifact"` before export/import/share, session lifecycle, or audit drill-in effects.
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
