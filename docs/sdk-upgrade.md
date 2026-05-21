# SDK Upgrade Notes

GoodVibes Agent pins `@pellux/goodvibes-sdk` exactly during pre-1.0 development. Do not move the pin or switch knowledge routes until SDK/TUI provide a verified npm release and route-contract handoff.

## Current Pin

- Agent package version: `0.0.0`
- SDK package pin: `@pellux/goodvibes-sdk@0.33.30`
- Expected daemon contract version: `0.33.30`
- Active knowledge routes: `knowledge.ask` and `knowledge.search`
- Agent-specific knowledge isolation: pending SDK handoff

Check the live daemon contract with:

```sh
bun run check:sdk
```

## Handoff Summary

When SDK publishes the Agent-specific knowledge seam:

1. Confirm npm has the exact SDK version and the route contracts are present in the published package.
2. Update the exact `@pellux/goodvibes-sdk` pin and the expected SDK constants together.
3. Run `bun install`, `bun run check:sdk`, and `bun run check:release` before any route switch.
4. Switch only `ask`/`search` after the Agent route request/response shapes are verified.
5. Rerun contamination checks: Agent queries must not return HomeGraph, Home Assistant, TV, or unrelated default-wiki facts.
6. Update `docs/release-risks.md`, `docs/release-evidence.md`, and release notes with the verified route state.

## Upgrade Process

1. SDK confirms the new package is published on npm and gives the exact version.
2. TUI confirms daemon compatibility expectations for the same version.
3. Update only the exact SDK dependency pin and `src/version.ts` constants.
4. Run `bun install`.
5. Run `bun run check:sdk` and confirm the daemon version/expected version report is coherent.
6. Run `bun run check:source` and `bun run check:release`.
7. Only then evaluate an Agent-specific knowledge route switch.

## Knowledge Route Switch Gate

Before replacing default `knowledge.ask` or `knowledge.search`, validate:

- Public route IDs and request/response shapes are present in the published SDK contracts.
- Agent ask/search use only Agent-owned knowledge and return no HomeGraph, Home Assistant, TV, or unrelated default-wiki facts for Agent queries.
- Default regular wiki behavior remains unchanged for other products.
- JSON output preserves raw structured data behind the same `ok`/`kind` envelopes.
- CLI and TUI summaries stay concise and do not dump raw route payloads.
- Smoke covers no-match behavior and at least one Agent-owned source-backed answer.

Do not create local shims for future route names. If the seam is missing or ambiguous, keep the current routes and ask SDK/TUI for a stable contract.
