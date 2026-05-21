# Release Risks

This inventory tracks known blockers and accepted limitations before a public `0.1.0` release. Keep it current with README, CHANGELOG, and the release checklist.

## Current Blockers

- Agent-specific knowledge isolation is pending a verified SDK npm handoff. Current `ask` and `search` commands still use default `knowledge.ask` and `knowledge.search`, so default-wiki contamination from unrelated GoodVibes domains is possible.
- Manual PTY smoke has not been recorded as passed for a release candidate. The checklist in `docs/manual-smoke.md` remains mandatory before publishing.
- The package is still private `0.0.0`. Do not publish until there is an explicit release decision, version bump to `0.1.0`, and TUI/SDK review acceptance.

## Design Limitations

- GoodVibes Agent connects to an already-running daemon. It does not start, stop, install, supervise, repair, or own daemon lifecycle.
- Memory, skills, personas, and active profile state are Agent-local registries until stable shared SDK registries exist.
- Build/fix/review work delegates to GoodVibes TUI through public shared-session routes; WRFC remains explicit-only and TUI-owned.
- Release gates are non-publishing. `check:source`, `check:sdk`, `check:release`, and smoke scripts verify readiness but do not replace manual review.

## Review Before Publish

- Re-run `bun run check:sdk`, `bun run check:source`, and `bun run check:release`.
- Record manual PTY smoke results.
- Reconfirm SDK package version and daemon contract expectations.
- Reconfirm whether Agent-specific knowledge routes are available; if not, document the contamination risk as accepted.
- Reconfirm package metadata, npm pack contents, and fresh Bun global install smoke.
