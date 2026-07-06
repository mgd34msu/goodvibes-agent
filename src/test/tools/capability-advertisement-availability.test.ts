/**
 * capability-advertisement-availability.test.ts
 *
 * Capability-advertisement honesty, agent side: proves the two
 * capability-surfacing seams degrade honestly for a method the SDK's
 * operator contract marks `invokable: false` (email.inbox.list / read,
 * email.draft.create, email.send — advertised /api/email/* paths with no
 * daemon route behind them; see @pellux/goodvibes-sdk's
 * method-catalog-route-reconcile and method-catalog-email.ts).
 *
 * 1. Discovery (agent-harness-operator-methods.ts): operator_methods /
 *    operator_method must render the capability DEGRADED — label says
 *    "unavailable (route not served by this daemon)", available:false,
 *    and the suggested model tool is not a real callable route.
 * 2. Execution (agent-operator-method-tool.ts): agent_operator_method must
 *    refuse to call an unavailable method with an honest error, before ever
 *    attempting a network request — the model must not be handed a tool it
 *    cannot call as if it were live.
 * 3. Regression guard: a genuinely-served method (automation.schedules.create) must
 *    still render as available and stay callable through the same paths —
 *    the degradation must not cry wolf on live capabilities.
 *
 * No real daemon runs here — the execution test proves the refusal happens
 * before any fetch is attempted, so it never touches a control-plane port.
 */

import { describe, expect, test } from 'bun:test';
import { createAgentOperatorMethodTool } from '../../tools/agent-operator-method-tool.ts';
import {
  describeHarnessOperatorMethod,
  operatorMethodSummary,
} from '../../tools/agent-harness-operator-methods.ts';

function makeShellPaths(root: string) {
  return {
    workingDirectory: root,
    homeDirectory: root,
    resolveProjectPath: (...parts: string[]) => [root, '.goodvibes', ...parts].join('/'),
    resolveUserPath: (...parts: string[]) => [root, '.goodvibes', ...parts].join('/'),
    resolveWorkspacePath: (...parts: string[]) => [root, ...parts].join('/'),
    isWithinWorkingDirectory: (path: string) => path.startsWith(root),
  };
}

function makeConfigManager(overrides: Record<string, unknown> = {}) {
  return { get: (key: string) => overrides[key] };
}

describe('capability-advertisement honesty (agent side)', () => {
  test('discovery: email.inbox.list (invokable:false) renders degraded, not as a live capability', () => {
    const summary = operatorMethodSummary({ query: 'email.inbox.list' });
    const methods = summary.methods as readonly Record<string, unknown>[];
    const emailInboxList = methods.find((method) => method.id === 'email.inbox.list');
    expect(emailInboxList).toBeDefined();
    expect(emailInboxList!.available).toBe(false);
    expect(emailInboxList!.label).toBe('email.inbox.list — unavailable (route not served by this daemon)');
    expect(emailInboxList!.modelRoute).not.toContain('agent_operator_method methodId');
  });

  test('discovery: operator_method lookup for an unavailable method reports available:false and an honest confirmation', () => {
    const resolution = describeHarnessOperatorMethod({ methodId: 'email.send' });
    expect(resolution.status).toBe('found');
    if (resolution.status !== 'found') throw new Error('expected found');
    expect(resolution.method.available).toBe(false);
    expect(resolution.method.label).toBe('email.send — unavailable (route not served by this daemon)');
    expect(String(resolution.method.confirmation)).toContain('Unavailable');
  });

  test('discovery: a genuinely-served method (automation.schedules.create) still renders as available', () => {
    const resolution = describeHarnessOperatorMethod({ methodId: 'automation.schedules.create' });
    expect(resolution.status).toBe('found');
    if (resolution.status !== 'found') throw new Error('expected found');
    expect(resolution.method.available).toBe(true);
    expect(String(resolution.method.label)).not.toContain('unavailable');
  });

  test('execution: agent_operator_method refuses an unavailable method honestly, without attempting a network call', async () => {
    const shellPaths = makeShellPaths('/tmp/capability-advertisement-availability-test-root');
    const configManager = makeConfigManager({ 'controlPlane.host': '127.0.0.1', 'controlPlane.port': 4444 });
    const tool = createAgentOperatorMethodTool(shellPaths as never, configManager);

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalled = true;
      throw new Error(`unexpected network call in a capability-availability test: ${String(args[0])}`);
    }) as unknown as typeof fetch;

    try {
      const result = await tool.execute({ methodId: 'email.inbox.list' });
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('email.inbox.list');
      expect(String(result.error)).toContain('unavailable');
      expect(String(result.error)).toContain('not served by this daemon');
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('execution: dryRun preview for an unavailable method still refuses before building a route preview', async () => {
    const shellPaths = makeShellPaths('/tmp/capability-advertisement-availability-test-root-2');
    const configManager = makeConfigManager();
    const tool = createAgentOperatorMethodTool(shellPaths as never, configManager);

    const result = await tool.execute({ methodId: 'email.send', dryRun: true });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('email.send');
    expect(String(result.error)).toContain('unavailable');
  });
});
