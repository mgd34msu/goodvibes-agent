import { dirname, join } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CommandRegistry } from '../command-registry.ts';
import type { ConfigKey } from '../../config/index.ts';
import { CONFIG_SCHEMA } from '../../config/index.ts';
import { listHookPointContracts } from '@pellux/goodvibes-sdk/platform/hooks';
import type { SetupTransferBundle } from './local-setup-transfer.ts';
import {
  buildSetupTransferBundle,
  createSetupLink,
  exportSetupTransferBundle,
  inspectSetupTransferBundle,
  parseSetupLink,
} from './local-setup-transfer.ts';
import { buildSetupReviewSnapshot, exportSetupSupportBundle } from './local-setup-review.ts';
import { openOnboardingWizard, requirePanelManager, requireShellPaths } from './runtime-services.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

type SetupSnapshot = Awaited<ReturnType<typeof buildSetupReviewSnapshot>>;

export function registerLocalSetupCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'setup',
    aliases: ['startup'],
    description: 'Launch the onboarding wizard and review Agent startup readiness',
    usage: '[review|doctor|services|hooks|remote|onboarding|support-bundle <dir> --yes|export <path> --yes|transfer <export|inspect|import> <path> [--yes]|link <surface> [target]|open-link <uri>]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const sub = commandArgs[0] ?? 'review';
      let shellPaths: ReturnType<typeof requireShellPaths> | null = null;
      let snapshotPromise: Promise<SetupSnapshot> | null = null;
      const getShellPaths = () => (shellPaths ??= requireShellPaths(ctx));
      const getSnapshot = async (): Promise<SetupSnapshot> => {
        snapshotPromise ??= buildSetupReviewSnapshot(ctx);
        return snapshotPromise;
      };

      if (sub === 'review') {
        const snapshot = await getSnapshot();
        ctx.print([
          'Startup Readiness Review',
          `  session: ${snapshot.sessionId}`,
          `  providers/models: ${snapshot.providerCount}`,
          `  services configured: ${snapshot.serviceCount}`,
          `  oauth providers: ${snapshot.oauthProviderCount + snapshot.builtinSubscriptionProviderCount}`,
          `  active subscriptions: ${snapshot.activeSubscriptionCount}`,
          `  pending subscriptions: ${snapshot.pendingSubscriptionCount}`,
          `  skills discovered: ${snapshot.skillCount}`,
          `  plugins discovered: ${snapshot.pluginCount}`,
          `  quarantined plugins: ${snapshot.quarantinedPluginCount}`,
          `  plugin search dirs: ${snapshot.pluginDirectories.length}`,
          `  managed hooks: ${snapshot.managedHookCount}`,
          `  managed hook chains: ${snapshot.managedHookChainCount}`,
          `  mcp servers known: ${snapshot.mcpServerCount}`,
          `  mcp quarantined: ${snapshot.quarantinedMcpCount}`,
          `  mcp elevated: ${snapshot.elevatedMcpCount}`,
          `  remote runners: ${snapshot.remoteRunnerCount}`,
          '',
          `  service ids: ${snapshot.services.join(', ') || '(none)'}`,
          `  plugin dirs: ${snapshot.pluginDirectories.join(', ') || '(none)'}`,
        ].join('\n'));
        return;
      }

      if (sub === 'doctor') {
        const snapshot = await getSnapshot();
        ctx.print([
          'Startup Doctor',
          ...snapshot.issues.map((issue) => `  [${issue.severity.toUpperCase()}] ${issue.area}: ${issue.message}`),
          ...(snapshot.serviceIssues.length > 0
            ? ['', '  Service issues:', ...snapshot.serviceIssues.map((issue) => `    - ${issue}`)]
            : []),
        ].join('\n'));
        return;
      }

      if (sub === 'services') {
        const snapshot = await getSnapshot();
        ctx.print([
          'Startup Services',
          `  configured: ${snapshot.serviceCount}`,
          `  oauth providers: ${snapshot.oauthProviderCount + snapshot.builtinSubscriptionProviderCount}`,
          `  active subscriptions: ${snapshot.activeSubscriptionCount}`,
          `  pending subscriptions: ${snapshot.pendingSubscriptionCount}`,
          `  issues: ${snapshot.serviceIssues.length}`,
          ...snapshot.services.map((name) => `  ${name}`),
          ...(snapshot.serviceIssues.length > 0
            ? ['', ...snapshot.serviceIssues.map((issue) => `  issue: ${issue}`)]
            : []),
        ].join('\n'));
        return;
      }

      if (sub === 'hooks') {
        const snapshot = await getSnapshot();
        const contracts = listHookPointContracts();
        ctx.print([
          'Startup Hooks',
          `  managed hooks: ${snapshot.managedHookCount}`,
          `  managed chains: ${snapshot.managedHookChainCount}`,
          `  hook contracts: ${contracts.length}`,
        ].join('\n'));
        return;
      }

      if (sub === 'remote') {
        const snapshot = await getSnapshot();
        const runners = ctx.ops.remoteRuntime?.listContracts() ?? [];
        ctx.print([
          'Startup Remote',
          `  runner contracts: ${snapshot.remoteRunnerCount}`,
          ...runners.map((runner) => `  ${runner.id}  [${runner.trustClass}]  ${runner.label}`),
        ].join('\n'));
        return;
      }

      if (sub === 'onboarding') {
        openOnboardingWizard(ctx, { mode: 'edit', reset: true });
        ctx.print('Opening onboarding wizard.');
        return;
      }

      if (sub === 'support-bundle') {
        const dirArg = commandArgs[1];
        if (!dirArg) {
          ctx.print('Usage: /setup support-bundle <dir> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `export setup support bundle to ${dirArg}`, '/setup support-bundle <dir> --yes');
          return;
        }
        const snapshot = await getSnapshot();
        const targetDir = exportSetupSupportBundle(dirArg, snapshot, ctx);
        writeFileSync(join(targetDir, 'remote-summary.json'), JSON.stringify({
          runners: ctx.ops.remoteRuntime?.listContracts() ?? [],
          artifacts: (ctx.ops.remoteRuntime?.listArtifacts() ?? []).map((artifact) => ({
            id: artifact.id,
            runnerId: artifact.runnerId,
            status: artifact.task.status,
            createdAt: artifact.createdAt,
          })),
        }, null, 2) + '\n', 'utf-8');
        ctx.print(`Exported support bundle to ${targetDir}`);
        return;
      }

      if (sub === 'export') {
        const pathArg = commandArgs[1];
        if (!pathArg) {
          ctx.print('Usage: /setup export <path> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `export startup review to ${pathArg}`, '/setup export <path> --yes');
          return;
        }
        const snapshot = await getSnapshot();
        const targetPath = getShellPaths().resolveWorkspacePath(pathArg);
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
        ctx.print(`Exported startup review to ${targetPath}`);
        return;
      }

      if (sub === 'transfer') {
        const mode = commandArgs[1]?.toLowerCase();
        const pathArg = commandArgs[2];
        if (!mode || !pathArg) {
          ctx.print('Usage: /setup transfer <export|inspect|import> <path> [--yes]');
          return;
        }
        const targetPath = getShellPaths().resolveWorkspacePath(pathArg);
        if (mode === 'export') {
          if (!parsed.yes) {
            requireYesFlag(ctx, `export setup transfer bundle to ${pathArg}`, '/setup transfer export <path> --yes');
            return;
          }
          const snapshot = await getSnapshot();
          const bundle = buildSetupTransferBundle(ctx, snapshot);
          ctx.print(`Exported setup transfer bundle to ${exportSetupTransferBundle(ctx, pathArg, bundle)}`);
          return;
        }
        if (mode === 'inspect') {
          try {
            const bundle = JSON.parse(readFileSync(targetPath, 'utf-8')) as SetupTransferBundle;
            ctx.print(`${inspectSetupTransferBundle(bundle)}\n  path: ${targetPath}`);
          } catch (error) {
            ctx.print(`Failed to inspect setup transfer bundle: ${summarizeError(error)}`);
          }
          return;
        }
        if (mode === 'import') {
          if (!parsed.yes) {
            requireYesFlag(ctx, `import setup transfer bundle from ${pathArg}`, '/setup transfer import <path> --yes');
            return;
          }
          try {
            const bundle = JSON.parse(readFileSync(targetPath, 'utf-8')) as SetupTransferBundle;
            for (const entry of CONFIG_SCHEMA) {
              if (Object.prototype.hasOwnProperty.call(bundle.config, entry.key)) {
                ctx.platform.configManager.setDynamic(entry.key as ConfigKey, (bundle.config as Record<string, unknown>)[entry.key]);
              }
            }
            if (bundle.services) {
              const servicesPath = getShellPaths().resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'services.json');
              mkdirSync(dirname(servicesPath), { recursive: true });
              writeFileSync(servicesPath, JSON.stringify(bundle.services, null, 2) + '\n', 'utf-8');
            }
            if (bundle.ecosystem?.plugins) {
              const pluginsPath = getShellPaths().resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'ecosystem', 'plugins.json');
              mkdirSync(dirname(pluginsPath), { recursive: true });
              writeFileSync(pluginsPath, JSON.stringify(bundle.ecosystem.plugins, null, 2) + '\n', 'utf-8');
            }
            if (bundle.ecosystem?.skills) {
              const skillsPath = getShellPaths().resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'ecosystem', 'skills.json');
              mkdirSync(dirname(skillsPath), { recursive: true });
              writeFileSync(skillsPath, JSON.stringify(bundle.ecosystem.skills, null, 2) + '\n', 'utf-8');
            }
            ctx.print(`Imported setup transfer bundle from ${targetPath}`);
          } catch (error) {
            ctx.print(`Failed to import setup transfer bundle: ${summarizeError(error)}`);
          }
          return;
        }
        ctx.print('Usage: /setup transfer <export|inspect|import> <path> [--yes]');
        return;
      }

      if (sub === 'link') {
        const surface = commandArgs[1];
        const target = commandArgs[2];
        if (!surface) {
          ctx.print('Usage: /setup link <cockpit|security|remote|knowledge|incident|hooks|orchestration|tasks> [target]');
          return;
        }
        ctx.print(createSetupLink(surface, target));
        return;
      }

      if (sub === 'open-link') {
        const link = commandArgs[1];
        if (!link) {
          ctx.print('Usage: /setup open-link <goodvibes://...>');
          return;
        }
        const parsed = parseSetupLink(link);
        if (!parsed) {
          ctx.print(`Invalid setup link: ${link}`);
          return;
        }
        const panelOpeners: Record<string, (() => void) | undefined> = {
          cockpit: ctx.openCockpitPanel,
          security: ctx.openSecurityPanel,
          remote: ctx.openRemotePanel,
          knowledge: ctx.openKnowledgePanel,
          incident: ctx.openIncidentPanel,
          hooks: ctx.openHooksPanel,
          orchestration: ctx.openOrchestrationPanel,
        };
        if (parsed.surface === 'tasks') {
          if (ctx.showPanel) ctx.showPanel('tasks');
          else {
            const panelManager = requirePanelManager(ctx);
            panelManager.open('tasks');
            panelManager.show();
            ctx.renderRequest();
          }
          ctx.print(`Opened setup link for tasks${parsed.target ? ` (${parsed.target})` : ''}.`);
          return;
        }
        const openPanel = panelOpeners[parsed.surface];
        if (!openPanel) {
          ctx.print(`Unsupported setup link surface: ${parsed.surface}`);
          return;
        }
        openPanel();
        ctx.print(`Opened setup link for ${parsed.surface}${parsed.target ? ` (${parsed.target})` : ''}.`);
        return;
      }

      ctx.print('Usage: /setup [review|doctor|services|hooks|remote|onboarding|support-bundle <dir> --yes|export <path> --yes|transfer <export|inspect|import> <path> [--yes]|link <surface> [target]|open-link <uri>]');
    },
  });
}
