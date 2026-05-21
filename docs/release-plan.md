# GoodVibes Agent Release Plan

This plan targets the first usable `goodvibes-agent` alpha. The package stays at `0.0.0` while private/unreleased and moves to `0.1.0` only when the release criteria below are met.

## Ground Rules

- Bun is the runtime, package manager, test runner, and build tool.
- Authored source code is TypeScript.
- Strong typing is required; explicit `any` and untyped escape hatches are not allowed.
- The distributed package must install a real `goodvibes-agent` executable through `package.json` `bin`; it is not a library-only package.
- Package contents must include the runtime bin, `src/`, docs needed at runtime/release, and no accidental build or local daemon state.
- Runtime dependencies use public SDK/daemon contracts, not `goodvibes-tui/src/*` imports.
- The agent is serial and proactive by default.
- User-facing product language is agent/operator language, not coding-TUI language, except when describing delegated build work.
- WRFC is requested only for explicit build, implementation, fix, review, or check work delegated to GoodVibes TUI.
- Risky actions require explicit approval: destructive changes, external messages/publication, spending money, cloud provisioning, service mutation, secret handling, and broad filesystem writes.

## Executable Distribution

- `package.json` exposes `goodvibes-agent` through `bin`.
- The bin target is TypeScript-authored and uses a Bun shebang path that works after global install.
- The bin file has executable permissions in git and package artifacts.
- `package.json` `files` includes `bin/`, `src/`, and docs required for install/runtime use.
- Release smoke includes package contents inspection, fresh install into a temporary prefix/global-equivalent location, `goodvibes-agent --help`, and `goodvibes-agent status` or `goodvibes-agent smoke` from `PATH`.

## Collaboration Cadence

GoodVibes TUI reviews the agent at each milestone boundary:

- Handoff format: changed files, commands run, UI screenshots when the TUI changes, SDK seam gaps, and known risks.
- Boundary review: product behavior still differs correctly from coding TUI behavior.
- Product language review: user-facing language stays assistant/operator-oriented except for delegated build work.
- Sharing review: copied/adapted bones are suitable for near-fork development and candidates for SDK/shared promotion are tracked.
- Delegation review: build/fix/review handoff remains on public contracts and does not drift into private payload fields.
- Release review: test, smoke, packaging, and install behavior are comparable to GoodVibes TUI expectations.

Ask TUI before major architectural copy/promote decisions. If a feature needs TUI internals, the default answer is to request a promoted SDK/shared seam before depending on it. Every copied/adapted TUI bone must be tracked as a copy/adapt candidate so shared primitives can later be promoted deliberately instead of diverging accidentally.

## Milestones

### M0: Private Scaffold

- Version stays `0.0.0`.
- No publish.
- Initial CLI/TUI, daemon client, local stores, docs, tests, and build are committed.
- `bun install`, `bun run typecheck`, `bun test`, `bun run build`, CLI help smoke, and daemon status smoke are green.
- TUI review: confirm the scaffold has the right product boundary and does not import TUI internals.

### M1: Local Usable Alpha

- Keep the current raw terminal TUI but add durable panes for transcript, working memory, active tasks, skills/personas, daemon status, provider/model state, and pending approvals.
- Add command history, multiline input, paste handling, resize correctness, and clear busy/error states.
- Keep slash commands as shortcuts, not the primary interaction model.
- Harden config loading, env/file overrides, auth/token discovery, clean shutdown, daemon health handling, and actionable connection errors.
- Add provider/model awareness without making the assistant coding-first.
- Provide CLI commands for `status`, `chat`, `ask`, `search`, `remember`, `memory`, `skills`, `personas`, `delegate`, `delegations`, `approvals`, and `workplan`.
- Stay `0.0.0` and private through M1 validation. M1 proves local usability from a fresh clone/install but is not the public `0.1.0` gate by itself.
- TUI review: compare shell usability against GoodVibes TUI basics without inheriting coding-transcript assumptions.

### M2: Delegation Parity

- Move from provisional generic delegation to the best stable public SDK/daemon contract available.
- Keep the current `sessions.messages.create` path only while it remains sufficient.
- Request a dedicated build-delegation/operator method if reliable handoff needs typed fields, task topology, or richer status.
- Make delegation visible and inspectable from CLI and TUI.
- Include original user ask, workspace hints, desired execution mode, risk class, and expected artifacts in stable public fields/body.
- Add task status/progress, result/artifact retrieval, user-visible handoff states, and completion summaries.
- Avoid screen scraping and private TUI-specific payloads.
- Request WRFC only when the user explicitly asks for build/fix/review/check work requiring it.
- TUI review: verify task messages route cleanly and that WRFC ownership stays in TUI/daemon controller chains.

### M3: Assistant Autonomy

- Improve intent classification for safe action, approval-worthy action, knowledge lookup, memory update, task tracking, automation, and TUI delegation.
- Keep the action policy auditable through CLI/TUI-visible decisions: category, risk, approval requirement, automatic-action allowance, matched trigger, and reason.
- Add explicit approval flow backed by daemon approvals where available.
- Store memories with provenance, confidence, timestamps, and sensitivity handling.
- Let the assistant create/update local skills and personas from repeated workflows.
- Add active persona and active skill selection as local assistant state that influences normal companion-chat prompts.
- Add reviewable memory changes, periodic memory/skill review commands, and stale-memory cleanup.
- Add read-only automation, schedules, runs, heartbeat, and scheduler-capacity observability through stable daemon/operator contracts before adding any mutation flows.
- Add the first daemon mutation flows only behind exact CLI/slash commands plus confirmation: approvals approve/deny/cancel, automation job run/pause/resume, automation run cancel/retry, and schedule run.
- Add scheduling/routine create/update/run/cancel flows only as explicit-user-action work with approval-aware handling.
- TUI review: confirm the assistant remains serial/proactive and does not adopt WRFC/fanout as a default reasoning path.

### M4: Install And Release Parity

- Keep exact dependency pins during pre-1.0 development.
- Add release scripts only after behavior stabilizes: test, typecheck, build, npm pack dry-run, publish dry-run, install smoke.
- Add a changelog starting with the first release.
- Add package install smoke for Bun global/local usage.
- Add Bun-only packaging checks: clean `bun install`, documented `bun pm trust` only if lifecycle dependencies require it, `npm pack` contents inspection, install into a temporary prefix/global-equivalent location, command available on `PATH`, help smoke, and status/smoke command.
- Keep release checks Bun/TypeScript-only: no explicit weak top type, no authored `.js`/`.mjs`/`.cjs`/`.jsx` files under `bin/`, `scripts/`, `src/`, or `test/`.
- Maintain manual PTY smoke notes for first key input, Unicode, cursor editing, multiline history, paste, resize, and terminal cleanup.
- Document README install/trust behavior, service/daemon connection, auth setup, upgrade notes, and current limitations.
- Do not add binary postinstall unless the package ships platform artifacts.
- If binaries are shipped later, use a deliberate agent-specific binary release flow and GitHub release artifacts.
- TUI review: compare release hygiene against current GoodVibes TUI conventions without copying binary-specific scripts prematurely.

### M5: Public `0.1.0` Release Gate

- Remain private and unreleased until the full release criteria below pass.
- Flip from `0.0.0` to `0.1.0` only for the first intentionally published usable alpha.
- Complete TUI release review and document any accepted risks.
- Run source checkout, package contents, temporary/global install, daemon status/auth, companion chat, knowledge, local store, and delegation smoke checks.
- Publish only after the package installs a real `goodvibes-agent` executable and docs match current behavior.

## Must-Have TUI Parity To Copy Or Adapt Next

- Config loading and override behavior.
- Auth/token UX.
- Provider/model selection behavior.
- Daemon status and client error handling.
- Terminal render/input primitives.
- Docs, release, and check scripts appropriate for a source package.

## SDK Seams To Request If Missing

- Dedicated build-delegation/operator method.
- Task/progress tree contract.
- Shared work-plan contracts.
- Reusable memory/skill/persona registry contracts.
- Surface-root-neutral path helpers.
- Daemon host/client bootstrap helper.
- Auth/session login helpers for non-browser CLIs.

## Daemon And SDK Integration Principles

- Replace generic helper gaps with typed SDK/operator client calls where stable exports exist.
- Add compatibility checks for daemon version and SDK package version at startup; older daemon/route contracts must warn or fail clearly before confusing downstream errors.
- Use work-plan/task APIs for visible durable task tracking.
- Use artifact-backed attachments for chat/delegation where needed.
- Identify missing stable seams for build delegation, task progress events, auth/pairing UX, and provider/model selection.
- SDK/TUI review: decide whether `sessions.messages.create` plus local receipt history is enough or whether SDK should promote `sessions.delegations.create` or equivalent.

## Release Criteria For `0.1.0`

- `bun install`, `bun run typecheck`, `bun test`, and `bun run build` pass from a clean checkout.
- `bunx tsc --noEmit` passes from a clean checkout.
- The executable bin starts through Bun and opens the agent TUI.
- CLI help smoke passes.
- Fresh global install smoke can run `goodvibes-agent --help`.
- Fresh global install smoke can run `goodvibes-agent status` and `goodvibes-agent smoke`.
- Daemon status/auth smoke passes.
- Exact SDK/daemon compatibility smoke passes or fails with a clear version/route-contract error.
- Companion chat smoke passes.
- Knowledge ask/search smoke passes.
- Memory, skill, and persona CRUD smoke passes.
- Delegation dry-run/live smoke passes through public contracts.
- `npm pack` and install smoke pass.
- The TUI can complete normal assistant work without requiring slash commands.
- Daemon status, companion chat, knowledge ask/search, memory, skills, personas, approvals, and work-plan commands work or fail with clear actionable errors.
- Build/fix/review requests delegate to GoodVibes TUI through public contracts.
- WRFC is not used for ordinary assistant work.
- Destructive or externally visible actions require explicit approval.
- README and changelog reflect current behavior only.
- TUI has reviewed the release behavior and any known boundary risks are documented.

## Promotion Candidates

- Surface-root-neutral path layout.
- Shared terminal renderer/input primitives.
- Provider/model selection logic.
- Auth/pairing UX helpers.
- Build delegation protocol.
- Task/progress tree UI contracts.
- Paste/artifact capture abstractions.
- Daemon host composition helpers.
