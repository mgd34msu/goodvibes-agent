# SDK Upgrade Notes

GoodVibes Agent pins `@pellux/goodvibes-sdk` exactly during pre-1.0 development. Move the pin or switch knowledge routes only after SDK/TUI provide a verified npm release and route-contract handoff.

## Current Pin

- Agent package version: `0.0.0`
- SDK package pin: `@pellux/goodvibes-sdk@0.33.34`
- Expected daemon contract version: `0.33.34`
- Active knowledge routes: `/api/goodvibes-agent/knowledge/ask` and `/api/goodvibes-agent/knowledge/search`
- Agent-specific knowledge isolation: active in code; live validation requires a daemon reporting `0.33.34`

Check the live daemon contract with:

```sh
bun run check:sdk
```

## Handoff Summary

For the SDK `0.33.34` Agent-specific knowledge handoff:

1. npm publish and package export verification are complete for `@pellux/goodvibes-sdk@0.33.34`.
2. The exact SDK dependency pin and expected SDK constants move together.
3. Agent `ask`/`search` target only `/api/goodvibes-agent/knowledge/ask` and `/api/goodvibes-agent/knowledge/search`.
4. Memory, skills, and personas stay local until shared registry contracts are promoted.
5. `bun run check:sdk` and `bun run check:release` require the daemon to report a compatible `0.33.34` contract.
6. Contamination checks must confirm Agent queries do not return HomeGraph, Home Assistant, TV, or unrelated default-wiki facts.
7. `docs/release-risks.md`, `docs/release-evidence.md`, and release notes must be updated after live validation.

## Upgrade Process

1. SDK confirms the new package is published on npm and gives the exact version.
2. TUI confirms daemon compatibility expectations for the same version.
3. Update only the exact SDK dependency pin and `src/version.ts` constants.
4. Run `bun install`.
5. Run `bun run check:sdk` and confirm the daemon version/expected version report is coherent.
6. Run `bun run check:source` and `bun run check:release`.
7. Only then evaluate an Agent-specific knowledge route switch.

## Knowledge Route Switch Gate

Before any future Agent knowledge route change, validate:

- Public route IDs and request/response shapes are present in the published SDK contracts.
- Agent ask/search use only Agent-owned knowledge and return no HomeGraph, Home Assistant, TV, or unrelated default-wiki facts for Agent queries.
- Default regular wiki behavior remains unchanged for other products.
- JSON output preserves raw structured data behind the same `ok`/`kind` envelopes.
- CLI and TUI summaries stay concise and do not dump raw route payloads.
- Smoke covers no-match behavior and at least one Agent-owned source-backed answer.

Do not create local shims for future route names. If the seam is missing or ambiguous, keep the current routes and ask SDK/TUI for a stable contract.
