# Deployment And Services

GoodVibes Agent is a client/operator TUI. It connects to an already-running GoodVibes runtime and does not own runtime or listener deployment.

## Runtime Ownership

Agent must not:

- start an embedded runtime
- start an embedded HTTP listener
- install or uninstall OS services
- start, stop, or restart runtime services
- enable web, listener, control-plane, or channel surface posture

Those operations belong to GoodVibes TUI or the owning runtime host. Agent reports external runtime readiness but does not configure that host.

## Agent Runtime

The installed package exposes one executable:

```sh
goodvibes-agent
```

The executable is backed by TypeScript-authored source with a Bun shebang. Package install smoke must verify:

- `goodvibes-agent --help`
- `goodvibes-agent --version`
- `goodvibes-agent status --json`
- `goodvibes-agent` launches the TUI in a real PTY
- `goodvibes-agent smoke --json` when that command is available in the baseline being tested

## External Runtime Connection

Agent reads configuration and tokens, then connects to an already-running GoodVibes runtime. The default local control-plane URL is normally:

```text
http://127.0.0.1:3421
```

If the runtime is unavailable, unauthenticated, or on an incompatible SDK version, Agent commands should report actionable diagnostics without printing token values.

## Release Rule

Only publish Agent releases that preserve the Agent product policy:

- serial/proactive assistant by default
- local memory/routines/skills/personas until shared registries are stable
- Agent knowledge routes only for Agent wiki calls
- companion chat for normal assistant chat
- explicit delegation to GoodVibes TUI for build/fix/review work
- WRFC only when explicitly requested for delegated build/fix/review work
