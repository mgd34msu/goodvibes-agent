import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { handleAgentKnowledgeCommand } from '../../cli/agent-knowledge-command.ts';
import { parseGoodVibesCli } from '../../cli/parser.ts';

const roots: string[] = [];

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

function createRuntime(commandArgs: readonly string[]) {
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
    cli: parseGoodVibesCli(['knowledge', ...commandArgs, '--json']),
    configManager,
    workingDirectory,
    homeDirectory,
  };
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

      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://127.0.0.1:3421/api/goodvibes-agent/knowledge/ingest/url');
      expect(requests[0]?.url).not.toContain('/api/knowledge/');
      expect(requests[0]?.body).toContain('"title":"Agent Manual"');
      expect(parsed).toMatchObject({
        ok: true,
        kind: 'agentKnowledge.ingest.url',
        route: '/api/goodvibes-agent/knowledge/ingest/url',
      });
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
});
