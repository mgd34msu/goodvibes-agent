import { describe, expect, test } from 'bun:test';
import type { AgentConfig } from '../src/config.js';
import type { GoodVibesDaemonClient } from '../src/daemon/client.js';
import { delegateToTui } from '../src/assistant/delegation.js';

describe('TUI delegation', () => {
  test('uses the public sessions message payload shape', async () => {
    let capturedRoute = '';
    let capturedInput: Record<string, unknown> | undefined;
    const config: AgentConfig = {
      baseUrl: 'http://127.0.0.1:3421',
      surfaceKind: 'goodvibes-agent',
      surfaceId: 'goodvibes-agent-test',
      defaultChatTitle: 'GoodVibes Agent',
      autoRemember: true,
      autoDelegateBuildRequests: true,
    };
    const client = {
      createSharedSession: async () => ({
        sessionId: 'session-1',
        session: { id: 'session-1' },
      }),
      invoke: async (routeId: string, input: Record<string, unknown>) => {
        capturedRoute = routeId;
        capturedInput = input;
        return { sessionId: 'session-1', mode: 'queued' };
      },
    } as unknown as GoodVibesDaemonClient;

    const result = await delegateToTui(client, config, {
      task: 'Build a durable task inbox with wrfc',
    });

    expect(result.delegated).toBe(true);
    expect(capturedRoute).toBe('sessions.messages.create');
    expect(capturedInput).toBeDefined();
    const payload = capturedInput as Record<string, unknown>;
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
});
