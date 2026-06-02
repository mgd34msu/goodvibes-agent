import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerChannelsRuntimeCommands } from '../../input/commands/channels-runtime.ts';

function channelContext(
  overrides: Record<string, unknown> = {},
  homeDirectory?: string,
): { readonly context: CommandContext; readonly printed: string[] } {
  const values: Record<string, unknown> = {
    'controlPlane.host': '127.0.0.1',
    'controlPlane.port': 3421,
    'surfaces.slack.enabled': true,
    'surfaces.slack.botToken': 'xoxb-redacted-test-token',
    'surfaces.slack.signingSecret': 'redacted-signing-secret',
    'surfaces.slack.defaultChannel': 'C123',
    'surfaces.telegram.enabled': true,
    'surfaces.telegram.botToken': 'telegram-redacted-token',
    ...overrides,
  };
  const printed: string[] = [];
  const context = {
    print: (message: string) => printed.push(message),
    platform: {
      configManager: {
        get: (key: string) => values[key],
      },
    },
    workspace: {
      shellPaths: {
        homeDirectory: homeDirectory ?? mkdtempSync(join(tmpdir(), 'goodvibes-agent-channels-home-')),
      },
    },
  } as unknown as CommandContext;
  return { context, printed };
}

function writeTokenHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-channels-token-'));
  const tokenDir = join(home, '.goodvibes', 'daemon');
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(join(tokenDir, 'operator-tokens.json'), JSON.stringify({ token: 'route-token-redacted' }));
  return home;
}

async function withMockFetch<T>(handler: typeof fetch, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runChannels(args: readonly string[], context: CommandContext): Promise<void> {
  const registry = new CommandRegistry();
  registerChannelsRuntimeCommands(registry);
  await registry.execute('channels', [...args], context);
}

describe('/channels command', () => {
  test('prints a read-only readiness summary with detail guidance', async () => {
    const { context, printed } = channelContext();

    await runChannels([], context);

    const output = printed.join('\n');
    expect(output).toContain('Channel Readiness');
    expect(output).toContain('ready: 2/13');
    expect(output).toContain('enabled: 2/13');
    expect(output).toContain('needs target: 1');
    expect(output).toContain('details: /channels show <id>');
    expect(output).toContain('Slack: ready ready=yes delivery=default-ready risk=group');
    expect(output).toContain('Telegram: needs-target ready=yes delivery=explicit-target risk=dm');
    expect(output).not.toContain('xoxb-redacted-test-token');
    expect(output).not.toContain('telegram-redacted-token');
  });

  test('filters enabled channels that need attention', async () => {
    const { context, printed } = channelContext({
      'surfaces.discord.enabled': true,
      'surfaces.discord.botToken': 'discord-redacted-token',
    });

    await runChannels(['attention'], context);

    const output = printed.join('\n');
    expect(output).toContain('Channel Readiness: Needs Attention');
    expect(output).toContain('Telegram: needs-target');
    expect(output).toContain('Discord: needs-config');
    expect(output).not.toContain('Slack: ready');
    expect(output).not.toContain('discord-redacted-token');
  });

  test('shows one channel with config-key names and next step only', async () => {
    const { context, printed } = channelContext();

    await runChannels(['show', 'telegram'], context);

    const output = printed.join('\n');
    expect(output).toContain('Channel: Telegram (telegram)');
    expect(output).toContain('state: needs-target');
    expect(output).toContain('required config keys: surfaces.telegram.botToken');
    expect(output).toContain('missing config keys: none');
    expect(output).toContain('default target keys: surfaces.telegram.defaultChatId');
    expect(output).toContain('next: Provide an explicit delivery target per send');
    expect(output).toContain('never prints secret values and never sends messages');
    expect(output).not.toContain('telegram-redacted-token');
  });

  test('prints read-only connected-host channel account and policy diagnostics without secret values', async () => {
    const { context, printed } = channelContext({}, writeTokenHome());

    await withMockFetch(async (input, init) => {
      expect(String(init?.headers ? (init.headers as Record<string, string>).authorization : '')).toContain('Bearer route-token-redacted');
      const path = new URL(String(input)).pathname;
      if (path === '/api/channels/accounts') {
        return new Response(JSON.stringify({
          accounts: [
            {
              surface: 'slack',
              accountId: 'workspace-1',
              configured: true,
              linked: true,
              authState: 'linked',
              secrets: [{ field: 'primary', source: 'config', value: 'xoxb-secret-should-not-print' }],
            },
          ],
        }));
      }
      if (path === '/api/channels/policies') {
        return new Response(JSON.stringify({
          policies: [
            {
              surface: 'slack',
              allowDirectMessages: false,
              allowlistUserIds: ['alice'],
              allowlistGroupIds: ['ops'],
              groupPolicies: [{ id: 'ops-policy' }],
            },
          ],
        }));
      }
      return new Response('not found', { status: 404 });
    }, async () => {
      await runChannels(['accounts'], context);
      await runChannels(['policies'], context);
    });

    const output = printed.join('\n');
    expect(output).toContain('Channel Accounts');
    expect(output).toContain('slack/workspace-1: configured; linked; auth=linked; secret refs=primary:config');
    expect(output).toContain('Channel Policies');
    expect(output).toContain('slack: direct=no; allowlist users=1; groups=1; group policies=1');
    expect(output).not.toContain('xoxb-secret-should-not-print');
    expect(output).not.toContain('route-token-redacted');
  });

  test('prints channel status doctor and setup schema from read-only connected-host routes', async () => {
    const { context, printed } = channelContext({}, writeTokenHome());

    await withMockFetch(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/channels/status') {
        return new Response(JSON.stringify({ channels: [{ surface: 'telegram', enabled: true, ready: false, state: 'needs-target' }] }));
      }
      if (path === '/api/channels/doctor/telegram') {
        return new Response(JSON.stringify({
          surface: 'telegram',
          checks: [{ id: 'configured', status: 'pass' }],
          repairActions: [{ id: 'inspect' }],
        }));
      }
      if (path === '/api/channels/setup/telegram') {
        return new Response(JSON.stringify({
          surface: 'telegram',
          version: 1,
          fields: [{ id: 'mode' }],
          secretTargets: [{ id: 'primary', required: true }],
        }));
      }
      return new Response('not found', { status: 404 });
    }, async () => {
      await runChannels(['status'], context);
      await runChannels(['doctor', 'telegram'], context);
      await runChannels(['setup', 'telegram'], context);
    });

    const output = printed.join('\n');
    expect(output).toContain('Connected Channel Status');
    expect(output).toContain('telegram: enabled; not-ready; state=needs-target');
    expect(output).toContain('Channel Doctor: telegram');
    expect(output).toContain('configured: pass');
    expect(output).toContain('Available repair action ids:');
    expect(output).toContain('Channel Setup Schema: telegram');
    expect(output).toContain('mode');
    expect(output).toContain('primary (required)');
  });

  test('connected-host channel routes fail closed when runtime auth is missing', async () => {
    const { context, printed } = channelContext();

    await runChannels(['accounts'], context);

    const output = printed.join('\n');
    expect(output).toContain('Channel accounts: unavailable');
    expect(output).toContain('kind: auth_required');
    expect(output).toContain('no channel send/action route was called');
  });
});
