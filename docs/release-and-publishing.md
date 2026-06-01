# Release And Publishing

GoodVibes Agent's current installable public alpha version is recorded in `package.json` and `CHANGELOG.md`.

## Package Identity

- registry package: `@pellux/goodvibes-agent`
- executable: `goodvibes-agent`
- SDK dependency: exact pin to `@pellux/goodvibes-sdk@0.33.35`
- runtime: Bun
- source language: TypeScript
- runtime ownership: external only

End users install and run GoodVibes Agent with Bun:

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
```

Do not add non-Bun install instructions for this product. The package is hosted on the public package registry, but the supported install and smoke path is Bun.

## Required Gates

Before any release candidate:

```sh
bun install
bun run typecheck
bun run build
bun run package:install-check
bun run publish:check
bun pm pack --dry-run
git diff --check
```

`bun run publish:package` publishes from a staged package directory to the package registry. If `NPM_CONFIG_USERCONFIG` is already set, the registry publish command uses it. Otherwise the script creates a temporary 0600 registry userconfig from `NODE_AUTH_TOKEN` or `NPM_TOKEN`, uses it for that publish command, and removes it with the staging directory.

Also run the package install smoke from a packed artifact. It must prove:

- the installed command is on `PATH`
- the bin target is `bin/goodvibes-agent.ts`
- the Bun shebang survives pack/install
- `goodvibes-agent --help` works
- `goodvibes-agent --version` reports the package version
- the installed TUI launches in a PTY and does not exit immediately
- runtime-backed commands fail clearly when the external GoodVibes runtime is unavailable or unauthenticated
- no token value is printed

## Do Not Ship

Do not publish if package-facing docs or install commands refer to another package name, another executable, or Agent-owned runtime lifecycle.

Do not publish if Agent Knowledge commands can fall back to default Knowledge/Wiki or another product-specific knowledge route. Agent Knowledge must use the isolated `/api/goodvibes-agent/knowledge/*` segment.

Do not ship runtime host binaries from this package. If Agent later gets compiled artifacts, they must use Agent artifact names and remain separate from runtime ownership.

## Product Rule

The public alpha can include mature terminal foundation code, but package-facing behavior must follow Agent product policy. Follow-up work should continue pruning or reshaping coding-first surfaces while preserving the renderer, input, fullscreen workspace, command registry, and release bones.
