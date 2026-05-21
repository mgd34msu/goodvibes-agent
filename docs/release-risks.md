# Release Risks

This inventory tracks known blockers and accepted limitations before a public `0.1.0` release. Keep it current with README, CHANGELOG, and the release checklist.

## Current Blockers

- Agent-specific knowledge isolation is pending a verified SDK npm handoff. Current `ask` and `search` commands still use default `knowledge.ask` and `knowledge.search`, so default-wiki contamination from unrelated GoodVibes domains is possible.
- The package is still private `0.0.0`. Do not publish until there is an explicit release decision, version bump to `0.1.0`, and TUI/SDK review acceptance.

## Current Evidence

- Manual PTY smoke was recorded as passed on `2026-05-20` in `docs/release-evidence.md`. Re-run it before publishing if terminal/input/rendering code changes.
- Live status/auth/compat and two-turn companion chat smoke were recorded on `2026-05-20` in `docs/release-evidence.md`.
- Live delegation dry receipt was skipped because the current delegation command creates a real shared session/task and has no dry-run mode.

## Design Limitations

- GoodVibes Agent connects to an already-running daemon. It does not start, stop, install, supervise, repair, or own daemon lifecycle.
- Memory, skills, personas, and active profile state are Agent-local registries until stable shared SDK registries exist.
- Build/fix/review work delegates to GoodVibes TUI through public shared-session routes; WRFC remains explicit-only and TUI-owned.
- Release gates are non-publishing. `check:source`, `check:sdk`, `check:release`, and smoke scripts verify readiness but do not replace manual review.

## Review Before Publish

- Re-run `bun run check:sdk`, `bun run check:source`, and `bun run check:release`.
- Confirm `docs/release-evidence.md` is current for the release candidate.
- Reconfirm SDK package version and daemon contract expectations.
- Reconfirm whether Agent-specific knowledge routes are available; if not, document the contamination risk as accepted.
- Reconfirm package metadata, npm pack contents, and fresh Bun global install smoke.
