# Runtime Connection

GoodVibes Agent is a TUI client for an already-running GoodVibes runtime. The package exposes one executable:

```sh
goodvibes-agent
```

The installed command is backed by TypeScript-authored source with a Bun shebang. Package install smoke must verify:

- `goodvibes-agent --help`
- `goodvibes-agent --version`
- `goodvibes-agent status --json`
- `goodvibes-agent` launches the TUI in a real PTY

## Runtime Prerequisite

Start the GoodVibes runtime from the owning GoodVibes host before launching Agent. Agent expects the runtime to expose public operator routes and the isolated Agent Knowledge routes:

```text
http://127.0.0.1:3421
/api/goodvibes-agent/knowledge/status
/api/goodvibes-agent/knowledge/ask
/api/goodvibes-agent/knowledge/search
```

If the runtime is unavailable, unauthenticated, or on an incompatible SDK version, Agent commands report actionable diagnostics without printing token values.

## Product Boundary

Agent owns the operator assistant TUI, local profiles, local memory/routines/skills/personas, isolated Agent Knowledge calls, companion chat, approvals/automation visibility, and explicit build delegation.

Agent does not host runtime connectivity. It does not provide commands to install, expose, start, stop, restart, or mutate the runtime host.

Agent Knowledge/Wiki is its own product segment. Agent uses `/api/goodvibes-agent/knowledge/*` only and must not fall back to default Knowledge/Wiki or other product-specific knowledge routes.

Normal assistant chat uses companion chat. Build/fix/review work is delegated explicitly to GoodVibes TUI through public runtime/session contracts, and WRFC is requested only when explicitly asked for delegated build/fix/review work.
