- Fixed: a fatal startup error could exit the Agent with nothing written anywhere — no stdout, no stderr, no activity log entry — because the same terminal output guard that keeps a rendered screen clean from stray writes was also intercepting the one write meant to explain why the process was dying. Every fatal startup exit now writes straight to the terminal's own output channel first, before anything that could fail, and that write finishes before the process exits.
- Fixed: help, version, completion, status output, and argument or settings errors raised at startup now go through that same direct-to-terminal path, so none of them can be silently swallowed by a later change to how output is intercepted.
- Added: a test that compiles a real binary and counts bytes on stdout and stderr, rather than trusting the fix from source — the identical source run under Bun always printed the error, so only a compiled-binary measurement could have caught this failure in the first place.
- Changed: the conversation-first continuation gate and the daemon client-build-compatibility check now consume the platform runtime's own modules directly, instead of a local copy kept here for as long as those modules were not yet part of the platform's public surface.
- Changed: the bundled GoodVibes platform runtime is 1.21.0.

GoodVibes Agent 1.23.1 - 2026-07-30
