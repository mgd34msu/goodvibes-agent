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

function directScheduleLike(lower: string): boolean {
  if (hasAny(lower, ['remind me', 'reminder', 'create reminder', 'schedule reminder'])) return true;
  if (hasAny(lower, ['schedule ', 'scheduled task', 'scheduled work', 'cron'])) return true;
  return hasAny(lower, ['pause schedule', 'resume schedule', 'run schedule', 'edit schedule', 'delete schedule', 'cancel schedule', 'enable schedule', 'disable schedule']);
}

function hostDiagnosticsLike(lower: string): boolean {
  if (hasAny(lower, ['daemon health', 'daemon status', 'daemon doctor', 'host health', 'host status', 'host doctor', 'service health', 'service status', 'health check'])) return true;
  const runtimeTarget = hasAny(lower, ['daemon', 'host', 'connected host', 'service', 'control plane', 'operator api', 'goodvibes runtime']);
  const diagnosticIntent = hasAny(lower, ['health', 'status', 'doctor', 'diagnose', 'diagnostic', 'readiness', 'compat', 'compatibility']);
  return runtimeTarget && diagnosticIntent;
}

function mediaGenerationLike(lower: string): boolean {
  const generationIntent = hasAny(lower, ['generate', 'create', 'make', 'render', 'draw', 'produce']);
  if (!generationIntent) return false;
  return hasAny(lower, ['image', 'video', 'media', 'picture', 'thumbnail', 'logo', 'illustration', 'graphic', 'artwork']);
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

const EXTERNAL_MEMORY_PROVIDER_IDS = [
  'honcho',
  'openviking',
  'mem0',
  'hindsight',
  'holographic',
  'retaindb',
  'byterover',
  'supermemory',
] as const;

function externalMemoryProviderId(lower: string): string | null {
  return EXTERNAL_MEMORY_PROVIDER_IDS.find((provider) => lower.includes(provider)) ?? null;
}

function externalMemoryProviderLike(lower: string): boolean {
  if (externalMemoryProviderId(lower)) return true;
  return hasAny(lower, [
    'external memory',
    'memory provider',
    'memory backend',
    'cross-session memory',
    'memory sync',
    'memory import',
    'memory export',
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

function interactiveProcessCapabilityLike(lower: string): boolean {
  if (hasAny(lower, [
    'pty',
    'interactive cli',
    'interactive command',
    'interactive shell',
    'interactive terminal',
    'terminal input',
    'process input',
    'process write',
    'stdin',
    'send input',
    'write to process',
    'password prompt',
    'sudo',
    'sudo_password',
    'privilege escalation',
    'claude code',
    'codex cli',
  ])) return true;
  return hasAll(lower, ['terminal', 'input']);
}

function fileRecoveryLike(lower: string): boolean {
  const recoveryWord = hasAny(lower, ['undo', 'redo', 'recover', 'recovery', 'restore', 'revert', 'roll back', 'rollback']);
  if (!recoveryWord) return false;
  return hasAny(lower, ['file', 'edit', 'write', 'patch', 'diff', 'change', 'snapshot', 'workspace']);
}

function researchRunnerLike(lower: string): boolean {
  if (hasAny(lower, [
    'browser-backed research',
    'browser backed research',
    'browser-backed runner',
    'browser backed runner',
    'browser research runner',
    'research runner',
    'deep research runner',
    'live research runner',
  ])) return true;
  return lower.includes('runner readiness') && hasAny(lower, ['research', 'browser']);
}

function visualResearchReportLike(lower: string): boolean {
  return hasAny(lower, [
    'visual report',
    'visual-report',
    'visual research report',
    'research report packet',
    'visual report packet',
    'report packet',
    'browser report rendering',
    'browser/pwa report',
    'render visual report',
    'render the visual report',
    'render research report',
  ]);
}

function voiceWorkflowLike(lower: string): boolean {
  return hasAny(lower, [
    'voice workflow',
    'voice memo',
    'voice transcription',
    'transcribe voice',
    'transcribe audio',
    'push-to-talk',
    'push to talk',
    'wake word',
    'wake-word',
    'spoken response',
    'spoken responses',
    'talk to the assistant',
    'talk to agent',
  ]);
}

function ttsProviderLike(lower: string): boolean {
  return hasAny(lower, [
    'tts provider',
    'tts voice',
    'tts picker',
    'text to speech',
    'text-to-speech',
    'speech synthesis',
    'spoken provider',
    'voice provider',
  ]);
}

function browserCockpitLike(lower: string): boolean {
  return hasAny(lower, [
    'browser cockpit',
    'connected browser',
    'browser dashboard',
    'web dashboard',
    'pwa',
    'open browser dashboard',
    'open browser cockpit',
    'mobile pwa',
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

  if (hostDiagnosticsLike(lower)) {
    add({
      id: 'host-runtime-diagnostics',
      label: 'Connected host diagnostics',
      score: 97,
      userSurface: 'Start workspace diagnostics',
      userOutcome: 'Inspect daemon, host, service, and compatibility health through read-only connected-host diagnostics.',
      why: 'The request asks for daemon, host, service, health, doctor, readiness, or compatibility diagnostics.',
      modelRoute: 'host action:"status" includeParameters:true',
      inspectRoute: 'host action:"capabilities" includeParameters:true',
      userRoute: 'Agent Workspace -> Start',
      requiresConfirmation: false,
      supportingRoutes: [
        'host action:"services" includeParameters:true',
        'host action:"methods" includeParameters:true',
        'setup action:"repair" target:"host" includeParameters:true',
        'setup action:"smoke" confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Host diagnostics are read-only. Service lifecycle, setup smoke, token repair, and operator methods remain explicit confirmed routes.',
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

  if (hasAny(lower, ['setting', 'settings', 'config', 'configuration', 'preference', 'preferences']) && !hasAny(lower, ['import settings', 'tui settings', 'copy settings', 'settings import'])) {
    const writeLike = hasAny(lower, ['set ', 'change', 'update', 'configure', 'reset', 'clear', 'default', 'restore']);
    add({
      id: 'agent-settings-configuration',
      label: 'Agent settings inspection or change',
      score: 84,
      userSurface: 'Settings workspace',
      userOutcome: 'Find the right Agent-owned setting and keep every setting mutation explicit and confirmed.',
      why: 'The request mentions settings, configuration, or preferences without asking for GoodVibes TUI import.',
      modelRoute: `settings action:"list" query:${quote(request)} includeParameters:true`,
      inspectRoute: 'settings action:"list" includeParameters:true',
      userRoute: 'Agent Workspace -> Settings',
      requiresConfirmation: writeLike,
      missingFields: writeLike ? ['setting key', 'new value or reset target', 'confirmation'] : undefined,
      supportingRoutes: [
        'settings action:"get" target:"..." includeParameters:true',
        'settings action:"set" key:"..." value:... confirm:true explicitUserRequest:"..."',
        'settings action:"reset" key:"..." confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Settings search and inspection are read-only. Set/reset/import effects mutate only Agent-owned settings and require confirmation.',
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

  if (hasAny(lower, ['memory', 'remember', 'forget', 'recall', 'skill', 'routine', 'learn', 'learning']) || externalMemoryProviderLike(lower)) {
    const providerId = externalMemoryProviderId(lower);
    if (externalMemoryProviderLike(lower)) {
      const externalEffect = hasAny(lower, ['connect', 'set up', 'setup', 'configure', 'enable', 'sync', 'import', 'export', 'write', 'upsert', 'delete', 'forget']);
      add({
        id: 'external-memory-provider-posture',
        label: 'External memory provider setup posture',
        score: 92,
        userSurface: 'Local Context workspace',
        userOutcome: 'Inspect provider readiness and required daemon/SDK contracts before promising external cross-session memory.',
        why: 'The request mentions an external memory provider, backend, sync, import/export, or a named provider such as Honcho, Mem0, or Supermemory.',
        modelRoute: providerId
          ? `memory action:"provider" providerId:"${providerId}" includeParameters:true`
          : 'memory action:"status" query:"external memory provider" includeParameters:true',
        inspectRoute: providerId
          ? `host action:"capability" query:"${providerId} memory provider"`
          : 'memory action:"status" query:"external memory provider" includeParameters:true',
        userRoute: 'Agent Workspace -> Local Context',
        requiresConfirmation: externalEffect,
        missingFields: [
          ...(providerId ? [] : ['provider id or backend name']),
          'published setup/status/read/write/receipt contract before external memory is considered ready',
          ...(externalEffect ? ['confirmation for any provider write, sync, import, export, or credential effect'] : []),
        ],
        supportingRoutes: [
          'memory action:"status" query:"external memory provider" includeParameters:true',
          'memory action:"provider" providerId:"honcho|mem0|supermemory" includeParameters:true',
          'host action:"capability" query:"memory provider"',
          'agent_harness mode:"mcp_servers" query:"memory provider"',
          'settings action:"list" query:"memory" includeHidden:true',
        ],
        policy: 'External memory posture is read-only. Agent-local memory remains the active path until GoodVibes publishes provider setup/status/read/write/sync contracts with secret-safe receipts.',
      });
    }

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

  if ((researchRunnerLike(lower) || visualResearchReportLike(lower) || hasAny(lower, ['research', 'deep research', 'investigate', 'sources', 'citations', 'citation', 'source-backed', 'market map', 'literature', 'report'])) && !scheduleLike(lower)) {
    if (researchRunnerLike(lower)) {
      const runnerEffect = hasAny(lower, ['start ', 'start the', 'launch ', 'execute ', 'run ', 'run a ', 'run the ', 'open ']);
      add({
        id: 'research-browser-runner-readiness',
        label: 'Browser-backed research runner readiness',
        score: 96,
        userSurface: 'Research workspace',
        userOutcome: 'Check browser-backed research readiness and fallback routes before pretending live browser research can run.',
        why: 'The request mentions a browser-backed research runner or runner readiness.',
        modelRoute: `research action:"runner" query:${quote(request)} includeParameters:true`,
        inspectRoute: 'research action:"runner" includeParameters:true',
        userRoute: 'Agent Workspace -> Research -> Browser runner readiness',
        requiresConfirmation: runnerEffect,
        missingFields: runnerEffect
          ? ['visible research run id or research question', 'published browser-runner ready state', 'confirmation before any live browser execution']
          : undefined,
        supportingRoutes: [
          `research action:"plan" query:${quote(request)} includeParameters:true`,
          'research action:"runs" includeParameters:true',
          'computer action:"browser" includeParameters:true',
          'computer action:"setup" query:"browser research runner" includeParameters:true',
        ],
        policy: 'Browser-runner readiness is read-only. Live browser-backed execution remains unavailable until the runner contract reports ready and the user confirms a scoped visible run.',
      });
    }

    if (visualResearchReportLike(lower)) {
      const renderEffect = hasAny(lower, ['render', 'open ', 'show ', 'save', 'export', 'share', 'publish']);
      add({
        id: 'research-visual-report-workflow',
        label: 'Visual research report workflow',
        score: 95,
        userSurface: 'Research workspace',
        userOutcome: 'Route visual report requests through reviewed source/report artifacts and expose browser-rendering gaps honestly.',
        why: 'The request mentions visual report packets, report rendering, or a browser/PWA research report view.',
        modelRoute: `research action:"plan" query:${quote(request)} includeParameters:true`,
        inspectRoute: 'research action:"reports" query:"visual report" includeParameters:true',
        userRoute: 'Agent Workspace -> Research -> Report artifacts',
        requiresConfirmation: renderEffect,
        missingFields: [
          'reviewed source bundle or saved report artifact id',
          ...(hasAny(lower, ['browser', 'pwa', 'render']) ? ['published browser/PWA report-rendering route before live browser rendering is considered ready'] : []),
          ...(renderEffect ? ['confirmation before report save, export, share, publish, or visible browser handoff'] : []),
        ],
        supportingRoutes: [
          'research action:"reports" query:"visual report"',
          `research action:"plan" query:${quote(request)} includeParameters:true`,
          'research action:"report" question:"..." sources:[...] visualReport:true requireCitationCoverage:true confirm:true explicitUserRequest:"..."',
          'agent_artifacts action:"show" artifactId:"..." includeContent:true',
          'workspace action:"action" actionId:"research-report-artifacts" includeParameters:true',
        ],
        policy: 'Visual report planning is read-only. Markdown visual-report packets can be saved after confirmation; browser/PWA rendering is not claimed until a connected-host route publishes concrete readiness evidence.',
      });
    }

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

  if (directScheduleLike(lower)) {
    const reminder = hasAny(lower, ['remind', 'reminder']);
    const lifecycle = hasAny(lower, ['pause', 'resume', 'run schedule', 'edit', 'delete', 'cancel', 'enable', 'disable']);
    add({
      id: 'direct-schedule-route',
      label: reminder ? 'Reminder scheduling route' : 'Schedule management route',
      score: 98,
      userSurface: 'Work and schedules workspace',
      userOutcome: 'Create, inspect, edit, or control schedules through the first-class schedule tool with confirmation boundaries.',
      why: 'The request directly mentions reminders, schedules, cron, or schedule lifecycle controls.',
      modelRoute: `schedule action:"list" query:${quote(request)} limit:5`,
      inspectRoute: 'schedule action:"list"',
      userRoute: 'Agent Workspace -> Work & Approvals',
      requiresConfirmation: reminder || lifecycle || hasAny(lower, ['create', 'schedule ', 'cron']),
      missingFields: reminder
        ? ['reminder message', 'time or cadence', 'confirmation']
        : lifecycle
          ? ['schedule id', 'exact lifecycle action', 'confirmation']
          : ['task', 'time/cadence', 'success criteria for autonomous work', 'confirmation'],
      supportingRoutes: [
        'schedule action:"remind" message:"..." scheduleKind:"at|every|cron" scheduleValue:"..." confirm:true explicitUserRequest:"..."',
        'schedule action:"create" task:"..." successCriteria:"..." scheduleKind:"at|every|cron" scheduleValue:"..." confirm:true explicitUserRequest:"..."',
        'schedule action:"edit|run|pause|resume|delete" scheduleId:"..." confirm:true explicitUserRequest:"..."',
        'autonomy action:"queue"',
      ],
      policy: 'Schedule listing is read-only. Reminder creation, autonomous schedule creation, edits, and lifecycle controls require exact fields plus confirmation.',
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

  if (fileRecoveryLike(lower)) {
    add({
      id: 'local-file-recovery',
      label: 'Local file edit recovery',
      score: 98,
      userSurface: 'Safety and recovery workspace',
      userOutcome: 'Inspect recent Agent file snapshots and apply exactly one confirmed undo or redo when needed.',
      why: 'The request mentions undo, redo, restore, revert, or recovery for file/edit/write/patch changes.',
      modelRoute: 'execution action:"recovery" includeParameters:true',
      inspectRoute: 'execution action:"history" includeParameters:true',
      userRoute: 'Agent Workspace -> Safety & Recovery',
      requiresConfirmation: hasAny(lower, ['undo', 'redo', 'restore', 'revert', 'roll back', 'rollback']),
      missingFields: ['recovery action when not obvious', 'snapshot target if multiple snapshots are available', 'confirmation before applying undo/redo'],
      supportingRoutes: [
        'execution action:"record" target:"..."',
        'agent_harness mode:"file_recovery" includeParameters:true',
        'agent_harness mode:"run_file_recovery" recoveryAction:"undo|redo" confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Recovery inspection is read-only. Applying an undo or redo snapshot is a single confirmed local file mutation with before/after state tracked by FileUndoManager.',
    });
  }

  if (interactiveProcessCapabilityLike(lower)) {
    const interactiveEffect = hasAny(lower, ['run ', 'start ', 'launch ', 'execute ', 'write ', 'send input', 'type ', 'sudo ']);
    add({
      id: 'interactive-process-capability',
      label: 'Interactive process, PTY, stdin, or sudo capability',
      score: 100,
      userSurface: 'Work and process supervision workspace',
      userOutcome: 'Check whether interactive CLI, stdin, PTY, or sudo mediation is safely available before starting hidden work.',
      why: 'The request mentions interactive terminal behavior, PTY, stdin/process input, sudo, or privilege prompts.',
      modelRoute: 'execution action:"process_capabilities"',
      inspectRoute: 'setup action:"item" setupItemId:"sudo-execution-posture"',
      userRoute: 'Agent Workspace -> Work & Approvals',
      requiresConfirmation: interactiveEffect,
      missingFields: interactiveEffect
        ? ['exact command or process id', 'whether foreground supervision is acceptable', 'confirmation before any start/write/credential effect']
        : undefined,
      supportingRoutes: [
        'process action:"capabilities"',
        'execution action:"processes" includeParameters:true',
        'setup action:"item" setupItemId:"sudo-execution-posture"',
        'terminal command:"..." background:true pty:true confirm:true explicitUserRequest:"..."',
        'process action:"write" processId:"..." data:"..." confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Capability inspection is read-only. PTY and sudo stay blocked unless the SDK/daemon publishes typed interactive and credential contracts; stdin writes require a discovered safe ProcessManager method plus confirmation.',
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

  if (mediaGenerationLike(lower)) {
    add({
      id: 'media-generation-artifact',
      label: 'Confirmed media artifact generation',
      score: 94,
      userSurface: 'Voice & Media workspace',
      userOutcome: 'Generate image or video only as a confirmed saved artifact with provider readiness visible first.',
      why: 'The request asks to generate, create, render, or draw image/video/media output.',
      modelRoute: 'device action:"provider" target:"media" includeParameters:true',
      inspectRoute: 'agent_harness mode:"media_posture" includeParameters:true',
      userRoute: 'Agent Workspace -> Voice & Media',
      requiresConfirmation: true,
      missingFields: ['media prompt', 'provider/model if the default is not acceptable', 'confirmation'],
      supportingRoutes: [
        `agent_media_generate prompt:${quote(request)} confirm:true explicitUserRequest:${quote(request)}`,
        'agent_artifacts mode:"list" query:"generated media"',
        'agent_knowledge_ingest sourceKind:"artifact" artifactId:"..." confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Media generation requires an explicit user request and confirmation. Generated bytes are saved as artifacts, not printed inline or silently ingested into Knowledge.',
    });
  }

  if (voiceWorkflowLike(lower) && !ttsProviderLike(lower)) {
    const voiceEffect = hasAny(lower, ['record', 'transcribe', 'start ', 'set up', 'setup', 'enable', 'speak', 'capture', 'open ']);
    add({
      id: 'voice-workflow-posture',
      label: 'Voice interaction workflow posture',
      score: 93,
      userSurface: 'Voice & Media workspace',
      userOutcome: 'Inspect push-to-talk, transcription, spoken-response, and wake-word posture before any voice capture or playback effect.',
      why: 'The request mentions voice workflows, voice memo transcription, push-to-talk, spoken responses, or wake-word capture.',
      modelRoute: `device action:"voice" query:${quote(request)} includeParameters:true`,
      inspectRoute: 'device action:"voice" includeParameters:true',
      userRoute: 'Agent Workspace -> Voice & Media -> Voice workflows',
      requiresConfirmation: voiceEffect,
      missingFields: voiceEffect
        ? ['voice workflow id or audio source', 'selected provider when needed', 'confirmation before capture, transcription, playback, or visible picker handoff']
        : undefined,
      supportingRoutes: [
        'device action:"provider" target:"voice" includeParameters:true',
        'device action:"open_tts_provider" confirm:true explicitUserRequest:"..."',
        'device action:"open_tts_voice" providerId:"..." confirm:true explicitUserRequest:"..."',
        'setup action:"item" setupItemId:"voice-workflows"',
      ],
      policy: 'Voice workflow inspection is read-only. Voice capture, transcription, spoken output, provider picker opens, and wake-word behavior stay unavailable or confirmed until published contracts prove readiness.',
    });
  }

  if (ttsProviderLike(lower)) {
    const openPicker = hasAny(lower, ['open', 'picker', 'choose', 'select', 'change', 'set ']);
    add({
      id: 'tts-provider-posture',
      label: 'TTS provider and voice setup posture',
      score: 92,
      userSurface: 'Voice & Media workspace',
      userOutcome: 'Inspect TTS provider and voice readiness before opening a picker or changing spoken-response settings.',
      why: 'The request mentions TTS, text-to-speech, speech synthesis, voice provider, or TTS voice selection.',
      modelRoute: 'device action:"provider" target:"tts" includeParameters:true',
      inspectRoute: 'device action:"voice" includeParameters:true',
      userRoute: 'Agent Workspace -> Voice & Media -> TTS setup',
      requiresConfirmation: openPicker,
      missingFields: openPicker ? ['provider or voice target when known', 'confirmation before visible picker handoff or setting change'] : undefined,
      supportingRoutes: [
        'device action:"open_tts_provider" confirm:true explicitUserRequest:"..."',
        'device action:"open_tts_voice" providerId:"..." confirm:true explicitUserRequest:"..."',
        'settings action:"list" query:"tts voice" includeParameters:true',
      ],
      policy: 'TTS inspection is read-only. Opening provider/voice pickers or changing spoken-response settings requires explicit confirmation.',
    });
  }

  if (browserCockpitLike(lower)) {
    const openCockpit = hasAny(lower, ['open', 'launch', 'show']);
    add({
      id: 'browser-cockpit-readiness',
      label: 'Connected browser cockpit/PWA readiness',
      score: 93,
      userSurface: 'Connected browser cockpit',
      userOutcome: 'Inspect the configured browser/PWA cockpit and setup routes before opening an external browser.',
      why: 'The request mentions the browser cockpit, PWA, web dashboard, or browser dashboard.',
      modelRoute: 'computer action:"browser" includeParameters:true',
      inspectRoute: 'workspace action:"surface" surfaceId:"connected-browser-cockpit" includeParameters:true',
      userRoute: 'Agent Workspace -> Home -> Browser cockpit',
      requiresConfirmation: openCockpit,
      missingFields: openCockpit ? ['confirmation before opening the external browser/PWA handoff'] : undefined,
      supportingRoutes: [
        'computer action:"open_browser" confirm:true explicitUserRequest:"..."',
        'workspace action:"open" surfaceId:"connected-browser-cockpit" confirm:true explicitUserRequest:"..."',
        'host action:"services" query:"web" includeParameters:true',
      ],
      policy: 'Browser/PWA readiness is read-only. Opening the connected browser cockpit is a visible confirmed handoff; browser-native Agent workspace receipts remain unpublished until the connected host provides them.',
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
