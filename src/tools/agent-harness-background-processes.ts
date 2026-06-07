import type { BackgroundProcess, ProcessManager } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext } from '../input/command-registry.ts';
import { sudoExecutionPosture } from './agent-harness-sudo-posture.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export interface AgentHarnessBackgroundProcessArgs {
  readonly processId?: unknown;
  readonly processSessionId?: unknown;
  readonly sessionId?: unknown;
  readonly session_id?: unknown;
  readonly action?: unknown;
  readonly processAction?: unknown;
  readonly command?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly cwd?: unknown;
  readonly timeoutMs?: unknown;
  readonly pty?: unknown;
  readonly data?: unknown;
  readonly fields?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

type BackgroundProcessLookupSource = 'processId' | 'processSessionId' | 'sessionId' | 'session_id' | 'target' | 'query';

export type BackgroundProcessResolution =
  | { readonly status: 'found'; readonly process: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

const MAX_LOG_PREVIEW_CHARS = 4_000;
const MAX_COMPACT_LOG_PREVIEW_CHARS = 600;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_BACKGROUND_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const PROCESS_PARITY_METHODS = ['terminal(background=true)', 'process(list)', 'process(poll)', 'process(wait)', 'process(log)', 'process(kill)', 'process(write)', 'pty', 'sudo'] as const;
const SENSITIVE_TEXT_PATTERNS: readonly [RegExp, string][] = [
  [/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|BEARER)[A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s]+)/gi, '$1=<redacted>'],
  [/(\b(?:token|secret|password|passwd|api[-_]?key|authorization|credential)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s]+)/gi, '$1<redacted>'],
  [/(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>'],
  [/(\s--(?:token|password|secret|api-key|api_key)\s+)("[^"]*"|'[^']*'|[^\s]+)/gi, '$1<redacted>'],
];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function readLimit(value: unknown, fallback: number): number {
  return Math.max(1, Math.min(500, readNumber(value, fallback)));
}

function clampTimeout(value: unknown, fallback: number): number {
  return Math.max(1_000, Math.min(MAX_BACKGROUND_TIMEOUT_MS, readNumber(value, fallback)));
}

function fieldMap(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(entry)]));
}

function readField(args: AgentHarnessBackgroundProcessArgs, id: string): string {
  return fieldMap(args.fields)[id] ?? '';
}

function managerFrom(context: CommandContext): ProcessManager | undefined {
  return context.workspace.processManager;
}

function redactText(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function compactText(value: string, max: number): string {
  const redacted = redactText(value);
  if (redacted.length <= max) return redacted;
  return `${redacted.slice(Math.max(0, redacted.length - max)).trimStart()}`;
}

function processStatus(entry: BackgroundProcess): 'running' | 'succeeded' | 'failed' | 'cancelled' {
  if (!entry.done) return 'running';
  if (entry.exitCode === 0) return 'succeeded';
  if (entry.exitCode === null) return 'cancelled';
  return 'failed';
}

function processAgeMs(entry: BackgroundProcess, now = Date.now()): number {
  return Math.max(0, (entry.completedAt ?? now) - entry.startTime);
}

function routeFor(processId: string, mode: 'background_process' | 'run_background_process', action?: string): string {
  const actionPart = action ? ` processAction:"${action}"` : '';
  return `agent_harness mode:"${mode}" processId:"${processId}"${actionPart}`;
}

function readProcessSessionId(args: AgentHarnessBackgroundProcessArgs): { readonly source: BackgroundProcessLookupSource; readonly input: string } | null {
  const processId = readString(args.processId) || readField(args, 'processId');
  if (processId) return { source: 'processId', input: processId };
  const processSessionId = readString(args.processSessionId) || readField(args, 'processSessionId');
  if (processSessionId) return { source: 'processSessionId', input: processSessionId };
  const sessionId = readString(args.sessionId) || readField(args, 'sessionId');
  if (sessionId) return { source: 'sessionId', input: sessionId };
  const snakeSessionId = readString(args.session_id) || readField(args, 'session_id');
  if (snakeSessionId) return { source: 'session_id', input: snakeSessionId };
  return null;
}

function describeProcessEntry(
  manager: ProcessManager,
  entry: BackgroundProcess,
  options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const output = manager.getOutput(entry.id) ?? { stdout: '', stderr: '' };
  const stdoutTail = compactText(output.stdout, options.includeParameters ? MAX_LOG_PREVIEW_CHARS : MAX_COMPACT_LOG_PREVIEW_CHARS);
  const stderrTail = compactText(output.stderr, options.includeParameters ? MAX_LOG_PREVIEW_CHARS : MAX_COMPACT_LOG_PREVIEW_CHARS);
  return {
    processId: entry.id,
    processSessionId: entry.id,
    sessionId: entry.id,
    session_id: entry.id,
    pid: entry.pid,
    status: processStatus(entry),
    done: entry.done,
    exitCode: entry.exitCode,
    command: options.includeParameters ? redactText(entry.cmd) : previewHarnessText(redactText(entry.cmd), 120),
    startedAt: new Date(entry.startTime).toISOString(),
    ageMs: processAgeMs(entry),
    routes: {
      inspect: routeFor(entry.id, 'background_process'),
      log: routeFor(entry.id, 'background_process'),
      wait: routeFor(entry.id, 'run_background_process', 'wait'),
      stop: routeFor(entry.id, 'run_background_process', 'stop'),
      visibleMonitor: 'agent_harness mode:"open_ui_surface" surfaceId:"process-monitor"',
      liveTail: `agent_harness mode:"open_ui_surface" surfaceId:"live-tail" target:"${entry.id}"`,
    },
    ...(stdoutTail || stderrTail ? {
      output: {
        stdoutTail,
        stderrTail,
        policy: 'Output is bounded and secret-looking text is redacted before model display.',
      },
    } : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
  };
}

function processSearchText(entry: BackgroundProcess): string {
  return [
    entry.id,
    String(entry.pid),
    entry.cmd,
    processStatus(entry),
  ].join('\n').toLowerCase();
}

function lookupFromArgs(args: AgentHarnessBackgroundProcessArgs): { readonly source: BackgroundProcessLookupSource; readonly input: string } | null {
  const processSession = readProcessSessionId(args);
  if (processSession) return processSession;
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function matchingProcesses(manager: ProcessManager, input: string): readonly BackgroundProcess[] {
  const entries = manager.list()
    .map((entry) => manager.getStatus(entry.id))
    .filter((entry): entry is BackgroundProcess => Boolean(entry));
  const normalized = input.toLowerCase().trim();
  if (!normalized) return entries;
  return entries.filter((entry) => processSearchText(entry).includes(normalized));
}

function candidateProcess(entry: BackgroundProcess): Record<string, unknown> {
  return {
    processId: entry.id,
    processSessionId: entry.id,
    sessionId: entry.id,
    session_id: entry.id,
    pid: entry.pid,
    status: processStatus(entry),
    command: previewHarnessText(redactText(entry.cmd), 96),
  };
}

function processToolParity(): readonly Record<string, unknown>[] {
  return [
    {
      capability: 'terminal(background=true)',
      status: 'supported',
      userOutcome: 'Start one visible tracked local command without blocking the conversation.',
      modelRoute: 'agent_harness mode:"run_background_process" processAction:"start" command:"..." confirm:true explicitUserRequest:"..."',
    },
    {
      capability: 'process(list)',
      status: 'supported',
      userOutcome: 'See every tracked local background process from the shared ProcessManager.',
      modelRoute: 'agent_harness mode:"background_processes"',
    },
    {
      capability: 'process(poll)',
      status: 'supported',
      userOutcome: 'Poll one tracked process status without waiting.',
      modelRoute: 'agent_harness mode:"run_background_process" processAction:"poll" sessionId:"..."',
    },
    {
      capability: 'process(wait)',
      status: 'supported',
      userOutcome: 'Wait on one tracked process with a bounded timeout.',
      modelRoute: 'agent_harness mode:"run_background_process" processAction:"wait" processId:"..." confirm:true explicitUserRequest:"..."',
    },
    {
      capability: 'process(log)',
      status: 'supported',
      userOutcome: 'Read bounded, redacted stdout/stderr tails for one tracked process.',
      modelRoute: 'agent_harness mode:"background_process" processId:"..." includeParameters:true',
    },
    {
      capability: 'process(kill)',
      status: 'supported',
      userOutcome: 'Stop and remove one tracked process from the shared ProcessManager.',
      modelRoute: 'agent_harness mode:"run_background_process" processAction:"kill" sessionId:"..." confirm:true explicitUserRequest:"..."',
    },
    {
      capability: 'process(write)',
      status: 'blocked-contract-gap',
      userOutcome: 'Interactive input is not exposed because the SDK ProcessManager has no safe stdin handle.',
      modelRoute: 'agent_harness mode:"run_background_process" processAction:"write" processId:"..." data:"..."',
    },
    {
      capability: 'pty',
      status: 'blocked-contract-gap',
      userOutcome: 'Interactive CLIs need a published PTY/session API before Agent can make them safe and visible.',
      modelRoute: 'agent_harness mode:"run_background_process" processAction:"start" pty:true command:"..."',
    },
    {
      capability: 'sudo',
      status: 'visible-only',
      userOutcome: 'Privilege prompts must stay foreground or use a future safe credential-prompt contract.',
      modelRoute: 'agent_harness mode:"execution_route" executionRouteId:"local-shell-command"',
    },
  ];
}

function capabilities(context?: CommandContext): Record<string, unknown> {
  const sudoPosture = sudoExecutionPosture(context);
  return {
    start: 'agent_harness mode:"run_background_process" processAction:"start" command:"..." confirm:true explicitUserRequest:"..."',
    inspect: 'agent_harness mode:"background_processes" or mode:"background_process"',
    wait: 'agent_harness mode:"run_background_process" processAction:"wait" processId|sessionId:"..." confirm:true explicitUserRequest:"..."',
    stop: 'agent_harness mode:"run_background_process" processAction:"kill" processId|sessionId:"..." confirm:true explicitUserRequest:"..."',
    aliases: {
      actions: {
        poll: 'status',
        kill: 'stop',
        log: 'output',
        write: 'unsupported until ProcessManager exposes stdin',
      },
      ids: ['processId', 'processSessionId', 'sessionId', 'session_id'],
      userOutcome: 'The harness accepts the process-tool words users expect while returning stable processId/sessionId aliases.',
    },
    parity: processToolParity(),
    substrate: {
      localProcessManager: {
        status: 'available-when-runtime-wires-processManager',
        supports: ['spawn', 'list', 'status', 'output', 'stop'],
        missing: ['stdin write', 'PTY session', 'sudo prompt mediation'],
      },
      daemonOperatorContract: {
        status: 'no-published-terminal-or-pty-method',
        auditedTerms: ['terminal', 'process.write', 'pty', 'sudo'],
        closestRoutes: [
          'agent_harness mode:"operator_methods" query:"tasks"',
          'agent_harness mode:"operator_methods" query:"automation"',
          'agent_harness mode:"operator_methods" query:"sessions"',
        ],
      },
    },
    pty: {
      status: 'not-yet-supported-in-agent-harness',
      guidance: 'Use foreground exec for noninteractive commands. Interactive PTY needs a published SDK/daemon session API before Agent can expose it safely.',
    },
    stdinWrite: {
      status: 'not-yet-supported-in-agent-harness',
      guidance: 'ProcessManager currently tracks output and stop lifecycle; it does not expose a safe stdin write API.',
    },
    sudo: {
      ...sudoPosture,
      guidance: sudoPosture.credentialSignal.guidance,
    },
  };
}

export function backgroundProcessCatalogStatus(context: CommandContext): Record<string, unknown> {
  const manager = managerFrom(context);
  if (!manager) {
    return {
      modes: ['background_processes', 'background_process', 'run_background_process'],
      status: 'unavailable',
      tracked: 0,
      running: 0,
      readOnly: false,
      reason: 'ProcessManager is not wired into this runtime.',
    };
  }
  const entries = matchingProcesses(manager, '');
  return {
    modes: ['background_processes', 'background_process', 'run_background_process'],
    status: 'available',
    tracked: entries.length,
    running: entries.filter((entry) => !entry.done).length,
    completed: entries.filter((entry) => entry.done).length,
    readOnly: false,
  };
}

export function backgroundProcessSummary(context: CommandContext, args: AgentHarnessBackgroundProcessArgs): Record<string, unknown> {
  const manager = managerFrom(context);
  if (!manager) {
    return {
      status: 'unavailable',
      processes: [],
      returned: 0,
      total: 0,
      capabilities: capabilities(context),
      policy: 'Background process UX uses the shared GoodVibes ProcessManager when the current runtime wires it in.',
    };
  }
  const query = readString(args.query || args.target);
  const entries = matchingProcesses(manager, query);
  const limit = readLimit(args.limit, 100);
  const processes = entries.slice(0, limit).map((entry) => describeProcessEntry(manager, entry, {
    includeParameters: args.includeParameters === true,
  }));
  return {
    status: 'available',
    summary: {
      tracked: entries.length,
      running: entries.filter((entry) => !entry.done).length,
      completed: entries.filter((entry) => entry.done).length,
      visibleMonitor: 'agent_harness mode:"open_ui_surface" surfaceId:"process-monitor"',
      liveTail: 'agent_harness mode:"open_ui_surface" surfaceId:"live-tail"',
    },
    processes,
    returned: processes.length,
    total: entries.length,
    capabilities: capabilities(context),
    policy: 'List/status/log routes are read-only and bounded. Starting, waiting on, or stopping a background process requires confirm:true and explicitUserRequest.',
  };
}

export function describeBackgroundProcess(context: CommandContext, args: AgentHarnessBackgroundProcessArgs): BackgroundProcessResolution {
  const manager = managerFrom(context);
  if (!manager) {
    return {
      status: 'missing_lookup',
      usage: 'Background processes are unavailable because ProcessManager is not wired into this runtime.',
    };
  }
  const lookup = lookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'background_process requires processId, target, or query. Use mode:"background_processes" to inspect tracked process ids.',
    };
  }
  const exact = manager.getStatus(lookup.input);
  if (exact) {
    return {
      status: 'found',
      process: describeProcessEntry(manager, exact, {
        includeParameters: true,
        lookup: { ...lookup, resolvedBy: 'id' },
      }),
    };
  }
  const matches = matchingProcesses(manager, lookup.input);
  if (matches.length === 1) {
    return {
      status: 'found',
      process: describeProcessEntry(manager, matches[0]!, {
        includeParameters: true,
        lookup: { ...lookup, resolvedBy: 'search' },
      }),
    };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: matches.slice(0, 8).map(candidateProcess),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown background process ${lookup.input}. Use mode:"background_processes" to inspect tracked process ids.`,
  };
}

function requireConfirmed(args: AgentHarnessBackgroundProcessArgs, action: string): string | null {
  if (!readString(args.explicitUserRequest)) return `${action} requires explicitUserRequest with the user's exact request or a short faithful summary.`;
  if (args.confirm !== true) return `${action} requires confirm:true after an explicit user request.`;
  return null;
}

function readProcessAction(args: AgentHarnessBackgroundProcessArgs): string {
  const action = (
    readString(args.processAction)
    || readString(args.action)
    || readField(args, 'action')
    || (readString(args.command) || readField(args, 'command') ? 'start' : '')
  ).toLowerCase();
  if (action === 'poll') return 'status';
  if (action === 'kill') return 'stop';
  return action;
}

function readCommand(args: AgentHarnessBackgroundProcessArgs): string {
  return readString(args.command) || readField(args, 'command');
}

function readProcessId(args: AgentHarnessBackgroundProcessArgs): string {
  return readProcessSessionId(args)?.input || readString(args.target);
}

function readCwd(context: CommandContext, args: AgentHarnessBackgroundProcessArgs): string | undefined {
  const raw = readString(args.cwd) || readField(args, 'cwd');
  const shellPaths = context.workspace.shellPaths;
  if (!raw) return shellPaths?.workingDirectory;
  if (!shellPaths) return raw;
  const resolved = shellPaths.resolveWorkspacePath(raw);
  if (!shellPaths.isWithinWorkingDirectory(resolved)) {
    throw new Error('Background process cwd must stay inside the current Agent workspace.');
  }
  return resolved;
}

function looksLikeSudo(command: string): boolean {
  return /(^|[\s;&|])(?:sudo|su|doas|pkexec)\b/.test(command);
}

async function waitForProcess(manager: ProcessManager, processId: string, timeoutMs: number): Promise<BackgroundProcess | undefined> {
  const started = Date.now();
  for (;;) {
    const entry = manager.getStatus(processId);
    if (!entry || entry.done) return entry;
    if (Date.now() - started >= timeoutMs) return entry;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function runBackgroundProcessAction(context: CommandContext, args: AgentHarnessBackgroundProcessArgs): Promise<Record<string, unknown>> {
  const manager = managerFrom(context);
  if (!manager) {
    return {
      status: 'unavailable',
      reason: 'ProcessManager is not wired into this runtime.',
      policy: 'Use foreground exec or connected-host delegation until background process lifecycle is available.',
    };
  }

  if (args.pty === true || readField(args, 'pty').toLowerCase() === 'true') {
    return {
      ...(capabilities(context).pty as Record<string, unknown>),
      status: 'unsupported',
      capability: 'pty',
    };
  }
  if (readString(args.data) || readField(args, 'data')) {
    return {
      ...(capabilities(context).stdinWrite as Record<string, unknown>),
      status: 'unsupported',
      capability: 'stdinWrite',
      processId: readProcessId(args) || null,
      dataReceived: true,
    };
  }

  const action = readProcessAction(args);
  if (action === 'write') {
    return {
      ...(capabilities(context).stdinWrite as Record<string, unknown>),
      status: 'unsupported',
      capability: 'stdinWrite',
      processId: readProcessId(args) || null,
      dataReceived: Boolean(readString(args.data) || readField(args, 'data')),
    };
  }
  if (action === 'capabilities' || action === 'doctor' || action === 'parity') {
    return {
      status: 'available',
      capabilities: capabilities(context),
      methods: PROCESS_PARITY_METHODS,
      policy: 'This is a read-only process UX contract report. It does not start, stop, or write to any process.',
    };
  }
  if (action === 'start' || action === 'spawn' || action === 'run') {
    const confirmationError = requireConfirmed(args, 'Background process start');
    if (confirmationError) throw new Error(confirmationError);
    const command = readCommand(args);
    if (!command) throw new Error('Background process start requires command.');
    if (looksLikeSudo(command)) {
      return {
        status: 'blocked',
        capability: 'sudo',
        reason: 'Background sudo prompts are not exposed by Agent because they can hang or hide privilege escalation.',
        guidance: capabilities(context).sudo,
      };
    }
    const cwd = readCwd(context, args);
    const timeoutMs = clampTimeout(args.timeoutMs ?? readField(args, 'timeoutMs'), DEFAULT_BACKGROUND_TIMEOUT_MS);
    const result = await manager.spawn(command, cwd, undefined, { timeout_ms: timeoutMs, sigterm_grace_ms: 5_000 });
    return {
      status: 'started',
      processId: result.process_id,
      processSessionId: result.process_id,
      sessionId: result.process_id,
      session_id: result.process_id,
      pid: result.pid,
      command: redactText(command),
      cwd,
      timeoutMs,
      routes: {
        inspect: result.process_id ? routeFor(result.process_id, 'background_process') : null,
        wait: result.process_id ? routeFor(result.process_id, 'run_background_process', 'wait') : null,
        stop: result.process_id ? routeFor(result.process_id, 'run_background_process', 'stop') : null,
        visibleMonitor: 'agent_harness mode:"open_ui_surface" surfaceId:"process-monitor"',
        liveTail: result.process_id ? `agent_harness mode:"open_ui_surface" surfaceId:"live-tail" target:"${result.process_id}"` : null,
      },
      policy: 'Started as a tracked local background process with bounded timeout and visible monitor/live-tail routes.',
    };
  }

  if (action === 'stop' || action === 'kill' || action === 'cancel') {
    const confirmationError = requireConfirmed(args, 'Background process stop');
    if (confirmationError) throw new Error(confirmationError);
    const processId = readProcessId(args);
    if (!processId) throw new Error('Background process stop requires processId.');
    const stopped = manager.stop(processId);
    return {
      status: stopped ? 'stopped' : 'not_found',
      processId,
      processSessionId: processId,
      sessionId: processId,
      session_id: processId,
      policy: stopped
        ? 'The process was signaled and removed from the shared ProcessManager.'
        : 'No tracked process matched that id.',
    };
  }

  if (action === 'wait') {
    const confirmationError = requireConfirmed(args, 'Background process wait');
    if (confirmationError) throw new Error(confirmationError);
    const processId = readProcessId(args);
    if (!processId) throw new Error('Background process wait requires processId.');
    const timeoutMs = clampTimeout(args.timeoutMs ?? readField(args, 'timeoutMs'), DEFAULT_WAIT_TIMEOUT_MS);
    const entry = await waitForProcess(manager, processId, timeoutMs);
    return {
      status: entry?.done ? 'completed' : entry ? 'still_running' : 'not_found',
      processId,
      processSessionId: processId,
      sessionId: processId,
      session_id: processId,
      timeoutMs,
      ...(entry ? { process: describeProcessEntry(manager, entry, { includeParameters: true }) } : {}),
      policy: 'Wait observes the tracked process and does not send input or signals.',
    };
  }

  if (action === 'list') return backgroundProcessSummary(context, args);
  if (action === 'status' || action === 'log' || action === 'output') {
    const resolved = describeBackgroundProcess(context, args);
    if (resolved.status === 'found') return resolved.process;
    return {
      status: resolved.status,
      ...(resolved.status === 'ambiguous' ? { input: resolved.input, candidates: resolved.candidates } : { usage: resolved.usage }),
    };
  }

  throw new Error('run_background_process requires processAction start, stop/kill, wait, list, status/poll, log/output, write, or capabilities.');
}
