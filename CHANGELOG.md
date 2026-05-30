# Changelog

All notable changes to GoodVibes Agent will be recorded here.

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
