# Changelog

Product-facing release notes for GoodVibes Agent.

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
- Added local Agent memory, personas, skills, skill bundles, routines, schedule receipts, and schedule reconciliation.
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

- Added isolated Agent Knowledge CLI and slash-command routing with no fallback to default Knowledge/Wiki or non-Agent knowledge segments.
- Added local Agent personas, skills, and routines with create/list/search/show/review/stale/delete workflows and secret-looking value rejection.
- Added explicit build/fix/review delegation to the GoodVibes build environment; WRFC is requested only through explicit delegation.
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
