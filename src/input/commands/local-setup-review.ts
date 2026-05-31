import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CommandContext } from '../command-registry.ts';
import { discoverSkills } from '../../panels/skills-panel.ts';
import { getPluginDirectories } from '../../plugins/loader';
import { listBuiltinSubscriptionProviders } from '@pellux/goodvibes-sdk/platform/config';
import type { SetupReviewSnapshot } from './local-setup-transfer.ts';
import { requireProviderApi, requireReadModels, requireServiceRegistry, requireShellPaths, requireSubscriptionManager } from './runtime-services.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';

export async function buildSetupReviewSnapshot(ctx: CommandContext): Promise<SetupReviewSnapshot> {
  const shellPaths = requireShellPaths(ctx);
  const serviceRegistry = requireServiceRegistry(ctx);
  const services = Object.keys(serviceRegistry.getAll()).sort((a, b) => a.localeCompare(b));
  const serviceConfigs = serviceRegistry.getAll();
  const serviceIssues: string[] = [];
  for (const name of services) {
    const inspection = await serviceRegistry.inspect(name);
    if (!inspection?.hasPrimaryCredential) {
      serviceIssues.push(`${name}: missing primary credential`);
    }
  }

  const skills = await discoverSkills(shellPaths);
  const security = requireReadModels(ctx).security.getSnapshot();
  const plugins = security.plugins;
  const mcpServers = security.mcpServers;
  const pluginDirectories = getPluginDirectories({
    cwd: shellPaths.workingDirectory,
    homeDir: shellPaths.homeDirectory,
  });
  const providerCount = (await requireProviderApi(ctx).listModels()).length;
  const remoteRunnerCount = ctx.ops.remoteRuntime?.listContracts().length ?? 0;
  const oauthProviderCount = Object.values(serviceConfigs).filter((service) => service.authType === 'oauth' && service.oauth).length;
  const builtinSubscriptionProviderCount = listBuiltinSubscriptionProviders().length;
  const subscriptionManager = requireSubscriptionManager(ctx);
  const activeSubscriptionCount = subscriptionManager.list().length;
  const pendingSubscriptionCount = subscriptionManager.listPending().length;
  const quarantinedPluginCount = plugins.filter((plugin) => plugin.quarantined).length;
  const quarantinedMcpCount = mcpServers.filter((server) => server.schemaFreshness === 'quarantined').length;
  const elevatedMcpCount = mcpServers.filter((server) => server.trustMode === 'allow-all').length;
  const hooksPath = shellPaths.resolveProjectPath('hooks.managed.json');
  let managedHookCount = 0;
  let managedHookChainCount = 0;
  if (existsSync(hooksPath)) {
    try {
      const parsed = JSON.parse(readFileSync(hooksPath, 'utf-8')) as { hooks?: unknown[]; chains?: unknown[] };
      managedHookCount = parsed.hooks?.length ?? 0;
      managedHookChainCount = parsed.chains?.length ?? 0;
    } catch {
      // Ignore malformed hook config during snapshot collection.
    }
  }

  const issues: SetupReviewSnapshot['issues'] = [
    {
      severity: providerCount > 0 ? 'pass' : 'fail',
      area: 'providers',
      message: providerCount > 0 ? `${providerCount} model(s) available` : 'no models available',
    },
    {
      severity: (services.length === 0 && oauthProviderCount === 0 && builtinSubscriptionProviderCount === 0) ? 'warn' : serviceIssues.length === 0 ? 'pass' : 'warn',
      area: 'services',
      message: (services.length === 0 && oauthProviderCount === 0 && builtinSubscriptionProviderCount === 0)
        ? 'no services configured'
        : serviceIssues.length === 0
          ? `${services.length} service(s), ${oauthProviderCount + builtinSubscriptionProviderCount} oauth provider(s), ${activeSubscriptionCount} active subscription override(s)`
          : `${serviceIssues.length} service configuration issue(s)`,
    },
    {
      severity: quarantinedPluginCount === 0 ? 'pass' : 'warn',
      area: 'plugins',
      message: quarantinedPluginCount === 0
        ? `${plugins.length} plugin(s) discovered`
        : `${quarantinedPluginCount} plugin(s) quarantined`,
    },
    {
      severity: quarantinedMcpCount === 0 && elevatedMcpCount === 0 ? 'pass' : 'warn',
      area: 'mcp',
      message: quarantinedMcpCount > 0 || elevatedMcpCount > 0
        ? `${quarantinedMcpCount} quarantined, ${elevatedMcpCount} elevated`
        : `${mcpServers.length} server(s) known`,
    },
    {
      severity: managedHookCount > 0 || managedHookChainCount > 0 ? 'pass' : 'warn',
      area: 'hooks',
      message: `${managedHookCount} managed hook(s), ${managedHookChainCount} chain(s)`,
    },
    {
      severity: remoteRunnerCount > 0 ? 'pass' : 'warn',
      area: 'remote',
      message: remoteRunnerCount > 0 ? `${remoteRunnerCount} remote runner contract(s)` : 'no remote runner contracts registered',
    },
  ];

  return {
    sessionId: ctx.session.runtime.sessionId,
    providerCount,
    serviceCount: services.length,
    oauthProviderCount,
    builtinSubscriptionProviderCount,
    activeSubscriptionCount,
    pendingSubscriptionCount,
    serviceIssues,
    skillCount: skills.length,
    pluginCount: plugins.length,
    quarantinedPluginCount,
    pluginDirectories,
    managedHookCount,
    managedHookChainCount,
    mcpServerCount: mcpServers.length,
    quarantinedMcpCount,
    elevatedMcpCount,
    remoteRunnerCount,
    issues,
    services,
  };
}

export function exportSetupSupportBundle(
  targetDirArg: string,
  snapshot: SetupReviewSnapshot,
  ctx: CommandContext,
): string {
  const shellPaths = requireShellPaths(ctx);
  const targetDir = shellPaths.resolveWorkspacePath(targetDirArg);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'startup-review.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  const servicesPath = shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'services.json');
  if (existsSync(servicesPath)) {
    writeFileSync(join(targetDir, 'services.json'), readFileSync(servicesPath, 'utf-8'), 'utf-8');
  }
  const hooksPath = shellPaths.resolveProjectPath('hooks.managed.json');
  if (existsSync(hooksPath)) {
    writeFileSync(join(targetDir, 'hooks.managed.json'), readFileSync(hooksPath, 'utf-8'), 'utf-8');
  }
  return targetDir;
}
