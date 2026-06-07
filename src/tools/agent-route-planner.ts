import type { CommandContext } from '../input/command-registry.ts';
import { listHarnessModes } from './agent-harness-mode-catalog.ts';
import { listWorkspaceActions } from './agent-harness-workspace-actions.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export interface AgentRoutePlannerArgs {
  readonly query?: unknown;
  readonly target?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

interface RouteCandidateDraft {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly userSurface: string;
  readonly userOutcome: string;
  readonly why: string;
  readonly modelRoute: string;
  readonly inspectRoute: string;
  readonly userRoute?: string;
  readonly requiresConfirmation: boolean;
  readonly missingFields?: readonly string[];
  readonly nextQuestion?: string;
  readonly supportingRoutes?: readonly string[];
  readonly policy?: string;
}

export interface AgentRouteCandidate {
  readonly id: string;
  readonly label: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly userSurface: string;
  readonly userOutcome: string;
  readonly why: string;
  readonly modelRoute: string;
  readonly inspectRoute: string;
  readonly userRoute?: string;
  readonly requiresConfirmation: boolean;
  readonly missingFields?: readonly string[];
  readonly nextQuestion?: string;
  readonly supportingRoutes?: readonly string[];
  readonly policy?: string;
  readonly score?: number;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(20, Math.trunc(parsed)));
}

function hasAny(lower: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => lower.includes(token));
}

function hasAll(lower: string, tokens: readonly string[]): boolean {
  return tokens.every((token) => lower.includes(token));
}

function quote(value: string, limit = 96): string {
  return JSON.stringify(previewHarnessText(value, limit));
}

const MODE_SEARCH_STOPWORDS = new Set(['a', 'an', 'and', 'for', 'from', 'in', 'my', 'of', 'on', 'or', 'please', 'the', 'this', 'to', 'with']);

function simplifiedModeQuery(input: string): string {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((token) => token.length > 0 && !MODE_SEARCH_STOPWORDS.has(token))
    .map((token) => (token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token))
    .join(' ');
}

function scheduleLike(lower: string): boolean {
  return hasAny(lower, [
    'schedule',
    'scheduled',
    'recurring',
    'repeat',
    'remind',
    'reminder',
    'cron',
    'every ',
    'daily',
    'weekly',
    'monthly',
    'tomorrow',
    'next week',
    'follow up',
    'follow-up',
  ]);
}

function autonomousLike(lower: string): boolean {
  return scheduleLike(lower) || hasAny(lower, [
    'autonomous',
    'ongoing',
    'long-running',
    'background',
    'monitor',
    'watcher',
    'webhook',
    'trigger',
    'when a ',
    'when an ',
    'wake up',
    'wake-up',
  ]);
}

function browserControlLike(lower: string): boolean {
  return hasAny(lower, [
    'browser control',
    'desktop control',
    'computer use',
    'take screenshot',
    'take a screenshot',
    'screenshot',
    'screen recording',
    'record screen',
    'record the screen',
    'observe screen',
    'observe the screen',
    'capture screen',
    'capture the screen',
    'use the browser',
    'use browser',
    'navigate browser',
    'click in browser',
    'click the page',
    'fill form',
    'fill out form',
    'logged-in page',
    'logged in page',
    'move mouse',
    'type into',
    'control desktop',
    'control the desktop',
  ]);
}

function processLifecycleLike(lower: string): boolean {
  if (lower.includes('background') && hasAny(lower, [
    'build',
    'bun ',
    'command',
    'dev server',
    'execute',
    'launch',
    'npm ',
    'pnpm ',
    'process',
    'pytest',
    'server',
    'start ',
    'terminal',
    'test',
    'yarn ',
  ])) return true;
  return hasAny(lower, [
    'background process',
    'background command',
    'background:true',
    'run in background',
    'run it in the background',
    'start in background',
    'terminal background',
    'terminal command',
    'process action',
    'process list',
    'process poll',
    'process log',
    'process wait',
    'process kill',
    'process write',
    'poll process',
    'log process',
    'wait process',
    'kill process',
    'stop process',
    'stdin',
    'pty',
  ]);
}

function buildCandidates(request: string): readonly RouteCandidateDraft[] {
  const lower = request.toLowerCase();
  const candidates: RouteCandidateDraft[] = [];

  const add = (candidate: RouteCandidateDraft): void => {
    candidates.push(candidate);
  };

  if (hasAny(lower, ['setup', 'first run', 'first-run', 'install', 'bootstrap', 'onboarding', 'start host', 'start daemon', 'goodvibes-daemon', 'connected host', 'token', 'smoke'])) {
    add({
      id: 'setup-and-host-readiness',
      label: 'Guided setup or connected-host repair',
      score: 95,
      userSurface: 'Start workspace',
      userOutcome: 'Get the assistant reachable and working before asking the user to diagnose topology.',
      why: 'The request is about install, first-run setup, host availability, auth, token, or setup smoke evidence.',
      modelRoute: 'setup action:"status" includeParameters:true',
      inspectRoute: 'host action:"status" includeParameters:true',
      userRoute: 'Agent Workspace -> Start',
      requiresConfirmation: false,
      supportingRoutes: [
        'setup action:"item" setupItemId:"connected-host-service"',
        'setup action:"token" confirm:true explicitUserRequest:"..."',
        'setup action:"smoke" confirm:true explicitUserRequest:"..."',
        'host action:"services" includeParameters:true',
      ],
      policy: 'Setup inspection is read-only; token repair, smoke execution, service lifecycle, and finish markers stay confirmed.',
    });
  }

  if (hasAll(lower, ['goodvibes', 'settings']) || hasAny(lower, ['import settings', 'tui settings', 'copy settings', 'settings import'])) {
    add({
      id: 'goodvibes-settings-import',
      label: 'Preview or import GoodVibes settings',
      score: 100,
      userSurface: 'Start workspace settings import',
      userOutcome: 'Carry useful GoodVibes TUI settings into Agent without copying unrelated host state.',
      why: 'The request asks to import or inspect existing GoodVibes settings.',
      modelRoute: 'settings action:"import"',
      inspectRoute: 'import_goodvibes_settings action:"preview"',
      userRoute: 'Agent Workspace -> Start -> Import GoodVibes TUI settings',
      requiresConfirmation: true,
      supportingRoutes: [
        'settings action:"import" confirm:true explicitUserRequest:"..."',
        'workspace action:"run" actionId:"import-goodvibes-tui-settings" confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Import previews are read-only; apply copies only Agent-owned settings and subscription state after confirmation.',
    });
  }

  if (hasAny(lower, ['model', 'provider', 'openrouter', 'openai', 'anthropic', 'claude', 'subscription', 'local model', 'ollama', 'llama.cpp', 'llamacpp', 'vllm', 'context window'])) {
    add({
      id: 'model-provider-routing',
      label: 'Model/provider route readiness',
      score: 88,
      userSurface: 'Model Routing workspace',
      userOutcome: 'Choose or diagnose model access without asking the user to know provider internals.',
      why: 'The request is about model choice, provider accounts, subscriptions, local models, or context-window fit.',
      modelRoute: 'models action:"status" includeParameters:true',
      inspectRoute: 'models action:"route" target:"..." includeParameters:true',
      userRoute: 'Agent Workspace -> Model Routing',
      requiresConfirmation: false,
      supportingRoutes: [
        'models action:"local"',
        'models action:"providers"',
        'models action:"smoke" confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Model inspection and cookbook guidance are read-only; local smoke checks and route changes stay explicit confirmed actions.',
    });
  }

  if (hasAny(lower, ['vibe.md', 'vibe ', 'personality', 'tone', 'style', 'persona', 'soul.md']) || hasAny(lower, ['agents.md', '.hermes.md', 'claude.md', '.cursorrules', 'project context'])) {
    const contextRoute = hasAny(lower, ['agents.md', '.hermes.md', 'claude.md', '.cursorrules', 'project context'])
      ? 'context action:"files" includeParameters:true'
      : 'vibe action:"status" includeParameters:true';
    add({
      id: 'personality-and-context',
      label: 'Personality and project context',
      score: 86,
      userSurface: 'Local Context and Personas workspace',
      userOutcome: 'Inspect or update how the assistant should behave without hidden prompt surprises.',
      why: 'The request mentions VIBE.md, personality, personas, tone, or project instruction files.',
      modelRoute: contextRoute,
      inspectRoute: contextRoute,
      userRoute: 'Agent Workspace -> Local Context',
      requiresConfirmation: hasAny(lower, ['create', 'init', 'import', 'change', 'update']),
      supportingRoutes: [
        'vibe action:"show"',
        'vibe action:"init" confirm:true explicitUserRequest:"..."',
        'context action:"prompt" includeParameters:true',
        'memory action:"curator" includeParameters:true',
      ],
      policy: 'Context/personality inspection is read-only; VIBE.md creation or persona import requires confirmation and secret scanning.',
    });
  }

  if (hasAny(lower, ['memory', 'remember', 'forget', 'recall', 'skill', 'routine', 'learn', 'learning', 'honcho', 'mem0', 'supermemory'])) {
    add({
      id: 'memory-learning',
      label: 'Memory, routines, skills, and learning review',
      score: 82,
      userSurface: 'Local Context workspace',
      userOutcome: 'Make durable learning reviewable, sourced, and reversible.',
      why: 'The request is about memory, recall, skills, routines, or external memory providers.',
      modelRoute: 'memory action:"status" includeParameters:true',
      inspectRoute: 'memory action:"curator" includeParameters:true',
      userRoute: 'Agent Workspace -> Local Context',
      requiresConfirmation: hasAny(lower, ['save', 'remember', 'forget', 'delete', 'merge', 'consolidate', 'create']),
      supportingRoutes: [
        'memory action:"list"',
        'memory action:"search" query:"..."',
        'memory action:"candidate" candidateId:"..."',
        'agent_learning_consolidation mode:"preview"',
      ],
      policy: 'Memory reads and review queues are safe; durable memory writes or consolidation phases require reviewed confirmed routes.',
    });
  }

  if (hasAny(lower, ['inbox', 'email', 'gmail', 'imap', 'smtp', 'calendar', 'caldav', 'agenda', 'rsvp', 'draft reply', 'reply to', 'tasks', 'todo', 'note']) && !hasAny(lower, ['channel', 'slack', 'discord', 'telegram'])) {
    add({
      id: 'personal-ops-request',
      label: 'Personal Ops intake',
      score: hasAny(lower, ['email', 'inbox', 'calendar', 'agenda', 'draft reply', 'rsvp']) ? 94 : 78,
      userSurface: 'Personal Ops workspace',
      userOutcome: 'Triage personal data through reviewed lanes, redacted cards, and confirmed external effects.',
      why: 'The request involves inbox, email, calendar, notes, tasks, reminders, or reply drafting.',
      modelRoute: `personal_ops action:"intake" query:${quote(request)}`,
      inspectRoute: 'personal_ops action:"status" includeParameters:true',
      userRoute: 'Agent Workspace -> Personal Ops',
      requiresConfirmation: hasAny(lower, ['read live', 'refresh', 'send', 'reply', 'archive', 'label', 'edit', 'rsvp', 'delete']),
      missingFields: hasAny(lower, ['send', 'reply', 'archive', 'label', 'edit', 'rsvp', 'delete'])
        ? ['connector lane and record id', 'exact provider effect', 'confirmation']
        : undefined,
      supportingRoutes: [
        'personal_ops action:"queue"',
        'personal_ops action:"lane" laneId:"inbox|calendar"',
        'personal_ops action:"read" laneId:"inbox|calendar" recordId:"..." fields:{...} confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Personal Ops intake is read-only. Provider reads and every send/edit/archive/RSVP effect stay scoped and confirmed.',
    });
  }

  if (hasAny(lower, ['research', 'deep research', 'investigate', 'sources', 'citations', 'citation', 'source-backed', 'market map', 'literature', 'report']) && !scheduleLike(lower)) {
    add({
      id: 'deep-research-workflow',
      label: 'Visible research workflow',
      score: 92,
      userSurface: 'Research workspace',
      userOutcome: 'Turn research into a visible run, reviewed sources, and a sourced report artifact.',
      why: 'The request asks for research, source gathering, citations, or a report.',
      modelRoute: `research action:"plan" query:${quote(request)} includeParameters:true`,
      inspectRoute: 'research action:"briefing"',
      userRoute: 'Agent Workspace -> Research',
      requiresConfirmation: hasAny(lower, ['start', 'run', 'create', 'save', 'report']),
      missingFields: hasAny(lower, ['start', 'run', 'create'])
        ? ['research question', 'deliverable or success criteria']
        : undefined,
      supportingRoutes: [
        'research action:"search" query:"..."',
        'research action:"create_run" title:"..." question:"..." confirm:true explicitUserRequest:"..."',
        'research action:"report" runId:"..." confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Planning and source search are read-only; visible run creation, source capture, lifecycle controls, and report saves stay confirmed.',
    });
  }

  if (autonomousLike(lower)) {
    add({
      id: 'autonomy-intake',
      label: 'Visible autonomy or schedule intake',
      score: scheduleLike(lower) || hasAny(lower, ['webhook', 'watcher', 'trigger', 'cron', 'schedule', 'remind', 'recurring']) ? 96 : 80,
      userSurface: 'Work and schedules workspace',
      userOutcome: 'Create or supervise ongoing work only through visible, cancellable routes.',
      why: 'The request sounds scheduled, recurring, event-triggered, long-running, or autonomous.',
      modelRoute: `autonomy action:"intake" query:${quote(request)} includeParameters:true`,
      inspectRoute: 'autonomy action:"queue"',
      userRoute: 'Agent Workspace -> Work & Approvals',
      requiresConfirmation: hasAny(lower, ['create', 'start', 'schedule', 'remind', 'run', 'pause', 'resume', 'cancel', 'delete']),
      missingFields: ['exact cadence/event source when applicable', 'task', 'success criteria'],
      supportingRoutes: [
        'schedule action:"create" task:"..." successCriteria:"..." scheduleKind:"at|every|cron" scheduleValue:"..." confirm:true explicitUserRequest:"..."',
        'schedule action:"remind" message:"..." scheduleKind:"at|every|cron" scheduleValue:"..." confirm:true explicitUserRequest:"..."',
        'agent_operator_method methodId:"watchers.create" confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Autonomy intake is read-only; schedule, watcher, run-control, and delivery effects stay on the owning confirmed route.',
    });
  }

  if (processLifecycleLike(lower)) {
    const starting = hasAny(lower, ['run ', 'start ', 'launch ', 'execute ', 'terminal command', 'background:true', 'run in background', 'start in background']);
    const lifecycle = hasAny(lower, ['poll', 'log', 'wait', 'kill', 'stop', 'write', 'send input', 'stdin']);
    add({
      id: 'local-background-process',
      label: 'Local background process controls',
      score: 99,
      userSurface: 'Work and process supervision workspace',
      userOutcome: 'Start or manage long-running local commands through visible process ids, logs, and cancellation routes.',
      why: 'The request mentions terminal background commands, process lifecycle actions, stdin, PTY, or process supervision.',
      modelRoute: 'execution action:"processes" includeParameters:true',
      inspectRoute: 'execution action:"capabilities"',
      userRoute: 'Agent Workspace -> Work & Approvals',
      requiresConfirmation: starting || hasAny(lower, ['wait', 'kill', 'stop', 'write', 'send input']),
      missingFields: starting
        ? ['command', 'working directory when not the current workspace', 'confirmation']
        : lifecycle
          ? ['process id or session id']
          : undefined,
      supportingRoutes: [
        'terminal command:"..." background:true confirm:true explicitUserRequest:"..."',
        'process action:"list"',
        'process action:"poll|log|wait|kill|write" session_id:"..."',
        'process action:"capabilities"',
      ],
      policy: 'Process planning and listing are read-only. Starting commands, waiting, killing, and stdin writes use the first-class terminal/process confirmation boundaries with bounded redacted logs.',
    });
  }

  if (hasAny(lower, ['build', 'fix', 'implement', 'refactor', 'patch', 'code', 'test', 'review pr', 'review pull', 'lint', 'run command', 'shell', 'terminal', 'file edit', 'edit files'])) {
    const delegated = hasAny(lower, ['parallel', 'delegate', 'delegated', 'subagent', 'remote', 'worktree', 'background', 'isolated', 'isolation']);
    add({
      id: delegated ? 'delegated-build-work' : 'local-first-execution',
      label: delegated ? 'Delegated or isolated build work' : 'Local-first execution and file work',
      score: delegated ? 98 : 90,
      userSurface: delegated ? 'Work plan and delegation workspace' : 'Main conversation and Work workspace',
      userOutcome: delegated
        ? 'Use isolated or parallel execution only when it improves the user result.'
        : 'Use the current workspace directly when local read/edit/exec is sufficient.',
      why: delegated
        ? 'The request mentions parallelism, delegation, remote execution, worktrees, or isolation.'
        : 'The request is ordinary coding, shell, test, review, or file work in the current workspace.',
      modelRoute: delegated ? 'delegation action:"status" includeParameters:true' : 'execution action:"status" includeParameters:true',
      inspectRoute: delegated ? 'delegation action:"routes" includeParameters:true' : 'execution action:"route" target:"local"',
      userRoute: 'Agent Workspace -> Work & Approvals',
      requiresConfirmation: delegated,
      missingFields: delegated ? ['task scope', 'workspace or worktree target', 'success criteria', 'review expectation'] : undefined,
      supportingRoutes: delegated
        ? [
          'agent_work_plan action:"dispatch_agents" confirm:true explicitUserRequest:"..."',
          'delegation action:"route" target:"tui handoff"',
          'agent_harness mode:"agent_orchestration"',
        ]
        : [
          'execution action:"history"',
          'execution action:"processes"',
          'execution action:"recovery"',
        ],
      policy: delegated
        ? 'Delegation must preserve the original ask and produce visible status, artifacts, recovery, and review evidence.'
        : 'Local work remains serial and visible by default; long-running commands use tracked process routes.',
    });
  }

  if (browserControlLike(lower)) {
    add({
      id: 'browser-control-workflow-plan',
      label: 'Browser, screenshot, or desktop-control workflow plan',
      score: 97,
      userSurface: 'Work and computer-use workspace',
      userOutcome: 'Choose the safest browser, screenshot, or desktop-control workflow before any live UI action.',
      why: 'The request asks for screenshot, browser navigation/control, screen observation, or desktop control.',
      modelRoute: `computer action:"plan" query:${quote(request)} includeParameters:true`,
      inspectRoute: 'computer action:"control" includeParameters:true',
      userRoute: 'Agent Workspace -> Work & Approvals',
      requiresConfirmation: hasAny(lower, ['open', 'control', 'click', 'fill', 'type', 'capture', 'screenshot', 'record', 'desktop']),
      missingFields: ['target page/app/screen when applicable', 'exact live action to perform', 'confirmation for any live-control effect'],
      supportingRoutes: [
        'computer action:"plan" query:"take a screenshot" includeParameters:true',
        'computer action:"mcp" query:"browser desktop" includeParameters:true',
        'computer action:"setup"',
        'computer action:"open_browser" confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Workflow planning is read-only. Browser opens, screenshots, authenticated browsing, form entry, desktop actions, and MCP/tool invocations require the selected tool-specific confirmation boundary.',
    });
  }

  if (hasAny(lower, ['browser', 'pwa', 'dashboard', 'desktop', 'screen', 'screenshot', 'camera', 'voice', 'tts', 'phone', 'mobile', 'device'])) {
    const device = hasAny(lower, ['voice', 'tts', 'phone', 'mobile', 'device', 'camera']);
    add({
      id: device ? 'device-voice-capability' : 'browser-computer-capability',
      label: device ? 'Device and voice capability map' : 'Browser/PWA or computer-use route',
      score: 84,
      userSurface: device ? 'Voice & Media workspace' : 'Connected browser cockpit',
      userOutcome: 'Use device, browser, and desktop capabilities only through visible permission-aware routes.',
      why: 'The request mentions browser/PWA, desktop/computer use, mobile, camera, screen, or voice/TTS.',
      modelRoute: device ? 'device action:"status" includeParameters:true' : 'computer action:"status" includeParameters:true',
      inspectRoute: device ? 'device action:"capability" target:"..." includeParameters:true' : 'computer action:"browser" includeParameters:true',
      userRoute: device ? 'Agent Workspace -> Voice & Media' : 'Connected browser cockpit',
      requiresConfirmation: hasAny(lower, ['open', 'control', 'run', 'speak', 'send', 'capture']),
      supportingRoutes: [
        'computer action:"open_browser" confirm:true explicitUserRequest:"..."',
        'device action:"voice"',
        'device action:"open_tts_provider" confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Capability inspection is read-only; browser opens, TTS picker opens, desktop control, and device effects require visible confirmation.',
    });
  }

  if (hasAny(lower, ['slack', 'discord', 'telegram', 'whatsapp', 'signal', 'matrix', 'teams', 'ntfy', 'notification', 'notify', 'send message', 'channel', 'delivery receipt'])) {
    add({
      id: 'channel-delivery',
      label: 'Channel setup, triage, or confirmed delivery',
      score: 88,
      userSurface: 'Channels workspace',
      userOutcome: 'Send and troubleshoot external messages through configured, inspectable channel targets.',
      why: 'The request mentions external channels, notifications, target setup, or delivery receipts.',
      modelRoute: 'channels action:"status" includeParameters:true',
      inspectRoute: 'channels action:"triage" includeParameters:true',
      userRoute: 'Agent Workspace -> Channels',
      requiresConfirmation: hasAny(lower, ['send', 'notify', 'deliver', 'test']),
      missingFields: hasAny(lower, ['send', 'notify', 'deliver']) ? ['configured target', 'message text', 'confirmation'] : undefined,
      supportingRoutes: [
        'channels action:"setup"',
        'channels action:"deliveries"',
        'agent_channel_send confirm:true explicitUserRequest:"..."',
        'agent_notify confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Channel inspection is read-only; every external delivery uses an explicit configured target and confirmation.',
    });
  }

  if (hasAny(lower, ['document', 'draft', 'artifact', 'upload', 'export', 'packet', 'handoff', 'blind compare', 'model compare', 'compare models', 'reviewer'])) {
    add({
      id: 'documents-artifacts-compare',
      label: 'Documents, artifacts, and model comparison',
      score: 86,
      userSurface: 'Documents & Compare workspace',
      userOutcome: 'Keep drafts, uploads, artifacts, reviewer packets, and model choices in one reviewable workflow.',
      why: 'The request is about documents, artifacts, exports, reviewer packets, or blind model comparison.',
      modelRoute: 'workspace action:"actions" categoryId:"documents" query:"documents compare artifacts"',
      inspectRoute: 'agent_harness mode:"document_ops" includeParameters:true',
      userRoute: 'Agent Workspace -> Documents & Compare',
      requiresConfirmation: hasAny(lower, ['create', 'revise', 'export', 'archive', 'share', 'compare', 'apply', 'attach', 'insert']),
      supportingRoutes: [
        'agent_documents action:"browse"',
        'agent_artifacts mode:"list"',
        'agent_model_compare mode:"compare" confirm:true explicitUserRequest:"..."',
        'agent_review_packet_share confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Browsing is read-only; draft changes, exports, archives, sharing, artifact promotion, and comparisons stay confirmed.',
    });
  }

  if (hasAny(lower, ['knowledge', 'ask knowledge', 'search knowledge', 'ingest', 'source node', 'source-backed'])) {
    add({
      id: 'agent-knowledge',
      label: 'Isolated Agent Knowledge',
      score: 82,
      userSurface: 'Knowledge workspace',
      userOutcome: 'Ask, search, inspect, or deliberately ingest reviewed sources into Agent-owned knowledge only.',
      why: 'The request mentions Agent Knowledge, Knowledge search, source-backed answers, or ingest.',
      modelRoute: 'agent_knowledge action:"ask" query:"..."',
      inspectRoute: 'agent_knowledge action:"status"',
      userRoute: 'Agent Workspace -> Knowledge',
      requiresConfirmation: hasAny(lower, ['ingest', 'add', 'promote', 'import']),
      supportingRoutes: [
        'agent_knowledge action:"search" query:"..."',
        'agent_knowledge_ingest sourceKind:"url|file|artifact" confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Agent Knowledge must stay on `/api/goodvibes-agent/knowledge/*` and never fall back to default knowledge.',
    });
  }

  if (hasAny(lower, ['security', 'permission', 'policy', 'why denied', 'why allowed', 'confirmation', 'requires confirmation', 'approval'])) {
    add({
      id: 'security-policy-explanation',
      label: 'Security posture or policy explanation',
      score: 90,
      userSurface: 'Safety and recovery workspace',
      userOutcome: 'Explain a safety decision before performing risky work.',
      why: 'The request asks about permissions, policy, approval, security posture, or why a tool is allowed or denied.',
      modelRoute: 'security action:"explain" toolName:"..." toolArgs:{...}',
      inspectRoute: 'security action:"status" includeParameters:true',
      userRoute: 'Agent Workspace -> Safety',
      requiresConfirmation: false,
      supportingRoutes: [
        'security action:"finding" findingId:"..."',
        'agent_harness mode:"policy_explain" toolName:"..." toolArgs:{...}',
      ],
      policy: 'Policy explanations are read-only and never execute the target tool.',
    });
  }

  if (hasAny(lower, ['daemon method', 'operator method', 'host capability', 'service endpoint', 'control plane', 'api route'])) {
    add({
      id: 'connected-host-contract',
      label: 'Connected host capability or method contract',
      score: 78,
      userSurface: 'Connected host diagnostics',
      userOutcome: 'Inspect daemon capabilities through public contracts instead of guessing hidden routes.',
      why: 'The request asks about daemon/operator/API route capability or service posture.',
      modelRoute: 'host action:"capabilities" includeParameters:true',
      inspectRoute: 'host action:"methods" includeParameters:true',
      userRoute: 'Agent Workspace -> Start',
      requiresConfirmation: false,
      supportingRoutes: [
        'host action:"method" methodId:"..."',
        'agent_operator_method methodId:"..." confirm:true explicitUserRequest:"..."',
        'host action:"services" includeParameters:true',
      ],
      policy: 'Method discovery is read-only; write/admin daemon methods require exact method id, confirmation, and an explicit user request.',
    });
  }

  if (candidates.length === 0) {
    add({
      id: 'main-conversation-first',
      label: 'Main conversation first',
      score: 35,
      userSurface: 'Main conversation',
      userOutcome: 'Answer or plan directly before escalating into a specialized tool or workspace.',
      why: 'The request does not clearly need a specialized route yet.',
      modelRoute: 'main conversation',
      inspectRoute: `workspace action:"actions" query:${quote(request, 72)}`,
      userRoute: 'Main conversation',
      requiresConfirmation: false,
      supportingRoutes: [
        `route action:"plan" query:${quote(request, 72)}`,
        `workspace action:"actions" query:${quote(request, 72)}`,
      ],
      policy: 'Stay in the main conversation unless a visible specialized route improves clarity, durability, safety, or autonomy.',
    });
  }

  return candidates;
}

function confidence(score: number): AgentRouteCandidate['confidence'] {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function describeCandidate(candidate: RouteCandidateDraft, includeParameters: boolean): AgentRouteCandidate {
  return {
    id: candidate.id,
    label: candidate.label,
    confidence: confidence(candidate.score),
    userSurface: candidate.userSurface,
    userOutcome: candidate.userOutcome,
    why: candidate.why,
    modelRoute: candidate.modelRoute,
    inspectRoute: candidate.inspectRoute,
    ...(candidate.userRoute ? { userRoute: candidate.userRoute } : {}),
    requiresConfirmation: candidate.requiresConfirmation,
    ...(candidate.missingFields?.length ? { missingFields: candidate.missingFields } : {}),
    ...(candidate.nextQuestion ? { nextQuestion: candidate.nextQuestion } : {}),
    ...(candidate.supportingRoutes?.length ? { supportingRoutes: candidate.supportingRoutes } : {}),
    ...(candidate.policy ? { policy: candidate.policy } : {}),
    ...(includeParameters ? { score: candidate.score } : {}),
  };
}

function workspaceMatches(context: CommandContext, request: string, limit: number): readonly Record<string, unknown>[] {
  try {
    return listWorkspaceActions(context, { query: request, limit }).slice(0, limit);
  } catch {
    return [];
  }
}

function modeMatches(request: string, limit: number): readonly Record<string, unknown>[] {
  try {
    const result = listHarnessModes({ query: request, limit }) as { readonly modes?: readonly Record<string, unknown>[] };
    const matches = result.modes?.slice(0, limit) ?? [];
    if (matches.length > 0) return matches;
    const simplified = simplifiedModeQuery(request);
    if (!simplified || simplified === request.toLowerCase()) return [];
    const fallback = listHarnessModes({ query: simplified, limit }) as { readonly modes?: readonly Record<string, unknown>[] };
    return fallback.modes?.slice(0, limit) ?? [];
  } catch {
    return [];
  }
}

export function planAgentTaskRoute(context: CommandContext, args: AgentRoutePlannerArgs): Record<string, unknown> {
  const request = readString(args.query) || readString(args.target);
  if (!request) {
    return {
      status: 'missing_request',
      usage: 'Use route action:"plan" query:"<user task>" to get the preferred GoodVibes Agent route, alternatives, missing fields, and confirmation boundary.',
      examples: [
        'Fix the failing tests in this repo.',
        'Triage my inbox and draft replies.',
        'Run a weekly source-backed research report.',
        'Why would settings action:set need confirmation?',
      ],
      policy: 'Route planning is read-only. It never runs tools, creates jobs, sends messages, changes settings, or opens UI surfaces.',
    };
  }

  const includeParameters = args.includeParameters === true;
  const limit = readLimit(args.limit, includeParameters ? 8 : 5);
  const candidates = [...buildCandidates(request)]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((candidate) => describeCandidate(candidate, includeParameters));
  const preferred = candidates[0]!;
  const workspaceActionMatches = workspaceMatches(context, request, includeParameters ? 6 : 3);
  const modes = modeMatches(request, includeParameters ? 6 : 3);

  return {
    status: 'ready',
    request: previewHarnessText(request, includeParameters ? 220 : 120),
    preferred,
    alternatives: candidates.slice(1),
    nextAction: preferred.requiresConfirmation
      ? 'Inspect the preferred route, collect missing fields, then run the returned confirmed route only after the user explicitly asks for that effect.'
      : 'Use the preferred read-only route first; only move to a confirmed route if the returned plan asks for one and the user requested the effect.',
    workspaceMatches: workspaceActionMatches,
    harnessModeMatches: modes,
    policy: 'GoodVibes Agent routes by user outcome. Package, daemon, TUI, SDK, and host ownership are diagnostic details; the model should choose the visible route that is easiest and safest for the user.',
  };
}
