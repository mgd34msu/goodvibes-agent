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
    goodVibesStatus: 'partial',
    owners: ['agent', 'connected-host', 'companion'],
    goodVibesNow: 'Agent has a strong operator workspace, but docs and policy still expose connected-host and delegation boundaries too early.',
    nextMoves: [
      'Make setup discover, launch, or repair the owning host with explicit user consent.',
      'Move boundary wording into diagnostics; keep primary UX phrasing assistant-first.',
      'Route model decisions by user task instead of asking the user to choose Agent versus host versus TUI.',
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
    goodVibesNow: 'Agent has onboarding and diagnostics, while host lifecycle remains external and therefore high-friction.',
    nextMoves: [
      'Add a consent-gated host lifecycle setup path that can use an installed GoodVibes host or guide installation when missing.',
      'Show one readiness checklist with blocking next actions in priority order.',
      'Add end-to-end install smoke that proves a user can go from package install to reachable assistant.',
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
    goodVibesNow: 'Provider routing, subscription posture, local compatible provider discovery, model pickers, and a read-only local model cookbook for Ollama, llama.cpp, vLLM, and local OpenAI-compatible servers exist; live hardware scanning, benchmarks, and guided downloads are still missing.',
    nextMoves: [
      'Promote local server discovery into first-run setup with clear working/not-working checks.',
      'Add live hardware scanning and benchmark-backed fit scoring for local model recommendations.',
      'Use one model readiness score that accounts for latency, context window, tool support, vision, cost, and privacy.',
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
    goodVibesNow: 'GoodVibes has broad channel adapters, readiness, policy, account inspection, pairing, notification, and confirmed send routes.',
    nextMoves: [
      'Turn per-channel setup into a step-by-step wizard with live probes and owner allowlist checks.',
      'Add a unified inbox and triage view for pending messages, channel errors, and delivery retries.',
      'Certify real delivery outcomes per channel before claiming release readiness.',
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
    goodVibesNow: 'Agent now has a unified Personal Ops workspace and model-visible readiness map for notes, work plans, tasks, reminders, routines, schedules, and delivery, while email inbox and calendar triage still require connectors.',
    nextMoves: [
      'Add provider-agnostic email account setup, inbox triage, summary, labels, and draft reply workflows.',
      'Add CalDAV or calendar connector support with agenda briefing, conflict detection, and reminder creation.',
      'Turn the Personal Ops readiness map into a live queue with inbox, agenda, task, note, reminder, schedule, and delivery records.',
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
    goodVibesNow: 'Agent has local memory, notes, personas, skills, routines, and learned-behavior capture, but lacks an autonomous curator and quality loop.',
    nextMoves: [
      'Add a local curator that proposes memory, skill, and routine changes after completed work.',
      'Score learned artifacts for usefulness, freshness, source quality, and risk before injecting them.',
      'Add automatic stale review and consolidation with user-visible diffs.',
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
    goodVibesNow: 'Agent has reminder scheduling, routine promotion, operator action tools, connected schedule posture, and a read-only autonomy queue that maps visible owners, status, inspect routes, and cancel/recovery routes across work plans, approvals, automation, schedules, routines, delegation, and delivery.',
    nextMoves: [
      'Attach live daemon run/task/schedule records to the autonomy queue instead of route-level cards only.',
      'Let users create recurring natural-language tasks from chat with confirmation and automatic status surfacing.',
      'Add log tails, progress, and checkpoint/retry metadata to queue cards when the owning surface supports it.',
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
    goodVibesNow: 'The source tree has file, shell, analysis, MCP, language intelligence, sandbox, and remote foundations, while Agent policy and docs still divert implementation work into delegation.',
    nextMoves: [
      'Allow supervised local execution when the Agent is already in the target workspace and permissions allow it.',
      'Use delegation for isolation, parallelism, or remote execution, not as the default user-facing answer to coding work.',
      'Add first-class browser control and desktop/device command setup with safety probes.',
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
    goodVibesNow: 'GoodVibes has remote, worktree, task, orchestration, and delegation foundations, but Agent tests intentionally block local fanout and worktree ownership.',
    nextMoves: [
      'Introduce user-visible multi-agent execution for approved large tasks with clear task cards.',
      'Attach every spawned runner to a work plan item, artifact trail, and cancel route.',
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
    goodVibesNow: 'Agent has web research, URL inspection, Agent Knowledge, ingest routes, and confirmed sourced report artifact saving with citation/source maps; live source queues, cancellation, and checkpoint resume are still missing.',
    nextMoves: [
      'Add a deep research mode with plan, live source queue, credibility scoring, report drafting, and explicit knowledge ingest.',
      'Add source bundle review and credibility scoring assistants before report save.',
      'Add live cancellation and checkpoint resume for long research runs.',
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
    goodVibesNow: 'Document Ops now has project-scoped versioned markdown drafts with browse/show/create/revise/review/comment/suggest/accept-suggestion/reject-suggestion/artifact-attach/artifact-insert/export, uploads, exports, sources, media artifacts, a unified artifact browser with read-only browse/show, filters, redacted metadata, bounded text previews, confirmed artifact export-to-file, confirmed multi-artifact package export with exact bytes, README, and redacted manifest, confirmed artifact-to-Knowledge promotion, confirmed artifact-to-document attachment, and confirmed artifact-to-compare reuse for saved text artifacts, plus a confirmed blind comparison runner with delayed reveal, durable JSON comparison artifacts, saved review boards, saved judgment artifacts, saved preference analytics, markdown report export, and confirmed winner route updates.',
    nextMoves: [
      'Add optional compressed package output for users who need a single archive file after reviewing the package directory.',
      'Add cross-session synthesis on top of the blind runner, review board, judgment artifacts, saved preference analytics, markdown export, and route update.',
      'Expose reviewer-ready document suggestion summaries in artifact exports and comparison handoffs.',
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
    goodVibesNow: 'Agent has voice/TTS, pairing, channel readiness, and mobile-depth release goals, but device command depth is not yet a finished user surface.',
    nextMoves: [
      'Finish companion app command depth with visible device capability maps and permission repair.',
      'Add push-to-talk and wake/speak workflows that work from companion surfaces.',
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
    goodVibesNow: 'GoodVibes host has web/control-plane foundations, while Agent remains terminal-first and treats browser hosting as external.',
    nextMoves: [
      'Expose Agent workspace categories through the connected browser surface.',
      'Add mobile-friendly chat, setup, automations, approvals, memory, and channel setup from the same contracts.',
      'Make local browser opening part of first-run success when terminal UX is not enough.',
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
    goodVibesNow: 'GoodVibes has strong permission policy, secrets, MCP trust, pairing, redaction, readiness, doctor, release evidence, and operator audit surfaces.',
    nextMoves: [
      'Keep strong defaults while reducing unnecessary confirmations for already-approved low-risk workflows.',
      'Attach every autonomous task to audit logs, artifacts, and rollback or cancel affordances.',
      'Add user-facing policy explanations for why an action was allowed, denied, or needs confirmation.',
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
