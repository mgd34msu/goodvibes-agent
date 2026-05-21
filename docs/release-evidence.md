# Release Evidence

This file records release-candidate evidence runs. It does not authorize publishing by itself; the release checklist, TUI review, SDK handoff, and explicit release decision still apply.

## 2026-05-20 M4/M5 Readiness Evidence

Environment:

- Local time: `2026-05-20 21:35:37 CDT (-0500)`
- GoodVibes daemon: already running at `http://127.0.0.1:3421`
- SDK contract: `0.33.30`
- Agent package version: private `0.0.0`

Manual PTY smoke:

- Ran `GOODVIBES_AGENT_HOME=$(mktemp -d) bun run dev tui` in a real PTY.
- First typed key appeared immediately.
- Unicode input `abc é こんにちは` was preserved.
- Left/Right cursor movement inserted text at the cursor.
- Backspace and Delete edited the expected code points without splitting Unicode.
- Home/End moved to start/end of the input line.
- Ctrl-J inserted multiline input.
- Up/Down history recalled and cleared `/status` predictably.
- Bracketed paste preserved multiline pasted text and did not submit unexpectedly.
- Ctrl-R refreshed read-only status panes without losing the current multiline input.
- PTY resize was exercised by changing `/dev/pts/4` to `32x100` and sending `SIGWINCH`; layout redrew without overlapping transcript and dashboard content.
- Esc exited cleanly and emitted bracketed-paste-off/cursor-restore/reset sequences.

Daemon failure and safety checks:

- `GOODVIBES_AGENT_BASE_URL=http://127.0.0.1:1 bun run dev status` returned structured `daemon_unavailable`.
- `GOODVIBES_AGENT_TOKEN=invalid-token bun run dev chat "hello"` returned structured `auth_required` without printing the invalid token value.
- `bun run dev approvals approve smoke-approval` returned `confirmation_required` before calling `approvals.approve`.
- `bun run dev automation run smoke-job` returned `confirmation_required` before calling `automation.jobs.run`.
- `bun run dev schedules run smoke-schedule` returned `confirmation_required` before calling `schedules.run`.

Live daemon smoke:

- `bun run dev status` returned `ok` with daemon version `0.33.30`.
- `bun run dev auth` returned authenticated `shared-token` state without token values.
- `bun run dev compat` returned `sdk.compatibility`, SDK pin `0.33.30`, daemon version `0.33.30`, Agent knowledge isolation `pending_sdk_handoff`, active routes `knowledge.ask`/`knowledge.search`, and `routeSwitchAllowed: false`.
- Two-turn companion chat used a temporary agent home. Turn one replied `AGENT_SMOKE_ONE`; turn two replied `AGENT_SMOKE_TWO`; both turns reused the same companion session id, redacted here.

Skipped live checks:

- Live delegation dry receipt was skipped. The current `delegate` command creates a real shared session/task through public daemon routes and can hand work to TUI; there is no dry-run receipt mode. This remains a documented release consideration rather than an accidental live mutation.
