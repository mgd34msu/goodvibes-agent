# Changelog

All notable changes to GoodVibes Agent will be recorded here.

## 0.1.7 - 2026-05-31

- Replaced active planning-loop output and tests that still described planning as TUI-owned with Agent-owned planning state and planning namespace language.
- Added `LICENSE` to the explicit package file contract and release verification so npm tarballs cannot omit license text.
- Prevented the operator workspace from dispatching placeholder delegation commands such as `/delegate --wrfc <task>`; those actions now provide guidance until the user supplies real task text.

## 0.1.6 - 2026-05-31

- Made the publish helper use exported `NODE_AUTH_TOKEN` or `NPM_TOKEN` automatically by writing a temporary npm user config for publish commands.
- Rewrote source docs for tools, commands, knowledge, artifacts, and multimodal behavior so they describe Agent-only Knowledge/Wiki and never teach default Knowledge/Wiki or HomeGraph fallback.
- Updated `/plan` command and Planning panel language from copied TUI-owned wording to Agent-owned workspace planning state.
- Added regression tests that keep source docs and active planning surfaces aligned with Agent Knowledge isolation and Agent product language.

## 0.1.5 - 2026-05-31

- Hardened package-facing release checks so shipped docs and Agent guidance cannot reintroduce default Knowledge/Wiki, HomeGraph, Home Assistant, copied TUI daemon, or copied WRFC-first policy text.
- Removed the generic default `knowledgeApi` client from the active Agent command context so slash commands must use the isolated Agent Knowledge API.
- Changed CLI `knowledge ingest-url` to post directly to `/api/goodvibes-agent/knowledge/ingest/url` instead of invoking the generic knowledge operator method.
- Rejected `--space`, `--knowledge-space`, `--knowledgeSpaceId`, `--includeAllSpaces`, and HomeGraph-style flags in CLI and slash Agent Knowledge commands before any daemon call.

## 0.1.4 - 2026-05-31

- Hardened Agent Knowledge route isolation for CLI JSON output and diagnostics: Agent status, ask, search, and ingest-url now report explicit `agentKnowledge.*` identities and `/api/goodvibes-agent/knowledge/*` routes.
- Pointed runtime orchestrator and multimodal writeback dependencies at Agent Knowledge so assistant-authored knowledge cannot land in default Knowledge/Wiki.
- Moved project planning and work-plan artifacts onto the Agent Knowledge store so Agent task state does not use the regular wiki segment.

## 0.1.3 - 2026-05-31

- Added local Agent personas with `/personas`: create/list/search/show/use/review/stale/delete, secret-looking value rejection, active persona prompt injection, and operator workspace status.
- Added local Agent skills with `/agent-skills` and `/skills local`: create/list/search/show/enable/disable/review/stale/delete, secret-looking value rejection, enabled skill prompt injection, and operator workspace status.
- Kept persona and skill state Agent-local with no default Knowledge/Wiki or HomeGraph fallback.

## 0.1.2 - 2026-05-30

- Added `goodvibes-agent compat` for package SDK pin, external daemon version, auth presence, and isolated Agent Knowledge route readiness.
- Added `goodvibes-agent knowledge ...` commands for the isolated `/api/goodvibes-agent/knowledge/*` environment with no default Knowledge/Wiki or HomeGraph fallback.
- Added explicit GoodVibes TUI build delegation through `goodvibes-agent delegate` and `/delegate`; WRFC is requested only through explicit `--wrfc`, `/wrfc`, or `/review` delegation.
- Removed the copied WRFC panel from the default Agent panel registry while preserving explicit TUI delegation for build/fix/review work.
- Hardened the Agent release helper and CLI help output for the current Agent changelog and command set.

## 0.1.1 - 2026-05-30

- Reissued the first public alpha package after the initial `0.1.0` registry publish produced an install-blocking npm packument inconsistency.
- Kept the same Agent runtime boundary and TUI-derived shell foundation: external daemon only, serial/proactive Agent policy, and explicit GoodVibes TUI delegation for build/fix/review work.

## 0.1.0 - 2026-05-28

- Published the first public alpha package for `@pellux/goodvibes-agent`.
- Kept the near-fork GoodVibes TUI shell, renderer, input, fullscreen workspace, command registry, and release foundation.
- Preserved Agent product policy: serial/proactive main conversation by default, no local Agent-owned WRFC/spawn fanout, and explicit GoodVibes TUI delegation for build/fix/review work.
- Moved Agent-owned runtime state to `.goodvibes/agent` surface roots.
- Updated packaged Agent guidance, reviewer persona, and provider skill to avoid copied TUI WRFC/multi-agent defaults.
- Kept daemon lifecycle external: Agent connects to an already-running GoodVibes daemon and blocks daemon/service ownership commands.
- Pinned `@pellux/goodvibes-sdk` to `0.33.35`.

## 0.0.0 - Private Baseline

- Copied the GoodVibes terminal foundation as a near-fork starting point for the Agent product.
- Renamed package identity to `@pellux/goodvibes-agent` and exposed one executable, `goodvibes-agent`.
- Pinned `@pellux/goodvibes-sdk` to `0.33.35`.
- Removed packaged daemon binaries and blocked Agent-owned daemon/service lifecycle commands.
- Limited package-facing docs to Agent install, external-daemon deployment, and release guidance.
- Replaced copied coding-first orchestration policy with Agent serial/proactive policy and explicit GoodVibes TUI build delegation.
- Added the first Agent operator workspace on the copied fullscreen workspace foundation, exposed through `/agent`, `/home`, and `/operator`.

The private baseline intentionally kept broad TUI foundation code so the Agent could inherit the renderer, input, fullscreen workspace, command registry, and release bones before Agent-specific policy was applied.
