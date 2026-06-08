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

type PersonalOpsLaneId = 'inbox' | 'calendar' | 'notes' | 'tasks' | 'reminders' | 'routines' | 'delivery';

function personalOpsLike(lower: string): boolean {
  return hasAny(lower, [
    'personal ops',
    'daily brief',
    'daily briefing',
    'morning brief',
    'morning briefing',
    'inbox',
    'email',
    'gmail',
    'imap',
    'smtp',
    'calendar',
    'caldav',
    'agenda',
    'rsvp',
    'draft reply',
    'reply to',
    'tasks',
    'todo',
    'to-do',
    'note',
    'routine',
    'review queue',
    'saved review',
  ]);
}

function personalOpsLaneFromText(lower: string): PersonalOpsLaneId | null {
  if (hasAny(lower, ['inbox', 'email', 'mail', 'gmail', 'imap', 'smtp', 'message', 'thread', 'draft reply', 'reply to'])) return 'inbox';
  if (hasAny(lower, ['calendar', 'caldav', 'agenda', 'meeting', 'event', 'availability', 'freebusy', 'free busy', 'rsvp'])) return 'calendar';
  if (hasAny(lower, ['note', 'scratchpad', 'jot down'])) return 'notes';
  if (hasAny(lower, ['task', 'tasks', 'todo', 'to-do', 'work item', 'work plan'])) return 'tasks';
  if (hasAny(lower, ['reminder', 'reminders', 'follow up', 'follow-up', 'ping me'])) return 'reminders';
  if (hasAny(lower, ['routine', 'checklist', 'repeatable'])) return 'routines';
  if (hasAny(lower, ['delivery', 'deliver', 'send summary', 'send briefing'])) return 'delivery';
  return null;
}

function personalOpsBriefingLike(lower: string): boolean {
  if (hasAny(lower, ['daily brief', 'daily briefing', 'morning brief', 'morning briefing', 'brief me', 'brief my', 'briefing'])) return true;
  return hasAny(lower, ['what is on my calendar', "what's on my calendar", 'today agenda', "today's agenda", 'agenda today']);
}

function personalOpsQueueLike(lower: string): boolean {
  return hasAny(lower, [
    'review queue',
    'saved review',
    'saved inbox',
    'saved calendar',
    'saved thread',
    'saved event',
    'queued inbox',
    'queued calendar',
  ]);
}

function personalOpsConnectorSetupLike(lower: string): boolean {
  const connector = hasAny(lower, ['gmail', 'imap', 'smtp', 'email connector', 'mail connector', 'calendar connector', 'caldav', 'mcp connector']);
  const setup = hasAny(lower, ['set up', 'setup', 'connect', 'configure', 'enable', 'repair', 'provider']);
  return connector && setup;
}

function personalOpsFreshReadLike(lower: string): boolean {
  return hasAny(lower, [
    'read live',
    'refresh',
    'fresh read',
    'fetch',
    'sync',
    'pull latest',
    'latest email',
    'new email',
    'unread',
    'upcoming event',
    'upcoming meeting',
    'calendar today',
    'today calendar',
  ]);
}

function personalOpsMutationLike(lower: string): boolean {
  return hasAny(lower, ['send', 'reply', 'archive', 'label', 'edit', 'rsvp', 'delete', 'move', 'create event', 'reschedule']);
}

function externalChannelLike(lower: string): boolean {
  return hasAny(lower, ['slack', 'discord', 'telegram', 'whatsapp', 'signal', 'matrix', 'teams', 'ntfy', 'webhook', 'notification', 'notify', 'send message', 'channel', 'delivery receipt']);
}

function channelTargetFromText(lower: string): string | null {
  return ['slack', 'discord', 'telegram', 'whatsapp', 'signal', 'matrix', 'teams', 'ntfy', 'webhook'].find((target) => lower.includes(target)) ?? null;
}

function channelSetupLike(lower: string): boolean {
  return hasAny(lower, ['set up', 'setup', 'connect', 'configure', 'enable', 'repair']) && externalChannelLike(lower);
}

function channelTriageLike(lower: string): boolean {
  return hasAny(lower, ['triage', 'blocker', 'blockers', 'retry', 'retries', 'failed', 'failure', 'error', 'pending message', 'pending delivery', 'doctor']) && externalChannelLike(lower);
}

function channelDeliveriesLike(lower: string): boolean {
  return hasAny(lower, ['delivery receipt', 'delivery receipts', 'delivery history', 'send history', 'sent messages', 'send outcomes', 'recent deliveries']);
}

function channelSendLike(lower: string): boolean {
  return hasAny(lower, ['send', 'notify', 'deliver', 'test send', 'test notification', 'ping']);
}

const MODEL_PROVIDER_IDS = [
  'openrouter',
  'openai',
  'anthropic',
  'claude',
  'ollama',
  'llama.cpp',
  'llamacpp',
  'vllm',
  'lm studio',
] as const;

function modelProviderId(lower: string): string | null {
  const provider = MODEL_PROVIDER_IDS.find((candidate) => lower.includes(candidate));
  if (!provider) return null;
  if (provider === 'llama.cpp' || provider === 'llamacpp') return 'llama.cpp';
  if (provider === 'lm studio') return 'lm-studio';
  return provider;
}

function localModelLike(lower: string): boolean {
  return hasAny(lower, [
    'local model',
    'local server',
    'local endpoint',
    'local ai',
    'ollama',
    'llama.cpp',
    'llamacpp',
    'vllm',
    'lm studio',
    'cookbook',
    'model recipe',
    'hardware fit',
    'serve model',
    'download model',
  ]);
}

function localModelSmokeLike(lower: string): boolean {
  return hasAny(lower, [
    'local model smoke',
    'model smoke',
    'check local model',
    'check local servers',
    'local server health',
    'server health',
    'model-list smoke',
    'test ollama',
    'smoke ollama',
  ]);
}

function providerAccountLike(lower: string): boolean {
  return hasAny(lower, [
    'provider account',
    'provider auth',
    'subscription',
    'api key',
    'apikey',
    'openrouter',
    'openai',
    'anthropic',
    'claude',
    'login',
    'billing',
  ]);
}

function modelRouteReadinessLike(lower: string): boolean {
  return hasAny(lower, [
    'model route',
    'route readiness',
    'best model',
    'choose model',
    'pick model',
    'compare route',
    'context window',
    'long context',
    'tool support',
    'vision model',
    'latency',
    'model cost',
    'privacy',
  ]);
}

function securityPermissionLike(lower: string): boolean {
  return hasAny(lower, [
    'security',
    'permission',
    'permissions',
    'policy',
    'policies',
    'approval',
    'approvals',
    'approve',
    'approved',
    'deny',
    'denied',
    'blocked',
    'allowed',
    'confirmation',
    'requires confirmation',
    'guardrail',
    'safety',
    'risky action',
    'unsafe action',
  ]);
}

function securityStatusLike(lower: string): boolean {
  if (hasAny(lower, [
    'security status',
    'security posture',
    'permission status',
    'permissions status',
    'current permissions',
    'active permissions',
    'permission mode',
    'approval mode',
    'approval settings',
    'tool permissions',
    'security dashboard',
    'safety status',
    'current policy',
    'policy status',
    'policy settings',
  ])) return true;
  return hasAny(lower, ['show', 'list', 'what are', 'what is', 'which']) && hasAny(lower, ['permissions', 'approvals', 'policy', 'allowed tools']);
}

function securityFindingLike(lower: string): boolean {
  const finding = hasAny(lower, [
    'finding',
    'findings',
    'incident',
    'security issue',
    'vulnerability',
    'leaked secret',
    'secret leak',
    'exposed token',
    'exposed secret',
    'mcp trust',
    'quarantine',
  ]);
  if (!finding) return false;
  return hasAny(lower, ['security', 'policy', 'permission', 'mcp', 'secret', 'token', 'incident', 'vulnerability', 'finding']);
}

function securityPolicyExplainLike(lower: string): boolean {
  if (hasAny(lower, [
    'why denied',
    'why was denied',
    'why blocked',
    'why was blocked',
    'why allowed',
    'why did you block',
    'why would',
    'why does',
    'explain policy',
    'explain permission',
    'explain approval',
    'explain confirmation',
    'need confirmation',
    'needs confirmation',
    'requires confirmation',
    'would be blocked',
    'will be blocked',
    'risky action',
    'unsafe action',
    'can you run',
    'can you use',
    'am i allowed',
  ])) return true;
  return hasAny(lower, ['blocked', 'denied', 'allowed', 'approval', 'confirmation']) && hasAny(lower, ['tool', 'action', 'route', 'command', 'call', 'execute', 'run', 'write', 'send', 'setting']);
}

function securityPolicyToolTarget(lower: string): string | null {
  if (lower.includes('agent_harness')) return 'agent_harness';
  if (lower.includes('settings action') || lower.includes('setting')) return 'settings';
  if (lower.includes('terminal')) return 'terminal';
  if (lower.includes('process')) return 'process';
  if (lower.includes('exec')) return 'exec';
  if (lower.includes('channel')) return 'channels';
  if (lower.includes('schedule')) return 'schedule';
  if (lower.includes('personal_ops') || lower.includes('personal ops')) return 'personal_ops';
  if (lower.includes('model')) return 'models';
  if (lower.includes('memory')) return 'memory';
  if (lower.includes('computer') || lower.includes('browser') || lower.includes('screenshot')) return 'computer';
  if (lower.includes('device') || lower.includes('voice') || lower.includes('tts')) return 'device';
  if (lower.includes('workspace')) return 'workspace';
  if (lower.includes('host') || lower.includes('daemon')) return 'host';
  if (lower.includes('command')) return 'terminal';
  return null;
}

function supportBundleLike(lower: string): boolean {
  if (hasAny(lower, ['support bundle', 'support packet', 'diagnostic bundle', 'diagnostics bundle', 'forensic bundle', 'forensics bundle'])) return true;
  return lower.includes('bundle') && hasAny(lower, ['support', 'diagnostic', 'diagnostics', 'forensic', 'forensics', 'auth', 'trust', 'subscription', 'security']);
}

function supportBundleEffectLike(lower: string): boolean {
  return hasAny(lower, ['export', 'import', 'create', 'generate', 'save', 'write', 'share', 'attach', 'send']);
}

function sessionWorkspaceLike(lower: string): boolean {
  if (hasAny(lower, [
    'saved session',
    'saved sessions',
    'session search',
    'search sessions',
    'session export',
    'export session',
    'session resume',
    'resume session',
    'session load',
    'load session',
    'session save',
    'save session',
    'session delete',
    'delete session',
    'session rename',
    'rename session',
    'session fork',
    'fork session',
    'session graph',
    'session bookmark',
    'bookmarked session',
    'bookmarks',
    'conversation restore',
    'restore conversation',
    'previous conversation',
    'past conversation',
    'transcript export',
    'export transcript',
    'return context',
    'session continuity',
  ])) return true;
  return lower.includes('session') && hasAny(lower, ['browse', 'find', 'search', 'show', 'inspect', 'resume', 'load', 'save', 'export', 'delete', 'rename', 'fork', 'bookmark']);
}

function sessionMutationLike(lower: string): boolean {
  if (hasAny(lower, ['resume', 'load', 'rename', 'fork', 'delete', 'remove', 'restore', 'export', 'unbookmark'])) return true;
  return hasAny(lower, ['save session', 'session save', 'bookmark session', 'session bookmark']);
}

function releaseAuditLike(lower: string): boolean {
  return hasAny(lower, [
    'release evidence',
    'release artifact',
    'release artifacts',
    'release readiness',
    'release quality',
    'readiness inventory',
    'release inventory',
    'release gate',
    'release gates',
    'verification ledger',
    'operator audit',
    'audit evidence',
    'audit artifact',
    'audit artifacts',
    'package evidence',
  ]);
}

function releaseEvidenceLike(lower: string): boolean {
  return hasAny(lower, ['release evidence', 'release artifact', 'release artifacts', 'audit evidence', 'audit artifact', 'audit artifacts', 'verification ledger', 'package evidence']);
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

  if (hasAny(lower, ['model', 'provider', 'openrouter', 'openai', 'anthropic', 'claude', 'subscription', 'local model', 'ollama', 'llama.cpp', 'llamacpp', 'vllm', 'context window', 'api key', 'local server', 'cookbook'])) {
    const providerId = modelProviderId(lower);

    if (localModelSmokeLike(lower)) {
      add({
        id: 'local-model-smoke-check',
        label: 'Local model server smoke check',
        score: 98,
        userSurface: 'Model Routing workspace',
        userOutcome: 'Check local model endpoints only through the confirmed smoke route with clear success criteria.',
        why: 'The request asks to check, smoke, or verify local model server health.',
        modelRoute: `models action:"smoke" query:${quote(request)} includeParameters:true`,
        inspectRoute: 'models action:"local" query:"local server health" includeParameters:true',
        userRoute: 'Agent Workspace -> Model Routing -> Check local servers',
        requiresConfirmation: true,
        missingFields: ['local endpoint or route id when multiple candidates exist', 'timeout when not default', 'confirmation before probing local servers'],
        supportingRoutes: [
          `models action:"local" query:${quote(request)} includeParameters:true`,
          'models action:"route" target:"local" includeParameters:true',
          'setup action:"item" setupItemId:"local-model-readiness"',
        ],
        policy: 'Local model discovery is read-only. Smoke checks may contact local endpoints and require confirm:true plus explicitUserRequest.',
      });
    }

    if (localModelLike(lower)) {
      const localEffect = hasAny(lower, ['download', 'install', 'start', 'serve', 'run ', 'set up', 'setup']);
      add({
        id: 'local-model-cookbook-route',
        label: 'Local model cookbook and endpoint readiness',
        score: localModelSmokeLike(lower) ? 94 : 96,
        userSurface: 'Model Routing workspace',
        userOutcome: 'Recommend local model recipes and inspect endpoint readiness before setup or smoke effects.',
        why: 'The request mentions local models, Ollama, llama.cpp, vLLM, LM Studio, cookbook recipes, or hardware fit.',
        modelRoute: `models action:"local" query:${quote(request)} includeParameters:true`,
        inspectRoute: 'models action:"status" query:"local" includeParameters:true',
        userRoute: 'Agent Workspace -> Model Routing -> Local cookbook',
        requiresConfirmation: localEffect,
        missingFields: localEffect ? ['selected recipe or endpoint', 'install/start/smoke intent', 'confirmation before local setup or server probing'] : undefined,
        supportingRoutes: [
          'models action:"route" target:"local" includeParameters:true',
          'models action:"smoke" query:"local" confirm:true explicitUserRequest:"..."',
          'agent_model_compare mode:"compare" confirm:true explicitUserRequest:"..."',
        ],
        policy: 'Cookbook and endpoint readiness are read-only. Downloads, server starts, benchmark runs, route updates, and local smoke checks remain separate confirmed effects.',
      });
    }

    if (providerAccountLike(lower) && !localModelLike(lower)) {
      const providerEffect = hasAny(lower, ['connect', 'set up', 'setup', 'configure', 'add', 'login', 'sign in', 'api key', 'key', 'change', 'refresh']);
      add({
        id: 'model-provider-account-posture',
        label: 'Model provider account and subscription posture',
        score: 96,
        userSurface: 'Model Routing workspace',
        userOutcome: 'Inspect provider account, subscription, and auth readiness before changing credentials or model routes.',
        why: 'The request mentions model providers, subscriptions, provider auth, or API keys.',
        modelRoute: providerId
          ? `models action:"provider" providerId:"${providerId}" includeParameters:true`
          : `models action:"providers" query:${quote(request)} includeParameters:true`,
        inspectRoute: 'models action:"providers" includeParameters:true',
        userRoute: 'Agent Workspace -> Model Routing -> Providers',
        requiresConfirmation: providerEffect,
        missingFields: providerEffect ? ['provider id', 'credential or subscription setup route', 'confirmation before storing credentials or changing routes'] : undefined,
        supportingRoutes: [
          'settings action:"list" query:"provider model api key" includeHidden:true',
          'models action:"status" includeParameters:true',
          'models action:"route" target:"default" includeParameters:true',
        ],
        policy: 'Provider inspection is read-only. Credential storage, provider refreshes, and route changes stay on explicit confirmed settings or model-route effects.',
      });
    }

    if (modelRouteReadinessLike(lower)) {
      add({
        id: 'model-route-readiness',
        label: 'Model route fit and readiness',
        score: 94,
        userSurface: 'Model Routing workspace',
        userOutcome: 'Inspect the best model route for context, tools, vision, cost, latency, and privacy before changing defaults.',
        why: 'The request asks to choose, compare, or inspect model route fit.',
        modelRoute: `models action:"route" query:${quote(request)} includeParameters:true`,
        inspectRoute: 'models action:"status" includeParameters:true',
        userRoute: 'Agent Workspace -> Model Routing -> Route readiness',
        requiresConfirmation: hasAny(lower, ['change', 'switch', 'set default', 'apply', 'use ']),
        missingFields: hasAny(lower, ['change', 'switch', 'set default', 'apply'])
          ? ['selected model route id', 'confirmation before route change']
          : undefined,
        supportingRoutes: [
          'models action:"status" includeParameters:true',
          'models action:"providers" includeParameters:true',
          'agent_model_compare mode:"compare" confirm:true explicitUserRequest:"..."',
        ],
        policy: 'Route inspection is read-only. Model comparisons and winner/default-route changes are separate confirmed routes with saved evidence.',
      });
    }

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

  if (personalOpsLike(lower) && !externalChannelLike(lower) && !directScheduleLike(lower)) {
    const laneId = personalOpsLaneFromText(lower);
    const laneRoute = laneId ? `personal_ops action:"lane" laneId:"${laneId}" includeParameters:true` : 'personal_ops action:"status" includeParameters:true';
    const laneQueueQuery = laneId ? ` query:"${laneId}"` : '';
    const intakeRoute = `personal_ops action:"intake" query:${quote(request)} includeParameters:true`;

    if (personalOpsConnectorSetupLike(lower)) {
      const connectorEffect = hasAny(lower, ['connect', 'set up', 'setup', 'configure', 'enable', 'repair']);
      add({
        id: 'personal-ops-connector-setup',
        label: 'Personal Ops connector setup posture',
        score: 97,
        userSurface: 'Personal Ops workspace',
        userOutcome: 'Inspect the inbox or calendar connector lane before promising fresh provider data.',
        why: 'The request mentions Gmail, IMAP/SMTP, CalDAV, or an email/calendar connector setup task.',
        modelRoute: laneRoute,
        inspectRoute: 'personal_ops action:"status" includeParameters:true',
        userRoute: 'Agent Workspace -> Personal Ops -> Connector readiness',
        requiresConfirmation: connectorEffect,
        missingFields: connectorEffect ? ['connector/provider choice', 'credential or MCP setup route', 'confirmation before any account or secret mutation'] : undefined,
        supportingRoutes: [
          intakeRoute,
          'agent_harness mode:"mcp_servers" query:"email calendar" includeParameters:true',
          'settings action:"list" query:"gmail imap smtp caldav" includeHidden:true',
        ],
        policy: 'Connector setup posture is read-only. Account connection, secret storage, MCP trust, and provider effects remain on explicit confirmed setup routes.',
      });
    }

    if (personalOpsBriefingLike(lower)) {
      add({
        id: 'personal-ops-daily-briefing',
        label: 'Personal Ops daily briefing',
        score: 96,
        userSurface: 'Personal Ops workspace',
        userOutcome: 'Start with one read-only daily plan across agenda, inbox, tasks, reminders, routines, delivery, and autonomy.',
        why: 'The request asks for a brief, briefing, agenda summary, or today view.',
        modelRoute: `personal_ops action:"briefing" query:${quote(request)} includeParameters:true`,
        inspectRoute: 'personal_ops action:"status" includeParameters:true',
        userRoute: 'Agent Workspace -> Personal Ops -> Daily briefing',
        requiresConfirmation: false,
        supportingRoutes: [
          'personal_ops action:"queue" includeParameters:true',
          'personal_ops action:"lane" laneId:"calendar" includeParameters:true',
          'autonomy action:"queue"',
          'schedule action:"list" limit:5',
        ],
        policy: 'Briefing is read-only. Live inbox/calendar reads, reminder creation, sends, edits, and schedule mutations stay on their owning confirmed routes.',
      });
    }

    if (personalOpsQueueLike(lower)) {
      add({
        id: 'personal-ops-review-queue',
        label: 'Personal Ops saved review queue',
        score: 96,
        userSurface: 'Personal Ops workspace',
        userOutcome: 'Review saved inbox threads and calendar events before doing fresh reads or provider effects.',
        why: 'The request asks for saved Personal Ops review queues or previously captured inbox/calendar cards.',
        modelRoute: `personal_ops action:"queue"${laneQueueQuery} includeParameters:true`,
        inspectRoute: laneRoute,
        userRoute: 'Agent Workspace -> Personal Ops -> Review queue',
        requiresConfirmation: false,
        supportingRoutes: [
          intakeRoute,
          'personal_ops action:"read" laneId:"inbox|calendar" recordId:"..." fields:{...} confirm:true explicitUserRequest:"..."',
          'agent_artifacts mode:"list" query:"personal ops review"',
        ],
        policy: 'Review queue inspection is read-only. Refreshing from a provider or applying send/edit/archive/RSVP effects requires a selected connector route and confirmation.',
      });
    }

    if (personalOpsFreshReadLike(lower)) {
      add({
        id: 'personal-ops-fresh-read-plan',
        label: 'Personal Ops fresh provider read plan',
        score: 95,
        userSurface: 'Personal Ops workspace',
        userOutcome: 'Select the safest read-only connector operation before fetching fresh inbox or calendar data.',
        why: 'The request asks to refresh, sync, fetch, or inspect unread/upcoming personal provider data.',
        modelRoute: intakeRoute,
        inspectRoute: laneRoute,
        userRoute: 'Agent Workspace -> Personal Ops -> Fresh read',
        requiresConfirmation: true,
        missingFields: ['lane id', 'read-only connector operation record id', 'bounded input fields', 'confirmation before reading live personal provider data'],
        supportingRoutes: [
          laneRoute,
          'personal_ops action:"read" laneId:"inbox|calendar" recordId:"..." fields:{...} confirm:true explicitUserRequest:"..."',
          'personal_ops action:"queue" includeParameters:true',
        ],
        policy: 'Fresh provider reads are never implicit. The planner only selects the lane; one read-only connector operation still needs exact fields, confirm:true, and explicitUserRequest.',
      });
    }

    add({
      id: 'personal-ops-intake-route',
      label: 'Personal Ops request intake',
      score: hasAny(lower, ['email', 'inbox', 'calendar', 'agenda', 'draft reply', 'rsvp']) ? 94 : 78,
      userSurface: 'Personal Ops workspace',
      userOutcome: 'Triage personal data through reviewed lanes, redacted cards, and confirmed external effects.',
      why: 'The request involves inbox, email, calendar, notes, tasks, reminders, or reply drafting.',
      modelRoute: intakeRoute,
      inspectRoute: laneRoute,
      userRoute: 'Agent Workspace -> Personal Ops',
      requiresConfirmation: personalOpsFreshReadLike(lower) || personalOpsMutationLike(lower),
      missingFields: personalOpsMutationLike(lower)
        ? ['connector lane and record id', 'exact provider effect', 'confirmation']
        : undefined,
      supportingRoutes: [
        'personal_ops action:"briefing" includeParameters:true',
        'personal_ops action:"queue" includeParameters:true',
        laneRoute,
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

  if (externalChannelLike(lower)) {
    const target = channelTargetFromText(lower);
    const setup = channelSetupLike(lower);
    const triage = channelTriageLike(lower);
    const deliveries = channelDeliveriesLike(lower);
    const send = channelSendLike(lower);
    const setupEffect = setup;
    const sendEffect = send && !setup && !triage && !deliveries;
    const channelRoute = target
      ? `channels action:"channel" target:"${target}" includeParameters:true`
      : `channels action:"status" query:${quote(request)} includeParameters:true`;
    const setupRoute = target
      ? `channels action:"setup" target:"${target}" includeParameters:true`
      : 'channels action:"setup" includeParameters:true';
    const modelRoute = deliveries
      ? 'channels action:"deliveries" limit:10 includeParameters:true'
      : triage
        ? 'channels action:"triage" includeParameters:true'
        : setup
          ? setupRoute
          : channelRoute;
    add({
      id: deliveries
        ? 'channel-delivery-receipts'
        : triage
          ? 'channel-triage-route'
          : setup
            ? 'channel-setup-route'
            : send
              ? 'channel-delivery-boundary'
              : 'channel-readiness-route',
      label: deliveries
        ? 'Channel delivery receipts'
        : triage
          ? 'Channel triage and retry posture'
          : setup
            ? 'Channel setup guide'
            : send
              ? 'Confirmed channel delivery boundary'
              : 'Channel readiness',
      score: deliveries || triage || setup || send ? 95 : 88,
      userSurface: 'Channels workspace',
      userOutcome: deliveries
        ? 'Review recent redacted delivery outcomes before retrying or sending more messages.'
        : triage
          ? 'Troubleshoot channel blockers, retries, pending messages, and route bindings without sending.'
          : setup
            ? 'Follow the ordered channel setup guide before relying on external delivery.'
            : 'Send and troubleshoot external messages through configured, inspectable channel targets.',
      why: 'The request mentions external channels, notifications, target setup, or delivery receipts.',
      modelRoute,
      inspectRoute: deliveries ? 'channels action:"status" includeParameters:true' : triage ? 'channels action:"status" includeParameters:true' : 'channels action:"triage" includeParameters:true',
      userRoute: 'Agent Workspace -> Channels',
      requiresConfirmation: setupEffect || sendEffect,
      missingFields: sendEffect
        ? ['configured target', 'message text', 'confirmation']
        : setupEffect
          ? ['channel/account target', 'configuration or credential route', 'confirmation before mutating channel setup']
          : undefined,
      supportingRoutes: [
        setupRoute,
        'channels action:"triage" includeParameters:true',
        'channels action:"deliveries" limit:10 includeParameters:true',
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

  if (securityPermissionLike(lower)) {
    if (securityStatusLike(lower)) {
      add({
        id: 'security-permission-status',
        label: 'Security and permission posture',
        score: 98,
        userSurface: 'Safety and recovery workspace',
        userOutcome: 'Show the current permission, approval, trust, and security posture before changing policy or attempting risky work.',
        why: 'The request asks what permissions, approvals, policies, or safety status are active.',
        modelRoute: `security action:"status" query:${quote(request)} includeParameters:true`,
        inspectRoute: 'security action:"status" includeParameters:true',
        userRoute: 'Agent Workspace -> Safety & Recovery',
        requiresConfirmation: false,
        supportingRoutes: [
          'workspace action:"actions" categoryId:"tools-permissions"',
          'settings action:"list" query:"permissions approval policy" includeParameters:true',
          'security action:"finding" findingId:"..." includeParameters:true',
        ],
        policy: 'Security posture inspection is read-only. Permission changes, approval changes, and risky target actions remain separate confirmed routes.',
      });
    }

    if (securityFindingLike(lower)) {
      add({
        id: 'security-finding-inspection',
        label: 'Security finding inspection',
        score: 97,
        userSurface: 'Safety and recovery workspace',
        userOutcome: 'Inspect the exact security finding, trust issue, incident, or leaked-secret record before repair work.',
        why: 'The request asks to inspect a security finding, incident, vulnerability, trust warning, or secret-leak issue.',
        modelRoute: `security action:"finding" target:${quote(request)} includeParameters:true`,
        inspectRoute: 'security action:"status" includeParameters:true',
        userRoute: 'Agent Workspace -> Safety & Recovery',
        requiresConfirmation: false,
        supportingRoutes: [
          'security action:"status" includeParameters:true',
          'agent_harness mode:"security_finding" findingId:"..." includeParameters:true',
          'support_bundles action:"status" includeParameters:true',
        ],
        policy: 'Finding inspection returns redacted evidence only. Secret rotation, trust changes, MCP enablement, or file edits stay on explicit confirmed repair routes.',
      });
    }

    if (securityPolicyExplainLike(lower) || (!securityStatusLike(lower) && !securityFindingLike(lower))) {
      const explainTarget = securityPolicyToolTarget(lower);
      add({
        id: 'security-policy-explanation',
        label: 'Security policy explanation',
        score: securityPolicyExplainLike(lower) ? 100 : 90,
        userSurface: 'Safety and recovery workspace',
        userOutcome: 'Explain whether one model action is allowed, blocked, or waiting on confirmation before performing it.',
        why: 'The request asks about a tool, route, command, approval, confirmation, or why an action is allowed, denied, or blocked.',
        modelRoute: explainTarget
          ? `security action:"explain" target:${quote(explainTarget)} toolArgs:{...} includeParameters:true`
          : 'security action:"explain" toolName:"..." toolArgs:{...} includeParameters:true',
        inspectRoute: 'security action:"status" includeParameters:true',
        userRoute: 'Agent Workspace -> Safety & Recovery',
        requiresConfirmation: false,
        missingFields: explainTarget ? ['arguments or action details to explain'] : ['tool name or route id', 'arguments or action details to explain'],
        supportingRoutes: [
          'security action:"status" includeParameters:true',
          'security action:"finding" findingId:"..." includeParameters:true',
          'agent_harness mode:"policy_explain" toolName:"..." toolArgs:{...}',
        ],
        policy: 'Policy explanations are read-only and never execute the target tool. Final execution still uses the live route guard, permission prompt, and typed confirmation gate.',
      });
    }
  }

  if (supportBundleLike(lower)) {
    const bundleEffect = supportBundleEffectLike(lower);
    add({
      id: 'support-bundle-route',
      label: 'Support bundle and diagnostics packet route',
      score: 96,
      userSurface: 'Safety and recovery workspace',
      userOutcome: 'Inspect available redacted support, diagnostic, trust, auth, or forensic bundles before exporting or importing anything.',
      why: 'The request mentions support bundles, diagnostic bundles, forensic bundles, or support packets.',
      modelRoute: `support action:"status" query:${quote(request)} includeParameters:true`,
      inspectRoute: 'support action:"status" includeParameters:true',
      userRoute: 'Agent Workspace -> Safety & Recovery -> Support bundles',
      requiresConfirmation: bundleEffect,
      missingFields: bundleEffect ? ['bundle type or path', 'export/import/share destination when applicable', 'confirmation before bundle export, import, or external sharing'] : undefined,
      supportingRoutes: [
        'support action:"bundle" bundlePath:"..." includeParameters:true',
        'agent_harness mode:"support_bundles" includeParameters:true',
        'workspace action:"actions" query:"support bundle" includeParameters:true',
        'agent_harness mode:"run_workspace_action" actionId:"..." confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Bundle catalog and bundle inspection are read-only and redacted. Bundle export, import, file writes, and sharing remain confirmation-gated workspace or slash-command flows.',
    });
  }

  if (sessionWorkspaceLike(lower) && !externalMemoryProviderLike(lower)) {
    const mutation = sessionMutationLike(lower);
    add({
      id: 'saved-session-route',
      label: 'Saved sessions, bookmarks, and transcript continuity',
      score: 97,
      userSurface: 'Conversation workspace',
      userOutcome: 'Find, inspect, resume, export, or manage saved Agent sessions and bookmarks from the conversation workspace.',
      why: 'The request mentions saved sessions, session search, transcript export, bookmarks, restore, or conversation continuity.',
      modelRoute: `sessions action:"list" query:${quote(request)} includeParameters:true`,
      inspectRoute: 'sessions action:"list" includeParameters:true',
      userRoute: 'Agent Workspace -> Conversation -> Saved sessions',
      requiresConfirmation: mutation,
      missingFields: mutation ? ['session id, title, or search target', 'exact lifecycle action', 'confirmation before save/load/resume/rename/fork/export/delete/bookmark changes'] : undefined,
      supportingRoutes: [
        'sessions action:"list" query:"..." includeParameters:true',
        'sessions action:"get" sessionId:"..." includeParameters:true',
        'agent_harness mode:"sessions" includeParameters:true',
        'workspace action:"actions" categoryId:"conversation" query:"session" includeParameters:true',
        'agent_harness mode:"run_workspace_action" actionId:"session-save|session-load|session-export-saved|session-delete" confirm:true explicitUserRequest:"..."',
      ],
      policy: 'Session and bookmark inspection is read-only. Save, load, resume, rename, fork, export, delete, and bookmark writes stay visible and confirmed through workspace or slash-command routes.',
    });
  }

  if (releaseAuditLike(lower)) {
    const evidence = releaseEvidenceLike(lower);
    add({
      id: evidence ? 'release-evidence-route' : 'release-readiness-route',
      label: evidence ? 'Release evidence artifact route' : 'Release readiness inventory route',
      score: 96,
      userSurface: 'Operator audit workspace',
      userOutcome: evidence
        ? 'Inspect packaged release evidence and operator/audit artifacts without expanding raw files blindly.'
        : 'Inspect the release-quality inventory, gates, and readiness dimensions before claiming a product capability is covered.',
      why: 'The request mentions release evidence, readiness inventory, release gates, verification ledger, or operator audit artifacts.',
      modelRoute: evidence
        ? `audit action:"evidence" query:${quote(request)} includeParameters:true`
        : `audit action:"readiness" query:${quote(request)} includeParameters:true`,
      inspectRoute: evidence
        ? 'audit action:"evidence" includeParameters:true'
        : 'audit action:"readiness" includeParameters:true',
      userRoute: 'Agent Workspace -> Operator Audit',
      requiresConfirmation: false,
      supportingRoutes: evidence
        ? [
          'audit action:"artifact" artifactId:"..." includeParameters:true',
          'audit action:"readiness" includeParameters:true',
          'agent_harness mode:"release_evidence" includeParameters:true',
        ]
        : [
          'audit action:"item" itemId:"..." includeParameters:true',
          'audit action:"evidence" includeParameters:true',
          'agent_harness mode:"release_readiness" includeParameters:true',
        ],
      policy: 'Release evidence and readiness inventory inspection are read-only. They expose packaged audit facts and bounded artifact content, not product mutations.',
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
