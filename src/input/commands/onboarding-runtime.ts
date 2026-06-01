import type { CommandRegistry } from '../command-registry.ts';
import { openOnboardingWizard } from './runtime-services.ts';

export function registerOnboardingRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'setup',
    aliases: ['onboarding'],
    description: 'Open Agent setup with current settings preloaded for review and editing',
    usage: '',
    handler(_args, ctx) {
      openOnboardingWizard(ctx, { mode: 'edit', reset: true });
      ctx.print('Opening Agent setup.');
    },
  });
}
