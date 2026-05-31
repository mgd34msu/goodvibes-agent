import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { listInstalledEcosystemEntries, loadEcosystemCatalog } from '@/runtime/index.ts';
import { BUILTIN_SUITES } from '@/runtime/index.ts';
import { requireEcosystemCatalogPaths, requireReadModels, requireSecretsManager, requireServiceRegistry, requireShellPaths } from './runtime-services.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

interface TrustReviewBundle {
  readonly version: 1;
  readonly capturedAt: number;
  readonly permissionMode: string;
  readonly secretKeys: readonly string[];
  readonly serviceNames: readonly string[];
  readonly pluginSummary: {
    readonly total: number;
    readonly trusted: number;
    readonly limited: number;
    readonly untrusted: number;
    readonly quarantined: number;
  };
  readonly mcpSummary: {
    readonly total: number;
    readonly constrained: number;
    readonly askOnRisk: number;
    readonly allowAll: number;
    readonly blocked: number;
    readonly quarantined: number;
  };
}

interface ReleaseBundle {
  readonly version: 1;
  readonly capturedAt: number;
  readonly runtime: {
    readonly provider: string;
    readonly model: string;
    readonly sessionId: string;
  };
  readonly evalSuites: readonly string[];
  readonly incidentCount: number;
  readonly remote: {
    readonly pools: number;
    readonly contracts: number;
    readonly artifacts: number;
  };
  readonly ecosystem: {
    readonly pluginCatalog: number;
    readonly skillCatalog: number;
    readonly installedPlugins: number;
    readonly installedSkills: number;
  };
}

function countByMode<T extends string>(values: readonly T[], mode: T): number {
  return values.filter((value) => value === mode).length;
}

function buildTrustReviewBundle(ctx: CommandContext): Promise<TrustReviewBundle> {
  return (async () => {
    const secretKeys = await requireSecretsManager(ctx).list();
    const services = Object.keys(requireServiceRegistry(ctx).getAll()).sort((a, b) => a.localeCompare(b));
    const security = requireReadModels(ctx).security.getSnapshot();
    const plugins = security.plugins;
    const mcpServers = security.mcpServers;
    return {
      version: 1,
      capturedAt: Date.now(),
      permissionMode: String(ctx.platform.configManager.get('permissions.mode')),
      secretKeys,
      serviceNames: services,
      pluginSummary: {
        total: plugins.length,
        trusted: plugins.filter((plugin) => plugin.trustTier === 'trusted').length,
        limited: plugins.filter((plugin) => plugin.trustTier === 'limited').length,
        untrusted: plugins.filter((plugin) => plugin.trustTier === 'untrusted').length,
        quarantined: plugins.filter((plugin) => plugin.quarantined).length,
      },
      mcpSummary: {
        total: mcpServers.length,
        constrained: countByMode(mcpServers.map((server) => server.trustMode), 'constrained'),
        askOnRisk: countByMode(mcpServers.map((server) => server.trustMode), 'ask-on-risk'),
        allowAll: countByMode(mcpServers.map((server) => server.trustMode), 'allow-all'),
        blocked: countByMode(mcpServers.map((server) => server.trustMode), 'blocked'),
        quarantined: mcpServers.filter((server) => server.schemaFreshness === 'quarantined').length,
      },
    };
  })();
}

function formatTrustReview(bundle: TrustReviewBundle): string {
  return [
    'Trust Review',
    `  permission mode: ${bundle.permissionMode}`,
    `  secrets stored: ${bundle.secretKeys.length}`,
    `  configured services: ${bundle.serviceNames.length}`,
    `  plugins: ${bundle.pluginSummary.total} (trusted ${bundle.pluginSummary.trusted}, limited ${bundle.pluginSummary.limited}, untrusted ${bundle.pluginSummary.untrusted}, quarantined ${bundle.pluginSummary.quarantined})`,
    `  MCP servers: ${bundle.mcpSummary.total} (constrained ${bundle.mcpSummary.constrained}, ask-on-risk ${bundle.mcpSummary.askOnRisk}, allow-all ${bundle.mcpSummary.allowAll}, blocked ${bundle.mcpSummary.blocked}, quarantined ${bundle.mcpSummary.quarantined})`,
  ].join('\n');
}

function inspectTrustBundle(path: string): string {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as TrustReviewBundle;
  return [
    'Trust Bundle Review',
    `  captured: ${new Date(parsed.capturedAt).toISOString()}`,
    `  permission mode: ${parsed.permissionMode}`,
    `  secrets stored: ${parsed.secretKeys.length}`,
    `  configured services: ${parsed.serviceNames.length}`,
    `  plugins: ${parsed.pluginSummary.total}`,
    `  MCP servers: ${parsed.mcpSummary.total}`,
  ].join('\n');
}

function buildReleaseBundle(ctx: Parameters<NonNullable<CommandRegistry['register']>>[0]['handler'] extends (args: string[], context: infer C) => unknown ? C : never): ReleaseBundle {
  const remoteRuntime = ctx.ops.remoteRuntime;
  const incidents = ctx.extensions.forensicsRegistry?.getAll() ?? [];
  const ecosystemPaths = requireEcosystemCatalogPaths(ctx);
  return {
    version: 1,
    capturedAt: Date.now(),
    runtime: {
      provider: ctx.session.runtime.provider,
      model: ctx.session.runtime.model,
      sessionId: ctx.session.runtime.sessionId,
    },
    evalSuites: Object.keys(BUILTIN_SUITES),
    incidentCount: incidents.length,
    remote: {
      pools: remoteRuntime?.listPools().length ?? 0,
      contracts: remoteRuntime?.listContracts().length ?? 0,
      artifacts: remoteRuntime?.listArtifacts().length ?? 0,
    },
    ecosystem: {
      pluginCatalog: loadEcosystemCatalog('plugin', ecosystemPaths).length,
      skillCatalog: loadEcosystemCatalog('skill', ecosystemPaths).length,
      installedPlugins: listInstalledEcosystemEntries('plugin', ecosystemPaths).length,
      installedSkills: listInstalledEcosystemEntries('skill', ecosystemPaths).length,
    },
  };
}

function inspectReleaseBundle(path: string): string {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ReleaseBundle;
  return [
    'Release Bundle Review',
    `  provider/model: ${parsed.runtime.provider || '(unset)'}/${parsed.runtime.model || '(unset)'}`,
    `  eval suites: ${parsed.evalSuites.length}`,
    `  incidents: ${parsed.incidentCount}`,
    `  remote pools/contracts/artifacts: ${parsed.remote.pools}/${parsed.remote.contracts}/${parsed.remote.artifacts}`,
    `  ecosystem catalog plugins/skills: ${parsed.ecosystem.pluginCatalog}/${parsed.ecosystem.skillCatalog}`,
  ].join('\n');
}

export function registerProductRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'trust',
    description: 'Review trust posture and export portable trust bundles',
    usage: '[review|bundle export <path> --yes|bundle inspect <path>]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const shellPaths = requireShellPaths(ctx);
      const sub = commandArgs[0] ?? 'review';
      if (sub === 'review') {
        const bundle = await buildTrustReviewBundle(ctx);
        ctx.print(formatTrustReview(bundle));
        return;
      }
      if (sub === 'bundle') {
        const mode = commandArgs[1];
        const pathArg = commandArgs[2];
        if ((mode === 'export' || mode === 'inspect') && !pathArg) {
          ctx.print(`Usage: /trust bundle ${mode} <path>${mode === 'export' ? ' --yes' : ''}`);
          return;
        }
        if (mode === 'export') {
          if (!parsed.yes) {
            requireYesFlag(ctx, `export trust bundle to ${pathArg}`, '/trust bundle export <path> --yes');
            return;
          }
          const bundle = await buildTrustReviewBundle(ctx);
          const targetPath = shellPaths.resolveWorkspacePath(pathArg!);
          mkdirSync(dirname(targetPath), { recursive: true });
          writeFileSync(targetPath, JSON.stringify(bundle, null, 2) + '\n', 'utf-8');
          ctx.print(`Trust bundle exported to ${targetPath}`);
          return;
        }
        if (mode === 'inspect') {
          ctx.print(inspectTrustBundle(shellPaths.resolveWorkspacePath(pathArg!)));
          return;
        }
      }
      ctx.print('Usage: /trust [review|bundle export <path> --yes|bundle inspect <path>]');
    },
  });
  registry.register({
    name: 'bridge',
    description: 'Review and operate self-hosted bridge and remote runner flows',
    usage: '[status|pools|assign <pool> <runner> --yes|runner <id>|review <artifactId>|export <artifactId> [path] --yes|import <path> --yes]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const shellPaths = requireShellPaths(ctx);
      if (!ctx.ops.remoteRuntime) {
        ctx.print('Remote runner registry is not available in this runtime.');
        return;
      }
      const remoteRegistry = ctx.ops.remoteRuntime;
      const sub = commandArgs[0] ?? 'status';
      if (sub === 'status') {
        const remote = requireReadModels(ctx).remote.getSnapshot();
        ctx.print([
          'Bridge Status',
          `  remote pools: ${remote.pools.length}`,
          `  runner contracts: ${remote.contracts.length}`,
          `  review artifacts: ${remote.artifacts.length}`,
        ].join('\n'));
        return;
      }
      if (sub === 'pools') {
        const pools = remoteRegistry.listPools();
        ctx.print(pools.length > 0
          ? ['Bridge Pools', ...pools.map((pool) => `  ${pool.id}  runners=${pool.runnerIds.length}  trust=${pool.trustClass}`)].join('\n')
          : 'Bridge Pools\n  No runner pools registered yet.');
        return;
      }
      if (sub === 'assign') {
        const poolId = commandArgs[1];
        const runnerId = commandArgs[2];
        if (!poolId || !runnerId) {
          ctx.print('Usage: /bridge assign <pool> <runner> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `assign bridge runner ${runnerId} to pool ${poolId}`, '/bridge assign <pool> <runner> --yes');
          return;
        }
        const pool = remoteRegistry.assignRunnerToPool(poolId, runnerId);
        if (!pool) {
          ctx.print(`Unable to assign runner ${runnerId} to pool ${poolId}.`);
          return;
        }
        ctx.print(`Assigned runner ${runnerId} to bridge pool ${poolId}.`);
        return;
      }
      if (sub === 'runner') {
        const runnerId = commandArgs[1];
        if (!runnerId) {
          ctx.print('Usage: /bridge runner <id>');
          return;
        }
        const contract = remoteRegistry.getContract(runnerId);
        if (!contract) {
          ctx.print(`Unknown runner contract: ${runnerId}`);
          return;
        }
        ctx.print([
          `Bridge Runner ${runnerId}`,
          `  template: ${contract.template}`,
          `  trustClass: ${contract.trustClass}`,
          `  transport: ${contract.sourceTransport}/${contract.transport.state}`,
          `  tools: ${contract.capabilityCeiling.allowedTools.join(', ') || '(none)'}`,
          `  pool: ${contract.poolId ?? '(unassigned)'}`,
        ].join('\n'));
        return;
      }
      if (sub === 'review') {
        const artifactId = commandArgs[1];
        if (!artifactId) {
          ctx.print('Usage: /bridge review <artifactId>');
          return;
        }
        const summary = remoteRegistry.buildReviewSummary(artifactId);
        ctx.print(summary ?? `Unknown remote artifact: ${artifactId}`);
        return;
      }
      if (sub === 'export') {
        const artifactId = commandArgs[1];
        if (!artifactId) {
          ctx.print('Usage: /bridge export <artifactId> [path] --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `export bridge artifact ${artifactId}`, '/bridge export <artifactId> [path] --yes');
          return;
        }
        const exported = await remoteRegistry.exportArtifact(
          artifactId,
          commandArgs[2] ? shellPaths.resolveWorkspacePath(commandArgs[2]) : undefined,
        );
        if (!exported) {
          ctx.print(`Unknown remote artifact: ${artifactId}`);
          return;
        }
        ctx.print(`Exported remote bridge artifact to ${exported.path}`);
        return;
      }
      if (sub === 'import') {
        const pathArg = commandArgs[1];
        if (!pathArg) {
          ctx.print('Usage: /bridge import <path> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `import bridge artifact from ${pathArg}`, '/bridge import <path> --yes');
          return;
        }
        const artifact = await remoteRegistry.importArtifact(shellPaths.resolveWorkspacePath(pathArg));
        ctx.print(`Imported remote bridge artifact ${artifact.id} for runner ${artifact.runnerId}.`);
        return;
      }
      ctx.print('Usage: /bridge [status|pools|assign <pool> <runner> --yes|runner <id>|review <artifactId>|export <artifactId> [path] --yes|import <path> --yes]');
    },
  });

  registry.register({
    name: 'release',
    description: 'Package certification and release-readiness operations',
    usage: '[review|checklist|bundle export <path> --yes|bundle inspect <path>]',
    handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const shellPaths = requireShellPaths(ctx);
      const sub = commandArgs[0] ?? 'review';
      if (sub === 'review') {
        const bundle = buildReleaseBundle(ctx);
        ctx.print([
          'Release Review',
          `  provider/model: ${bundle.runtime.provider || '(unset)'}/${bundle.runtime.model || '(unset)'}`,
          `  eval suites: ${bundle.evalSuites.length}`,
          `  incidents: ${bundle.incidentCount}`,
          `  remote pools/contracts/artifacts: ${bundle.remote.pools}/${bundle.remote.contracts}/${bundle.remote.artifacts}`,
          `  ecosystem catalog plugins/skills: ${bundle.ecosystem.pluginCatalog}/${bundle.ecosystem.skillCatalog}`,
          `  installed plugins/skills: ${bundle.ecosystem.installedPlugins}/${bundle.ecosystem.installedSkills}`,
        ].join('\n'));
        return;
      }
      if (sub === 'checklist') {
        ctx.print([
          'Release Checklist',
          '  1. Run /setup review and /setup doctor',
          '  2. Run /security review and /trust review',
          '  3. Run /policy preflight and /policy simulate',
          '  4. Run /eval gate <suite> for required certification suites',
          '  5. Review /incident latest and /bridge status',
          '  6. Export /release bundle export <path> --yes for release evidence',
        ].join('\n'));
        return;
      }
      if (sub === 'bundle') {
        const mode = commandArgs[1];
        const pathArg = commandArgs[2];
        if ((mode === 'export' || mode === 'inspect') && !pathArg) {
          ctx.print(`Usage: /release bundle ${mode} <path>${mode === 'export' ? ' --yes' : ''}`);
          return;
        }
        if (mode === 'export') {
          if (!parsed.yes) {
            requireYesFlag(ctx, `export release bundle to ${pathArg}`, '/release bundle export <path> --yes');
            return;
          }
          const bundle = buildReleaseBundle(ctx);
          const targetPath = shellPaths.resolveWorkspacePath(pathArg!);
          mkdirSync(dirname(targetPath), { recursive: true });
          writeFileSync(targetPath, JSON.stringify(bundle, null, 2) + '\n', 'utf-8');
          ctx.print(`Release bundle exported to ${targetPath}`);
          return;
        }
        if (mode === 'inspect') {
          ctx.print(inspectReleaseBundle(shellPaths.resolveWorkspacePath(pathArg!)));
          return;
        }
      }
      ctx.print('Usage: /release [review|checklist|bundle export <path> --yes|bundle inspect <path>]');
    },
  });
}
