- **Fixed: typing can no longer summon a system authentication prompt over the screen.** Submitting a turn acquires a keep-the-machine-awake inhibitor while work runs (`power.inhibitWhileWorking`). On hosts whose polkit rules require authentication for that — typical for tmux or SSH sessions the login manager does not count as an active local seat — systemd registered an interactive auth agent on the controlling terminal: "authentication is required to inhibit system sleep", painted raw over the UI on every submitted message. The inhibitor is now requested with `--no-ask-password` (platform runtime 2.0.15), so a refusal is an immediate silent exit and the platform simply runs without the inhibitor, exactly as it does on hosts with no login manager at all.
- Changed: the refusal path is pinned by a test on the inhibitor's exact argument list — no systemd tool this platform spawns may ever prompt on the user's terminal.
- Changed: `power.inhibitWhileWorking: false` remains the full opt-out from keep-awake, and `power.keepAwake` the manual hold; both unchanged.
- Changed: the bundled platform runtime is 2.0.15 and the daemon installed alongside this Agent is 1.28.18, which carry the same fix.
- No behavior change for hosts where the inhibitor is granted: work still holds the machine awake and releases when work drains.

GoodVibes Agent 2.0.14 - 2026-08-08
