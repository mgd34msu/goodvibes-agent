- **Fixed: the workspace no longer offers routes that go nowhere.** Around 70 emitted "Agent Workspace" routes named views that were never registered, so a tap on one dead-ended in an empty screen. Every emitted route now resolves against the real workspace category registry.
- Changed: a guard test now walks all 35 files that emit workspace routes and resolves each against the registry by longest label match, so a phantom route fails the build instead of shipping.
- Changed: the Google setup runbook is regenerated from the platform runtime 2.0.20 generator, so the setup steps it walks through match what the platform actually does at this pin.
- Changed: the runbook's one sdk-owned `/status` phrase is gone with that regeneration, so the phantom-command scan covers the runbook whole again and the last per-file scan exemption is deleted. No slash-shaped token in any package-facing page escapes the scan any more.
- Changed: the bundled platform runtime, terminal-shell, and release toolchain are now 2.0.20 (up from 2.0.19), and the reusable release workflows are repinned to the 2.0.20 release commit. The platform side of that cycle is daemon boot recovery for interrupted checkouts; no Agent-side behavior changed with the pin.

GoodVibes Agent 2.0.17 - 2026-08-21
