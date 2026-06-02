import type { CommandRegistry } from '../command-registry.ts';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import {
  buildCompanionConnectionInfo,
  encodeConnectionPayload,
  formatConnectionBlock,
  generateQrMatrix,
  getOrCreateCompanionToken,
  renderQrToString,
} from '@pellux/goodvibes-sdk/platform/pairing';
import { GOODVIBES_AGENT_PAIRING_SURFACE } from '../../config/surface.ts';
import { resolveRuntimeEndpointBinding } from '../../cli/endpoints.ts';
import { requirePlatform, requireShellPaths } from './runtime-services.ts';

function getLocalNetworkIp(): string {
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const netInfo of nets[name] ?? []) {
        if (netInfo.family === 'IPv4' && !netInfo.internal) return netInfo.address;
      }
    }
  } catch {
    return '127.0.0.1';
  }
  return '127.0.0.1';
}

function urlHostForBindHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return getLocalNetworkIp();
  return host || '127.0.0.1';
}

export function registerQrcodeRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'qrcode',
    aliases: ['qr', 'pair'],
    description: 'Print companion pairing details and a QR code',
    usage: '',
    handler(_args, ctx) {
      const shellPaths = requireShellPaths(ctx);
      const configManager = requirePlatform(ctx).configManager;
      const daemonHomeDir = join(shellPaths.homeDirectory, '.goodvibes', 'daemon');
      const tokenRecord = getOrCreateCompanionToken(GOODVIBES_AGENT_PAIRING_SURFACE, { daemonHomeDir });
      const binding = resolveRuntimeEndpointBinding(configManager, 'controlPlane');
      const daemonUrl = `http://${urlHostForBindHost(binding.host)}:${binding.port}`;
      const info = buildCompanionConnectionInfo({
        daemonUrl,
        token: tokenRecord.token,
        username: 'admin',
        surface: GOODVIBES_AGENT_PAIRING_SURFACE,
      });
      const payload = encodeConnectionPayload(info);
      const qr = renderQrToString(generateQrMatrix(payload));
      ctx.print([formatConnectionBlock(info, payload), '', qr].join('\n'));
    },
  });
}
