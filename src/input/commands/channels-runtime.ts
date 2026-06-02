import type { CommandRegistry } from '../command-registry.ts';
import type { AgentWorkspaceChannelStatus } from '../agent-workspace-channels.ts';
import { buildAgentWorkspaceChannels } from '../agent-workspace-channels.ts';

type ChannelFilter = 'all' | 'ready' | 'attention';

function formatChannelLine(channel: AgentWorkspaceChannelStatus): string {
  const missing = channel.missingRequiredKeys.length > 0
    ? ` missing=${channel.missingRequiredKeys.join('|')}`
    : '';
  const target = channel.configuredDefaultTargetKeys.length > 0
    ? ` target=${channel.configuredDefaultTargetKeys.join('|')}`
    : channel.defaultTargetKeys.length > 0
      ? ` target=missing(${channel.defaultTargetKeys.join('|')})`
      : ' target=not-required';
  return [
    `  ${channel.label}: ${channel.setupState}`,
    `ready=${channel.ready ? 'yes' : 'no'}`,
    `delivery=${channel.delivery}`,
    `risk=${channel.risk}`,
    target,
    missing,
  ].join(' ');
}

function filterChannels(
  channels: readonly AgentWorkspaceChannelStatus[],
  filter: ChannelFilter,
): readonly AgentWorkspaceChannelStatus[] {
  if (filter === 'ready') return channels.filter((channel) => channel.ready);
  if (filter === 'attention') return channels.filter((channel) => channel.enabled && channel.setupState !== 'ready');
  return channels;
}

function printChannelSummary(
  print: (message: string) => void,
  channels: readonly AgentWorkspaceChannelStatus[],
  filter: ChannelFilter,
): void {
  const ready = channels.filter((channel) => channel.ready);
  const enabled = channels.filter((channel) => channel.enabled);
  const needsTarget = channels.filter((channel) => channel.setupState === 'needs-target');
  const needsConfig = channels.filter((channel) => channel.setupState === 'needs-config');
  const filtered = filterChannels(channels, filter);
  const title = filter === 'ready'
    ? 'Channel Readiness: Ready'
    : filter === 'attention'
      ? 'Channel Readiness: Needs Attention'
      : 'Channel Readiness';
  const lines: string[] = [
    title,
    `  ready: ${ready.length}/${channels.length}`,
    `  enabled: ${enabled.length}/${channels.length}`,
    `  needs target: ${needsTarget.length}`,
    `  needs config: ${needsConfig.length}`,
    '  policy: read-only inspection; sends require explicit user action and Agent policy',
    '  details: /channels show <id>',
    '',
    ...(filtered.length > 0
      ? filtered.map(formatChannelLine)
      : [`  No ${filter === 'ready' ? 'ready' : 'attention'} channels matched.`]),
  ];
  print(lines.join('\n'));
}

function printChannelDetail(
  print: (message: string) => void,
  channel: AgentWorkspaceChannelStatus,
): void {
  print([
    `Channel: ${channel.label} (${channel.id})`,
    `  state: ${channel.setupState}`,
    `  enabled: ${channel.enabled ? 'yes' : 'no'}`,
    `  ready: ${channel.ready ? 'yes' : 'no'}`,
    `  delivery: ${channel.delivery}`,
    `  risk: ${channel.risk} (${channel.riskLabel})`,
    `  required config keys: ${channel.requiredKeys.join(', ') || 'none'}`,
    `  missing config keys: ${channel.missingRequiredKeys.join(', ') || 'none'}`,
    `  default target keys: ${channel.defaultTargetKeys.join(', ') || 'not required'}`,
    `  configured target keys: ${channel.configuredDefaultTargetKeys.join(', ') || 'none'}`,
    `  next: ${channel.nextStep}`,
    '  policy: this command never prints secret values and never sends messages',
  ].join('\n'));
}

export function registerChannelsRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'channels',
    aliases: ['channel'],
    description: 'Inspect Agent channel readiness without sending messages',
    usage: '[list|readiness|ready|attention|show <id>]',
    argsHint: 'list|readiness|ready|attention|show',
    handler(args, ctx) {
      const channels = buildAgentWorkspaceChannels(ctx);
      const subcommand = (args[0] ?? 'readiness').trim().toLowerCase();

      if (subcommand === 'list' || subcommand === 'readiness') {
        printChannelSummary(ctx.print, channels, 'all');
        return;
      }

      if (subcommand === 'ready') {
        printChannelSummary(ctx.print, channels, 'ready');
        return;
      }

      if (subcommand === 'attention' || subcommand === 'issues') {
        printChannelSummary(ctx.print, channels, 'attention');
        return;
      }

      if (subcommand === 'show') {
        const channelId = args[1]?.trim().toLowerCase();
        if (!channelId) {
          ctx.print('Usage: /channels show <id>');
          return;
        }
        const channel = channels.find((entry) => entry.id.toLowerCase() === channelId || entry.label.toLowerCase() === channelId);
        if (!channel) {
          ctx.print(`Unknown channel: ${channelId}\nUse /channels list to see available channel ids.`);
          return;
        }
        printChannelDetail(ctx.print, channel);
        return;
      }

      ctx.print('Usage: /channels [list|readiness|ready|attention|show <id>]');
    },
  });
}
