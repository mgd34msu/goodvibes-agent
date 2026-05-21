import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'bun:test';
import type { AgentConfig } from '../src/config.js';
import { delegateToTui, shouldDelegateToTui, shouldRequestWrfc, type DelegationDaemonClient } from '../src/assistant/delegation.js';
import { formatDelegationStatus, loadDelegationStatusSnapshot, type DelegationStatusClient } from '../src/assistant/delegation-status.js';
import type { RouteId } from '../src/daemon/routes.js';
import { DaemonConnectionError } from '../src/daemon/client.js';
import { DelegationReceiptStore } from '../src/store/delegations.js';

describe('TUI delegation', () => {
  test('uses the public sessions message payload shape', async () => {
    let capturedRoute = '';
    let capturedInput: Record<string, unknown> | undefined;
    const config: AgentConfig = {
      baseUrl: 'http://127.0.0.1:3421',
      surfaceKind: 'goodvibes-agent',
      surfaceId: 'goodvibes-agent-test',
      defaultChatTitle: 'GoodVibes Agent',
      companionTimeoutMs: 90_000,
      autoRemember: true,
      autoDelegateBuildRequests: true,
    };
    const client: DelegationDaemonClient = {
      createSharedSession: async () => ({
        sessionId: 'session-1',
        session: { id: 'session-1' },
      }),
      invoke: async <T = unknown>(routeId: RouteId, input: Record<string, unknown>): Promise<T> => {
        capturedRoute = routeId;
        capturedInput = input;
        return { sessionId: 'session-1', mode: 'queued' } as T;
      },
    };

    const result = await delegateToTui(client, config, {
      task: 'Build a durable task inbox with wrfc',
    });

    expect(result.delegated).toBe(true);
    expect(result.receipt.requestedWrfc).toBe(true);
    expect(result.receipt.checkCommand).toContain(result.receipt.id);
    expect(capturedRoute).toBe('sessions.messages.create');
    expect(capturedInput).toBeDefined();
    const payload = expectRecord(capturedInput);
    expect(payload.sessionId).toBe('session-1');
    expect(payload.surfaceKind).toBe('goodvibes-agent');
    expect(payload.surfaceId).toBe('goodvibes-agent-test');
    expect(payload.kind).toBe('task');
    expect(String(payload.body)).toContain('requestedExecution: wrfc');
    expect(payload.routing).toEqual({
      executionIntent: {
        riskClass: 'elevated',
        requiresApproval: false,
        networkPolicy: 'inherit',
        filesystemPolicy: 'workspace-write',
      },
      reasoningEffort: 'high',
    });
    expect('reviewMode' in payload).toBe(false);
    expect('executionProtocol' in payload).toBe(false);
    expect('dangerously_disable_wrfc' in payload).toBe(false);
    expect('metadata' in payload).toBe(false);
  });

  test('delegates serial TUI work without WRFC when not explicitly requested', async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const client: DelegationDaemonClient = {
      createSharedSession: async () => ({ sessionId: 'session-2', session: { id: 'session-2' } }),
      invoke: async <T = unknown>(_routeId: RouteId, input: Record<string, unknown>): Promise<T> => {
        capturedInput = input;
        return { sessionId: 'session-2', mode: 'queued' } as T;
      },
    };

    const result = await delegateToTui(client, testConfig(), {
      task: 'Build a small inbox',
    });

    const payload = expectRecord(capturedInput);
    expect(String(payload.body)).toContain('requestedExecution: serial-tui');
    expect(String(payload.body)).toContain('wrfcRequested: false');
    expect(result.receipt.requestedWrfc).toBe(false);
    expect(shouldDelegateToTui('hello, summarize my day')).toBe(false);
    expect(shouldRequestWrfc('hello, summarize my day')).toBe(false);
  });

  test('persists local delegation receipts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'goodvibes-agent-delegations-'));
    try {
      const path = join(dir, 'delegations.json');
      const store = new DelegationReceiptStore(path);
      const receipt = store.record({
        task: 'Build status view',
        summary: 'Build status view',
        requestedWrfc: false,
        mode: 'queued',
        sessionId: 'session-3',
        surfaceKind: 'goodvibes-agent',
        surfaceId: 'agent-test',
      });
      const reloaded = new DelegationReceiptStore(path);
      expect(reloaded.find(receipt.id)?.sessionId).toBe('session-3');
      expect(reloaded.find('session-3')?.id).toBe(receipt.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('delegation status degrades route failures while keeping local receipts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'goodvibes-agent-delegations-'));
    try {
      const store = new DelegationReceiptStore(join(dir, 'delegations.json'));
      const receipt = store.record({
        task: 'Build route diagnostics',
        summary: 'Build route diagnostics',
        requestedWrfc: true,
        mode: 'queued',
        sessionId: 'session-4',
        surfaceKind: 'goodvibes-agent',
        surfaceId: 'agent-test',
      });
      const client: DelegationStatusClient = {
        invoke: async () => {
          throw new DaemonConnectionError('daemon_unavailable', 'daemon unavailable for test');
        },
      };

      const snapshot = await loadDelegationStatusSnapshot(client, testConfig(), store, receipt.id);
      const text = formatDelegationStatus(snapshot);

      expect(snapshot.selected?.id).toBe(receipt.id);
      expect(snapshot.sessions.error?.kind).toBe('daemon_unavailable');
      expect(text).toContain(receipt.id);
      expect(text).toContain('Sessions warning: daemon_unavailable');
      expect(text).toContain('Tasks warning: daemon_unavailable');
      expect(text).toContain('Work plan warning: daemon_unavailable');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function testConfig(): AgentConfig {
  return {
    baseUrl: 'http://127.0.0.1:3421',
    surfaceKind: 'goodvibes-agent',
    surfaceId: 'goodvibes-agent-test',
    defaultChatTitle: 'GoodVibes Agent',
    companionTimeoutMs: 90_000,
    autoRemember: true,
    autoDelegateBuildRequests: true,
  };
}

function expectRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeDefined();
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}
