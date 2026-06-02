import { describe, expect, test } from 'bun:test';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerChannelsRuntimeCommands } from '../../input/commands/channels-runtime.ts';

function channelContext(overrides: Record<string, unknown> = {}): { readonly context: CommandContext; readonly printed: string[] } {
  const values: Record<string, unknown> = {
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
  } as unknown as CommandContext;
  return { context, printed };
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
});
