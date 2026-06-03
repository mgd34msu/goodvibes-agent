import { networkInterfaces } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import type { PanelManager } from '../panel-manager.ts';
import { SessionBrowserPanel } from '../session-browser-panel.ts';
import { QrPanel } from '../qr-panel.ts';
import { DocsPanel } from '../docs-panel.ts';
import { PanelListPanel } from '../panel-list-panel.ts';
import { TokenBudgetPanel } from '../token-budget-panel.ts';
import type { ResolvedBuiltinPanelDeps } from './shared.ts';
import { requireUiServices } from './shared.ts';
import {
  buildCompanionConnectionInfo,
} from '@pellux/goodvibes-sdk/platform/pairing';
import { copyToClipboard } from '../../utils/clipboard.ts';
import { GOODVIBES_AGENT_PAIRING_SURFACE } from '../../config/surface.ts';

function getLocalNetworkIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function readBootstrapPassword(credentialPath: string): string | undefined {
  try {
    const content = readFileSync(credentialPath, 'utf-8');
    for (const line of content.split('\n')) {
      if (line.startsWith('password=')) {
        return line.slice('password='.length).trim();
      }
    }
  } catch {
    // credential file may not exist yet
  }
  return undefined;
}

function readOperatorToken(tokenPath: string): string | null {
  if (!existsSync(tokenPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const token = (parsed as Record<string, unknown>)['token'];
    return typeof token === 'string' && token.trim().length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function registerSessionPanels(manager: PanelManager, deps: ResolvedBuiltinPanelDeps): void {
  manager.registerType({
    id: 'qr-code',
    name: 'QR Code',
    icon: 'Q',
    category: 'session',
    description: 'QR code for companion app pairing through the connected GoodVibes host',
    factory: () => {
      if (!deps.connectedHostTokenDir) throw new Error('connected host token directory must be provided to the session panel factory via BuiltinPanelDeps');
      const token = readOperatorToken(`${deps.connectedHostTokenDir}/operator-tokens.json`);
      const connectedHostPort = deps.configManager.get('controlPlane.port');
      const connectedHostName = String(process.env['GOODVIBES_AGENT_RUNTIME_HOST'] ?? process.env['GOODVIBES_DAEMON_HOST'] ?? getLocalNetworkIp());
      const connectedHostUrl = `http://${connectedHostName}:${connectedHostPort}`;
      const bootstrapPassword = readBootstrapPassword(deps.localUserAuthManager.getBootstrapCredentialPath());
      const connectionInfo = token
        ? buildCompanionConnectionInfo({
          daemonUrl: connectedHostUrl,
          token,
          password: bootstrapPassword,
          surface: GOODVIBES_AGENT_PAIRING_SURFACE,
        })
        : {
          url: connectedHostUrl,
          token: '',
          username: 'admin',
          ...(bootstrapPassword !== undefined ? { password: bootstrapPassword } : {}),
          surface: GOODVIBES_AGENT_PAIRING_SURFACE,
        };
      return new QrPanel(connectionInfo, undefined, copyToClipboard);
    },
  });

  manager.registerType({
    id: 'sessions',
    name: 'Sessions',
    icon: 'H',
    category: 'session',
    description: 'Browse, search, and resume past conversation sessions',
    factory: () => new SessionBrowserPanel(deps.sessionManager, deps.resumeSession),
  });

  manager.registerType({
    id: 'docs',
    name: 'Docs',
    icon: '?',
    category: 'session',
    description: 'Tool list, model capabilities, and keyboard shortcut reference',
    factory: () => new DocsPanel(deps.toolRegistry, deps.providerRegistry),
  });

  manager.registerType({
    id: 'panel-list',
    name: 'Panel List',
    icon: 'L',
    category: 'session',
    description: 'Browse all registered panels grouped by category, with open/closed status and Enter-to-open',
    factory: () => new PanelListPanel(manager, deps.componentHealthMonitor),
  });

  manager.registerType({
    id: 'system-messages',
    name: 'System Messages',
    icon: 'J',
    category: 'monitoring',
    description: 'Operational system messages routed away from the main conversation (scans, discovery, plugin events, tool status)',
    preload: true,
    factory: () => deps.systemMessagesPanel,
  });

  manager.registerType({
    id: 'tokens',
    name: 'Tokens',
    icon: 'K',
    category: 'monitoring',
    description: 'Token budget tracker: per-turn and cumulative usage with context window gauge',
    factory: () => {
      const panel = new TokenBudgetPanel(deps.sessionMemoryStore, deps.configManager);
      if (deps.orchestrator && deps.getCtxWindow) {
        panel.wire(deps.orchestrator, deps.getCtxWindow, requireUiServices(deps).readModels.session);
      }
      return panel;
    },
  });
}
