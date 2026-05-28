import type { CommandRegistry } from '../command-registry.ts';

export function registerAgentWorkspaceRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'agent',
    aliases: ['home', 'operator'],
    description: 'Open the GoodVibes Agent operator workspace',
    usage: '',
    handler(_args, ctx) {
      if (!ctx.openAgentWorkspace) {
        ctx.print('Agent operator workspace is not available in this runtime.');
        return;
      }
      ctx.openAgentWorkspace();
    },
  });
}
