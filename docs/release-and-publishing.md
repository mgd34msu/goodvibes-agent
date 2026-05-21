# Release And Publishing

GoodVibes Agent is private at `0.0.0`. Do not publish until there is an explicit release decision.

## Package Identity

- npm package: `@pellux/goodvibes-agent`
- executable: `goodvibes-agent`
- SDK dependency: exact pin to `@pellux/goodvibes-sdk@0.33.35`
- runtime: Bun
- source language: TypeScript
- daemon ownership: external only

## Required Gates

Before any release candidate:

```sh
bun install
bunx tsc --noEmit
bun run build
bun run package:install-check
bun run publish:check
npm pack --dry-run
git diff --check
```

Also run the package install smoke from a packed artifact. It must prove:

- the installed command is on `PATH`
- the bin target is `bin/goodvibes-agent.ts`
- the Bun shebang survives pack/install
- `goodvibes-agent --help` works
- `goodvibes-agent --version` reports the package version
- daemon-backed commands fail clearly when the external daemon is unavailable or unauthenticated
- no token value is printed

## Do Not Ship

Do not publish if package-facing docs or install commands refer to another package name, another executable, or Agent-owned daemon lifecycle.

Do not ship daemon binaries from this package. If Agent later gets compiled artifacts, they must use Agent artifact names and remain separate from daemon ownership.

## Near-Fork Baseline Rule

The first baseline commit can include copied TUI foundation code, but it must be marked as a copy checkpoint rather than product-ready Agent behavior. Follow-up work must remove or adapt coding-first policy, especially default WRFC/coding guardrails.
