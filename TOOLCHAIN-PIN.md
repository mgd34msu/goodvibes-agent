# TOOLCHAIN-PIN — @pellux/goodvibes-toolchain

The agent consumes the shared CI/CD toolchain `@pellux/goodvibes-toolchain`
(built from `goodvibes-sdk` at commit `20093d41`). While that package is not yet
published to the registry, it is dev-linked as a local tarball:

- `devDependencies["@pellux/goodvibes-toolchain"]` → `file:` tarball
- `overrides["@pellux/goodvibes-toolchain"]` → same `file:` tarball

The tarball was built fresh from the pinned SDK commit
(`git archive 20093d41 packages/toolchain` → `tsc` → `bun pm pack`):

- source commit: `goodvibes-sdk@20093d41`
- package version: `1.10.1`
- tarball sha256: `c64bd3aaffa5b2e77fcedbfbdb1b73a7c9a4c3aa053df9d4ee539e141b4a68e2`

## Re-pin at the next release train

When the SDK train publishes `@pellux/goodvibes-toolchain` to the registry,
replace the `file:` dev-link with the published exact version pin:

1. Set `devDependencies["@pellux/goodvibes-toolchain"]` to the published exact
   semver (e.g. `"1.10.1"`).
2. Remove the `@pellux/goodvibes-toolchain` entry from `overrides` (it exists
   only to force the local tarball across the dependency graph during dev-link).
3. `bun update @pellux/goodvibes-toolchain` and commit the moved `bun.lock`.
4. The runtime pins (`@pellux/goodvibes-sdk`, `@pellux/goodvibes-terminal-shell`
   at `1.10.1`, registry) are untouched by this dev-link and stay as-is.
