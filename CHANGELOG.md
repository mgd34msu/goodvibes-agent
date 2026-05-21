# Changelog

## Unreleased

This package remains private at `0.0.0`. The first public usable alpha should be released as `0.1.0` only after the release checklist and manual PTY smoke pass.

### Added

- Bun-backed `goodvibes-agent` executable package scaffold.
- Proactive serial assistant/operator TUI and CLI.
- Public SDK/daemon integration for status, auth, companion chat, knowledge ask/search, work plans, approvals, automation observability, schedules, scheduler capacity, and explicit TUI build delegation.
- Assistant-local memory, skills, personas, active profile state, and policy explanations.
- Durable companion chat session reuse with provider/model routing awareness.
- Local delegation receipts and read-only delegation status summaries.
- Explicit, confirmation-gated operator mutation commands for approvals, automation runs/jobs, and schedule runs.
- Release smoke scripts that verify source commands, packed artifact installation, global-prefix bin, Bun shebang, compatibility, status, and smoke commands.
- Terminal input hardening for Unicode, multiline paste, history, cursor movement, Home/End, Delete, and cleanup behavior.
- Read-only SDK compatibility reporting for the pinned SDK/daemon contract and pending Agent knowledge isolation.

### Boundaries

- The agent connects to an already-running GoodVibes daemon; it does not start, stop, install, or supervise daemon lifecycle.
- Normal assistant chat uses companion chat routes.
- Build/fix/review work delegates to GoodVibes TUI through public shared-session routes.
- WRFC is requested only for explicit build/fix/review work.
- Memory, skills, and personas are local to GoodVibes Agent until stable shared SDK registries exist.
- SDK remains pinned to published `@pellux/goodvibes-sdk@0.33.30`.
- Agent-specific knowledge isolation is pending a verified newer SDK npm handoff.

### Release Notes

- Manual PTY smoke in `docs/manual-smoke.md` is mandatory before publishing because terminal editing behavior is user-facing.
- Release-candidate evidence is recorded in `docs/release-evidence.md`.
- Current blockers and accepted limitations are tracked in `docs/release-risks.md`.
- `bun run check:release` is a non-publishing release gate. It does not replace manual PTY smoke.
