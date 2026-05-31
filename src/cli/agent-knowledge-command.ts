import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBrowserAgentSdk } from '@pellux/goodvibes-sdk/browser/agent';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { SDK_VERSION, VERSION } from '../version.ts';
import type { CliCommandOutput } from './types.ts';
import type { CliCommandRuntime } from './management.ts';
import { formatJsonOrText, yesNo } from './management.ts';

type JsonRecord = Record<string, unknown>;

interface AgentDaemonConnection {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly tokenPath: string;
}

interface AgentKnowledgeFailure {
  readonly ok: false;
  readonly kind: 'daemon_unavailable' | 'auth_required' | 'version_mismatch' | 'daemon_route_unavailable' | 'daemon_error';
  readonly error: string;
  readonly baseUrl: string;
  readonly route: string;
  readonly daemonVersion?: string;
  readonly expectedSdkVersion?: string;
}

interface AgentKnowledgeSuccess<TData> {
  readonly ok: true;
  readonly kind: string;
  readonly route: string;
  readonly data: TData;
}

type AgentKnowledgeResult<TData> = AgentKnowledgeSuccess<TData> | AgentKnowledgeFailure;

interface DaemonCallMethod {
  readonly kind: string;
  readonly route: string;
}

const AGENT_KNOWLEDGE_METHODS = {
  status: {
    kind: 'agentKnowledge.status',
    route: '/api/goodvibes-agent/knowledge/status',
  },
  ask: {
    kind: 'agentKnowledge.ask',
    route: '/api/goodvibes-agent/knowledge/ask',
  },
  search: {
    kind: 'agentKnowledge.search',
    route: '/api/goodvibes-agent/knowledge/search',
  },
  ingestUrl: {
    kind: 'agentKnowledge.ingest.url',
    route: '/api/goodvibes-agent/knowledge/ingest/url',
  },
} as const;

const DELEGATION_METHOD = {
  kind: 'sessions.messages.create',
  route: 'sessions.messages.create',
} as const;

interface DelegationResult {
  readonly sessionId: string;
  readonly message: unknown;
  readonly task: string;
  readonly wrfcRequested: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(record: JsonRecord | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(record: JsonRecord | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : null;
}

function readArray(record: JsonRecord | null, key: string): readonly unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function cleanInline(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function commandValues(args: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--')) {
      values.push(token);
      continue;
    }
    if (!token.includes('=') && args[index + 1] && !args[index + 1]!.startsWith('--')) index += 1;
  }
  return values;
}

function delegationTaskValues(args: readonly string[]): string[] {
  const values: string[] = [];
  for (const token of args) {
    if (token === '--wrfc') continue;
    if (!token.startsWith('--')) values.push(token);
  }
  return values;
}

function readOptionValue(args: readonly string[], name: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === name) {
      const next = args[index + 1];
      return next && !next.startsWith('--') ? next : undefined;
    }
    if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
  }
  return undefined;
}

function readPositiveInt(args: readonly string[], name: string, fallback: number): number {
  const raw = readOptionValue(args, name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readStringList(args: readonly string[], name: string): readonly string[] {
  const raw = readOptionValue(args, name);
  if (!raw) return [];
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function stripCommandFlag(args: readonly string[], flag: string): { readonly rest: readonly string[]; readonly present: boolean } {
  const rest: string[] = [];
  let present = false;
  for (const arg of args) {
    if (arg === flag) {
      present = true;
      continue;
    }
    rest.push(arg);
  }
  return { rest, present };
}

function readPackageMetadata(): { readonly version: string; readonly sdkVersion: string } {
  return { version: VERSION, sdkVersion: SDK_VERSION };
}

function resolveDaemonConnection(runtime: CliCommandRuntime): AgentDaemonConnection {
  const host = String(runtime.configManager.get('controlPlane.host') ?? '127.0.0.1');
  const port = Number(runtime.configManager.get('controlPlane.port') ?? 3421);
  const baseUrl = `http://${host}:${Number.isFinite(port) ? port : 3421}`;
  const tokenPath = join(runtime.homeDirectory, '.goodvibes', 'daemon', 'operator-tokens.json');
  if (!existsSync(tokenPath)) return { baseUrl, token: null, tokenPath };
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf-8')) as unknown;
    const token = isRecord(parsed) && typeof parsed.token === 'string' ? parsed.token : null;
    return { baseUrl, token, tokenPath };
  } catch {
    return { baseUrl, token: null, tokenPath };
  }
}

async function fetchDaemonStatus(connection: AgentDaemonConnection): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown }> {
  try {
    const response = await fetch(`${connection.baseUrl}/status`, {
      headers: connection.token ? { authorization: `Bearer ${connection.token}` } : undefined,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: summarizeError(error) };
  }
}

async function classifyKnowledgeError(error: unknown, connection: AgentDaemonConnection, route: string): Promise<AgentKnowledgeFailure> {
  const message = summarizeError(error);
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return { ok: false, kind: 'auth_required', error: message, baseUrl: connection.baseUrl, route };
  }
  if (lower.includes('404') || lower.includes('not found')) {
    const metadata = readPackageMetadata();
    const daemon = await fetchDaemonStatus(connection);
    const daemonRecord = isRecord(daemon.body) ? daemon.body : {};
    const daemonVersion = readString(daemonRecord, 'version') ?? 'unknown';
    if (daemon.ok && daemonVersion !== metadata.sdkVersion) {
      return {
        ok: false,
        kind: 'version_mismatch',
        error: `External daemon SDK version ${daemonVersion} does not match Agent SDK pin ${metadata.sdkVersion}; Agent Knowledge route is unavailable.`,
        baseUrl: connection.baseUrl,
        route,
        daemonVersion,
        expectedSdkVersion: metadata.sdkVersion,
      };
    }
    return { ok: false, kind: 'daemon_route_unavailable', error: message, baseUrl: connection.baseUrl, route };
  }
  if (lower.includes('fetch') || lower.includes('connect') || lower.includes('econnrefused')) {
    return { ok: false, kind: 'daemon_unavailable', error: message, baseUrl: connection.baseUrl, route };
  }
  return { ok: false, kind: 'daemon_error', error: message, baseUrl: connection.baseUrl, route };
}

function createAgentSdk(connection: AgentDaemonConnection) {
  return createBrowserAgentSdk({
    baseUrl: connection.baseUrl,
    authToken: connection.token,
  });
}

async function postAgentKnowledgeJson<TData>(
  connection: AgentDaemonConnection,
  route: string,
  body: JsonRecord,
): Promise<TData> {
  const response = await fetch(`${connection.baseUrl}${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connection.token ?? ''}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const detail = isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : text;
    throw new Error(`HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return parsed as TData;
}

function findDisallowedKnowledgeScopeFlag(args: readonly string[]): string | null {
  const disallowed = [
    '--space',
    '--knowledge-space',
    '--knowledge-space-id',
    ['--knowledge', 'SpaceId'].join(''),
    '--include-all-spaces',
    ['--include', 'AllSpaces'].join(''),
    ['--home', 'graph'].join(''),
    ['--home', '-graph'].join(''),
  ];
  for (const token of args) {
    for (const flag of disallowed) {
      if (token === flag || token.startsWith(`${flag}=`)) return flag;
    }
  }
  return null;
}

function formatScopeFlagRejection(flag: string): string {
  return [
    `Agent Knowledge is isolated; ${flag} is not accepted.`,
    'GoodVibes Agent must not use default Knowledge/Wiki or non-Agent product spaces.',
    'Use only /api/goodvibes-agent/knowledge/* Agent-owned routes.',
  ].join('\n');
}

function sourceLine(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const title = cleanInline(record.title)
    || cleanInline(record.canonicalUri)
    || cleanInline(record.sourceUri)
    || cleanInline(record.url)
    || cleanInline(record.id)
    || 'untitled';
  const type = cleanInline(record.sourceType) || cleanInline(record.type) || 'source';
  const url = cleanInline(record.canonicalUri) || cleanInline(record.sourceUri) || cleanInline(record.url);
  return url && url !== title ? `[${type}] ${title} (${url})` : `[${type}] ${title}`;
}

function resultLine(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const title = cleanInline(record.title) || cleanInline(record.id) || 'untitled';
  const id = cleanInline(record.id);
  const type = cleanInline(record.type) || cleanInline(record.kind) || cleanInline(record.sourceType) || 'result';
  const score = readNumber(record, 'score');
  const url = cleanInline(record.url) || cleanInline(record.canonicalUri) || cleanInline(record.sourceUri);
  const snippet = cleanInline(record.snippet) || cleanInline(record.summary) || cleanInline(record.text);
  const parts = [
    `[${type}] ${title}`,
    id && id !== title ? `id=${id}` : '',
    score !== null ? `score=${score.toFixed(3)}` : '',
    url ? `url=${url}` : '',
  ].filter((part) => part.length > 0);
  return snippet ? `${parts.join('  ')}\n    ${snippet}` : parts.join('  ');
}

function formatStatus(data: unknown): string {
  const record = isRecord(data) ? data : {};
  const ready = readBoolean(record, 'ready');
  const sourceCount = readNumber(record, 'sourceCount');
  const nodeCount = readNumber(record, 'nodeCount');
  const issueCount = readNumber(record, 'issueCount');
  const edgeCount = readNumber(record, 'edgeCount');
  const storagePath = readString(record, 'storagePath');
  return [
    'Agent Knowledge status',
    `  ready: ${ready === null ? 'unknown' : yesNo(ready)}`,
    `  sources: ${sourceCount ?? 'unknown'}`,
    `  nodes: ${nodeCount ?? 'unknown'}`,
    `  edges: ${edgeCount ?? 'unknown'}`,
    `  issues: ${issueCount ?? 'unknown'}`,
    storagePath ? `  storage: ${storagePath}` : null,
    '  route: /api/goodvibes-agent/knowledge/status',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function formatAsk(data: unknown, query: string): string {
  const record = isRecord(data) ? data : {};
  const answer = isRecord(record.answer) ? record.answer : record;
  const text = cleanInline(answer.text) || cleanInline(record.answer) || 'No answer returned.';
  const confidence = readNumber(answer, 'confidence') ?? readNumber(record, 'confidence');
  const synthesized = readBoolean(answer, 'synthesized');
  const sources = readArray(answer, 'sources');
  const facts = readArray(answer, 'facts');
  const gaps = readArray(answer, 'gaps');
  const lines = [
    `Agent Knowledge answer: ${query}`,
    text,
    '',
    `confidence: ${confidence ?? 'unknown'}${synthesized === null ? '' : `  synthesized: ${yesNo(synthesized)}`}`,
  ];
  if (sources.length > 0) {
    lines.push('', 'Sources:', ...sources.slice(0, 8).map((source) => `  - ${sourceLine(source)}`));
  }
  if (facts.length > 0) lines.push('', `Facts: ${facts.length}`);
  if (gaps.length > 0) lines.push('', `Gaps: ${gaps.length}`);
  return lines.join('\n');
}

function formatSearch(data: unknown, query: string): string {
  const record = isRecord(data) ? data : {};
  const items = readArray(record, 'items');
  const results = items.length > 0 ? items : readArray(record, 'results');
  if (results.length === 0) {
    return [
      `Agent Knowledge search: ${query}`,
      '  no results',
      '  route: /api/goodvibes-agent/knowledge/search',
    ].join('\n');
  }
  return [
    `Agent Knowledge search: ${query}`,
    ...results.slice(0, 10).map((result, index) => `  ${index + 1}. ${resultLine(result)}`),
  ].join('\n');
}

function formatIngest(data: unknown, url: string): string {
  const record = isRecord(data) ? data : {};
  const source = isRecord(record.source) ? record.source : record;
  const sourceId = cleanInline(source.id);
  const canonicalUri = cleanInline(source.canonicalUri) || cleanInline(source.sourceUri) || url;
  const artifactId = cleanInline(record.artifactId);
  return [
    'Agent Knowledge ingest-url accepted',
    `  source: ${sourceId || '(pending)'}`,
    `  url: ${canonicalUri}`,
    artifactId ? `  artifact: ${artifactId}` : null,
    '  route: /api/goodvibes-agent/knowledge/ingest/url',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function buildDelegationBody(task: string, wrfcRequested: boolean): string {
  return [
    'GoodVibes Agent explicit build delegation.',
    '',
    'Original user ask:',
    task,
    '',
    'Agent policy:',
    '- GoodVibes Agent is not the coding TUI.',
    '- Preserve the full original ask.',
    '- GoodVibes TUI owns file edits, git/worktree flows, runtime-isolation UX, and any WRFC owner chain.',
    wrfcRequested
      ? '- WRFC was explicitly requested by the Agent user for this build/fix/review delegation.'
      : '- WRFC was not explicitly requested; do not turn this into WRFC solely because it came from Agent.',
  ].join('\n');
}

function formatFailure(failure: AgentKnowledgeFailure, json: boolean): string {
  if (json) return JSON.stringify(failure, null, 2);
  return [
    `Agent Knowledge error: ${failure.kind}`,
    `  ${failure.error}`,
    `  daemon: ${failure.baseUrl}`,
    `  route: ${failure.route}`,
    failure.kind === 'version_mismatch' && failure.daemonVersion && failure.expectedSdkVersion
      ? `  versions: daemon=${failure.daemonVersion} expected=${failure.expectedSdkVersion}`
      : null,
    failure.kind === 'version_mismatch'
      ? '  next: update/restart the external GoodVibes daemon so /status matches the Agent SDK pin.'
      : null,
    failure.kind === 'daemon_route_unavailable'
      ? '  next: update/restart the external GoodVibes daemon to the SDK version required by this Agent package.'
      : null,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

async function runKnowledgeCall<TData>(
  runtime: CliCommandRuntime,
  method: DaemonCallMethod,
  call: (connection: AgentDaemonConnection) => Promise<TData>,
): Promise<AgentKnowledgeResult<TData>> {
  const connection = resolveDaemonConnection(runtime);
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: `No daemon operator token found at ${connection.tokenPath}`,
      baseUrl: connection.baseUrl,
      route: method.route,
    };
  }
  try {
    const data = await call(connection);
    return { ok: true, kind: method.kind, route: method.route, data };
  } catch (error) {
    return classifyKnowledgeError(error, connection, method.route);
  }
}

export async function handleAgentKnowledgeCommand(runtime: CliCommandRuntime): Promise<CliCommandOutput> {
  const [sub = 'status', ...rawRest] = runtime.cli.commandArgs;
  const confirmation = stripCommandFlag(rawRest, '--yes');
  const rest = confirmation.rest;
  const normalized = sub.toLowerCase();
  const json = runtime.cli.flags.outputFormat === 'json';
  const disallowedScopeFlag = findDisallowedKnowledgeScopeFlag(rest);
  if (disallowedScopeFlag) {
    const failure = {
      ok: false,
      kind: 'agent_knowledge_scope_rejected',
      error: formatScopeFlagRejection(disallowedScopeFlag),
      route: '/api/goodvibes-agent/knowledge/*',
    };
    return {
      output: json ? JSON.stringify(failure, null, 2) : failure.error,
      exitCode: 2,
    };
  }

  if (normalized === 'status') {
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.status, async (connection) => (
      await createAgentSdk(connection).knowledge.status()
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatStatus(result.data)),
      exitCode: 0,
    };
  }

  if (normalized === 'ask') {
    const query = commandValues(rest).join(' ').trim();
    if (!query) return { output: 'Usage: goodvibes-agent knowledge ask <question> [--limit <n>] [--mode concise|standard|detailed]', exitCode: 2 };
    const mode = readOptionValue(rest, '--mode');
    const selectedMode = mode === 'concise' || mode === 'standard' || mode === 'detailed' ? mode : 'standard';
    const limit = readPositiveInt(rest, '--limit', 8);
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.ask, async (connection) => (
      await createAgentSdk(connection).knowledge.ask({
        query,
        limit,
        mode: selectedMode,
        includeSources: true,
        includeConfidence: true,
        includeLinkedObjects: true,
      })
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatAsk(result.data, query)),
      exitCode: 0,
    };
  }

  if (normalized === 'search') {
    const query = commandValues(rest).join(' ').trim();
    if (!query) return { output: 'Usage: goodvibes-agent knowledge search <query> [--limit <n>]', exitCode: 2 };
    const limit = readPositiveInt(rest, '--limit', 10);
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.search, async (connection) => (
      await createAgentSdk(connection).knowledge.search({ query, limit })
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatSearch(result.data, query)),
      exitCode: 0,
    };
  }

  if (normalized === 'ingest-url') {
    const values = commandValues(rest);
    const url = values[0];
    if (!url) return { output: 'Usage: goodvibes-agent knowledge ingest-url <url> [--title <title>] [--tags a,b] --yes', exitCode: 2 };
    if (!confirmation.present) {
      const failure = {
        ok: false,
        kind: 'confirmation_required',
        error: `Refusing to ingest URL into Agent Knowledge ${url} without --yes.`,
        route: AGENT_KNOWLEDGE_METHODS.ingestUrl.route,
      };
      return {
        output: json ? JSON.stringify(failure, null, 2) : `${failure.error}\nUsage: goodvibes-agent knowledge ingest-url <url> [--title <title>] [--tags a,b] --yes`,
        exitCode: 2,
      };
    }
    const title = readOptionValue(rest, '--title');
    const tags = readStringList(rest, '--tags');
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.ingestUrl, async (connection) => (
      await postAgentKnowledgeJson(connection, AGENT_KNOWLEDGE_METHODS.ingestUrl.route, {
        url,
        title,
        tags,
        sourceType: 'url',
        connectorId: 'goodvibes-agent-cli',
      })
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatIngest(result.data, url)),
      exitCode: 0,
    };
  }

  return {
    output: 'Usage: goodvibes-agent knowledge [status|ask <question>|search <query>|ingest-url <url> --yes]',
    exitCode: 2,
  };
}

export async function handleAgentKnowledgeShortcutCommand(
  runtime: CliCommandRuntime,
  subcommand: 'ask' | 'search',
): Promise<CliCommandOutput> {
  return handleAgentKnowledgeCommand({
    ...runtime,
    cli: {
      ...runtime.cli,
      command: 'knowledge',
      rawCommand: 'knowledge',
      commandArgs: [subcommand, ...runtime.cli.commandArgs],
    },
  });
}

export async function handleCompatCommand(runtime: CliCommandRuntime): Promise<CliCommandOutput> {
  const connection = resolveDaemonConnection(runtime);
  const metadata = readPackageMetadata();
  const daemon = await fetchDaemonStatus(connection);
  const daemonRecord = isRecord(daemon.body) ? daemon.body : {};
  const daemonVersion = readString(daemonRecord, 'version') ?? 'unknown';
  const versionCompatible = daemon.ok && daemonVersion === metadata.sdkVersion;
  const knowledgeRoute = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.status, async (routeConnection) => (
    await createAgentSdk(routeConnection).knowledge.status()
  ));
  const knowledgeRouteReady = knowledgeRoute.ok;
  const value = {
    ok: versionCompatible && knowledgeRouteReady,
    packageVersion: metadata.version,
    sdkPin: metadata.sdkVersion,
    daemon: {
      baseUrl: connection.baseUrl,
      status: daemon.status,
      version: daemonVersion,
      reachable: daemon.ok,
      compatible: versionCompatible,
    },
    auth: {
      tokenPresent: Boolean(connection.token),
      tokenPath: connection.tokenPath,
    },
    agentKnowledge: {
      route: '/api/goodvibes-agent/knowledge/status',
      ready: knowledgeRouteReady,
      kind: knowledgeRoute.ok ? 'ok' : knowledgeRoute.kind,
    },
  };
  const text = [
    'GoodVibes Agent compatibility',
    `  package: ${metadata.version}`,
    `  SDK pin: ${metadata.sdkVersion}`,
    `  daemon: ${daemonVersion} at ${connection.baseUrl} (${daemon.ok ? 'reachable' : 'unreachable'})`,
    `  version compatible: ${yesNo(versionCompatible)}`,
    `  operator token: ${connection.token ? 'present' : 'missing'} (${connection.tokenPath})`,
    `  Agent knowledge route: ${knowledgeRouteReady ? 'ready' : `not ready (${knowledgeRoute.ok ? 'unknown' : knowledgeRoute.kind})`}`,
    ...(versionCompatible ? [] : ['  next: update/restart the external GoodVibes daemon so /status matches the Agent SDK pin.']),
  ].join('\n');
  return {
    output: runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(value, null, 2) : text,
    exitCode: value.ok ? 0 : 1,
  };
}

export async function handleDelegateCommand(runtime: CliCommandRuntime): Promise<CliCommandOutput> {
  const wrfcRequested = hasFlag(runtime.cli.commandArgs, '--wrfc');
  const task = delegationTaskValues(runtime.cli.commandArgs).join(' ').trim();
  if (!task) {
    return {
      output: 'Usage: goodvibes-agent delegate [--wrfc] <build/fix/review task>',
      exitCode: 2,
    };
  }
  const result = await runKnowledgeCall<DelegationResult>(runtime, DELEGATION_METHOD, async (connection) => {
    const sdk = createAgentSdk(connection);
    const created = await sdk.operator.invoke('sessions.create', {
      title: `Agent delegation: ${task.slice(0, 72)}`,
      surfaceKind: 'goodvibes-agent',
      surfaceId: 'goodvibes-agent-cli',
    });
    const sessionId = isRecord(created.session) && typeof created.session.id === 'string'
      ? created.session.id
      : null;
    if (!sessionId) throw new Error('sessions.create returned no session id.');
    const message = await sdk.operator.invoke('sessions.messages.create', {
      sessionId,
      body: buildDelegationBody(task, wrfcRequested),
      surfaceKind: 'goodvibes-agent',
      surfaceId: 'goodvibes-agent-cli',
      kind: 'task',
      routing: {
        executionIntent: {
          riskClass: 'elevated',
          requiresApproval: true,
          networkPolicy: 'inherit',
          filesystemPolicy: 'workspace-write',
        },
      },
    });
    return { sessionId, message, task, wrfcRequested };
  });
  if (!result.ok) return { output: formatFailure(result, runtime.cli.flags.outputFormat === 'json'), exitCode: 1 };
  const text = [
    'Delegation submitted to GoodVibes TUI/shared-session routes.',
    `  session: ${result.data.sessionId}`,
    `  mode: ${result.data.wrfcRequested ? 'WRFC requested' : 'direct build delegation'}`,
    `  task: ${result.data.task}`,
    '  next: check GoodVibes TUI shared-session/task status for the result.',
  ].join('\n');
  return {
    output: formatJsonOrText(runtime.cli)(result, text),
    exitCode: 0,
  };
}
