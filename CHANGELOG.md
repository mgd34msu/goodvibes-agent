# Changelog

All notable changes to GoodVibes Agent will be recorded here.

## 0.0.0 - Private Baseline

- Copied the GoodVibes terminal foundation as a near-fork starting point for the Agent product.
- Renamed package identity to `@pellux/goodvibes-agent` and exposed one executable, `goodvibes-agent`.
- Pinned `@pellux/goodvibes-sdk` to `0.33.35`.
- Removed packaged daemon binaries and blocked Agent-owned daemon/service lifecycle commands.
- Limited package-facing docs to Agent install, external-daemon deployment, and release guidance.
- Replaced copied coding-first orchestration policy with Agent serial/proactive policy and explicit GoodVibes TUI build delegation.
- Added the first Agent operator workspace on the copied fullscreen workspace foundation, exposed through `/agent`, `/home`, and `/operator`.

This baseline is not product-ready. It still contains broad copied TUI surfaces that must be pruned or reshaped into Agent-first operator workflows before a public release.
