# GoodVibes Agent Manual Smoke

These checks assume the GoodVibes daemon is already running and reachable. Do not start or stop the daemon from this package.

## Terminal Input

Run:

```sh
bun run dev tui
```

Check:

- First typed key appears immediately.
- Unicode input such as `hello é こんにちは` is preserved.
- Left/Right move the visible input cursor; inserted text lands at the cursor.
- Backspace removes the character before the cursor; Delete removes the character under the cursor.
- Home/End move to the start/end of the current line.
- Ctrl-J inserts a newline; Up/Down history preserves multiline drafts.
- Bracketed paste preserves multiline pasted text and does not submit unexpectedly.
- Ctrl-R refreshes status panes without blocking input on route errors.
- Resize redraws without overlapping dashboard and transcript text.
- Ctrl-C, Esc, `/quit`, and `/exit` restore bracketed paste, cursor visibility, raw mode, and shell echo.

## Daemon Failure States

Run with temporary homes:

```sh
GOODVIBES_AGENT_HOME=$(mktemp -d) GOODVIBES_AGENT_BASE_URL=http://127.0.0.1:1 bun run dev status
GOODVIBES_AGENT_HOME=$(mktemp -d) GOODVIBES_AGENT_TOKEN=invalid-token bun run dev chat "hello"
```

Expected:

- Unavailable daemon returns structured `daemon_unavailable`.
- Invalid token returns structured `auth_required`.
- Token values are not printed.

## Safe Mutation Checks

These commands must not call side-effecting routes because `--yes` is omitted:

```sh
bun run dev approvals approve smoke-approval
bun run dev automation run smoke-job
bun run dev schedules run smoke-schedule
```

Expected: each returns structured `confirmation_required`.
