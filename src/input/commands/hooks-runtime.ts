import { readFileSync } from 'node:fs';
import type { CommandRegistry } from '../command-registry.ts';
import { requireHookApi } from './runtime-services.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsAgentHookType(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsAgentHookType(entry));
  if (!isRecord(value)) return false;
  if (value.type === 'agent') return true;
  return Object.values(value).some((entry) => containsAgentHookType(entry));
}

function fileContainsAgentHookType(path: string): boolean {
  try {
    return containsAgentHookType(JSON.parse(readFileSync(path, 'utf-8')) as unknown);
  } catch {
    return false;
  }
}

export function registerHooksRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'hooks',
    aliases: [],
    description: 'Inspect, author, simulate, and reload managed hook workflows',
    usage: '[contracts [filter] | reload --yes | scaffold <name> <match> <type> --yes | chain <name> <event1,event2,...> --yes | remove <name> --yes | enable <name> --yes | disable <name> --yes | simulate <eventPath> | inspect <path> | import <path> [merge|replace] --yes | export [path] --yes]',
    argsHint: '[subcommand]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const hookApi = requireHookApi(ctx);
      const workbench = hookApi.workbench;
      if (commandArgs.length === 0 && ctx.openHooksPanel) {
        ctx.openHooksPanel();
        return;
      }

      const subcommand = (commandArgs[0] ?? 'contracts').toLowerCase();
      if (subcommand === 'reload') {
        if (!parsed.yes) {
          requireYesFlag(ctx, 'reload managed hook workflows', '/hooks reload --yes');
          return;
        }
        await workbench.reload();
        ctx.print(`Reloaded managed hooks from ${workbench.getFilePath()}`);
        return;
      }
      if (subcommand === 'scaffold') {
        const [name, match, type] = commandArgs.slice(1);
        if (!name || !match || !type) {
          ctx.print('Usage: /hooks scaffold <name> <match> <command|prompt|http|ts> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `scaffold managed hook ${name}`, '/hooks scaffold <name> <match> <command|prompt|http|ts> --yes');
          return;
        }
        if (type === 'agent') {
          ctx.print('Blocked: GoodVibes Agent does not author local agent-spawning hooks. Use command, prompt, http, or ts hooks, or delegate explicit build work to GoodVibes TUI.');
          return;
        }
        if (!['command', 'prompt', 'http', 'ts'].includes(type)) {
          ctx.print(`Unknown hook type: ${type}`);
          return;
        }
        const hook = await workbench.scaffoldHook(name, match, type as Parameters<typeof workbench.scaffoldHook>[2]);
        ctx.print(`Scaffolded managed hook ${hook.name} at ${match} in ${workbench.getFilePath()}`);
        return;
      }
      if (subcommand === 'chain') {
        const name = commandArgs[1];
        const matches = commandArgs[2]?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
        if (!name || matches.length === 0) {
          ctx.print('Usage: /hooks chain <name> <event1,event2,...> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `scaffold managed hook chain ${name}`, '/hooks chain <name> <event1,event2,...> --yes');
          return;
        }
        const chain = await workbench.scaffoldChain(name, matches);
        ctx.print(`Scaffolded managed hook chain ${chain.name} with ${chain.steps.length} step(s).`);
        return;
      }
      if (subcommand === 'remove') {
        const name = commandArgs[1];
        if (!name) {
          ctx.print('Usage: /hooks remove <name> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `remove managed hook workflow ${name}`, '/hooks remove <name> --yes');
          return;
        }
        const removed = await workbench.remove(name);
        if (!removed) {
          ctx.print(`No managed hook or chain named ${name}.`);
          return;
        }
        ctx.print(`Removed managed hook workflow entry ${name}.`);
        return;
      }
      if (subcommand === 'enable' || subcommand === 'disable') {
        const name = commandArgs[1];
        if (!name) {
          ctx.print(`Usage: /hooks ${subcommand} <name> --yes`);
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `${subcommand} managed hook ${name}`, `/hooks ${subcommand} <name> --yes`);
          return;
        }
        const changed = await workbench.toggle(name, subcommand === 'enable');
        if (!changed) {
          ctx.print(`No managed hook named ${name}.`);
          return;
        }
        ctx.print(`${subcommand === 'enable' ? 'Enabled' : 'Disabled'} managed hook ${name}.`);
        return;
      }
      if (subcommand === 'simulate') {
        const eventPath = commandArgs[1];
        if (!eventPath) {
          ctx.print('Usage: /hooks simulate <eventPath>');
          return;
        }
        const result = workbench.simulate(eventPath);
        ctx.print([
          `Hook simulation for ${result.eventPath}`,
          `  matched hooks: ${result.matchedHooks.length}`,
          ...result.matchedHooks.map((entry) => `    ${entry.name}  ${entry.pattern}  ${entry.type}`),
          `  matched chains: ${result.matchedChains.length}`,
          ...result.matchedChains.map((entry) => `    ${entry.name}  stepMatches=${entry.stepMatches}`),
        ].join('\n'));
        return;
      }
      if (subcommand === 'export') {
        if (!parsed.yes) {
          requireYesFlag(ctx, 'export managed hook workflows', '/hooks export [path] --yes');
          return;
        }
        const path = await workbench.export(commandArgs[1] ?? workbench.getFilePath());
        ctx.print(`Exported managed hooks to ${path}`);
        return;
      }
      if (subcommand === 'inspect') {
        const path = commandArgs[1];
        if (!path) {
          ctx.print('Usage: /hooks inspect <path>');
          return;
        }
        const inspection = workbench.inspect(path);
        ctx.print([
          `Hook bundle inspection: ${inspection.path}`,
          `  hooks: ${inspection.hookCount}`,
          `  chains: ${inspection.chainCount}`,
          `  patterns: ${inspection.patterns.join(', ') || '(none)'}`,
        ].join('\n'));
        return;
      }
      if (subcommand === 'import') {
        const path = commandArgs[1];
        const strategy = commandArgs[2] === 'replace' ? 'replace' : 'merge';
        if (!path) {
          ctx.print('Usage: /hooks import <path> [merge|replace] --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `import managed hook workflows from ${path}`, '/hooks import <path> [merge|replace] --yes');
          return;
        }
        if (fileContainsAgentHookType(path)) {
          ctx.print('Blocked: hook bundle contains type=agent entries. GoodVibes Agent does not import local agent-spawning hooks.');
          return;
        }
        await workbench.import(path, strategy);
        ctx.print(`Imported managed hooks from ${path} using ${strategy} strategy.`);
        return;
      }

      const filter = (subcommand === 'contracts' ? commandArgs.slice(1) : commandArgs).join(' ').trim().toLowerCase();
      const contracts = hookApi.contracts(filter);

      if (contracts.length === 0) {
        ctx.print(filter.length === 0 ? 'No hook contracts registered.' : `No hook contracts matched "${filter}".`);
        return;
      }

      const lines: string[] = [`Hook Contracts (${contracts.length}):`];
      for (const contract of contracts) {
        lines.push(`  ${contract.pattern}`);
        lines.push(`    authority=${contract.authority} mode=${contract.executionMode} deny=${contract.canDeny ? 'yes' : 'no'} mutate=${contract.canMutateInput ? 'yes' : 'no'} inject=${contract.canInjectContext ? 'yes' : 'no'} timeout=${contract.timeoutMs}ms policy=${contract.failurePolicy}`);
        lines.push(`    ${contract.description}`);
      }
      const managedHooks = workbench.listManagedHooks();
      const managedChains = workbench.listManagedChains();
      lines.push('');
      lines.push(`Managed hooks file: ${workbench.getFilePath()}`);
      lines.push(`Managed entries: hooks=${managedHooks.length} chains=${managedChains.length}`);
      ctx.print(lines.join('\n'));
    },
  });
}
