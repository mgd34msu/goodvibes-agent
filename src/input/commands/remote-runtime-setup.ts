import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getDefaultAcpAgentCommand } from '@pellux/goodvibes-sdk/platform/acp';
import type { CommandContext, RemoteCommandService } from '../command-registry.ts';
import type { RemoteSessionBundle } from '@/runtime/index.ts';
import { requireShellPaths } from './runtime-services.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

type RemoteRegistryLike = Pick<RemoteCommandService, 'listContracts' | 'exportSessionBundle' | 'importSessionBundle'>;

type ActiveConnectionLike = {
  agentId: string;
  transportState: string;
  messageCount: number;
  errorCount: number;
  label: string;
};

export function inspectRemoteSessionBundle(bundle: RemoteSessionBundle): string {
  return [
    'Remote Session Bundle Review',
    `  session: ${bundle.sessionId}`,
    `  exportedAt: ${new Date(bundle.exportedAt).toISOString()}`,
    `  active connections: ${bundle.activeConnectionIds.length}`,
    `  pools: ${bundle.pools.length}`,
    `  contracts: ${bundle.contracts.length}`,
    `  artifacts: ${bundle.artifacts.length}`,
  ].join('\n');
}

export async function handleRemoteSetupCommand(
  args: string[],
  ctx: CommandContext,
  activeConnections: ActiveConnectionLike[],
  remoteRegistry: RemoteRegistryLike,
): Promise<boolean> {
  const parsed = stripYesFlag(args);
  const commandArgs = [...parsed.rest];
  const subcommand = commandArgs[0]?.toLowerCase() ?? 'show';
  if (subcommand === 'setup') {
    const command = getDefaultAcpAgentCommand();
    const danger = ctx.platform.configManager.getCategory('danger');
    const lines = [
      'Remote Setup Review',
      `  acp agent command: ${command.join(' ')}`,
      `  runtime host enabled: ${danger.daemon ? 'yes' : 'no'}`,
      `  inbound listener enabled: ${danger.httpListener ? 'yes' : 'no'}`,
      `  remote worker contracts: ${remoteRegistry.listContracts().length}`,
      `  active acp connections: ${activeConnections.length}`,
      '',
      '  guidance:',
      '    - set ACP_AGENT_CMD to override the spawned remote agent command',
      '    - use /remote env to export a reusable shell snippet',
      '    - runtime-host and inbound-listener posture belongs to the runtime owner, not Agent onboarding',
    ];
    if (commandArgs[1]?.toLowerCase() === 'export') {
      const pathArg = commandArgs[2];
      if (!pathArg) {
        ctx.print('Usage: /remote setup export <path> --yes');
        return true;
      }
      if (!parsed.yes) {
        requireYesFlag(ctx, `export remote setup bundle to ${pathArg}`, '/remote setup export <path> --yes');
        return true;
      }
      const shellPaths = requireShellPaths(ctx);
      const targetPath = shellPaths.resolveWorkspacePath(pathArg);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, `${JSON.stringify({
        exportedAt: Date.now(),
        acpAgentCommand: command,
        runtimeHostEnabled: Boolean(danger.daemon),
        inboundListenerEnabled: Boolean(danger.httpListener),
        remoteRunnerContracts: remoteRegistry.listContracts().length,
      }, null, 2)}\n`, 'utf-8');
      ctx.print(`Exported remote setup bundle to ${targetPath}`);
      return true;
    }
    ctx.print(lines.join('\n'));
    return true;
  }

  if (subcommand === 'env') {
    const command = getDefaultAcpAgentCommand();
    const shellSnippet = [
      `export ACP_AGENT_CMD='${command.join(' ')}'`,
      `export GOODVIBES_REMOTE_SESSION='${ctx.session.runtime.sessionId}'`,
    ].join('\n');
    if (commandArgs[1]?.toLowerCase() === 'export') {
      const pathArg = commandArgs[2];
      if (!pathArg) {
        ctx.print('Usage: /remote env export <path> --yes');
        return true;
      }
      if (!parsed.yes) {
        requireYesFlag(ctx, `export remote environment snippet to ${pathArg}`, '/remote env export <path> --yes');
        return true;
      }
      const shellPaths = requireShellPaths(ctx);
      const targetPath = shellPaths.resolveWorkspacePath(pathArg);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, `${shellSnippet}\n`, 'utf-8');
      ctx.print(`Exported remote environment snippet to ${targetPath}`);
      return true;
    }
    ctx.print(['Remote Environment', shellSnippet].join('\n'));
    return true;
  }

  if (subcommand === 'tunnel') {
    const mode = commandArgs[1]?.toLowerCase() ?? 'review';
    const lines = [
      'Remote Tunnel Review',
      '  transport: self-hosted ACP / runtime relay',
      `  session: ${ctx.session.runtime.sessionId}`,
      `  active remote connections: ${activeConnections.length}`,
      '  guidance: forward ACP agent traffic through your chosen self-hosted tunnel or SSH transport',
    ];
    if (mode === 'export') {
      const pathArg = commandArgs[2];
      if (!pathArg) {
        ctx.print('Usage: /remote tunnel export <path> --yes');
        return true;
      }
      if (!parsed.yes) {
        requireYesFlag(ctx, `export remote tunnel review to ${pathArg}`, '/remote tunnel export <path> --yes');
        return true;
      }
      const shellPaths = requireShellPaths(ctx);
      const targetPath = shellPaths.resolveWorkspacePath(pathArg);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, `${lines.join('\n')}\n`, 'utf-8');
      ctx.print(`Exported remote tunnel review to ${targetPath}`);
      return true;
    }
    ctx.print(lines.join('\n'));
    return true;
  }

  if (subcommand === 'bootstrap') {
    const mode = commandArgs[1]?.toLowerCase() ?? 'export';
    const payload = {
      exportedAt: Date.now(),
      sessionId: ctx.session.runtime.sessionId,
      acpAgentCommand: getDefaultAcpAgentCommand(),
      env: {
        ACP_AGENT_CMD: getDefaultAcpAgentCommand().join(' '),
        GOODVIBES_REMOTE_SESSION: ctx.session.runtime.sessionId,
      },
      links: [
        'goodvibes://open/remote',
        'goodvibes://open/cockpit?target=remote',
      ],
    };
    if (mode === 'inspect') {
      const pathArg = commandArgs[2];
      if (!pathArg) {
        ctx.print('Usage: /remote bootstrap inspect <path>');
        return true;
      }
      const shellPaths = requireShellPaths(ctx);
      const targetPath = shellPaths.resolveWorkspacePath(pathArg);
      const parsed = JSON.parse(readFileSync(targetPath, 'utf-8')) as typeof payload;
      ctx.print([
        'Remote Bootstrap Bundle Review',
        `  session: ${parsed.sessionId}`,
        `  acp agent command: ${parsed.acpAgentCommand.join(' ')}`,
        `  links: ${parsed.links.length}`,
      ].join('\n'));
      return true;
    }
    const pathArg = commandArgs[2] ?? commandArgs[1];
    if (!pathArg || mode !== 'export') {
      ctx.print('Usage: /remote bootstrap export <path> --yes | /remote bootstrap inspect <path>');
      return true;
    }
    if (!parsed.yes) {
      requireYesFlag(ctx, `export remote bootstrap bundle to ${pathArg}`, '/remote bootstrap export <path> --yes');
      return true;
    }
    const shellPaths = requireShellPaths(ctx);
    const targetPath = shellPaths.resolveWorkspacePath(pathArg);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    ctx.print(`Exported remote bootstrap bundle to ${targetPath}`);
    return true;
  }

  if (subcommand === 'session') {
    const mode = commandArgs[1]?.toLowerCase();
    const pathArg = commandArgs[2];
    if (!mode || !pathArg) {
      ctx.print('Usage: /remote session <export|inspect|import> <path> [--yes]');
      return true;
    }
    const shellPaths = requireShellPaths(ctx);
    const targetPath = shellPaths.resolveWorkspacePath(pathArg);
    if (mode === 'export') {
      if (!parsed.yes) {
        requireYesFlag(ctx, `export remote session bundle to ${pathArg}`, '/remote session export <path> --yes');
        return true;
      }
      const exported = await remoteRegistry.exportSessionBundle(targetPath);
      ctx.print(`Exported remote session bundle ${exported.bundle.sessionId} to ${exported.path}`);
      return true;
    }
    if (mode === 'inspect') {
      const bundle = JSON.parse(readFileSync(targetPath, 'utf-8')) as RemoteSessionBundle;
      ctx.print(inspectRemoteSessionBundle(bundle));
      return true;
    }
    if (mode === 'import') {
      if (!parsed.yes) {
        requireYesFlag(ctx, `import remote session bundle from ${pathArg}`, '/remote session import <path> --yes');
        return true;
      }
      const bundle = await remoteRegistry.importSessionBundle(targetPath);
      ctx.print(`Imported remote session bundle ${bundle.sessionId} with ${bundle.contracts.length} contracts.`);
      return true;
    }
    ctx.print('Usage: /remote session <export|inspect|import> <path> [--yes]');
    return true;
  }

  return false;
}
