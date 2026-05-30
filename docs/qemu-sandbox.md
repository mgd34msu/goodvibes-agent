# QEMU Sandbox Boundary

GoodVibes Agent does not own QEMU sandbox setup, sandbox command execution, or daemon-backed sandbox lifecycle.

Those workflows belong to GoodVibes TUI. Agent may inspect local sandbox-related configuration for diagnostics, but build/fix/review work that needs sandboxing should be delegated to a GoodVibes TUI session through the explicit build delegation path.

Agent fail-closes these previously copied TUI paths:

- QEMU setup bundle scaffolding
- QEMU wrapper template generation
- QEMU manifest application
- sandbox command execution helpers
- local sandbox/QEMU slash-command mutation flows

Use the GoodVibes TUI QEMU sandbox documentation and commands from the TUI project when sandbox setup or QEMU-backed execution is required.
