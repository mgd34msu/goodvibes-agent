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

## 2026-05-21 SDK 0.33.31 Handoff Status

- SDK confirmed `@pellux/goodvibes-sdk@0.33.31` is published and that Agent knowledge routes are `/api/goodvibes-agent/knowledge/ask` and `/api/goodvibes-agent/knowledge/search`.
- Code now targets the Agent-specific knowledge environment for `ask` and `search`.
- The running daemon now reports a compatible `0.33.31` contract.
- Live Agent knowledge validation passed after daemon route-service wiring was restored.
- `/api/goodvibes-agent/knowledge/status` reported ready with an empty Agent knowledge store.
- `/api/goodvibes-agent/knowledge/ask` for `What is GoodVibes Agent?` returned no match with no sources, facts, or gaps.
- `/api/goodvibes-agent/knowledge/search` for `What is GoodVibes Agent?` returned no results.
- The Agent-owned route did not return HomeGraph, Home Assistant, TV, or unrelated default-wiki facts for the validation query.

## 2026-05-21 SDK 0.33.32 Handoff Status

- SDK confirmed `@pellux/goodvibes-sdk@0.33.32` is published and verified.
- The already-running daemon was updated by TUI and reported a compatible `0.33.32` contract.
- Agent code remains on `/api/goodvibes-agent/knowledge/status`, `/ask`, and `/search`; no default wiki fallback or client-side content filtering is used.
- `/api/goodvibes-agent/knowledge/status` reported ready with the isolated `knowledge-agent.sqlite` store.
- `/api/goodvibes-agent/knowledge/ask` for `What is GoodVibes Agent?` returned no match with zero confidence and no sources, facts, or gaps.
- `/api/goodvibes-agent/knowledge/search` for `What is GoodVibes Agent?` returned no results.
- The Agent-owned routes did not return HomeGraph, Home Assistant, TV, or default-wiki cross-talk for the validation query.
- Separate TUI validation found default `/api/knowledge/ask` still answers `What is GoodVibes Agent?` from regular Knowledge/Wiki GoodVibes GitHub repo sources. GoodVibes Agent does not use that route for Agent ask/search, but release green handoff remains held pending SDK patch or guidance.

## 2026-05-21 SDK 0.33.33 Handoff Status

- SDK confirmed `@pellux/goodvibes-sdk@0.33.33` is published and verified.
- The already-running daemon was updated by TUI and reported a compatible `0.33.33` contract.
- Agent code remains on `/api/goodvibes-agent/knowledge/status`, `/ask`, and `/search`; no default wiki fallback or client-side content filtering is used.
- `/api/goodvibes-agent/knowledge/status` reported ready with the isolated `knowledge-agent.sqlite` store and zero sources, nodes, issues, and usage records.
- `/api/goodvibes-agent/knowledge/ask` for `What is GoodVibes Agent?` returned no match with zero confidence and no sources, facts, or gaps.
- `/api/goodvibes-agent/knowledge/search` for `What is GoodVibes Agent?` returned no results.
- The Agent-owned routes did not return HomeGraph, Home Assistant, TV, or default-wiki cross-talk for the validation query.
- Separate TUI validation found default `/api/knowledge/ask` still answers `What is GoodVibes Agent?` from a regular Knowledge/Wiki default-space Navigation Menu source under `github.com/mgd34msu/goodvibes`. GoodVibes Agent does not use that route for Agent ask/search, but release green handoff remains held pending SDK patch or guidance.

## 2026-05-21 SDK 0.33.34 Handoff Status

- SDK confirmed `@pellux/goodvibes-sdk@0.33.34` is published and verified.
- The already-running daemon was updated by TUI and reported a compatible `0.33.34` contract.
- Agent code remains on `/api/goodvibes-agent/knowledge/status`, `/ask`, and `/search`; no default wiki fallback or client-side content filtering is used.
- `/api/goodvibes-agent/knowledge/status` reported ready with the isolated Agent knowledge store, zero sources, nodes, issues, and usage records, plus one prior job run record.
- `/api/goodvibes-agent/knowledge/ask` for `What is GoodVibes Agent?` returned no match with zero confidence and no sources, facts, or gaps.
- `/api/goodvibes-agent/knowledge/search` for `What is GoodVibes Agent?` returned no results.
- The Agent-owned routes did not return HomeGraph, Home Assistant, TV, or default-wiki cross-talk for the validation query.

## 2026-05-21 M1 TUI Foundation Smoke

- Ran `GOODVIBES_AGENT_HOME=$(mktemp -d) bun run src/main.ts tui` in a real PTY.
- Terminal setup emitted alt-screen enter, screen clear, cursor hide, mouse enable, keyboard-extension enable, and bracketed-paste enable sequences.
- First typed key appeared immediately in the shell footer prompt through the compositor-rendered frame.
- Ctrl-J inserted multiline prompt input, and subsequent text rendered on the next prompt line with the visible cursor preserved.
- PTY resize was exercised by changing `/dev/pts/4` to `30x100` and sending `SIGWINCH`; the compositor reset its diff and redrew the TUI shell without falling back to a full custom string renderer.
- Ctrl-L emitted a forced clear/home sequence, reset the compositor diff, and redrew the shell with the compact operator dashboard still visible.
- Esc exited cleanly and emitted bracketed-paste-off, keyboard-extension reset, mouse disable, cursor show, screen clear, alt-screen exit, and ANSI reset sequences.
