# Release and publishing

GoodVibes Agent's current installable version is recorded in `package.json` and `CHANGELOG.md`.

## Package identity

- registry package: `@pellux/goodvibes-agent`
- executable: `goodvibes-agent`
- connected-host compatibility: checked through public Agent routes; `AGENT_DAEMON_BUILD_FLOOR` (`src/runtime/daemon-build-compatibility.ts`) is `1.28.0`, a breaking change from the daemon/TUI product split. A daemon older than that build is REFUSED AT ADOPTION: the memory spine stays local, the inbound dispatch never binds, and the operator gets a one-time "update the daemon" notice naming both versions. This floor's value and rationale belong in this repository's CHANGELOG and release notes whenever it is raised, not left to infer.
- runtime: Bun `1.3.14` or newer
- source language: TypeScript
- package docs: every Markdown file under `docs/*.md`
- connected host ownership: outside Agent
- current release line: stable patch releases

End users install and run GoodVibes Agent with Bun:

```sh
bun add -g @pellux/goodvibes-agent
goodvibes-agent --help
```

Do not add non-Bun install instructions for this product. The package is hosted on the public package registry, but the supported install and smoke path is the normal Bun global command above, followed by `goodvibes-agent` launching the TUI. The package-facing text policy rejects non-Bun Agent install/run snippets, references to other `@pellux/goodvibes-*` packages outside Agent support paths, and versioned Agent package references that drift from `package.json`.

## Required gates

The release-quality inventory, `release/release-readiness.json`, is the capability gate for the current release line. It must list every release capability that GoodVibes Agent is expected to cover, including capabilities owned by Agent, the connected host, the companion app, and release operations. A bare `covered` status is not enough: every inventory item must also carry `quality` evidence for capability coverage, direct user access, model access through Agent tools or harness routes, safety/product boundary, and release evidence. Package verification rejects any inventory item that is missing those dimensions or marks them as unknown, todo, gap, unverified, or unproven. The packaged Agent exposes the release evidence bundle through `agent_harness` modes `release_evidence` and `release_evidence_artifact`, and exposes the inventory through `release_readiness` and `release_readiness_item`, so the model can inspect the same operator/audit artifacts without relying on hidden project context.

Use neutral evidence aliases in release evidence.

Before any stable release or patch release:

```sh
bun install
bun run typecheck
bun run build
bun run package:install-check
bun run publish:check
bun pm pack --dry-run
git diff --check
```

Shared release metadata verification requires `publish:check` to keep release metadata and package-facing text checks, package runtime build, npm pack dry-run, forbidden/required tarball path assertions, and the tarball size cap before reporting success.

Shared release metadata verification also requires `build:package-runtime` to keep the clean `dist/package/main.js` build, Bun compile compatibility patch, build-machine path-leak guards, empty-entrypoint guard, and runtime build success summary.

Shared release metadata verification requires `scripts/bun-compile-compat.ts` to keep the css-tree JSON-import rewrites, jsdom XHR worker and stylesheet path-leak patches, sql.js wasm embedding, idempotent patch skip, unexpected-shape warning, and successful patch diagnostic that keep Bun-compiled Agent runtimes self-contained.

Shared release metadata verification requires the `prebuild` and `version` package scripts to run `scripts/prebuild.ts`; that script must keep the workspace-locked project-surface sync and Bun compile compatibility patch, while `scripts/project-surfaces.ts` must preserve exact package semver reads plus `src/version.ts` and README badge synchronization.

`bun run publish:package` publishes from a staged package directory to the package registry. It re-runs the shared package policy checks against the source tree, filters forbidden package paths during staging, and verifies the staged package docs, required package paths, and metadata before invoking npm. If `NPM_CONFIG_USERCONFIG` is already set, the registry publish command uses it. Otherwise the script creates a temporary 0600 registry userconfig from `NODE_AUTH_TOKEN` or `NPM_TOKEN`, uses it for that publish command, and removes it with the staging directory. The publish script is idempotent for reruns: if the exact package version is already present on the registry, it reports that state and exits successfully instead of failing the release retry. Shared release metadata verification requires those staged source/staged policy checks, forbidden-path filtering, docs checks, auth handoff, idempotent lookup, dry-run pack, public publish, and cleanup markers to remain in the publish script.

`bun run release` requires product release notes instead of raw git-log output. Pass `--notes-file ./release-notes.md` or set `GOODVIBES_AGENT_RELEASE_NOTES` before a real release. For patch releases, use product-facing notes that summarize the complete patch contents, not only the first fix in the batch. Release metadata verification keeps `release/release-notes.md` with the release-quality inventory and live-verification evidence, and package verification requires the installed package to ship the same current release evidence bundle: release notes, performance snapshot, release-quality inventory, and live-verification JSON/Markdown. Release notes should describe what changed for Agent users: TUI behavior, setup, Agent Knowledge, local behavior libraries, connected-host compatibility, package/install behavior, model-visible harness behavior, and safety policy. Do not use commit hashes as the shipped changelog content.

Before it mutates version metadata or creates a tag, `bun run release` checks the declared files under `release/` for existence, non-empty content, final newlines, trailing whitespace, and space-before-tab indentation, then enforces the non-test release gates: typecheck, architecture check, performance check, build, publish check, packed install smoke, verification ledger, pack dry-run, and `git diff --check`. Dry-run previews run the same evidence text hygiene check without writing files, commits, or tags. After it writes the release version, `src/version.ts` fallback, and changelog section, it verifies release metadata and package-facing text policy again, then reruns evidence hygiene and diff hygiene before creating the commit and tag. That package policy check proves `package.json`, `CHANGELOG.md`, and the `src/version.ts` fallback literal agree on the Agent version, that the package manifest keeps the required Agent runtime/docs files, exclusions, release/publish script entrypoints, and local CI gate entrypoints without explicitly including forbidden Agent/TUI boundary paths or leaving existing forbidden paths reachable through broad includes, that the local release script still requires product notes, real-release validation, post-mutation package policy, docs staging, and annotated tags, that the GitHub setup action uses the same Bun version as `packageManager`, and that package-facing text is present and still follows Agent docs, rendered CLI help, parser-backed CLI command snippets, parser/type/alias/help/handler/top-level help command coverage, exported package-text source coverage, autocomplete overlay text, context inspector text, in-app help overlays, file/bookmark picker text, live process output text, MCP workspace text, model picker/workspace text, profile/session picker text, process/runtime activity text, search overlays, shared selection/picker chrome, setup/onboarding wizard text, settings workspace text, slash-command registry text, Agent workspace catalog text, route boundaries, install policy, and Agent package version pins. The generated changelog heading uses the operator's local release date in `YYYY-MM-DD` form, not UTC rollover time. The prebuild version sync refuses missing, ranged, or otherwise non-exact Agent versions instead of writing placeholder fallbacks. The release commit stages those metadata files plus every package-facing `docs/*.md` page, so release docs cannot drift outside the tag. The full test suite remains a branch-CI responsibility and must already be green for the release SHA.

`--skip-validation` is only allowed with `--dry-run`. Real releases must run the validation gates above.

`--dry-run` is non-mutating and may be used from a dirty or non-main worktree to preview the next version and generated changelog section. For patch previews, use `bun run scripts/release.ts --dry-run --patch --notes-file ./release-notes.md`. Real releases still require a clean worktree on `main`.

The GitHub release workflow publishes to npm only when the repository variable `PUBLISH_NPM` is `true` and the repository secret `NPM_TOKEN` is configured. Without those repository settings, the workflow still validates and creates the GitHub release, but npm publish must be run from a local environment with an exported token. After optional npm publish, the workflow installs the exact registry version into an isolated Bun home, seeds a connected-host token sentinel, captures stdout and stderr for `--version`, `--help`, and `status --json`, and fails without printing that sentinel. Shared release metadata verification requires those publish, exact-version registry lookup, install smoke, and token-sentinel markers to remain in the release workflow.

Branch CI is the only workflow that runs the full test suite and release gates. It runs `bun run test` once for the release SHA, along with typecheck, architecture, performance, build, publish, packed install, and verification ledger checks. The release workflow must not run tests or duplicate those gates; shared release metadata verification rejects duplicated release-workflow gates and requires the workflow to verify that branch CI and its test job passed for the exact checked-out SHA before package packing, GitHub Release creation, and optional npm publish. It also requires the release workflow to preserve tag/package version matching, single-tarball packing, changelog excerpt extraction, and GitHub Release tarball attachment markers.

Shared release metadata verification requires the package build scripts to keep exact TypeScript and Bun compile commands for the Agent entrypoint and platform binary names. It also requires `scripts/build.ts` to keep the prebuild/compatibility patch, multi-target matrix, sqlite-vec native addon externalization/copy policy, same-platform hard failure, cross-target registry fetch of the target-platform addon, and build summary/failure exit behavior. On a cross-target build the runner does not have the target platform's optional sqlite-vec package installed, so `scripts/build.ts` fetches that platform's addon from the npm registry (pinned to the resolved `sqlite-vec` version) and copies it into `dist/lib/sqlite-vec-<os>-<arch>/`; a failed fetch or a missing addon in the fetched package is a hard build failure, never a silent skip.

### sqlite-vec native addon release assets

A compiled Agent binary loads the sqlite-vec native addon from `<binary-dir>/lib/sqlite-vec-<os>-<arch>/vec0.<suffix>` (`vec0.so` on Linux, `vec0.dylib` on macOS). Bun cannot embed a native addon inside the compiled binary, so the release lane ships the addon as a separate per-platform asset. Each build matrix leg contributes its target's addon tree, and the GitHub Release job packages one archive per platform, `sqlite-vec-<os>-<arch>.tar.gz`, whose interior layout is exactly `lib/sqlite-vec-<os>-<arch>/vec0.<suffix>`, so it extracts in place next to the binary with no renaming. All four archives are checksummed in `SHA256SUMS.txt` alongside the binaries under the missing-entry-fatal convention: a directly-downloaded binary can restore the semantic vector index by co-locating the matching addon (see the README "Standalone binary and the semantic vector index" section). On macOS the system SQLite that `bun:sqlite` links refuses to load extensions, so the darwin archives ship for parity but the vector index stays unavailable there and memory search degrades to literal matching; this is a platform capability limit, not a packaging defect.

Shared release metadata verification requires branch CI to run the compiled binary smoke after `bun run build`, and `scripts/post-build-smoke.ts` must keep the default `dist/goodvibes-agent` binary path, optional `--binary` override, isolated temp cwd, `--version` launch, sqlite-vec/`$bunfs` module-resolution leak guards, Agent version-prefix assertion, failure diagnostics, and cleanup.

Shared release metadata verification requires `architecture:check` to keep the Agent/TUI product-boundary rules: no runtime imports from `goodvibes-tui/src`, no coding-TUI git/worktree header posture in the Agent shell, isolated Agent Knowledge client/routes, typed operator contracts, explicit dependency ownership, source-size limits, and no explicit `any` or process-global test mocks.

Shared release metadata verification requires `perf:check` to load `release/performance-snapshot.json`, validate its render samples and extra SLO/queue/tool/compaction/integration metrics, run the CI performance-budget evaluation, print the formatted report, and exit from the budget result. The release performance snapshot is staged with release metadata so the tag carries the exact recorded sample used by the branch-CI performance gate.

Shared release metadata verification requires `verification:ledger` to keep JSON and Markdown evidence output plus inventory coverage for settings schema, feature flags, slash commands, top-level CLI commands, external surfaces, onboarding capability bundles, the model-visible release evidence bundle, the model-visible service posture surface, the model-visible channel readiness surface, the model-visible notification target surface, the model-visible provider account surface, the model-visible MCP server surface, the model-visible setup/onboarding surface, the model-visible model routing surface, the model-visible pairing surface, the model-visible delegation surface, the model-visible security/support bundle surface, the model-visible voice/media posture surface, the model-visible sessions/bookmarks surface, the model-visible operator method catalog, the model-visible command/CLI/tool catalogs, the model-visible keyboard route catalog, the model-visible harness mode catalog, and the release-quality dimensions from `release/release-readiness.json`, including local-signal, local-behavior, and external-outcome accounting. Package verification also enforces compact model tool registration, wrapped tool definitions, harness catalog defaults, searchable harness mode discovery, command/CLI/tool route metadata, keyboard route metadata, connected-host route hints, operator/audit route hints, and stripped nested schema descriptions so tool metadata stays usable.

Shared release metadata verification requires `verification:live` to keep the external-outcome audit for stable releases: compiled CLI checks, connected-host token/URL discovery, connected-host status/health/model routes, isolated Agent Knowledge status/ask/search/source/node/issue/map/connector route checks plus packaged evidence for item inspection, JSON/Markdown report artifacts, strict mode, and Agent Knowledge contamination guards.

Do not add targeted `bun test` passes or separate release-only test gates to CI, release, or aggregate scripts. Tests that matter for release must be included in the single full branch-CI suite.

Shared release metadata verification requires the `test` script to keep using `scripts/run-tests.ts`, and that runner must discover all `.test`/`.spec` TypeScript files under `src`, sort them deterministically, run one `bun test` invocation with an isolated `.test-tmp/suite` temp root, fail when no tests are found, and propagate the Bun test exit code.

Also run the package install smoke from a packed artifact. It must prove:

- the installed command is on `PATH`
- the bin target is `bin/goodvibes-agent.ts`
- the Bun shebang survives pack/install
- the bundled runtime `dist/package/main.js` is present and non-empty
- every shared required package path is installed as a non-empty file
- every package-facing `docs/*.md` page is installed and non-empty
- Bun global install uses `bun add -g`
- `goodvibes-agent --help` works
- `goodvibes-agent --version` reports the package version
- the installed TUI launches in a PTY and does not exit immediately
- connected-host commands fail clearly when GoodVibes host is unavailable or unauthenticated
- a seeded connected-host token sentinel is never printed in captured command output, PTY transcript, or failure diagnostics

Shared release metadata verification requires the install-check script to keep those packed artifact, Bun global install, installed CLI/status, blocked lifecycle command, PTY launch, required-path, runtime, token-sentinel, and cleanup markers.

## Do not ship

Do not publish if package-facing docs or install commands refer to another package name, another executable, or Agent-owned connected-host lifecycle.

Do not publish if `README.md` or `docs/README.md` omits a package-facing docs page, or links a docs page that is not included by the package `files` manifest.

Do not publish if Agent Knowledge commands can fall back to default knowledge or another product-specific knowledge route. Agent Knowledge must use the isolated `/api/goodvibes-agent/knowledge/*` segment.

Do not ship connected-host binaries from this package. If Agent later gets compiled artifacts, they must use Agent artifact names and remain separate from connected-host ownership.

## Product rule

Stable patch releases can include mature terminal foundation code, but package-facing behavior must follow Agent product policy. Follow-up patch releases should continue pruning or reshaping coding-first surfaces while preserving the renderer, input, fullscreen workspace, command registry, and release foundation.
