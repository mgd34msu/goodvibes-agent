# Changelog

All notable changes to GoodVibes Agent will be recorded here.

## 0.1.102 - 2026-06-01

- 34aaea8 Prune hidden copied panel surfaces

## 0.1.101 - 2026-06-01

- 5f35012 Prune hidden copied command surfaces

## 0.1.100 - 2026-06-01

- e2d5eee Run release tests only through branch CI
- 7d46e87 Prune dormant copied command modules

## 0.1.99 - 2026-06-01

- 804edd2 Prune copied setup commands and single-test CI

## 0.1.98 - 2026-06-01

- Avoid duplicate remote test runs during releases by letting the tag Release workflow own the single full validation pass.

## 0.1.97 - 2026-06-01

- d17b910 Harden package TUI launch smoke

## 0.1.96 - 2026-06-01

- 7ae787f Remove unused widget scaffold

## 0.1.95 - 2026-06-01

- a3b0dea Remove copied foundation examples

## 0.1.94 - 2026-06-01

- ae6fa3e Polish Agent runtime status labels

## 0.1.93 - 2026-06-01

- 7f802e5 Add external runtime URL override

## 0.1.92 - 2026-06-01

- f52b62e Fix copied CLI executable guidance

## 0.1.91 - 2026-06-01

- efbb82a Expand Agent Knowledge CLI management

## 0.1.90 - 2026-06-01

- 19f67ea Polish Agent command guidance

## 0.1.89 - 2026-06-01

- 6be201c Fix Agent workspace command targets

## 0.1.88 - 2026-06-01

- e97d2a2 Fix release test daemon port allocation

## 0.1.87 - 2026-06-01

- cd0d9fc Improve Agent TUI startup diagnostics

## 0.1.86 - 2026-06-01

- aac1849 Retry npm publish verification

## 0.1.85 - 2026-06-01

- 4a046f7 Harden npm publish reruns

## 0.1.84 - 2026-06-01

- 35dbf3d Show live external runtime status

## Unreleased

- Foregrounded live external-runtime reachability, SDK compatibility, operator-token state, and isolated Agent Knowledge readiness in `status`/`doctor` output.
- Removed the deprecated `actions/cache@v4` setup step so future CI/CD runs avoid Node 20 deprecation annotations from the shared workflow setup action.

## 0.1.83 - 2026-06-01

- f5099c1 Hide runtime-owned settings from Agent workspace

## 0.1.82 - 2026-06-01

- 3185531 Remove Agent local auth ownership paths

## 0.1.81 - 2026-06-01

- Added local Agent skill bundles so users can group related local skills, enable or disable the bundle, and inject the bundle's member procedures into the same serial assistant conversation.
- Added `/agent-skills bundle ...` commands plus Agent workspace visibility for skill bundle counts, enabled bundle state, active skill count, and bundle membership.
- Restored the GitHub CI eval gate script and replaced the copied TUI/daemon release workflow with an Agent package release workflow that validates Bun global install, package contents, compiled binary launch, and optional npm publish.
- Kept bundles Agent-local and reviewable with no daemon lifecycle behavior, hidden background agents, or non-Agent knowledge fallback.

## 0.1.80 - 2026-06-01

- Added an Agent day-one readiness checklist to the onboarding review step covering runtime connection, default model route, profile setup, isolated Agent Knowledge, local behavior, channels, routines/schedules, and explicit build delegation.
- Kept the first-run review focused on Agent setup outcomes instead of copied runtime lifecycle or non-Agent knowledge behavior.

## 0.1.79 - 2026-06-01

- Expanded the Voice & Media workspace into a provider readiness matrix covering selected TTS readiness, missing secret key names, media understanding/generation posture, and browser-tool state.
- Kept voice, browser, and generated media side effects explicit: the workspace renders setup state and next steps only, never secret values or hidden runtime actions.

## 0.1.78 - 2026-06-01

- Expanded the Agent channel workspace into a concrete readiness matrix with setup state, missing runtime config keys, default-target posture, and safe next steps for each externally owned channel.
- Kept channel setup read-only inside Agent: no runtime lifecycle ownership, no hidden sends, and no secret values rendered.

## 0.1.77 - 2026-06-01

- Added a first-class Agent profile creation form inside the fullscreen operator workspace instead of dispatching a placeholder command template.
- Surfaced profile and starter-template summaries directly in the Profiles workspace so day-one setup can pick an isolated Agent home from the TUI.
- Made Agent runtime profile creation refuse existing profile homes to protect local profile state across CLI, onboarding, and workspace flows.

## 0.1.76 - 2026-05-31

- Added optional starter profile creation to first-run onboarding so setup can create an isolated Agent home seeded with persona, skill, and routine templates.
- Added onboarding apply/verify support for Agent profile creation with prevalidation, rollback, and overwrite protection.
- Updated onboarding and renderer regressions so the first-run flow stays Agent-specific while exposing the starter profile path directly in the TUI.

## 0.1.75 - 2026-05-31

- Reworded Agent status, doctor, and external runtime diagnostics away from copied service/surface ownership language.
- Added `--delivery-channel` as the documented schedule promotion delivery flag while keeping prior delivery aliases as compatibility-only parser inputs.
- Cleaned Agent TUI help, workspace, and panel guidance so visible copy describes Agent workflows, channels, runtime endpoints, and external runtime connection boundaries.

## 0.1.74 - 2026-05-31

- Filtered checked-in foundation operator artifacts to Agent-relevant routes so host-specific knowledge segments are not documented in Agent artifacts.
- Added a release regression that rejects excluded host-specific route IDs, paths, descriptions, and enum values from Agent operator artifacts.
- Updated foundation artifact wording to describe the Agent-filtered contract instead of a full host contract dump.

## 0.1.73 - 2026-05-31

- Replaced copied first-run capability language with Agent-specific setup: operator TUI, provider access, isolated Agent Knowledge, local memory/skills, channels, automation review, and explicit TUI delegation.
- Reworked the fullscreen settings workspace grouping and descriptions around Agent experience, models, local Agent state, tools/automation, and external runtime connection.
- Added package-facing guards and regressions so copied browser/network/listener setup wording does not return to shipped Agent docs.

## 0.1.72 - 2026-05-31

- Removed copied runtime lifecycle and transport words from the Agent CLI parser, command handler, detailed help, and package exports.
- Replaced package-facing deployment/service docs with runtime-connection docs focused on the external runtime prerequisite and Agent product boundary.
- Added regression coverage so hidden lifecycle words are treated as normal TUI prompts instead of supported Agent commands.

## 0.1.71 - 2026-05-31

- Stopped importing copied TUI slash-command modules that do not belong to the Agent product surface.
- Trimmed the built-in panel registry to Agent-relevant approval, automation, auth, provider, security, task, and policy views.
- Reduced package contents so hidden copied command and panel modules are not shipped with the installed Agent TUI.

## 0.1.70 - 2026-05-31

- Removed copied TUI coding, runtime lifecycle, and developer-maintenance slash commands from the visible Agent command registry.
- Focused `/help` on Agent operator workflows instead of conversation branching, templates, tool inspection, or blocked TUI exit commands.
- Added regression coverage so copied TUI commands stay hidden while Agent knowledge, memory, skills, personas, routines, delegation, schedule, secrets, and work-plan commands remain available.

## 0.1.69 - 2026-05-31

- Made the first-run onboarding detail area wrap selected-row guidance across multiple lines instead of hiding setup context behind single-line truncation.
- Shortened first-screen setup labels and values so Agent identity, runtime connection, secret policy, profiles, and continue actions remain readable at normal terminal widths.
- Fixed tiny-view onboarding scroll behavior so the selected action stays visible when field capacity is minimal.

## 0.1.68 - 2026-05-31

- Removed internal foundation-phase language and blocked lifecycle command examples from package-facing docs.
- Stopped advertising runtime lifecycle and surface-management commands in shell completion while keeping safety blocks for accidental invocations.
- Added package text guards so shipped docs stay focused on the Agent TUI product path.

## 0.1.67 - 2026-05-31

- Reworked remote bridge and remote review language from copied runner/control-room wording to Agent-facing worker/review wording.
- Made bridge worker assignment read-only in Agent and removed hidden contract creation from remote show/contract paths.
- Added regressions around the remote worker review panel and bridge command wording.

## 0.1.66 - 2026-05-31

- Removed remote-runner and node/device posture wording from first-run Agent setup surfaces.
- Replaced the blocked remote-runner workspace action with a read-only build-delegation status action.
- Added onboarding/workspace regressions to keep visible setup focused on Agent features instead of copied runner internals.

## 0.1.65 - 2026-05-31

- Made the operator workspace more product-facing by replacing foundation/setup jargon with Agent profile, runtime status, voice/media, and browser-tool language.
- Removed the remote-runner item from the first-run voice/media workspace so day-one setup stays focused on user-facing assistant capabilities.
- Reworded settings, status panels, profile commands, and docs away from control-plane/runtime-profile terminology while preserving the same underlying contracts.

## 0.1.64 - 2026-05-31

- Cleaned remaining visible setup, workspace, panel, and auth wording that still exposed copied runtime-host terminology.
- Changed the advertised auth login target to runtime/listener while keeping legacy runtime-host aliases non-prominent.
- Added regression coverage so setup and workspace text stay Agent-specific and avoid copied platform/product wording.

## 0.1.63 - 2026-05-31

- Rewrote the remaining repo docs that still read like copied runtime/API notes into Agent-facing product docs.
- Clarified channel, provider, planning, voice, tools, and Agent Knowledge boundaries around external runtime usage and no default Knowledge/Wiki fallback.
- Kept the shipped package focused on the Agent TUI while preserving non-packaged foundation docs as Agent-specific references.

## 0.1.62 - 2026-05-31

- Tightened primary CLI help around Agent workflows instead of advanced runtime diagnostics.
- Reworded onboarding, workspace, and routine schedule surfaces toward Agent/operator language.
- Kept schedule promotion explicit while removing stale runtime-schedule wording from user-facing flows.

## 0.1.61 - 2026-05-31

- ff6766d Stop shipping repo-local skills
- 2eedcf5 Focus primary CLI help on Agent use
- 0ec6af0 Document Bun trust path for SDK native deps
- f9a6c76 Surface Agent actions in slash help

## 0.1.60 - 2026-05-31

- f3f2486 Stop shipping developer guidance in package
- 80c273e Remove developer debug surface
- e2d058f Remove code intelligence command surface
- acb3eeb Remove coding intelligence render dependencies

## 0.1.59 - 2026-05-31

- f03ee5f Remove unused coding panel sources
- 5950687 Remove blocked teamwork command surface
- e60bf10 Remove noisy Bun preinstall lifecycle

## 0.1.58 - 2026-05-31

- e137f90 Fail cleanly for non-TTY TUI launch

## 0.1.57 - 2026-05-31

- 90edab3 Expand Agent onboarding setup surfaces
- 251ae62 Guard package-facing Agent product language

## 0.1.56 - 2026-05-31

- a0b54e8 Document Bun global PATH setup
- f845cca Rename onboarding setup step
- 4462e52 Clarify Bun-only install path

## 0.1.55 - 2026-05-31

- d8f4eee Remove copied developer audit surfaces

## 0.1.54 - 2026-05-31

- dc1a290 Keep release docs version-neutral
- 07eb275 Stabilize Bun package install smoke
- d5da8fb Fix Bun global TUI launch smoke
- 883a11c Add exact-confirm local library delete flow

## 0.1.53 - 2026-05-31

- 77ad0cf Add local library edit workspace flow

## 0.1.52 - 2026-05-31

- e543fa5 Add selected local library actions

## 0.1.51 - 2026-05-31

- 6a8e8a6 Add local library workspace editors

## 0.1.50 - 2026-05-31

- bdb654a Improve local library workspaces

## 0.1.49 - 2026-05-31

- 445e694 Show isolated Agent Knowledge in TUI panel
- 632d951 Add agent-local registry tool
- 4832355 Make agent setup workspace actionable

## 0.1.48 - 2026-05-31

- 67f8ce0 Remove audit remnants and surface setup checklist
- 34c3d0b Remove internal development-only surfaces

## 0.1.47 - 2026-05-31

- 2bb2b8a Internal cleanup before operator UX work

## 0.1.46 - 2026-05-31

- e0addfe Internal cleanup before operator UX work

## 0.1.45 - 2026-05-31

- 0aa4b3e Approval UX cleanup

## 0.1.44 - 2026-05-31

- fdee09e Internal cleanup before operator UX work

## 0.1.43 - 2026-05-31

- 3afba9c Approval UX cleanup

## 0.1.42 - 2026-05-31

- 3c84649 Agent workspace cleanup

## 0.1.41 - 2026-05-31

- c108e13 Internal cleanup before operator UX work

## 0.1.40 - 2026-05-31

- 329dc13 Add routine schedule delivery targets

## 0.1.39 - 2026-05-31

- c98de19 Add routine schedule reconciliation

## 0.1.38 - 2026-05-31

- 072503c Add routine schedule promotion receipts

## 0.1.37 - 2026-05-31

- 656b6f4 Add Agent routine runtime schedule promotion

## 0.1.36 - 2026-05-31

- 9de2f5e Add guided Agent starter authoring

## 0.1.35 - 2026-05-31

- 2c25d5e Add local starter profile import export

## 0.1.34 - 2026-05-31

- 28838cc Add curated Agent profile starters

## 0.1.33 - 2026-05-31

- bfe0127 Add profile portability workspace coverage

## 0.1.32 - 2026-05-31

- 8af3cbd Add voice media node workspace coverage

## 0.1.31 - 2026-05-31

- 2bc4887 Expand Agent Knowledge workspace flows

## 0.1.30 - 2026-05-31

- 6a1c818 Add channel readiness to Agent workspace

## 0.1.29 - 2026-05-31

- 3fafcda Add Agent channel workspace guidance

## 0.1.28 - 2026-05-31

- 77a9dc4 Add isolated Agent runtime profiles

## 0.1.27 - 2026-05-31


## 0.1.26 - 2026-05-31

- dfb6147 Harden Agent read tool policy

## 0.1.25 - 2026-05-31

- cba5f6d Harden Agent find tool policy

## 0.1.24 - 2026-05-31

- 2375df3 Bound web search tool policy

## 0.1.23 - 2026-05-31

- 18d7381 Harden analyze and registry tool policy

## 0.1.22 - 2026-05-31

- 07e4445 Mark control tool read-only in agent runtime

## 0.1.21 - 2026-05-31

- d83f325 Keep inspect scaffold dry-run-only in agent runtime

## 0.1.20 - 2026-05-31

- c0eca13 Block settings mutation tool in agent runtime

## 0.1.19 - 2026-05-31

- a4255d5 Restrict durable workflow tool mutations in agent runtime

## 0.1.18 - 2026-05-31

- 1fd7729 Restrict state tool mutations in agent runtime

## 0.1.17 - 2026-05-31

- f148186 Restrict fetch side effects in agent runtime

## 0.1.16 - 2026-05-31

- bea1197 Restrict MCP tool mutations in agent runtime

## 0.1.15 - 2026-05-31

- 67de700 Restrict remote and channel tools in agent runtime

## 0.1.14 - 2026-05-31

- d128004 Block background exec in agent runtime

## 0.1.13 - 2026-05-31

- 989b048 Block local coding tools in agent runtime

## 0.1.12 - 2026-05-31

- 1843a77 Handle external runtime SDK mismatch in live verification
- 2b1a3f4 Align agent-owned test paths

## 0.1.11 - 2026-05-31

- d20a93e Allow explicit recall review without yes
- 601f41c Require confirmation for eval execution
- f41befb Block copied infrastructure onboarding mutations
- 79071ec Block implicit block file saves
- 40aca02 Block inline diff file edits in Agent
- 854eda8 Block MCP workspace config mutations
- 665c423 Require confirmation for CLI Agent Knowledge ingest
- f07255a Require confirmation for recall review mutations
- 6e78ec3 Require confirmation for Agent Knowledge mutations
- c1e5ac1 Require confirmation for operator control mutations
- 5d6fc3c Require confirmation for local state mutations
- 3afd788 Require confirmation for remaining export paths
- d36ae96 Require confirmation for portable state bundles
- 1f0caab Require confirmation for setup and remote exports
- 2e149c9 Require confirmation for incident and handoff exports
- b439c55 Require confirmation for settings mutations
- f7c8fe6 Require confirmation for platform auth mutations
- 09064e0 Require confirmation for auth and service mutations
- 55e8b8d Require confirmation for marketplace mutations
- 88becca Require confirmation for plugin mutations
- 89c0584 Require confirmation for local provider mutations
- 7f3af1b Require confirmation for managed hook mutations
- 323426c Require confirmation for destructive workplan cleanup
- 191350e Require confirmation for side-effecting slash commands

## 0.1.10 - 2026-05-31

- 93aba19 Block agent-spawning hook authoring
- 735839a Prune git header renderer from Agent
- 95d22fd Remove unused git shell bootstrap wiring
- 1392ebc Remove Agent write-quit commit helper
- df6572f Remove coding header posture from Agent shell
- 2b8e679 Align live verification with Agent routes
- 70eb800 Add stable typecheck release scripts
- 6b57500 Hide local agent activity in Agent UI
- 7166188 Add Agent Knowledge CLI shortcuts
- 386c19d Align service diagnostics with Agent boundaries
- e8b19db Lock runtime-owned settings in Agent

## 0.1.9 - 2026-05-31

- 75e5d4a Align shell surface delegation test
- a24c581 Use delegation wording in runtime indicator
- 259a75f Guard Agent knowledge isolation
- 59b6729 Align task help with Agent policy
- 0074a76 Classify stale runtime knowledge routes

## 0.1.8 - 2026-05-31

- 384c85a Remove stale WRFC artifact test
- 6230c64 Remove copied TUI historical docs
- 9065f4d Add local Agent routines
- e90d579 Lock Agent Knowledge CLI routes
- 1b05f97 Guard agent runtime policy boundaries
- 86f4bd1 Block agent cancellation from activity UI
- 22d6a1d Block remote runner cancellation from agent
- 9553688 Drop local agent records from saved sessions
- f4b6f9d Block local session graph mutations
- e372c44 Make orchestration command read-only
- 7bb908c Narrow local agent tool to read-only modes
- e8ed9c6 Verify packed global install smoke
- fdc956b Forbid packaged local agent definitions
- 881a18f Exclude local review agents from package
- 649cac7 Improve full test failure reporting
- 9982abc Remove default wiki from Agent runtime
- f625ac6 Make ops command view only
- af86ce5 Block copied CLI task submission
- 567e07c Externalize worktree recovery guidance
- 0fb2aa3 Block local runtime task mutations

## 0.1.7 - 2026-05-31

- Replaced active planning-loop output and tests that still described planning as TUI-owned with Agent-owned planning state and planning namespace language.
- Added `LICENSE` to the explicit package file contract and release verification so registry tarballs cannot omit license text.
- Prevented the operator workspace from dispatching placeholder delegation commands such as `/delegate --wrfc <task>`; those actions now provide guidance until the user supplies real task text.
- Added local Agent routines with `/routines`: create/list/search/show/enable/disable/start/review/stale/delete, secret-looking value rejection, enabled routine prompt injection, and operator workspace status. Starting a routine stays in the main conversation and does not create hidden background jobs.
- Removed copied TUI release, UAT, and WRFC artifact docs from the Agent source tree and updated remaining source docs so channel, voice, integration, and panel guidance speaks in Agent/external-runtime terms.

## 0.1.6 - 2026-05-31

- Made the publish helper use exported `NODE_AUTH_TOKEN` or `NPM_TOKEN` automatically by writing a temporary npm user config for publish commands.
- Rewrote source docs for tools, commands, knowledge, artifacts, and multimodal behavior so they describe Agent-only Knowledge/Wiki and never teach default Knowledge/Wiki or non-Agent graph fallback.
- Updated `/plan` command and Planning panel language from copied TUI-owned wording to Agent-owned workspace planning state.
- Added regression tests that keep source docs and active planning surfaces aligned with Agent Knowledge isolation and Agent product language.

## 0.1.5 - 2026-05-31

- Hardened package-facing release checks so shipped docs and Agent guidance cannot reintroduce default Knowledge/Wiki, non-Agent graph, copied runtime-hosting, or copied WRFC-first policy text.
- Removed the generic default `knowledgeApi` client from the active Agent command context so slash commands must use the isolated Agent Knowledge API.
- Changed CLI `knowledge ingest-url` to post directly to `/api/goodvibes-agent/knowledge/ingest/url` instead of invoking the generic knowledge operator method.
- Rejected default-space and broad cross-space query flags in CLI and slash Agent Knowledge commands before any runtime call.

## 0.1.4 - 2026-05-31

- Hardened Agent Knowledge route isolation for CLI JSON output and diagnostics: Agent status, ask, search, and ingest-url now report explicit `agentKnowledge.*` identities and `/api/goodvibes-agent/knowledge/*` routes.
- Pointed runtime orchestrator and multimodal writeback dependencies at Agent Knowledge so assistant-authored knowledge cannot land in default Knowledge/Wiki.
- Moved project planning and work-plan artifacts onto the Agent Knowledge store so Agent task state does not use the regular wiki segment.

## 0.1.3 - 2026-05-31

- Added local Agent personas with `/personas`: create/list/search/show/use/review/stale/delete, secret-looking value rejection, active persona prompt injection, and operator workspace status.
- Added local Agent skills with `/agent-skills` and `/skills local`: create/list/search/show/enable/disable/review/stale/delete, secret-looking value rejection, enabled skill prompt injection, and operator workspace status.
- Kept persona and skill state Agent-local with no default Knowledge/Wiki or non-Agent graph fallback.

## 0.1.2 - 2026-05-30

- Added `goodvibes-agent compat` for package SDK pin, external runtime version, auth presence, and isolated Agent Knowledge route readiness.
- Added `goodvibes-agent knowledge ...` commands for the isolated `/api/goodvibes-agent/knowledge/*` environment with no default Knowledge/Wiki or non-Agent graph fallback.
- Added explicit GoodVibes TUI build delegation through `goodvibes-agent delegate` and `/delegate`; WRFC is requested only through explicit `--wrfc`, `/wrfc`, or `/review` delegation.
- Removed the copied WRFC panel from the default Agent panel registry while preserving explicit TUI delegation for build/fix/review work.
- Hardened the Agent release helper and CLI help output for the current Agent changelog and command set.

## 0.1.1 - 2026-05-30

- Reissued the first public alpha package after the initial `0.1.0` registry publish produced an install-blocking npm packument inconsistency.
- Kept the same Agent runtime boundary and TUI-derived shell foundation: external runtime only, serial/proactive Agent policy, and explicit GoodVibes TUI delegation for build/fix/review work.

## 0.1.0 - 2026-05-28

- Published the first public alpha package for `@pellux/goodvibes-agent`.
- Kept the GoodVibes TUI-derived shell, renderer, input, fullscreen workspace, command registry, and release foundation.
- Preserved Agent product policy: serial/proactive main conversation by default, no local Agent-owned WRFC/spawn fanout, and explicit GoodVibes TUI delegation for build/fix/review work.
- Moved Agent-owned runtime state to `.goodvibes/agent` surface roots.
- Updated packaged Agent guidance, reviewer persona, and provider skill to avoid copied TUI WRFC/multi-agent defaults.
- Kept runtime lifecycle external: Agent connects to an already-running GoodVibes runtime and blocks runtime/service ownership commands.
- Pinned `@pellux/goodvibes-sdk` to `0.33.35`.

## 0.0.0 - Private Baseline

- Adopted the GoodVibes terminal foundation as the starting point for the Agent product.
- Renamed package identity to `@pellux/goodvibes-agent` and exposed one executable, `goodvibes-agent`.
- Pinned `@pellux/goodvibes-sdk` to `0.33.35`.
- Removed packaged runtime-host binaries and blocked Agent-owned runtime/service lifecycle commands.
- Limited package-facing docs to Agent install, external-runtime deployment, and release guidance.
- Replaced copied coding-first orchestration policy with Agent serial/proactive policy and explicit GoodVibes TUI build delegation.
- Added the first Agent operator workspace on the copied fullscreen workspace foundation, exposed through `/agent`, `/home`, and `/operator`.

The private baseline intentionally kept broad TUI foundation code so the Agent could inherit the renderer, input, fullscreen workspace, command registry, and release bones before Agent-specific policy was applied.
