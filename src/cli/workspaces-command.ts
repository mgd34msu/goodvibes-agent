import { createShellPathService } from '@/runtime/index.ts';
import {
  isWorkspaceRegistered,
  normalizeWorkspaceRoot,
  readWorkspaceRegistry,
  registerWorkspace,
  unregisterWorkspace,
} from '../config/workspace-registry.ts';
import type { CliCommandOutput } from './types.ts';
import type { CliCommandRuntime } from './management.ts';

/**
 * `goodvibes-agent workspaces` — manage the registered-workspace list that
 * gates automatic checkpoints (owner ruling, 2026-07-10; see
 * ../runtime/services.ts and ../config/workspace-registry.ts). A workspace
 * root not in this list gets no automatic turn/agent-lifecycle checkpoints,
 * and explicit `checkpoints.create` gateway calls against it are refused with
 * this command's registration hint (see services.ts's checkpointsGatewayManager).
 */

function hasYes(args: readonly string[]): boolean {
  return args.includes('--yes');
}

function flagValue(args: readonly string[], names: readonly string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    for (const name of names) {
      if (token === name) {
        const next = args[index + 1];
        return next && !next.startsWith('--') ? next : null;
      }
      if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
    }
  }
  return null;
}

function commandValues(args: readonly string[]): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--')) values.push(token);
  }
  return values;
}

function jsonOrText(runtime: CliCommandRuntime, value: unknown, text: string): string {
  return runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(value, null, 2) : text;
}

function usage(runtime: CliCommandRuntime, error: string): CliCommandOutput {
  const message = `${error}\nUsage: goodvibes-agent workspaces [list|register [path] [--label <label>] --yes|unregister [path] --yes]`;
  return { output: jsonOrText(runtime, { ok: false, error: message }, message), exitCode: 2 };
}

export function handleWorkspacesCommand(runtime: CliCommandRuntime): CliCommandOutput {
  const shellPaths = createShellPathService({
    workingDirectory: runtime.workingDirectory,
    homeDirectory: runtime.homeDirectory,
  });
  const [sub = 'list', ...rawRest] = runtime.cli.commandArgs;
  const values = commandValues(rawRest);

  if (sub === 'list' || sub === 'ls') {
    const snapshot = readWorkspaceRegistry(shellPaths);
    const current = normalizeWorkspaceRoot(runtime.workingDirectory);
    if (runtime.cli.flags.outputFormat === 'json') {
      return { output: JSON.stringify({ ok: true, ...snapshot, currentWorkspaceRegistered: isWorkspaceRegistered(shellPaths, current) }, null, 2), exitCode: 0 };
    }
    const lines = snapshot.workspaces.length === 0
      ? ['No registered workspaces', '  automatic checkpoints are off everywhere until a workspace is registered']
      : [
        `Registered workspaces (${snapshot.workspaces.length})`,
        ...snapshot.workspaces.map((entry) => `  ${entry.root}${entry.label ? ` (${entry.label})` : ''} — registered ${entry.registeredAt}`),
      ];
    lines.push('', `current workspace ${current}`, `  registered ${isWorkspaceRegistered(shellPaths, current) ? 'yes' : 'no'}`);
    return { output: lines.join('\n'), exitCode: 0 };
  }

  if (sub === 'register' || sub === 'add') {
    const target = values[0] ?? runtime.workingDirectory;
    if (!hasYes(rawRest)) {
      return usage(runtime, `Refusing to register workspace ${normalizeWorkspaceRoot(target)} for automatic checkpoints without --yes.`);
    }
    const label = flagValue(rawRest, ['--label']) ?? undefined;
    const result = registerWorkspace(shellPaths, target, label ? { label } : undefined);
    const text = result.alreadyRegistered
      ? `Workspace already registered: ${result.record.root}`
      : `Workspace registered: ${result.record.root}\n  automatic checkpoints are now allowed for this workspace`;
    return { output: jsonOrText(runtime, { ok: true, ...result }, text), exitCode: 0 };
  }

  if (sub === 'unregister' || sub === 'remove' || sub === 'rm') {
    const target = values[0] ?? runtime.workingDirectory;
    if (!hasYes(rawRest)) {
      return usage(runtime, `Refusing to unregister workspace ${normalizeWorkspaceRoot(target)} without --yes.`);
    }
    const result = unregisterWorkspace(shellPaths, target);
    const text = result.removed
      ? `Workspace unregistered: ${normalizeWorkspaceRoot(target)}\n  automatic checkpoints are now off for this workspace`
      : `Workspace was not registered: ${normalizeWorkspaceRoot(target)}`;
    return { output: jsonOrText(runtime, { ok: true, ...result }, text), exitCode: result.removed ? 0 : 1 };
  }

  return usage(runtime, `Unknown workspaces subcommand: ${sub}`);
}
