# Deployment And Services

GoodVibes Agent is a client/operator surface. It does not own daemon or listener deployment.

## Service Ownership

Agent must not:

- start an embedded daemon
- start an embedded HTTP listener
- install or uninstall OS services
- start, stop, or restart daemon services
- enable web, listener, control-plane, or channel surface posture

Those operations belong to GoodVibes TUI or the daemon host.

## Agent Runtime

The installed package exposes one executable:

```sh
goodvibes-agent
```

The executable is backed by TypeScript-authored source with a Bun shebang. Package install smoke must verify:

- `goodvibes-agent --help`
- `goodvibes-agent --version`
- `goodvibes-agent status --json`
- `goodvibes-agent smoke --json` when that command is available in the baseline being tested

## External Daemon Connection

Agent reads configuration and tokens, then connects to an already-running daemon. The default local control-plane URL is normally:

```text
http://127.0.0.1:3421
```

If the daemon is unavailable, unauthenticated, or on an incompatible SDK version, Agent commands should report actionable diagnostics without printing token values.

## Surface Commands

`goodvibes-agent surfaces`, `surfaces check`, and `surfaces show <surfaceId>` are read-only diagnostics.

`surfaces enable` and `surfaces disable` are intentionally blocked in Agent because they can mutate daemon/listener/web/channel posture.

## Release Rule

Only publish Agent releases that preserve the Agent product policy:

- serial/proactive assistant by default
- local memory/skills/personas until shared registries are stable
- Agent knowledge routes only for Agent wiki calls
- companion chat for normal assistant chat
- explicit delegation to GoodVibes TUI for build/fix/review work
- WRFC only when explicitly requested for delegated build/fix/review work
