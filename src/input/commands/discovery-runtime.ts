import type { CommandRegistry } from '../command-registry.ts';
import { scan, persistProviders } from '@pellux/goodvibes-sdk/platform/discovery';
import { requireProviderApi, requireShellPaths } from './runtime-services.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

export function registerDiscoveryRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'scan',
    aliases: [],
    description: 'Scan localhost and LAN for local LLM servers',
    usage: '[--yes]',
    async handler(args, ctx) {
      const { yes } = stripYesFlag(args);
      ctx.print('Scanning for local LLM servers...');
      ctx.renderRequest();

      const result = await scan();

      if (result.servers.length === 0) {
        ctx.print(
          `[Scan] No local LLM servers found (scanned ${result.scannedHosts} hosts, ` +
          `${result.scannedPorts} ports in ${Math.round(result.durationMs / 1000)}s)`,
        );
      } else {
        const lines = [
          `[Scan] Found ${result.servers.length} server(s) in ${Math.round(result.durationMs / 1000)}s:`,
          '',
          ...result.servers.map((server) =>
            `  ${server.name.padEnd(30)} ${server.models.length} model(s)  ${server.host}:${server.port}`,
          ),
          '',
          'Use /model to select a discovered model.',
        ];
        ctx.print(lines.join('\n'));
      }

      if (result.servers.length > 0) {
        if (!yes) {
          requireYesFlag(ctx, 'persist discovered local provider configuration', '/scan --yes');
          ctx.print('[Scan] Discovery results were not saved. Rerun /scan --yes to register and persist providers.');
          ctx.renderRequest();
          return;
        }
        try {
          await requireProviderApi(ctx).registerDiscoveredProviders(result.servers);
        } catch (err) {
          ctx.print(`[Scan] Warning: failed to register some providers: ${summarizeError(err)}`);
        }
        const shellPaths = requireShellPaths(ctx);
        persistProviders({
          homeDirectory: shellPaths.homeDirectory,
          surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
        }, result.servers);
        ctx.print('[Scan] Discovered providers registered and persisted.');
      }
      ctx.renderRequest();
    },
  });
}
