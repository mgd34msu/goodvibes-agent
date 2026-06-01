import type { CommandRegistry } from '../command-registry.ts';

export function registerGuidanceRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'welcome',
    aliases: ['guide'],
    description: 'Open the Agent setup workspace',
    usage: '[open|print]',
    handler(args, ctx) {
      const sub = args[0] ?? 'open';
      if (sub === 'open' || sub === 'panel') {
        if (ctx.openOnboardingWizard) {
          ctx.openOnboardingWizard({ mode: 'edit' });
          return;
        }
        ctx.print('Use /setup to open Agent setup.');
        return;
      }
      if (sub === 'print') {
        ctx.print([
          'Welcome To GoodVibes Agent',
          '  /setup              - open Agent setup with current settings preloaded',
          '  /agent              - open the Agent operator workspace',
          '  /knowledge          - inspect isolated Agent Knowledge status, ask, and search',
          '  /memory             - manage local Agent memory',
          '  /personas           - manage local Agent personas',
          '  /agent-skills       - manage reusable local Agent skills',
          '  /routines           - manage local Agent routines',
          '  /delegate           - explicitly hand build/fix/review work to GoodVibes TUI',
        ].join('\n'));
        return;
      }
      ctx.print('Usage: /welcome [open|print]');
    },
  });
}
