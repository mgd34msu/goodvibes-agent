# Changelog

All notable changes to GoodVibes Agent will be recorded here.

## 0.0.0 - Private Baseline

- Copied the GoodVibes terminal foundation as a near-fork starting point for the Agent product.
- Renamed package identity to `@pellux/goodvibes-agent` and exposed one executable, `goodvibes-agent`.
- Pinned `@pellux/goodvibes-sdk` to `0.33.35`.
- Removed packaged daemon binaries and blocked Agent-owned daemon/service lifecycle commands.
- Limited package-facing docs to Agent install, external-daemon deployment, and release guidance.

This baseline is not product-ready. Coding-first guardrails and WRFC-default behavior remain copied foundation code and must be replaced with Agent serial/proactive policy before a public release.
