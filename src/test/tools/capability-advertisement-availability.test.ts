/**
 * capability-advertisement-availability.test.ts
 *
 * Capability-advertisement honesty, agent side: proves the two
 * capability-surfacing seams degrade honestly for a method the SDK's
 * operator contract marks `invokable: false`. channels.inbox.list is the
 * current example: it is advertised but not backed by a served route,
 * since serving it means building a provider-inbound aggregator, not
 * wiring an existing one (see @pellux/goodvibes-sdk's method-catalog-channels.ts).
 *
 * 1. Discovery (agent-harness-operator-methods.ts): operator_methods /
 *    operator_method must render the capability DEGRADED — label says
 *    "unavailable (route not served by this daemon)", available:false,
 *    and the suggested model tool is not a real callable route.
 * 2. Execution (agent-operator-method-tool.ts): agent_operator_method must
 *    refuse to call an unavailable method with an honest error, before ever
 *    attempting a network request — the model must not be handed a tool it
 *    cannot call as if it were live.
 * 3. Regression guard: genuinely-served methods (automation.schedules.create,
 *    channels.drafts.save, the email.* family) must still render as available
 *    and stay callable through the same paths — the degradation must not cry
 *    wolf on live capabilities.
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
  test('discovery: channels.inbox.list (invokable:false) renders degraded, not as a live capability', () => {
    const summary = operatorMethodSummary({ query: 'channels.inbox.list' });
    const methods = summary.methods as readonly Record<string, unknown>[];
    const channelsInboxList = methods.find((method) => method.id === 'channels.inbox.list');
    expect(channelsInboxList).toBeDefined();
    expect(channelsInboxList!.available).toBe(false);
    expect(channelsInboxList!.label).toBe('channels.inbox.list — unavailable (route not served by this daemon)');
    expect(channelsInboxList!.modelRoute).not.toContain('agent_operator_method methodId');
  });

  test('discovery: operator_method lookup for an unavailable method reports available:false and an honest confirmation', () => {
    const resolution = describeHarnessOperatorMethod({ methodId: 'channels.inbox.list' });
    expect(resolution.status).toBe('found');
    if (resolution.status !== 'found') throw new Error('expected found');
    expect(resolution.method.available).toBe(false);
    expect(resolution.method.label).toBe('channels.inbox.list — unavailable (route not served by this daemon)');
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
      const result = await tool.execute({ methodId: 'channels.inbox.list' });
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('channels.inbox.list');
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

    const result = await tool.execute({ methodId: 'channels.inbox.list', dryRun: true });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('channels.inbox.list');
    expect(String(result.error)).toContain('unavailable');
  });

  /**
   * The other direction, and the reason the methods above had to change.
   *
   * email.* was the original subject of this test precisely BECAUSE nothing
   * served it. The IMAP/SMTP service is platform capability now
   * (@pellux/goodvibes-sdk/platform/email) and the daemon attaches a real
   * handler to each id (platform/control-plane/routes/email.ts), so these are
   * live routes. Asserting that here is what stops the degradation logic from
   * quietly going on describing them as broken after they were fixed.
   */
  test('discovery: the email methods the daemon now serves render as live, not degraded', () => {
    for (const methodId of ['email.inbox.list', 'email.inbox.read', 'email.send', 'email.draft.create']) {
      const resolution = describeHarnessOperatorMethod({ methodId });
      expect(resolution.status, `${methodId} should be catalogued`).toBe('found');
      if (resolution.status !== 'found') throw new Error('expected found');
      expect(resolution.method.available, `${methodId} is served by the daemon now`).toBe(true);
      expect(String(resolution.method.label)).not.toContain('unavailable');
    }
  });

  /**
   * channels.drafts.save (and the rest of the channels.drafts.* family) was
   * this test's other unavailable example until the daemon attached a real
   * route behind it. channels.inbox.list is the one channels.* method still
   * without a served route (see the file header), so it carries that role now.
   * Asserting the drafts family here catches the same staleness if it recurs.
   */
  test('discovery: the channels drafts methods the daemon now serves render as live, not degraded', () => {
    for (const methodId of ['channels.drafts.save', 'channels.drafts.get', 'channels.drafts.list', 'channels.drafts.delete']) {
      const resolution = describeHarnessOperatorMethod({ methodId });
      expect(resolution.status, `${methodId} should be catalogued`).toBe('found');
      if (resolution.status !== 'found') throw new Error('expected found');
      expect(resolution.method.available, `${methodId} is served by the daemon now`).toBe(true);
      expect(String(resolution.method.label)).not.toContain('unavailable');
    }
  });
});
