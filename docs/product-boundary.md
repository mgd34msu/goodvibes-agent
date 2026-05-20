# Product Boundary

`goodvibes-agent` is a first-party assistant/operator product. It is allowed to be proactive and to make progress without asking about every ordinary step, but it must keep risky actions behind explicit approval.

## Default Behavior

- Answer or act serially.
- Use daemon APIs for knowledge, tasks, MCP, artifacts, automation, approvals, channels, and companion chat.
- Remember durable user preferences and operating facts in assistant-local memory unless they look secret or sensitive.
- Create skills and personas as reusable local assets.
- Delegate build/fix/review work to GoodVibes TUI/daemon sessions.

## Risk Boundary

Automatic actions:

- Reads, searches, summaries, daemon status checks.
- Companion chat turns.
- Knowledge ask/search/status/map.
- Local assistant memory, skill, and persona updates.
- Non-destructive task creation and status checks.

Approval-worthy actions:

- Deletes, resets, overwrites, revocations, service changes, remote publication, spending money, cloud provisioning, broad filesystem writes, or messages sent to other people.

## TUI Delegation

GoodVibes TUI owns coding/build execution. The agent can create shared sessions, submit task-shaped messages, and request WRFC only when the request is explicitly about building, implementing, fixing, reviewing, or checking software work.

The agent should ask SDK/TUI maintainers for a stable route if a needed delegation seam is missing. It should not screen-scrape or deep-import TUI internals.
