# Release Checklist

This checklist is for preparing the first usable `goodvibes-agent` alpha. Do not publish from this repository until each gate is complete and reviewed.

## Preconditions

- GoodVibes daemon is already running and compatible with the pinned SDK.
- `@pellux/goodvibes-sdk` remains exactly pinned to the verified published version.
- No Agent-specific knowledge route switch is made without SDK/TUI handoff.
- Package version remains `0.0.0` and `private: true` until the final publish decision.
- README and `CHANGELOG.md` describe only current behavior.

## Automated Gates

Run from a clean checkout:

```sh
bun install
bun run check:source
bun run check:release
```

`check:source` runs type policy checks, typecheck, tests, build, `git diff --check`, and `npm pack --dry-run`.

`check:release` runs the source gate plus CLI and packed-artifact smoke. It installs the packed artifact into a temporary global prefix and verifies `goodvibes-agent --help`, `goodvibes-agent status`, and `goodvibes-agent smoke` from `PATH`.

## Manual Gates

- Run `docs/manual-smoke.md` in a real PTY.
- Verify no token values are printed in config/status/auth failure output.
- Verify unavailable daemon, auth failure, and version mismatch are actionable.
- Verify companion chat works for a two-turn conversation and reuses the session.
- Verify knowledge ask/search are scoped acceptably for the currently pinned SDK. If SDK has not published Agent-specific knowledge isolation, document the known default-wiki contamination risk instead of switching routes.
- Verify explicit TUI build delegation through public contracts with a harmless task, or document why live delegation was skipped.

## Publish Decision

- TUI has reviewed release behavior and accepted known risks.
- SDK has confirmed whether a newer published package is required.
- Manual PTY smoke has passed.
- `CHANGELOG.md` is current.
- Package version is bumped to `0.1.0`.
- `private` is removed only as part of the intentional publish commit.
- After publish, Bun global install is verified with `bun install -g @pellux/goodvibes-agent`, `goodvibes-agent --help`, and `goodvibes-agent status`.
