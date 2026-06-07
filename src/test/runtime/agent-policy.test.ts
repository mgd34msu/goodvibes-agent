import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { createRuntimeServices } from '../../runtime/services.ts';
import {
  AGENT_BLOCKED_MAIN_CONVERSATION_TOOL_NAMES,
  AGENT_READ_ONLY_TOOL_MODES,
  validateAgentToolInvocationForAgentPolicy,
} from '../../tools/agent-tool-policy-guard.ts';
import { operatorMethodCatalogStatus } from '../../tools/agent-harness-operator-methods.ts';
import { createAgentOperatorMethodTool } from '../../tools/agent-operator-method-tool.ts';

describe('Agent user-first autonomy policy', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function makeRuntimeServices() {
    root = mkdtempSync(join(tmpdir(), 'gv-agent-policy-'));
    return createRuntimeServices({
      runtimeBus: new RuntimeEventBus(),
      runtimeStore: createRuntimeStore(),
      configManager: new ConfigManager({
        surfaceRoot: 'agent',
        workingDir: root,
        homeDir: root,
        configDir: join(root, '.goodvibes', 'agent'),
      }),
      workingDir: root,
      homeDirectory: root,
      getConversationTitle: () => 'Agent policy test',
    });
  }

  test('model tool policy allows visible agent orchestration and local implementation tools', () => {
    expect(AGENT_BLOCKED_MAIN_CONVERSATION_TOOL_NAMES).toEqual([]);
    expect(AGENT_READ_ONLY_TOOL_MODES).toContain('spawn');
    expect(AGENT_READ_ONLY_TOOL_MODES).toContain('batch-spawn');
    expect(AGENT_READ_ONLY_TOOL_MODES).toContain('cancel');
    expect(AGENT_READ_ONLY_TOOL_MODES).toContain('message');
    expect(AGENT_READ_ONLY_TOOL_MODES).toContain('wait');
    expect(validateAgentToolInvocationForAgentPolicy({ mode: 'spawn' })).toBeNull();
    expect(validateAgentToolInvocationForAgentPolicy({ mode: 'cancel' })).toBeNull();
  });

  test('main footer reads active agents instead of hardcoding zero', () => {
    const mainSource = readFileSync(join(import.meta.dir, '../../main.ts'), 'utf8');
    expect(mainSource).toContain('uiServices.readModels.agents.getSnapshot()');
    expect(mainSource).toContain('runningAgentCount = activeAgents.length');
    expect(mainSource).not.toContain('runningAgentCount = 0');
  });

  test('shared-session continuation spawns a visible tracked agent', async () => {
    const services = makeRuntimeServices();
    await services.sessionBroker.start();

    const submission = await services.sessionBroker.followUpMessage({
      surfaceKind: 'goodvibes-agent',
      surfaceId: 'agent-policy-test',
      body: 'Build the thing',
    });
    const broker = services.sessionBroker as unknown as {
      runQueuedFollowUp(sessionId: string): Promise<{ readonly agentId: string } | null>;
    };

    const result = await broker.runQueuedFollowUp(submission.session.id);
    expect(result?.agentId).toMatch(/^agent-/);
    expect(services.agentManager.getStatus(result!.agentId)?.task).toContain('Build the thing');
  });

  test('operator method catalog exposes the GoodVibes daemon contract dynamically', () => {
    const status = operatorMethodCatalogStatus() as {
      readonly methods: number;
      readonly readOnlyMethods: number;
      readonly confirmedMethods: number;
      readonly adminMethods: number;
      readonly categories: Record<string, number>;
      readonly policy: string;
    };

    expect(status.methods).toBeGreaterThanOrEqual(200);
    expect(status.readOnlyMethods).toBeGreaterThan(0);
    expect(status.confirmedMethods).toBeGreaterThan(0);
    expect(status.adminMethods).toBeGreaterThan(0);
    expect(status.categories.automation).toBeGreaterThan(0);
    expect(status.categories.knowledge).toBeGreaterThan(0);
    expect(status.policy).toContain('agent_operator_method');
  });

  test('generic operator method bridge previews and confirmation-gates write routes', async () => {
    const tool = createAgentOperatorMethodTool(
      { homeDirectory: root || tmpdir() } as never,
      {} as never,
    );

    const readPreview = await tool.execute({
      methodId: 'services.status',
      dryRun: true,
    });
    expect(readPreview.success).toBe(true);
    expect(readPreview.output).toContain('"methodId": "services.status"');
    expect(readPreview.output).toContain('"confirmationRequired": false');
    expect(readPreview.output).toContain('"expectedOutcome"');
    expect(readPreview.output).toContain('"installed"');

    const writePreview = await tool.execute({
      methodId: 'automation.jobs.create',
      input: { prompt: 'Summarize my inbox every morning.' },
    });
    expect(writePreview.success).toBe(false);
    expect(writePreview.error).toContain('"confirm": true');
    expect(writePreview.error).toContain('"confirmationRequired": true');

    const watcherPreview = await tool.execute({
      methodId: 'watchers.create',
      input: { label: 'Billing webhook triage', kind: 'webhook' },
      dryRun: true,
    });
    expect(watcherPreview.success).toBe(true);
    expect(watcherPreview.output).toContain('"expectedOutcome"');
    expect(watcherPreview.output).toContain('"created-visible-watcher"');
  });

  test('generic operator method bridge certifies service repair receipts', async () => {
    root = mkdtempSync(join(tmpdir(), 'gv-agent-policy-'));
    mkdirSync(join(root, '.goodvibes', 'daemon'), { recursive: true });
    writeFileSync(join(root, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token: 'service-repair-token' }));

    const originalFetch = globalThis.fetch;
    const requests: Array<{ readonly url: string; readonly method: string; readonly authorization: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        authorization: init?.headers instanceof Headers
          ? init.headers.get('authorization')
          : (init?.headers as Record<string, string> | undefined)?.authorization ?? null,
      });
      return new Response(JSON.stringify({
        platform: 'linux',
        path: '/tmp/goodvibes.service',
        installed: true,
        autostart: true,
        running: true,
        pid: 1234,
        commandPreview: 'goodvibes service start',
        suggestedCommands: [],
        lastAction: 'start',
        network: {
          controlPlane: { ready: true },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;

    try {
      const tool = createAgentOperatorMethodTool(
        { homeDirectory: root } as never,
        {
          get: (key: string) => key === 'controlPlane.port'
            ? 3429
            : key === 'controlPlane.host'
              ? '127.0.0.1'
              : undefined,
        },
      );
      const result = await tool.execute({
        methodId: 'services.start',
        confirm: true,
        explicitUserRequest: 'Start the GoodVibes service.',
      });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      const output = JSON.parse(result.output) as {
        readonly body: { readonly running: boolean };
        readonly outcome: {
          readonly status: string;
          readonly certified: boolean;
          readonly evidence: { readonly running: boolean; readonly actionError: string | null };
          readonly expectedOutcome: { readonly target: string; readonly verificationRoute: string };
        };
      };
      expect(requests[0]).toEqual({
        url: 'http://127.0.0.1:3429/api/service/start',
        method: 'POST',
        authorization: 'Bearer service-repair-token',
      });
      expect(output.body.running).toBe(true);
      expect(output.outcome.status).toBe('certified');
      expect(output.outcome.certified).toBe(true);
      expect(output.outcome.evidence).toMatchObject({ running: true, actionError: null });
      expect(output.outcome.expectedOutcome.target).toBe('running-service');
      expect(output.outcome.expectedOutcome.verificationRoute).toContain('services.status');
      expect(result.output).not.toContain('service-repair-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('generic operator method bridge certifies watcher receipts', async () => {
    root = mkdtempSync(join(tmpdir(), 'gv-agent-policy-'));
    mkdirSync(join(root, '.goodvibes', 'daemon'), { recursive: true });
    writeFileSync(join(root, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token: 'watcher-receipt-token' }));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: 'watcher-billing',
      kind: 'webhook',
      label: 'Billing webhook triage',
      state: 'active',
      source: {
        id: 'billing',
        kind: 'webhook',
        label: 'Billing webhook',
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
      },
      metadata: {},
      lastCheckpoint: 'created',
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch;

    try {
      const tool = createAgentOperatorMethodTool(
        { homeDirectory: root } as never,
        {
          get: (key: string) => key === 'controlPlane.port'
            ? 3429
            : key === 'controlPlane.host'
              ? '127.0.0.1'
              : undefined,
        },
      );
      const result = await tool.execute({
        methodId: 'watchers.create',
        input: { label: 'Billing webhook triage', kind: 'webhook' },
        confirm: true,
        explicitUserRequest: 'Create a billing webhook watcher.',
      });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      const output = JSON.parse(result.output) as {
        readonly outcome: {
          readonly kind: string;
          readonly status: string;
          readonly certified: boolean;
          readonly evidence: { readonly id: string; readonly state: string; readonly sourceEnabled: boolean; readonly lastError: string | null };
          readonly expectedOutcome: { readonly target: string; readonly verificationRoute: string };
        };
      };
      expect(output.outcome.kind).toBe('watcher-receipt');
      expect(output.outcome.status).toBe('certified');
      expect(output.outcome.certified).toBe(true);
      expect(output.outcome.evidence).toMatchObject({
        id: 'watcher-billing',
        state: 'active',
        sourceEnabled: true,
        lastError: null,
      });
      expect(output.outcome.expectedOutcome.target).toBe('created-visible-watcher');
      expect(output.outcome.expectedOutcome.verificationRoute).toContain('watchers.list');
      expect(result.output).not.toContain('watcher-receipt-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
