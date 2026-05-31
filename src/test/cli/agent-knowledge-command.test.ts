import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { handleAgentKnowledgeCommand, handleAgentKnowledgeShortcutCommand } from '../../cli/agent-knowledge-command.ts';
import { parseGoodVibesCli } from '../../cli/parser.ts';

const roots: string[] = [];

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

function createRuntimeForArgv(argv: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), 'gv-agent-knowledge-cli-'));
  roots.push(root);
  const workingDirectory = join(root, 'workspace');
  const homeDirectory = join(root, 'home');
  mkdirSync(join(homeDirectory, '.goodvibes', 'daemon'), { recursive: true });
  mkdirSync(workingDirectory, { recursive: true });
  writeFileSync(
    join(homeDirectory, '.goodvibes', 'daemon', 'operator-tokens.json'),
    JSON.stringify({ token: 'test-token' }),
  );
  const configManager = new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    workingDir: workingDirectory,
    homeDir: homeDirectory,
  });
  return {
    cli: parseGoodVibesCli([...argv, '--json']),
    configManager,
    workingDirectory,
    homeDirectory,
  };
}

function createRuntime(commandArgs: readonly string[]) {
  return createRuntimeForArgv(['knowledge', ...commandArgs]);
}

function readSdkPin(): string {
  const parsed = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'unknown';
  const dependencies = (parsed as { readonly dependencies?: unknown }).dependencies;
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) return 'unknown';
  const version = (dependencies as Record<string, unknown>)['@pellux/goodvibes-sdk'];
  return typeof version === 'string' ? version : 'unknown';
}

function inputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Agent Knowledge CLI route isolation', () => {
  test('implementation does not invoke default knowledge ingest operator method from the CLI', () => {
    const source = readFileSync(join(process.cwd(), 'src/cli/agent-knowledge-command.ts'), 'utf-8');
    expect(source).toContain("@pellux/goodvibes-sdk/browser/agent");
    expect(source).not.toContain("operator.invoke('knowledge.ingest.url'");
    expect(source).toContain('/api/goodvibes-agent/knowledge/ingest/url');
  });

  test('ingest-url uses the Agent Knowledge route and never the default wiki path', async () => {
    const requests: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return new Response(JSON.stringify({
        source: {
          id: 'src-agent-manual',
          canonicalUri: 'https://example.test/agent-manual',
          sourceType: 'url',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) satisfies typeof fetch;

    try {
      const result = await handleAgentKnowledgeCommand(createRuntime([
        'ingest-url',
        'https://example.test/agent-manual',
        '--title',
        'Agent Manual',
        '--tags',
        'agent,manual',
      ]));
      const parsed = JSON.parse(result.output) as unknown;

      expect(result.exitCode).toBe(2);
      expect(requests).toHaveLength(0);
      expect(parsed).toMatchObject({
        ok: false,
        kind: 'confirmation_required',
        route: '/api/goodvibes-agent/knowledge/ingest/url',
      });

      const confirmed = await handleAgentKnowledgeCommand(createRuntime([
        'ingest-url',
        'https://example.test/agent-manual',
        '--title',
        'Agent Manual',
        '--tags',
        'agent,manual',
        '--yes',
      ]));
      const confirmedParsed = JSON.parse(confirmed.output) as unknown;

      expect(confirmed.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://127.0.0.1:3421/api/goodvibes-agent/knowledge/ingest/url');
      expect(requests[0]?.url).not.toContain('/api/knowledge/');
      expect(requests[0]?.body).toContain('"title":"Agent Manual"');
      expect(confirmedParsed).toMatchObject({
        ok: true,
        kind: 'agentKnowledge.ingest.url',
        route: '/api/goodvibes-agent/knowledge/ingest/url',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects Knowledge space flags before any daemon request', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('daemon must not be called for rejected Agent Knowledge scope flags');
    }) satisfies typeof fetch;

    try {
      const result = await handleAgentKnowledgeCommand(createRuntime([
        'search',
        'what',
        'is',
        'Agent?',
        '--includeAllSpaces',
      ]));
      const parsed = JSON.parse(result.output) as unknown;

      expect(result.exitCode).toBe(2);
      expect(parsed).toMatchObject({
        ok: false,
        kind: 'agent_knowledge_scope_rejected',
        route: '/api/goodvibes-agent/knowledge/*',
      });
      expect(result.output).toContain('must not use default Knowledge/Wiki, HomeGraph, or Home Assistant spaces');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('status JSON reports Agent Knowledge route identity', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ready: true,
      sourceCount: 0,
      nodeCount: 0,
      edgeCount: 0,
      issueCount: 0,
      storagePath: 'knowledge-agent.sqlite',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) satisfies typeof fetch;

    try {
      const result = await handleAgentKnowledgeCommand(createRuntime(['status']));
      const parsed = JSON.parse(result.output) as unknown;

      expect(result.exitCode).toBe(0);
      expect(parsed).toMatchObject({
        ok: true,
        kind: 'agentKnowledge.status',
        route: '/api/goodvibes-agent/knowledge/status',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ask uses only the Agent Knowledge route', async () => {
    const requests: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return new Response(JSON.stringify({
        query: 'What is GoodVibes Agent?',
        answer: {
          text: 'No Agent-owned knowledge has been ingested yet.',
          mode: 'standard',
          confidence: 0,
          synthesized: false,
          sources: [],
          facts: [],
          linkedObjects: [],
          gaps: [],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) satisfies typeof fetch;

    try {
      const result = await handleAgentKnowledgeCommand(createRuntime([
        'ask',
        'What',
        'is',
        'GoodVibes',
        'Agent?',
      ]));
      const parsed = JSON.parse(result.output) as unknown;

      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://127.0.0.1:3421/api/goodvibes-agent/knowledge/ask');
      expect(requests[0]?.url).not.toContain('/api/knowledge/');
      expect(parsed).toMatchObject({
        ok: true,
        kind: 'agentKnowledge.ask',
        route: '/api/goodvibes-agent/knowledge/ask',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('top-level ask shortcut uses only the Agent Knowledge route', async () => {
    const requests: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return new Response(JSON.stringify({
        query: 'What is GoodVibes Agent?',
        answer: {
          text: 'No Agent-owned knowledge has been ingested yet.',
          mode: 'standard',
          confidence: 0,
          synthesized: false,
          sources: [],
          facts: [],
          linkedObjects: [],
          gaps: [],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) satisfies typeof fetch;

    try {
      const runtime = createRuntimeForArgv(['ask', 'What', 'is', 'GoodVibes', 'Agent?']);
      const result = await handleAgentKnowledgeShortcutCommand(runtime, 'ask');
      const parsed = JSON.parse(result.output) as unknown;

      expect(runtime.cli.command).toBe('ask');
      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://127.0.0.1:3421/api/goodvibes-agent/knowledge/ask');
      expect(requests[0]?.url).not.toContain('/api/knowledge/');
      expect(parsed).toMatchObject({
        ok: true,
        kind: 'agentKnowledge.ask',
        route: '/api/goodvibes-agent/knowledge/ask',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('search uses only the Agent Knowledge route', async () => {
    const requests: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return new Response(JSON.stringify({
        query: 'GoodVibes Agent',
        results: [],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) satisfies typeof fetch;

    try {
      const result = await handleAgentKnowledgeCommand(createRuntime([
        'search',
        'GoodVibes',
        'Agent',
      ]));
      const parsed = JSON.parse(result.output) as unknown;

      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://127.0.0.1:3421/api/goodvibes-agent/knowledge/search');
      expect(requests[0]?.url).not.toContain('/api/knowledge/');
      expect(parsed).toMatchObject({
        ok: true,
        kind: 'agentKnowledge.search',
        route: '/api/goodvibes-agent/knowledge/search',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('classifies missing Agent Knowledge route on older daemon as version_mismatch without default wiki fallback', async () => {
    const requests: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = inputUrl(input);
      requests.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      if (url === 'http://127.0.0.1:3421/status') {
        return new Response(JSON.stringify({ version: '0.33.30' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error('Route not found: /api/goodvibes-agent/knowledge/status (404)');
    }) satisfies typeof fetch;

    try {
      const result = await handleAgentKnowledgeCommand(createRuntime(['status']));
      const parsed = JSON.parse(result.output) as unknown;

      expect(result.exitCode).toBe(1);
      expect(requests.map((request) => request.url)).toEqual([
        'http://127.0.0.1:3421/api/goodvibes-agent/knowledge/status',
        'http://127.0.0.1:3421/status',
      ]);
      expect(requests.some((request) => request.url.includes('/api/knowledge/'))).toBe(false);
      expect(parsed).toMatchObject({
        ok: false,
        kind: 'version_mismatch',
        route: '/api/goodvibes-agent/knowledge/status',
        daemonVersion: '0.33.30',
        expectedSdkVersion: readSdkPin(),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
