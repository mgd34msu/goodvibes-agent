import type { CommandRegistry } from '../command-registry.ts';
import { buildAgentWorkspaceChannels } from '../agent-workspace-channels.ts';

export function registerChannelsRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'channels',
    aliases: ['channel'],
    description: 'Inspect Agent channel readiness without sending messages',
    usage: '[list|readiness]',
    argsHint: 'list|readiness',
    handler(_args, ctx) {
      const channels = buildAgentWorkspaceChannels(ctx);
      const ready = channels.filter((channel) => channel.ready);
      const enabled = channels.filter((channel) => channel.enabled);
      const needsTarget = channels.filter((channel) => channel.setupState === 'needs-target');
      const needsConfig = channels.filter((channel) => channel.setupState === 'needs-config');
      const lines: string[] = [
        'Channel Readiness',
        `  ready: ${ready.length}/${channels.length}`,
        `  enabled: ${enabled.length}/${channels.length}`,
        `  needs target: ${needsTarget.length}`,
        `  needs config: ${needsConfig.length}`,
        '  policy: read-only inspection; sends require explicit user action and Agent policy',
        '',
        ...channels.map((channel) => {
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
        }),
      ];
      ctx.print(lines.join('\n'));
    },
  });
}
