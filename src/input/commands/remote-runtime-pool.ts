import type { CommandContext } from '../command-registry.ts';

type RemotePoolLike = {
  id: string;
  label: string;
  trustClass: string;
  preferredTemplate?: string;
  maxRunners?: number;
  runnerIds: readonly string[];
  description?: string;
};

type RemoteRegistryLike = {
  listPools(): readonly RemotePoolLike[];
  getPool(id: string): RemotePoolLike | null | undefined;
};

export function handleRemotePoolCommand(
  args: string[],
  ctx: Pick<CommandContext, 'print'>,
  remoteRegistry: RemoteRegistryLike,
): boolean {
  const subcommand = args[0]?.toLowerCase() ?? 'show';
  if (subcommand !== 'pool') return false;
  const mode = args[1]?.toLowerCase() ?? 'list';
  if (mode === 'list') {
    const pools = remoteRegistry.listPools();
    if (pools.length === 0) {
      ctx.print('No remote worker pools defined yet.');
      return true;
    }
    ctx.print([
      `Remote Worker Pools (${pools.length})`,
      ...pools.map((pool) => `  ${pool.id}  ${pool.runnerIds.length} workers  trust=${pool.trustClass}  template=${pool.preferredTemplate ?? '(none)'}`),
    ].join('\n'));
    return true;
  }
  if (mode === 'show') {
    const poolId = args[2];
    if (!poolId) {
      ctx.print('Usage: /remote pool show <poolId>');
      return true;
    }
    const pool = remoteRegistry.getPool(poolId);
    if (!pool) {
      ctx.print(`Unknown remote worker pool: ${poolId}`);
      return true;
    }
    ctx.print([
      `Remote Worker Pool ${pool.id}`,
      `  label: ${pool.label}`,
      `  trustClass: ${pool.trustClass}`,
      `  preferredTemplate: ${pool.preferredTemplate ?? '(none)'}`,
      `  maxWorkers: ${pool.maxRunners ?? '(unbounded)'}`,
      `  workers: ${pool.runnerIds.join(', ') || '(none)'}`,
      `  description: ${pool.description ?? '(none)'}`,
    ].join('\n'));
    return true;
  }
  if (mode === 'create') {
    ctx.print([
      'Remote worker pool mutation is blocked in GoodVibes Agent.',
      '  requested: /remote pool create',
      '  policy: Agent inspects remote worker pools but does not manage worker topology',
      '  next: use the owning GoodVibes runtime or delegated build environment for worker-pool administration',
    ].join('\n'));
    return true;
  }
  if (mode === 'assign') {
    ctx.print([
      'Remote worker pool mutation is blocked in GoodVibes Agent.',
      '  requested: /remote pool assign',
      '  policy: Agent inspects remote worker pools but does not manage worker topology',
      '  next: use the owning GoodVibes runtime or delegated build environment for worker-pool administration',
    ].join('\n'));
    return true;
  }
  if (mode === 'unassign') {
    ctx.print([
      'Remote worker pool mutation is blocked in GoodVibes Agent.',
      '  requested: /remote pool unassign',
      '  policy: Agent inspects remote worker pools but does not manage worker topology',
      '  next: use the owning GoodVibes runtime or delegated build environment for worker-pool administration',
    ].join('\n'));
    return true;
  }
  ctx.print('Usage: /remote pool <list|show|create|assign|unassign> ...');
  return true;
}
