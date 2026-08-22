- **Fixed: a dead OpenAI subscription login recovers or says so honestly.** A token OpenAI rejects mid-lifetime (a Codex login elsewhere, a password change, an expired session) now gets one shared, time-bounded refresh attempt and one retry before anything is surfaced to you.
- Changed: when the subscription session truly is over, the error names the subscription session and tells you to sign in again. It never says "check your API key" to a logged-in subscriber any more.
- Changed: a refresh that cannot be judged (the token endpoint unreachable or answering 5xx) surfaces the original rejection instead of demanding a re-login the account may not need.
- Changed: concurrent requests hitting the same revoked token share one refresh instead of each spending the rotating refresh token, which could falsely kill a session another request had just healed.
- Changed: the bundled platform runtime, terminal-shell, and release toolchain move to 2.0.21, and the bundled daemon moves to 1.28.23 carrying the same runtime.

GoodVibes Agent 2.0.19 - 2026-08-21
