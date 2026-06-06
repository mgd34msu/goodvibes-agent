# Autonomous Agent Competitive Inventory

This audit uses one rule: every feature must make the autonomous assistant easier or more useful for the user. Internal ownership boundaries matter for implementation and safety, but the user experience should feel like one assistant.

## Sources

- OpenClaw local checkout: `/home/buzzkill/Projects/openclaw`, especially `README.md` and `VISION.md`.
- Hermes Agent current checkout: `/tmp/goodvibes-agent-audit/hermes-agent`, especially `README.md`, `pyproject.toml`, and `docs/observability/README.md`.
- Odysseus current checkout: `/tmp/goodvibes-agent-audit-odysseus/odysseus`, especially `README.md`.
- GoodVibes Agent and GoodVibes host local checkouts: `/home/buzzkill/Projects/goodvibes-agent` and `/home/buzzkill/Projects/goodvibes-tui`.

## Inventory

The source of truth for the structured inventory is `src/agent/competitive-feature-inventory.ts`.

| Feature | OpenClaw | Hermes Agent | Odysseus | GoodVibes now | Target |
|---|---|---|---|---|---|
| One assistant mental model | Gateway is control plane; assistant is the product | CLI, TUI, gateway, and messaging expose one assistant | One web workspace | Partial: boundaries are exposed too early | Better |
| First-run and always-on setup | Onboard can install gateway service | Installers and setup wizard configure dependencies and gateway | Docker/native start with admin bootstrap | Partial: route-backed setup plan exists; host lifecycle is external | Better |
| Models and local model cookbook | Multi-provider, subscription auth, failover | Many providers and managed tool gateway | Hardware-aware Cookbook for Ollama, llama.cpp, vLLM | Partial: routing and hardware-scored local cookbook exist; live benchmarks/download guidance missing | Better |
| Omnichannel inbox and delivery | Very broad channel list and DM safety | Telegram, Discord, Slack, WhatsApp, Signal, email | Email, browser, ntfy, PWA | Parity on foundations, needs setup UX polish | Better |
| Email, calendar, notes, tasks | Mail/calendar/reminder workflows in showcase | Email gateway and workspace skills | IMAP/SMTP triage, CalDAV, notes/tasks | Partial: Personal Ops has live note/routine/delivery records; email/calendar connectors missing | Better |
| Closed learning loop | Skills and memory | Autonomous memory, skills, session search, user model | Persistent vector/keyword memory and skills | Partial: local libraries and read-only curator exist; automatic proposals/consolidation missing | Better |
| Autonomous schedules/background work | Cron, wakeups, webhooks, triggers | Built-in cron with delivery | Scheduled tasks and reminders | Partial: read-only ongoing-work intake selects safe routes; autonomy queue includes live research runs, connected-host tasks, approvals, automation runs, schedules, tails, source ids, and exact confirmed control routes; natural-language recurring task creation and richer host telemetry still need depth | Better |
| Computer use, browser, shell | Browser, canvas, nodes, system.run | Terminal backends, browser, code execution, computer use | opencode with web/files/shell/MCP | Partial: local-first execution posture routes read/edit/exec/web/delegation and confirmed file recovery; browser/desktop setup missing | Better |
| Multi-agent and remote execution | Multi-agent routing and session tools | Subagents, kanban, worktrees | Agent runs whole tasks | Partial: foundations exist, Agent blocks fanout | Better |
| Deep research and reports | Research-oriented workflows | Web tools, session search, trajectory tooling | Deep Research visual reports | Partial: web/URL research, Knowledge ingest, visible local run ledger with log tails, source queue/credibility review, reviewed-source bundles, citation coverage repair hints, and sourced report artifacts exist; browser-backed runner and richer visual reports missing | Better |
| Documents and model comparison | Canvas/web primitives | TUI/dashboard/session tools | Documents and blind Compare | Parity: Document Ops has project-scoped versioned markdown drafts with browse/show/create/revise/review/comment/suggest/accept-suggestion/reject-suggestion/artifact-attach/artifact-insert/export, unified artifact browse/show/export/package plus confirmed artifact-to-Knowledge promotion, artifact-to-document attachment, and artifact-to-compare reuse for saved text artifacts, and a confirmed blind runner with durable JSON artifacts, saved review boards, saved judgments, saved preference analytics, markdown report export, and confirmed route updates | Parity |
| Mobile, voice, device nodes | macOS/iOS/Android nodes and voice | Termux, messaging, voice memo transcription | Responsive PWA | Partial: pairing and voice exist, command depth unfinished | Better |
| Web dashboard and PWA | Control UI and WebChat | Local dashboard | Primary responsive web UI | Partial: host has foundations, Agent is terminal-first | Better |
| Security, permissions, recovery | Secure defaults, pairing, doctor | Approval, isolation, observability | Admin gating and service isolation | Leading: strong policy and audit surfaces | Better |

## Key Findings

1. GoodVibes has many raw foundations already: providers, channels, memory, routines, schedules, MCP, tasks, remote, artifacts, knowledge, media, permissions, and operator APIs.
2. The largest gap is not raw capability count. It is UX integration. The current Agent often presents implementation boundaries instead of the simplest user path.
3. The current Agent policy overcorrects against hidden work. The best-in-class target is visible autonomy: jobs can run unattended only when they have clear owner, scope, schedule, status, logs, and cancel/recovery routes.
4. Email, calendar, browser-backed deep research runners, hardware-scored local model serving, and browser/desktop-control setup are the clearest product gaps.
5. GoodVibes can lead on safety if it keeps its approval, redaction, trust, readiness, and release-evidence posture while removing unnecessary ceremony from approved workflows.

## Product Direction

- Present one assistant. Move package and host ownership language into diagnostics.
- Make setup complete the user's outcome: installed, reachable, authenticated, paired, and ready to act. The current setup plan orders blockers, but host lifecycle/install repair is still a gap.
- Prefer supervised local execution over refusal or delegation friction when the Agent has local permission and workspace context; use `execution_posture` to make that route explicit.
- Use delegation and remote runners for isolation, parallelism, or remote execution, not because the user picked the wrong entrypoint.
- Turn conservative ongoing-work intake into confirmed natural-language recurring task creation when timing, owner, delivery, and success criteria are explicit.
- Extend live autonomy queue records with richer daemon retry, checkpoint, and host log detail when the connected host exposes it.
- Build first-class email/calendar connectors and extend Personal Ops live records into inbox, agenda, task, and reminder queues.
- Extend the learning curator from ranked review cards into proposed memory, skill, and routine updates with provenance and rollback.
- Turn research from the current visible run ledger into a browser-backed live report workflow with artifacts, cancellation, richer visual reports, and explicit knowledge ingest.
- Extend Document Ops beyond parity with compressed artifact packages, cross-session synthesis, reviewer-ready suggestion summaries, and richer comparison handoffs.
- Make browser, mobile, voice, and device control setup discoverable and repairable from the same assistant cockpit.
