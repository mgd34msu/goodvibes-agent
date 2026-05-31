# Changelog

All notable changes to GoodVibes Agent will be recorded here.

## Unreleased

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
