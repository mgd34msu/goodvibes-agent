- **Fixed: this Agent adopts the running daemon again.** The version gate compared the daemon's 1.28.x release number against the platform's 2.x number and refused every adoption since the platform went 2.0, silently running without the shared daemon and its session spine. It now checks the platform build the daemon actually reports.
- Changed: a dead subscription login is stamped the moment the provider refuses it, so every status view shows it as ended instead of green, and later requests fail fast with the honest message instead of retrying a refusal.
- Changed: a subscription token nearing expiry refreshes silently before the request is sent, so an ordinary expiry never surfaces anything to you at all.
- Changed: a machine with no microphone is reported as exactly that, once, in plain words, with a gentle retry every minute until a device appears. A device that exists but is busy keeps prompt retries and the existing crash latch.
- Changed: the bundled platform runtime, terminal-shell, and release toolchain move to 2.0.22, and the bundled daemon moves to 1.28.24 carrying the same runtime.

GoodVibes Agent 2.0.20 - 2026-08-22
