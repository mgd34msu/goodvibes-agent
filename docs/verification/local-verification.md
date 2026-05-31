# Local Verification

GoodVibes Agent has three verification layers:

- `local signal`: schema, routing, rendering, persistence, CLI, external-daemon diagnostics, and real-state checks that can run without proving an external SaaS or device outcome.
- `local behavior`: behavior that completes locally through in-process tests, the compiled CLI, a package install smoke, or controlled persisted state.
- `external outcome`: real delivery/provisioning checks such as Slack delivery, Cloudflare provisioning, Home Assistant device behavior, or a remote runner.

## Verification Ledger

Run the inventory ledger:

```bash
bun run verification:ledger
```

Write JSON for automation:

```bash
bun run verification:ledger -- --json --out /tmp/goodvibes-verification-ledger
```

The ledger counts settings, feature flags, slash commands, panels, CLI commands, external surfaces, and onboarding capability bundles. It intentionally separates local proof from external proof so the project can show where verification is strong without claiming that a third-party service was exercised.

## GoodVibes Home Audit

Run a read-only audit against the active GoodVibes home:

```bash
bun run audit:home -- --home ~/.goodvibes
```

Write machine-readable output:

```bash
bun run audit:home -- --home ~/.goodvibes --json --out /tmp/goodvibes-home-audit
```

The audit is inherited from the shared GoodVibes home boundary and is read-only. It checks:

- which files are owned by TUI, daemon, Agent, or another GoodVibes product;
- stale or unknown shared settings that could affect the external daemon connection;
- schema/default coverage for current settings;
- sensitive-file permissions for GoodVibes secrets;
- duplicated generated profile names;
- write-boundary diffs so tests can prove Agent code did not mutate unrelated GoodVibes products.

Agent uses this audit only as a diagnostic. It does not grant Agent daemon lifecycle ownership, and it does not authorize writes outside Agent-owned state.

## Live Verification

Run the compiled CLI, authenticated daemon probes, inventory ledger, and home audit together:

```bash
bun run verification:live -- --home ~/.goodvibes --out /tmp/goodvibes-live-verification
```

The live verifier checks:

- inventory coverage is at least 90% local signal;
- `dist/goodvibes-agent` exists and can run `--version`, `status --json`, `compat --json`, `knowledge status --json`, `providers`, and read-only posture diagnostics;
- the daemon bearer token can authenticate `/status`, `/api/health`, and `/v1/models`;
- Agent Knowledge probes use only `/api/goodvibes-agent/knowledge/status`, `/ask`, and `/search`;
- warnings are preserved for real posture problems such as an enabled-but-unreachable web surface or an enabled service that is not installed.

The live verifier must not call default `/api/knowledge/*`, HomeGraph, or Home Assistant knowledge routes. If Agent Knowledge is unavailable, the check reports that failure instead of falling back.

By default, warnings do not fail the command because they are useful runtime findings. Use strict mode when every warning should fail automation:

```bash
bun run verification:live -- --strict --out /tmp/goodvibes-live-verification-strict
```

## Release-Oriented Local Gate

For a practical local gate before a release or large config migration:

```bash
bun test src/test/config/goodvibes-home-audit.test.ts src/test/verification/verification-ledger.test.ts
bun test src/test/input
bun run typecheck
bun run build
bun run package:install-check
bun run verification:live -- --home ~/.goodvibes --out /tmp/goodvibes-live-verification
```

Read-only posture checks can return non-zero when an external daemon surface is unavailable or disabled. That is a real readiness finding, not a daemon lifecycle action by Agent.
