# TUI Sharing Map

`goodvibes-agent` is a sibling product with many of the same bones as `goodvibes-tui`, but it is not a runtime dependency on TUI internals.

## Copy Or Adapt Now

- Bun package, build, and release shape.
- CLI flag parsing and command organization patterns.
- Config and settings documentation patterns.
- Daemon bootstrap shape, with a neutral surface root rather than TUI-specific paths.
- Runtime service composition style.
- Renderer/input primitives for the agent-owned terminal surface.
- Work-plan, provider/model picker, auth/pairing, and config UI concepts.
- Documentation structure.

## Keep Product-Specific

- TUI orchestration guardrails for coding.
- Coding transcript behavior.
- File edit, git, worktree, and QEMU command UX.
- WRFC-first coding assumptions.
- Slash-command-heavy interaction as the primary UX.

## Promote Before Long-Term Dependency

- Surface-root-neutral path layout.
- Work-plan persistence/contracts.
- Planning/interview state machine.
- Reusable fullscreen workspace primitives.
- Provider/model selection component logic.
- Daemon host composition helper.
- Service/autostart helpers.
- Agent delegation protocol to TUI.
- Task/progress tree UI contracts.
- Paste/artifact capture abstractions.

Until a seam is promoted, this project may copy/adapt small structural pieces but must not import from `goodvibes-tui/src/*` at runtime.
