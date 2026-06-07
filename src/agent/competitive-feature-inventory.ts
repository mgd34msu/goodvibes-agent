export type CompetitorId = 'openclaw' | 'hermes' | 'odysseus';

export type GoodVibesCompetitiveStatus = 'leading' | 'parity' | 'partial' | 'gap';

export type GoodVibesOwner = 'agent' | 'connected-host' | 'companion' | 'release';

export interface CompetitorFeatureSignal {
  readonly competitor: CompetitorId;
  readonly evidence: string;
}

export interface CompetitiveFeatureInventoryItem {
  readonly id: string;
  readonly userOutcome: string;
  readonly targetStandard: 'parity' | 'better';
  readonly bestInClassRequirement: string;
  readonly goodVibesStatus: GoodVibesCompetitiveStatus;
  readonly owners: readonly GoodVibesOwner[];
  readonly goodVibesNow: string;
  readonly nextMoves: readonly string[];
  readonly competitorSignals: readonly CompetitorFeatureSignal[];
}

export const COMPETITIVE_FEATURE_INVENTORY: readonly CompetitiveFeatureInventoryItem[] = [
  {
    id: 'one-assistant-mental-model',
    userOutcome: 'The user asks one assistant for help and does not need to understand package, host, daemon, or execution-boundary ownership.',
    targetStandard: 'better',
    bestInClassRequirement: 'Every setup, chat, automation, channel, and execution route is presented as one assistant with visible safety and recovery state.',
    goodVibesStatus: 'leading',
    owners: ['agent', 'connected-host', 'companion'],
    goodVibesNow: 'Agent has a strong operator workspace, visible TUI Home cockpit, first-class `route action:"plan|status"`, `setup action:"repair"`, and `agent_harness mode:"summary|route_decision|setup_repair"` that all start from the same assistant-first lanes: setup, chat/model, project work, Personal Ops, research/docs, background work, and safety/recovery with user-facing next actions. The route planner accepts a plain user task, returns the preferred visible route, alternatives, missing fields, confirmation boundary, workspace matches, and harness mode matches, so the model can choose Agent-owned setup, settings, Personal Ops, research, autonomy, execution, delegation, computer/browser, workspace, host, device, channel, security, or Knowledge paths without asking the user to understand package ownership. Host/daemon health, doctor, readiness, service, and compatibility wording goes directly to `host action:"status"` before repair or lifecycle effects. Normal settings/configuration wording goes directly to `settings action:"list"` before set/reset/import effects. Direct reminder, schedule, cron, and schedule lifecycle wording goes directly to `schedule action:"list"` before confirmed schedule effects. Command-shaped background work goes directly to `execution action:"processes"` plus first-class `terminal`/`process` controls, interactive PTY/stdin/sudo wording goes directly to `execution action:"process_capabilities"` before hidden process starts or credential effects, while broader ongoing or watcher-like background work stays on autonomy intake. File undo/redo/recovery wording goes directly to `execution action:"recovery"` before any confirmed snapshot mutation. Media generation wording goes to media provider readiness plus confirmed `agent_media_generate` saved artifacts, with no inline bytes or silent Knowledge promotion. Screenshot, browser-navigation/control, screen-observation, and desktop-control wording goes directly to `computer action:"plan"` before any live UI tool is considered. Setup repair accepts the current setup blocker or a plain target such as host/auth/service, then returns the safest next route: token repair, connected-host status, services.status receipt, user-run bootstrap commands, or no lifecycle action when the host is already reachable. Technical host, daemon, provider, MCP, and delegation details remain available as diagnostics and confirmation boundaries instead of first-screen ownership questions.',
    nextMoves: [
      'Keep adding plain-language route fixtures for any user task that still falls through to technical ownership language.',
      'Promote new daemon and SDK contracts into first-class Agent routes only after they have visible status, confirmation, and recovery semantics.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Gateway is described as the control plane while the assistant is the product.' },
      { competitor: 'hermes', evidence: 'CLI, gateway, and messaging all expose one Hermes assistant conversation model.' },
      { competitor: 'odysseus', evidence: 'Web workspace combines chat, agents, memory, docs, email, calendar, and tasks in one app.' },
    ],
  },
  {
    id: 'first-run-and-always-on-setup',
    userOutcome: 'A fresh user can install, configure models, start the always-on runtime, and reach the assistant without manual topology work.',
    targetStandard: 'better',
    bestInClassRequirement: 'One guided flow verifies dependencies, installs or starts the host, configures auth, pairs channels, and leaves a working assistant.',
    goodVibesStatus: 'partial',
    owners: ['agent', 'connected-host', 'release'],
    goodVibesNow: 'Agent has onboarding, diagnostics, a first-class `setup action:"status|item|repair|checkpoint|save_checkpoint|clear_checkpoint|token|smoke|finish|import_settings"` adapter, first-class `settings action:"list|get|set|reset|import"` UX for Agent settings plus redacted GoodVibes settings import preview/apply, first-class `host action:"status|capabilities|capability|services|service|methods|method"` UX for connected-host diagnostics, and a visible Start checklist that keeps connected-host auth and install smoke beside runtime/model setup. The shared first-run setup wizard orders connected-host readiness, connected-host auth, provider/model access, install smoke, local model readiness, Agent Knowledge, local behavior, channels, automation review, browser/desktop control, delegation, and finish state with progress, current-step route hints, backtracking routes, setup-smoke rerun/save routes, saved-smoke repeated-blocker focus, and Agent-owned saved setup checkpoints that resume across restarts without storing user prompt text while reporting stale-checkpoint auto-advance evidence when a saved step is already ready. Connected-host setup includes a read-only setup repair decision route, live service probe evidence, token-safe auth posture with exact pairing route ids, confirmed SDK-backed local operator-token create/repair with no raw-token output, recommended diagnostic/status cards, confirmed service install/start/restart routes that stay inspect-first unless service status proves need, setup `serviceLifecycleDecision` gates, service repair-card success criteria, `agent_operator_method` certified receipt outcomes plus exact install/start/restart/no-action lifecycle decisions from services.status receipts, offline bootstrap commands for missing-host setup, a confirmed token-safe setup smoke route with optional durable redacted evidence artifacts from package binary to first assistant turn, Home/setup summary surfacing for the latest smoke result plus smoke history/trend/frequent blockers, `setupWizard.closeout` and top-level `setupCloseout` decisions that reduce critical blockers, smoke evidence, and the user completion marker into blocked/run-smoke/finish/complete states, confirmed setup finish marker writes, setup checkpoint direct model routes, visible Start actions to show/save/clear the checkpoint, and fixtures for missing host, unreachable host, missing token, model-unconfigured, and ready-closeout paths.',
    nextMoves: [
      'Auto-advance individual setup wizard step history from stable connected-host service/auth/smoke receipt ids once the daemon publishes durable setup receipt records.',
      'Attach stable receipt ids and timestamps to setup wizard step history when the connected host publishes durable service/auth/smoke receipt records.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Onboarding can install the Gateway daemon so it stays running.' },
      { competitor: 'hermes', evidence: 'Installers handle runtime dependencies and the setup wizard configures the gateway.' },
      { competitor: 'odysseus', evidence: 'Docker and native setup generate an admin account and open a local web UI.' },
    ],
  },
  {
    id: 'models-and-local-model-cookbook',
    userOutcome: 'The user can choose cloud, subscription, or local models without knowing provider-specific setup details.',
    targetStandard: 'better',
    bestInClassRequirement: 'Model setup recommends the best available route, detects local servers, benchmarks fit, and can help download or serve local models.',
    goodVibesStatus: 'partial',
    owners: ['agent', 'connected-host'],
    goodVibesNow: 'First-class `models action:"status|route|local|providers|provider|smoke"` UX now fronts provider routing, subscription posture, local compatible provider discovery, model pickers, visible route-readiness inspection, and a hardware-scored local model cookbook for Ollama, llama.cpp, vLLM, and local OpenAI-compatible servers; lower-level harness modes remain available for detailed inspection. Model routes and local recipes expose one readiness score across latency, context window, tool support, vision, cost, and privacy. The cookbook scans local CPU/RAM/platform, applies safe accelerator hints, ranks fit, returns setup plans with download/start guidance, local endpoint candidates with exact endpoint inspect routes, model-list smoke commands, smoke success criteria, failure triage, confirmed local smoke checks, provider-add and refresh route hints, benchmark action routes, a visible Check local servers action, a visible model-lane local benchmark action backed by agent_model_compare, saved benchmark-evidence review, saved local-route benchmark artifacts, and revealed winner judgments that raise matching recipe confidence before any separate default-model apply action.',
    nextMoves: [
      'Add daemon/SDK-fed local provider health once connected hosts expose richer latency and serving diagnostics beyond the current confirmed model-list smoke checks.',
      'Carry measured per-candidate latency into exact model-route readiness once benchmark artifacts expose stable route ids for every candidate.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Supports multiple model providers plus subscription auth and model failover.' },
      { competitor: 'hermes', evidence: 'Supports many providers, OpenRouter, local endpoints, and a managed tool gateway subscription.' },
      { competitor: 'odysseus', evidence: 'Cookbook scans hardware and recommends or serves models through Ollama, llama.cpp, and vLLM.' },
    ],
  },
  {
    id: 'omnichannel-inbox-and-delivery',
    userOutcome: 'The assistant is reachable where the user already communicates and can reply safely on those channels.',
    targetStandard: 'better',
    bestInClassRequirement: 'Channel setup is guided, inbound trust is default-safe, delivery is reliable, and the user can inspect every route from one place.',
    goodVibesStatus: 'parity',
    owners: ['agent', 'connected-host', 'companion'],
    goodVibesNow: 'GoodVibes has broad channel adapters, readiness, policy, account inspection, pairing, notification, confirmed send routes, and first-class `channels action:"status|channel|setup|triage|deliveries"` inspection for readiness, one channel, setup guide, triage, and redacted confirmed-send receipt history; `agent_channel_send` remains the confirmed send route. The guide ranks the next channel, walks the user through choosing a surface, enabling it intentionally, inspecting setup schema, configuring secret-backed settings, choosing delivery targets, reviewing allowlist policy, checking live status/doctor output, and sending only one explicitly confirmed test. Channel triage unifies setup blockers, daemon `/api/deliveries` attempts, visible control-plane surface messages, route bindings, and redacted Agent receipts without claiming provider-specific inbox polling.',
    nextMoves: [
      'Promote provider-specific unread channel inbox polling only when the connected-host contract publishes a general safe message feed.',
      'Certify real delivery outcomes per channel before claiming release readiness.',
      'Attach structured connected-host setup-schema, account, policy, status, and doctor receipts to the channel setup guide when the host publishes stable success/failure evidence.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Lists broad messaging support across WhatsApp, Telegram, Slack, Discord, iMessage, Matrix, Teams, and more.' },
      { competitor: 'hermes', evidence: 'Gateway supports Telegram, Discord, Slack, WhatsApp, Signal, CLI, and email.' },
      { competitor: 'odysseus', evidence: 'Uses browser, email, ntfy, and mobile/PWA surfaces for user reach.' },
    ],
  },
  {
    id: 'email-calendar-notes-and-tasks',
    userOutcome: 'The assistant can triage email, draft replies, track calendar context, and act on notes or tasks with reminders.',
    targetStandard: 'better',
    bestInClassRequirement: 'Email, calendar, notes, tasks, reminders, and schedules share one reviewed personal operations surface.',
    goodVibesStatus: 'partial',
    owners: ['agent', 'connected-host'],
    goodVibesNow: 'Agent now has a unified Personal Ops workspace and first-class `personal_ops action:"briefing|status|queue|intake|lane|read"` model tool, backed by the existing harness modes. The direct tool exposes a read-only daily plan across inbox, agenda, tasks, reminders, routines, delivery, notes, and the autonomy queue, a read-only queue view across saved inbox thread/calendar event review items plus fresh provider-read routes, and model-visible request intake that turns inbox, agenda, task, reminder, note, routine, and delivery asks into the safest lane, route, required fields, next steps, and confirmation boundary. Model-visible lanes for inbox, agenda, notes, work plans, tasks, reminders, routines, schedules, and delivery surface Agent-owned notes, routines, schedule receipts, and delivery channels as live records with safe routes. Email/calendar-capable MCP connectors surface as inspectable setup routes, expanded Personal Ops lanes classify connector tool names into read-only and write-like inbox/calendar capabilities, MCP schemas expand into inbox/calendar operation records with required fields, sample inputs, schema routes, confirmation flags, and fresh-read routes, inbox triage/draft plus calendar agenda/conflict workflow cards expose prerequisites, inspect routes, send/edit confirmation boundaries, and ordered execution plans that separate connector reads, local composition, and confirmed provider effects. Confirmed `personal_ops action:"read"` preserves the existing `run_personal_ops_read` boundary: one read-only inbox/calendar MCP operation with required-field checks, bounded redacted output, normalized review cards for common messages/events/results shapes, optional saved redacted review-card artifacts, and saved review artifacts resurfaced as redacted inbox thread and calendar event queue records with artifact inspect routes, freshness status, confirmed refresh routes when a matching read connector is ready, local draft/reminder follow-up routes, and explicit confirmed provider-effect boundaries. Task/reminder lanes now expose visible work-plan, connected-host task, confirmed reminder, autonomous schedule, and connected schedule operation records. Fresh provider-backed thread/event queues still need depth once connector/daemon records are durable.',
    nextMoves: [
      'Attach fresh provider-backed email thread queues, labels, and confirmed send/label/archive execution once connector or daemon records expose durable provider ids.',
      'Attach fresh provider-backed CalDAV/calendar event queues, conflict detection, and confirmed edit/RSVP execution once connector or daemon records expose durable event ids.',
      'Deepen provider-backed task/reminder records beyond the current local/connected-host operation cards.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Showcases mail, calendar, reminders, issues, and personal operating-system workflows.' },
      { competitor: 'hermes', evidence: 'Messaging gateway includes email and skills include Google Workspace dependencies.' },
      { competitor: 'odysseus', evidence: 'Ships IMAP/SMTP email triage and local-first CalDAV calendar support.' },
    ],
  },
  {
    id: 'closed-learning-loop',
    userOutcome: 'The assistant gets better over time by saving useful memories, skills, and routines only when they are useful and reviewable.',
    targetStandard: 'better',
    bestInClassRequirement: 'Learning is automatic enough to be useful, but every durable behavior has provenance, review, rollback, and quality scoring.',
    goodVibesStatus: 'partial',
    owners: ['agent'],
    goodVibesNow: 'Agent has local memory, notes, personas, skills, routines, learned-behavior capture, safe VIBE.md personality discovery from project/global files, safe project context discovery for .hermes.md/HERMES.md/AGENTS.md/CLAUDE.md/HERMES_HOME/SOUL.md/.cursorrules/.cursor/rules/*.mdc files, prompt injection for VIBE.md and project context after secret-looking content scans, direct `vibe action:"status|show|init|import_persona"` routes, /vibe status/init/show/import-persona routes, init/import preview confirmationRoutes, setup posture, Local Context and Personas workspace health counts for applied/loaded/blocked/truncated VIBE.md and project context files, learning-curator personality health cards for blocked/truncated personality files, and opt-in profile starter export/import/application for VIBE.md so users can start with a friendly personality file without persona-registry ceremony, hidden prompt surprises, or profile portability gaps. `context action:"files|file"` exposes target-aware context inspection, loaded/truncated/blocked status, bounded bodies, and direct workspace action route hints from Inspect project context / Inspect one context file. Formal behavior prompt injection still uses only reviewed memory at or above the durable confidence threshold plus reviewed setup-ready skills, routines, bundles, and personas while listing suppressed unreviewed/setup-blocked behavior for curator review; runtime prompt builds now write durable prompt-context receipt ids with turn/source/model/provider, selected and suppressed record refs, segment counts, prompt hash, size, timestamp, and sanitized terminal outcome for completed/error/cancelled turns without storing raw prompt or response text, `context action:"prompt|receipts|receipt"` exposes the applied prompt composition order, recent receipt ids, exact receiptId/turnId/outcomeStatus filters, turn outcomes, selected VIBE.md/project context/memory/routine/skill/persona records, suppressed records, prompt previews on request, and approximate token budget without mutating local context, and Agent Workspace -> Local Context renders a compact prompt receipt timeline with total/completed/error/cancelled/pending counts, latest turn outcome, applied/suppressed counts, bounded outcome detail, exact latest-receipt drill-in, and outcome filter routes. The direct `memory action:"curator|candidate"` route now returns a score-driven prompt plan that shows prompt-active records, suppressed review/setup/low-confidence/personality/consolidation counts, proposal queues, consolidation queues, ordering rules, and exact review routes before durable context expands; it also ranks review, stale, missing-setup, low-confidence, VIBE.md health, duplicate-consolidation candidates with visible diffs/rollback/recreate routes, an ordered duplicate-consolidation batch review plan, confirmed duplicate-consolidation phase helpers for preview/merge/stale/delete/rollback/recreate with durable receipts, delete refusal until duplicates are staged stale, and exact-id post-delete recreate guidance that refuses unsafe id collisions, reviewed-note, completed-work, completed-research, and saved-session memory/behavior proposals, and promotion candidates with existing safe routes. The direct `memory action:"status|provider|list|search|get"` route now exposes local memory counts, direct memory record lookup/search, prompt-active recall, vector stats, embedding-provider doctor warnings, provider inspection, and external-memory setup contract maps for Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, and Supermemory while honestly marking provider records as not published until the SDK/daemon publishes concrete setup/status/read/write/receipt contracts.',
    nextMoves: [
      'Wire external memory-provider status/read/write/sync execution records into the current memory action:"provider" setup-contract maps when the connected host or SDK publishes Honcho, Mem0, Supermemory, or similar backend records.',
      'Add external memory-provider receipt parity for cross-session sync once provider setup/status/read/write records become durable daemon or SDK contracts.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Skills and memory are core extension points.' },
      { competitor: 'hermes', evidence: 'Markets a closed learning loop with autonomous skill creation, skill improvement, session search, and user modeling.' },
      { competitor: 'odysseus', evidence: 'Ships persistent memory and skills backed by vector and keyword retrieval.' },
    ],
  },
  {
    id: 'autonomous-schedules-and-background-work',
    userOutcome: 'The user can ask for ongoing work in natural language and then supervise, pause, resume, or cancel it from a clear queue.',
    targetStandard: 'better',
    bestInClassRequirement: 'Schedules, cron jobs, recurring routines, and long-running tasks are autonomous but never hidden.',
    goodVibesStatus: 'partial',
    owners: ['agent', 'connected-host'],
    goodVibesNow: 'Agent has a first-class `schedule` adapter for schedule action:list/create/remind/edit/run/pause/resume/delete that routes to confirmed natural-language autonomous schedule creation when task, cadence, success criteria, and user request provenance are explicit; reminder scheduling; routine promotion; confirmed connected schedule editing with read-only current-state before/after diffs from schedules.list before confirmation; and allowlisted schedule lifecycle controls. Unconfirmed schedule and routine-promotion previews now return explicit confirmationRoutes instead of vague rerun guidance, and confirmed actions return next routes for schedule list, autonomy queue inspection, run, edit, pause, resume, and delete when applicable. It also has connected schedule posture; a read-only ongoing-work intake selector with trigger workflow posture and watcher receipt success criteria for time-based wakeups/schedules, published watchers.create/list/run/start/stop incoming webhook or event watchers, Gmail/email connector-gated triggers, and control-plane event streams; `agent_operator_method` certified watcher receipt outcomes for watchers.create/patch/run/start/stop/delete; and a read-only autonomy queue that maps visible owners, status, inspect routes, cancel/recovery routes, live research runs, live connected-host task records, live approval records, live automation run records, live schedule records, delegated subagent orchestration routes, log tails, diagnostics for task retry/output/correlation and automation telemetry/delivery/route posture, bounded redacted host task output route/preview descriptors, source ids, normalized available/unavailable controls with reasons, and exact confirmed checkpoint/pause/resume/cancel/edit/control routes where supported, including first-class schedule pause/resume aliases over the daemon enable/disable lifecycle. Agent also exposes visible local Agent orchestration through `agent_orchestration` and `agent_orchestration_agent`, plus tracked local background processes through `background_processes`, `background_process`, and confirmed `run_background_process` start/wait/stop routes with process-style poll/log/kill/write and session-id aliases that feed the same background-work cockpit lane; true live host output chunk streams and persisted/provider-specific watcher run or source records still need connected-host evidence depth.',
    nextMoves: [
      'Attach true live host output chunk streams when the connected host exposes them beyond current bounded task output route/preview descriptors.',
      'Promote certified watcher receipts into persisted autonomy queue/run history and provider-specific Gmail/email source records when the daemon publishes durable watcher source records.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Supports cron, wakeups, webhooks, Gmail triggers, and always-on gateway workflows.' },
      { competitor: 'hermes', evidence: 'Built-in cron scheduler delivers daily reports, backups, audits, and unattended work.' },
      { competitor: 'odysseus', evidence: 'Notes, tasks, reminders, and cron-style scheduled tasks can be acted on by the agent.' },
    ],
  },
  {
    id: 'computer-use-browser-and-shell',
    userOutcome: 'The assistant can browse, use the computer, run shell commands, edit files, and recover from mistakes with understandable approvals.',
    targetStandard: 'better',
    bestInClassRequirement: 'Computer use includes browser control, shell, files, code edits, desktop/device actions, sandboxing, undo, and live tool cards.',
    goodVibesStatus: 'partial',
    owners: ['agent', 'connected-host', 'companion'],
    goodVibesNow: 'Agent exposes local-first execution posture for read/search/analyze, file edit/write, bounded foreground shell commands, web/fetch evidence, Work workspace process supervision with tracked/running/completed counts plus stdin/PTY/sudo parity and direct process actions, visible process monitor/live tail/tool inspector supervision routes, first-class `execution action:"capabilities|process_capabilities"`, `computer action:"plan"`, `terminal`, and `process` adapters for direct process parity reports, browser navigation/screenshot/desktop-control workflow planning, terminal(command, background:true), and process(action:list/poll/wait/log/kill/write/capabilities) UX over confirmed tracked local background process start/list/status/log/wait/stop routes, session-id aliases, bounded redacted process log tails with byte/count/truncation metadata, a read-only process parity matrix for terminal background start plus process list/poll/wait/log/kill/write/PTY/sudo semantics, route-planner preference for `execution action:"process_capabilities"` when the user asks about interactive CLI, PTY, stdin, sudo, or privilege prompts, dynamic SDK/daemon substrate probes for ProcessManager stdin/PTY methods, terminal/PTY operator routes, session-input steering routes, and credential routes, confirmed stdin write execution when a safe ProcessManager stdin method is discovered, setup-linked sudo execution posture with foreground-supervised escalation guidance, SUDO_PASSWORD presence-only reporting, blocked background sudo/stdin password routes, and missing contract evidence, execution-history activity cards that group redacted records by turn with status/outcome, verification evidence, bounded process-output summaries, live-output routes, exact inspect routes, and file-recovery handoffs, confirmed file recovery, strict browser/desktop ready-attention-setup posture with workflow cards/checklists/fallback routes, and delegation for isolation, parallelism, remote execution, separate worktrees, or requested review. Current SDK still lacks a typed PTY session, sudo credential mediation contract, and generic live browser/desktop command contract, so PTY remains discover-only/not generically executable, browser/desktop control remains route-planned before specific trusted tools are inspected, and background sudo prompts are blocked without reading, storing, printing, or injecting raw password values.',
    nextMoves: [
      'Attach true live process ids and host output chunks to history cards once the SDK/daemon ProcessManager exposes stable interactive output records.',
      'Add typed PTY session execution and sudo credential mediation once the SDK/daemon exposes interactive APIs with visible user control.',
      'Keep delegation for isolation, parallelism, or remote execution, not as the default user-facing answer to coding work.',
      'Implement first-class browser/desktop command execution adapters once trusted tool invocation contracts expose visible result receipts.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Provides browser control, canvas, nodes, system.run, camera, screen recording, and session tools.' },
      { competitor: 'hermes', evidence: 'Includes terminal backends, browser tools, code execution, computer-use tooling, and isolated subagents.' },
      { competitor: 'odysseus', evidence: 'Agent uses web, files, shell, MCP, skills, and memory through opencode.' },
    ],
  },
  {
    id: 'multi-agent-and-remote-execution',
    userOutcome: 'Large tasks can be split safely across isolated agents or remote runners while the user sees progress and can intervene.',
    targetStandard: 'better',
    bestInClassRequirement: 'Parallelism is available when it improves time-to-result, with per-task workspaces, logs, artifacts, and review gates.',
    goodVibesStatus: 'partial',
    owners: ['agent', 'connected-host'],
    goodVibesNow: 'GoodVibes has shared-session, remote runner, artifact, task, worktree, orchestration, subagent, and delegation foundations; Agent exposes `agent_orchestration` and `agent_orchestration_agent` for live visible subagent records, serial-by-default policy, managed multi-agent plan milestones, per-agent plan cards with cancel/message/wait routes, work-plan links, dispatch receipt counts, closeout cards, remote-runner contract/artifact evidence, auto-attached remote artifact review routes matched by runner id, spawn/batch-spawn decision cards, templates, and exact first-class `agent` list/inspect/message/wait/cancel routes, plus local-first, TUI handoff, delegated-review, remote-inspection, and hidden-fanout-blocked decision cards with structured confirmed handoff briefs. Approved visible work-plan items can now be dispatched through `agent_work_plan action:"dispatch_agents"` into first-class `agent` spawn or batch-spawn calls with saved linked-agent receipts, post-dispatch next routes for orchestration, work-plan detail, agent inspect/wait/message/cancel, and closeout, and managed orchestration closeout visibility. It intentionally blocks invisible local fanout and raw remote mutation from Agent.',
    nextMoves: [
      'Promote completed remote-runner artifact capture/export receipts into the closeout cards when the remote runtime publishes stable capture outcome records.',
      'Add per-task workspace/worktree evidence to managed plan cards when the connected host exposes stable workspace isolation records.',
      'Keep default chat serial, but route complex execution to supervised parallel work when it clearly helps the user.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Supports multi-agent routing and sessions tools for agent-to-agent coordination.' },
      { competitor: 'hermes', evidence: 'Spawns isolated subagents and has kanban-style orchestration with per-task worktrees.' },
      { competitor: 'odysseus', evidence: 'Lets users hand tools to an agent and have it run whole tasks itself.' },
    ],
  },
  {
    id: 'deep-research-and-knowledge-reports',
    userOutcome: 'The user can ask for deep research and receive a sourced, inspectable report that can be saved to knowledge.',
    targetStandard: 'better',
    bestInClassRequirement: 'Research plans, source quality, citations, synthesis, visual report output, and knowledge ingest are one coherent workflow.',
    goodVibesStatus: 'partial',
    owners: ['agent', 'connected-host'],
    goodVibesNow: 'Agent has web research, URL inspection, Agent Knowledge, ingest routes, a Research workspace that shows browser-runner and visual-report readiness plus exact run/source/report routes, a Research briefing action, Plan workflow action, Public source search action, Browser runner readiness action, and Report artifacts action, a project-local visible research run ledger with phase/progress/checkpoints/log tails/pause/resume/cancel/complete routes, a read-only next-action briefing across visible runs, source review, saved reports, browser readiness, and exact follow-up routes, read-only research workflow planning across run/source/report/browser/Knowledge routes, bounded public source-candidate search that returns capture-ready source summaries and exact confirmed add_source routes without writing the queue, browser-backed runner readiness with setup/fallback/source-review/report/Knowledge-promotion routes plus an explicit browser-runner contract for visible controls/source receipts/bounded logs/report handoff, a research source queue with credibility, score, review/reject/use state, report-ready source lines, reviewed-source bundle handoff, direct saved report artifact inspection, and confirmed sourced report artifact saving with citation/source maps plus citation coverage metadata, repair guidance, optional strict enforcement, and visual report packets that add at-a-glance summary, evidence matrix, findings board, dated source/comparison view, open questions, next actions, and handoff checklist over the same reviewed source artifact; browser-backed autonomous research execution and browser/PWA visual rendering are still missing.',
    nextMoves: [
      'Implement the browser-runner contract as a live deep research executor that updates visible run controls, source queue records, bounded logs, and report drafts as it works.',
      'Carry saved visual report packets into the browser/PWA renderer when the connected-host report surface publishes a concrete route.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Showcases web research, bookmarks, project research, and personal knowledge workflows.' },
      { competitor: 'hermes', evidence: 'Has web tools, session search, trajectory tooling, and research-ready batch workflows.' },
      { competitor: 'odysseus', evidence: 'Ships Deep Research that gathers, reads, and synthesizes sources into a visual report.' },
    ],
  },
  {
    id: 'documents-files-and-model-comparison',
    userOutcome: 'The user can write documents, compare models, handle uploads, and inspect generated artifacts without leaving the assistant.',
    targetStandard: 'parity',
    bestInClassRequirement: 'Documents, uploads, AI edit suggestions, blind model comparison, and artifact reuse are first-class app workflows.',
    goodVibesStatus: 'parity',
    owners: ['agent', 'connected-host'],
    goodVibesNow: 'Document Ops now has project-scoped versioned markdown drafts with browse/show/create/revise/review/comment/suggest/accept-suggestion/reject-suggestion/artifact-attach/artifact-insert/export, uploads, exports, sources, media artifacts, reviewer-ready document export appendices with comment and AI suggestion summaries plus review metadata counts, a visible chronological review packet timeline across documents, comments, AI suggestions, attachments, document exports, comparisons, judgments, route-decision receipts, saved packet presets, handoffs, handoff archives, and route-decision next actions, a visible read-only reviewer-readiness preflight that flags missing source artifacts, unresolved comments, proposed suggestions, unrevealed comparisons, hidden judgments, route-change decisions, and incomplete reviewer handoff evidence before export/archive/apply, inline readiness badges at document export, reviewer handoff/archive, and route-apply forms, review packet defaults that pick the latest document/export/comparison/judgment/route-decision/handoff evidence and use saved preset evidence only as fallback to prefill document export, compare handoff/archive, winner-apply, leave-unchanged route-decision, save-preset, and share forms with field-local hints, a guided read-only review packet wizard with progress, current-step routing, backtracking routes, persisted apply/leave-unchanged route-decision evidence, final archive review, and refreshed-preset lineage verification before external sharing, a confirmed `agent_review_packet_presets` tool plus workspace forms that save/list/show reusable document/comparison/judgment/route-decision/handoff/archive/related artifact packet presets without changing documents, model routing, handoffs, or archives, run list/show freshness checks for missing or superseded artifact ids, recommend reuse routes that point at newer matching evidence when metadata is sufficient, and refresh stale presets into new local preset artifacts with source-preset lineage after explicit confirmation, a unified artifact browser with read-only browse/show, filters, redacted metadata, bounded text previews, confirmed artifact export-to-file, confirmed multi-artifact package directory and ZIP archive export with exact bytes, README, and redacted manifest, confirmed artifact-to-Knowledge promotion, confirmed artifact-to-document attachment, and confirmed artifact-to-compare reuse for saved text artifacts, plus a confirmed blind comparison runner with delayed reveal, durable JSON comparison artifacts, saved review boards, side-by-side reviewer views that combine related document/artifact excerpts with comparison evidence, split-pane reviewer handoff diffs with section jump focus plus recent-handoff defaults and visible recent choices from artifact metadata, saved judgment artifacts, task/document/benchmark-filtered preference analytics and cross-session synthesis, markdown report export, confirmed apply-winner route-decision receipts, confirmed leave-unchanged route-decision receipts, reviewer handoff artifacts that combine comparison evidence with related document/artifact exports, one-click reviewer handoff ZIP archives with source comparison/judgment, related evidence bytes, matching route-decision receipt bytes, README, and manifest ids, confirmed `agent_review_packet_share` delivery of plain-text archive references through configured channel targets after explicit confirmation, and confirmed winner route updates.',
    nextMoves: [
      'Certify real reviewer packet delivery outcomes across configured channel targets before claiming release-depth external delivery.',
      'Carry the same packet wizard, lineage, and archive-share workflow into future browser/PWA surfaces without weakening confirmation or ZIP-byte boundaries.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Canvas and browser/web surfaces provide visual interaction primitives.' },
      { competitor: 'hermes', evidence: 'TUI and dashboard surfaces support conversation history, tools, and sessions.' },
      { competitor: 'odysseus', evidence: 'Ships Documents and Compare workflows in the web workspace.' },
    ],
  },
  {
    id: 'mobile-voice-and-device-nodes',
    userOutcome: 'The user can talk to the assistant and use phone or desktop device capabilities without returning to the terminal.',
    targetStandard: 'better',
    bestInClassRequirement: 'Voice, mobile, notifications, camera, screen, location, and device commands are paired, permission-aware, and reliable.',
    goodVibesStatus: 'partial',
    owners: ['agent', 'connected-host', 'companion'],
    goodVibesNow: 'Agent now has first-class `computer action:"status|plan|control|browser|setup|mcp|open_browser"` UX over browser/PWA readiness, browser/screenshot/desktop-control route planning, repair/setup, trusted tool discovery, and visible browser cockpit handoffs, plus `device action:"status|capability|voice|provider|open_tts_provider|open_tts_voice"` UX over companion pairing, mobile/PWA compatibility, voice/TTS, notifications, provider posture, and visible TTS picker handoffs while preserving the existing harness detail routes. The read-only device capability map reports ready/attention/setup-needed states, computer browser/PWA readiness reports URL/category/mobile/receipt gaps, browser/desktop control reports trusted-tool/MCP setup posture and safe workflow plans, and voice workflow posture maps push-to-talk, voice memo transcription, spoken responses, and wake-word capture. The Voice & Media workspace now gives users Voice workflows, Device capability map, and Browser/PWA readiness actions with direct `device` and `computer` route hints; camera, location, and wake-word capture remain honest not-published contract gaps.',
    nextMoves: [
      'Finish companion app command depth and permission repair using the visible capability map as the user-facing checklist.',
      'Connect companion-side push-to-talk execution and publish wake/speak only after a permission-scoped runtime contract exists.',
      'Certify camera, screen, notification, location, and local command routes by platform.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'macOS, iOS, and Android nodes expose voice, canvas, camera, screen, location, notifications, and system commands.' },
      { competitor: 'hermes', evidence: 'Runs in Termux and supports voice memo transcription and messaging continuity.' },
      { competitor: 'odysseus', evidence: 'Responsive PWA works on mobile and includes browser notifications.' },
    ],
  },
  {
    id: 'web-dashboard-and-pwa',
    userOutcome: 'The assistant is usable from a browser with clear status, settings, sessions, tools, and mobile-friendly controls.',
    targetStandard: 'better',
    bestInClassRequirement: 'The browser surface is not a secondary admin panel; it is a full user-grade assistant cockpit.',
    goodVibesStatus: 'partial',
    owners: ['connected-host', 'agent'],
    goodVibesNow: 'GoodVibes host has web/control-plane foundations, and Agent now exposes the configured connected-host browser cockpit/PWA through first-class `computer action:"browser|open_browser"` routes plus Home and Voice & Media workspace actions. The route resolves `web.publicBaseUrl` or the web endpoint binding, requires explicit user confirmation before opening an external browser, returns service/web setup routes when disabled, and reports workspace-category coverage, mobile/PWA controls, Agent onboarding marker status, and the unpublished browser/PWA first-run receipt contract instead of pretending a separate Agent web app or completed browser-native cockpit exists. Agent remains terminal-first until connected-host browser-native Agent category routes are published.',
    nextMoves: [
      'Publish connected-host browser-native routes for Agent workspace categories using the existing coverage map as the acceptance checklist.',
      'Add mobile-friendly chat, setup, automations, approvals, memory, and channel setup controls from the same route contracts.',
      'Fold browser-cockpit readiness into first-run finish state once connected-host browser/PWA receipts prove the route is ready.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Gateway serves Control UI and WebChat, plus companion apps.' },
      { competitor: 'hermes', evidence: 'Provides local web dashboard and TUI gateway surfaces.' },
      { competitor: 'odysseus', evidence: 'Primary experience is a self-hosted responsive web workspace/PWA.' },
    ],
  },
  {
    id: 'security-permissions-and-recovery',
    userOutcome: 'Powerful automation is safe by default, explainable, recoverable, and adjustable without killing capability.',
    targetStandard: 'better',
    bestInClassRequirement: 'Every risky action has clear scope, trust, provenance, approval UX, logs, rollback, and doctor repair.',
    goodVibesStatus: 'leading',
    owners: ['agent', 'connected-host', 'release'],
    goodVibesNow: 'GoodVibes has strong permission policy, secrets, MCP trust, pairing, redaction, readiness, doctor, release evidence, operator audit surfaces, and first-class policy explanations that show whether one model action is allowed, denied, or waiting on confirmation.',
    nextMoves: [
      'Keep strong defaults while reducing unnecessary confirmations for already-approved low-risk workflows.',
      'Attach every autonomous task to audit logs, artifacts, and rollback or cancel affordances.',
    ],
    competitorSignals: [
      { competitor: 'openclaw', evidence: 'Emphasizes secure defaults, DM pairing, allowlists, sandboxing, and doctor checks.' },
      { competitor: 'hermes', evidence: 'Documents command approval, DM pairing, container isolation, network egress isolation, and observability hooks.' },
      { competitor: 'odysseus', evidence: 'Gates admin-only tools, local services, shell, file access, webhooks, and tokens with security guidance.' },
    ],
  },
];

export function competitiveInventoryStatusCounts(): Record<GoodVibesCompetitiveStatus, number> {
  return COMPETITIVE_FEATURE_INVENTORY.reduce<Record<GoodVibesCompetitiveStatus, number>>((counts, item) => {
    counts[item.goodVibesStatus] += 1;
    return counts;
  }, {
    leading: 0,
    parity: 0,
    partial: 0,
    gap: 0,
  });
}
