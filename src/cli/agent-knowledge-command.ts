import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBrowserAgentSdk } from '@pellux/goodvibes-sdk/browser/agent';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { SDK_VERSION, VERSION } from '../version.ts';
import type { CliCommandOutput } from './types.ts';
import type { CliCommandRuntime } from './management.ts';
import {
  formatAsk,
  formatBatchIngest,
  formatConnectors,
  formatEntityList,
  formatFailure,
  formatIngest,
  formatItem,
  formatMap,
  formatReindex,
  formatSearch,
  formatStatus,
} from './agent-knowledge-format.ts';
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
  sourcesList: {
    kind: 'agentKnowledge.sources.list',
    route: '/api/goodvibes-agent/knowledge/sources',
  },
  nodesList: {
    kind: 'agentKnowledge.nodes.list',
    route: '/api/goodvibes-agent/knowledge/nodes',
  },
  issuesList: {
    kind: 'agentKnowledge.issues.list',
    route: '/api/goodvibes-agent/knowledge/issues',
  },
  itemGet: {
    kind: 'agentKnowledge.item.get',
    route: '/api/goodvibes-agent/knowledge/items/{id}',
  },
  map: {
    kind: 'agentKnowledge.map',
    route: '/api/goodvibes-agent/knowledge/map',
  },
  connectorsList: {
    kind: 'agentKnowledge.connectors.list',
    route: '/api/goodvibes-agent/knowledge/connectors',
  },
  ingestUrl: {
    kind: 'agentKnowledge.ingest.url',
    route: '/api/goodvibes-agent/knowledge/ingest/url',
  },
  ingestArtifact: {
    kind: 'agentKnowledge.ingest.artifact',
    route: '/api/goodvibes-agent/knowledge/ingest/artifact',
  },
  ingestUrls: {
    kind: 'agentKnowledge.ingest.urls',
    route: '/api/goodvibes-agent/knowledge/ingest/urls',
  },
  ingestBookmarks: {
    kind: 'agentKnowledge.ingest.bookmarks',
    route: '/api/goodvibes-agent/knowledge/ingest/bookmarks',
  },
  ingestBrowserHistory: {
    kind: 'agentKnowledge.ingest.browserHistory',
    route: '/api/goodvibes-agent/knowledge/ingest/browser-history',
  },
  reindex: {
    kind: 'agentKnowledge.reindex',
    route: '/api/goodvibes-agent/knowledge/reindex',
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

function readFirstStringList(args: readonly string[], names: readonly string[]): readonly string[] {
  for (const name of names) {
    const values = readStringList(args, name);
    if (values.length > 0) return values;
  }
  return [];
}

function readSinceMs(args: readonly string[]): number | undefined {
  const days = readOptionValue(args, '--since-days');
  if (!days) return undefined;
  const parsed = Number.parseInt(days, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Date.now() - parsed * 24 * 60 * 60 * 1000;
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
        error: `Connected GoodVibes service SDK version ${daemonVersion} does not match Agent SDK pin ${metadata.sdkVersion}; Agent Knowledge route is unavailable.`,
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

function queryRoute(route: string, query: JsonRecord): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim().length > 0) params.append(key, item);
      }
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString();
  return suffix ? `${route}?${suffix}` : route;
}

async function getAgentKnowledgeJson<TData>(
  connection: AgentDaemonConnection,
  route: string,
  query: JsonRecord = {},
): Promise<TData> {
  const response = await fetch(`${connection.baseUrl}${queryRoute(route, query)}`, {
    headers: {
      authorization: `Bearer ${connection.token ?? ''}`,
    },
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
    '- GoodVibes TUI owns file edits, git/worktree flows, execution isolation UX, and any WRFC owner chain.',
    wrfcRequested
      ? '- WRFC was explicitly requested by the Agent user for this build/fix/review delegation.'
      : '- WRFC was not explicitly requested; do not turn this into WRFC solely because it came from Agent.',
  ].join('\n');
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
      error: `No runtime operator token found at ${connection.tokenPath}`,
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

  if (normalized === 'list' || normalized === 'sources' || normalized === 'nodes' || normalized === 'issues') {
    const requestedKind = normalized === 'list' ? (readOptionValue(rest, '--kind') ?? 'sources').toLowerCase() : normalized;
    const kind = requestedKind === 'nodes' || requestedKind === 'issues' ? requestedKind : 'sources';
    const limit = readPositiveInt(rest, '--limit', 10);
    const method = kind === 'sources'
      ? AGENT_KNOWLEDGE_METHODS.sourcesList
      : kind === 'nodes'
        ? AGENT_KNOWLEDGE_METHODS.nodesList
        : AGENT_KNOWLEDGE_METHODS.issuesList;
    const result = await runKnowledgeCall(runtime, method, async (connection) => (
      await getAgentKnowledgeJson(connection, method.route, { limit })
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatEntityList(result.data, kind, limit)),
      exitCode: 0,
    };
  }

  if (normalized === 'get') {
    const [id] = commandValues(rest);
    if (!id) return { output: 'Usage: goodvibes-agent knowledge get <source|node|issue id>', exitCode: 2 };
    const route = `/api/goodvibes-agent/knowledge/items/${encodeURIComponent(id)}`;
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.itemGet, async (connection) => (
      await getAgentKnowledgeJson(connection, route)
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatItem(result.data, id)),
      exitCode: 0,
    };
  }

  if (normalized === 'map') {
    const limit = readPositiveInt(rest, '--limit', 50);
    const query = commandValues(rest).join(' ').trim();
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.map, async (connection) => (
      await getAgentKnowledgeJson(connection, AGENT_KNOWLEDGE_METHODS.map.route, { limit, query })
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatMap(result.data)),
      exitCode: 0,
    };
  }

  if (normalized === 'connectors') {
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.connectorsList, async (connection) => (
      await getAgentKnowledgeJson(connection, AGENT_KNOWLEDGE_METHODS.connectorsList.route)
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatConnectors(result.data)),
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

  if (normalized === 'ingest-file' || normalized === 'ingest-artifact') {
    const values = commandValues(rest);
    const path = values[0];
    if (!path) return { output: 'Usage: goodvibes-agent knowledge ingest-file <path> [--title <title>] [--tags a,b] [--folder <path>] --yes', exitCode: 2 };
    if (!confirmation.present) {
      const failure = {
        ok: false,
        kind: 'confirmation_required',
        error: `Refusing to ingest file into Agent Knowledge ${path} without --yes.`,
        route: AGENT_KNOWLEDGE_METHODS.ingestArtifact.route,
      };
      return {
        output: json ? JSON.stringify(failure, null, 2) : `${failure.error}\nUsage: goodvibes-agent knowledge ingest-file <path> [--title <title>] [--tags a,b] [--folder <path>] --yes`,
        exitCode: 2,
      };
    }
    const title = readOptionValue(rest, '--title');
    const tags = readStringList(rest, '--tags');
    const folderPath = readOptionValue(rest, '--folder');
    const connectorId = readOptionValue(rest, '--connector') ?? 'goodvibes-agent-file';
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.ingestArtifact, async (connection) => (
      await postAgentKnowledgeJson(connection, AGENT_KNOWLEDGE_METHODS.ingestArtifact.route, {
        path,
        title,
        tags,
        folderPath,
        connectorId,
        allowPrivateHosts: hasFlag(rest, '--allow-private-hosts'),
        metadata: { originSurface: 'goodvibes-agent-cli' },
      })
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatIngest(
        result.data,
        path,
        'ingest-file',
        '/api/goodvibes-agent/knowledge/ingest/artifact',
        'file',
      )),
      exitCode: 0,
    };
  }

  if (normalized === 'import-urls' || normalized === 'import-bookmarks') {
    const values = commandValues(rest);
    const path = values[0];
    const method = normalized === 'import-urls'
      ? AGENT_KNOWLEDGE_METHODS.ingestUrls
      : AGENT_KNOWLEDGE_METHODS.ingestBookmarks;
    if (!path) {
      return {
        output: `Usage: goodvibes-agent knowledge ${normalized} <path> [--allow-private-hosts] --yes`,
        exitCode: 2,
      };
    }
    if (!confirmation.present) {
      const failure = {
        ok: false,
        kind: 'confirmation_required',
        error: `Refusing to import ${path} into Agent Knowledge without --yes.`,
        route: method.route,
      };
      return {
        output: json ? JSON.stringify(failure, null, 2) : `${failure.error}\nUsage: goodvibes-agent knowledge ${normalized} <path> [--allow-private-hosts] --yes`,
        exitCode: 2,
      };
    }
    const result = await runKnowledgeCall(runtime, method, async (connection) => (
      await postAgentKnowledgeJson(connection, method.route, {
        path,
        allowPrivateHosts: hasFlag(rest, '--allow-private-hosts'),
        metadata: { originSurface: 'goodvibes-agent-cli' },
      })
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatBatchIngest(result.data, normalized)),
      exitCode: 0,
    };
  }

  if (normalized === 'import-browser-history' || normalized === 'sync-browser-history') {
    if (!confirmation.present) {
      const failure = {
        ok: false,
        kind: 'confirmation_required',
        error: 'Refusing to import browser history into Agent Knowledge without --yes.',
        route: AGENT_KNOWLEDGE_METHODS.ingestBrowserHistory.route,
      };
      return {
        output: json ? JSON.stringify(failure, null, 2) : `${failure.error}\nUsage: goodvibes-agent knowledge import-browser-history [--browsers chrome,firefox] [--sources history,bookmark] [--limit <n>] [--since-days <n>] --yes`,
        exitCode: 2,
      };
    }
    const browsers = readFirstStringList(rest, ['--browsers', '--browser']);
    const sourceKinds = readFirstStringList(rest, ['--sources', '--source-kinds', '--source-kind']);
    const homeOverride = readOptionValue(rest, '--home');
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.ingestBrowserHistory, async (connection) => (
      await postAgentKnowledgeJson(connection, AGENT_KNOWLEDGE_METHODS.ingestBrowserHistory.route, {
        browsers,
        sourceKinds,
        homeOverride,
        limit: readPositiveInt(rest, '--limit', 250),
        sinceMs: readSinceMs(rest),
        connectorId: 'goodvibes-agent-browser-history',
      })
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatBatchIngest(result.data, 'browser-history')),
      exitCode: 0,
    };
  }

  if (normalized === 'reindex') {
    if (!confirmation.present) {
      const failure = {
        ok: false,
        kind: 'confirmation_required',
        error: 'Refusing to reindex Agent Knowledge without --yes.',
        route: AGENT_KNOWLEDGE_METHODS.reindex.route,
      };
      return {
        output: json ? JSON.stringify(failure, null, 2) : `${failure.error}\nUsage: goodvibes-agent knowledge reindex --yes`,
        exitCode: 2,
      };
    }
    const result = await runKnowledgeCall(runtime, AGENT_KNOWLEDGE_METHODS.reindex, async (connection) => (
      await postAgentKnowledgeJson(connection, AGENT_KNOWLEDGE_METHODS.reindex.route, {})
    ));
    if (!result.ok) return { output: formatFailure(result, json), exitCode: 1 };
    return {
      output: formatJsonOrText(runtime.cli)(result, formatReindex(result.data)),
      exitCode: 0,
    };
  }

  return {
    output: 'Usage: goodvibes-agent knowledge [status|ask <question>|search <query>|list|sources|nodes|issues|get <id>|map|connectors|ingest-url <url> --yes|ingest-file <path> --yes|import-urls <path> --yes|import-bookmarks <path> --yes|import-browser-history --yes|reindex --yes]',
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
    `  runtime: ${daemonVersion} at ${connection.baseUrl} (${daemon.ok ? 'reachable' : 'unreachable'})`,
    `  version compatible: ${yesNo(versionCompatible)}`,
    `  operator token: ${connection.token ? 'present' : 'missing'} (${connection.tokenPath})`,
    `  Agent knowledge route: ${knowledgeRouteReady ? 'ready' : `not ready (${knowledgeRoute.ok ? 'unknown' : knowledgeRoute.kind})`}`,
    ...(versionCompatible ? [] : ['  next: update connected GoodVibes services so /status matches the Agent SDK pin.']),
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
