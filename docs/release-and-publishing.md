# Release And Publishing

GoodVibes Agent `0.1.0` is the first public alpha release.

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

The public alpha can include copied TUI foundation code, but package-facing behavior must follow Agent product policy. Follow-up work should continue pruning or reshaping copied coding-first surfaces while preserving the TUI-derived renderer, input, fullscreen workspace, command registry, and release bones.
