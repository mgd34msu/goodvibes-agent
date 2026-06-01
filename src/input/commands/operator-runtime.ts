import type { CommandRegistry } from '../command-registry.ts';
import type { ProfileData } from '@pellux/goodvibes-sdk/platform/profiles';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import { requireProfileManager } from './runtime-services.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

export function registerOperatorRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'settings',
    aliases: ['cfg-ui'],
    description: 'Open the fullscreen configuration workspace',
    handler(_args, ctx) {
      if (ctx.openSettingsModal) ctx.openSettingsModal();
      else ctx.print('Configuration workspace is not available in this runtime.');
    },
  });

  registry.register({
    name: 'context',
    aliases: ['ctx'],
    description: 'Inspect context window usage (token breakdown per message)',
    handler: (_args, ctx) => {
      if (ctx.openContextInspector) {
        ctx.openContextInspector();
      } else {
        const msgs = ctx.session.conversationManager.getMessagesForLLM();
        if (msgs.length === 0) {
          ctx.print('[context] No messages in conversation.');
          return;
        }
        const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
        let total = 0;
        const lines: string[] = ['Context breakdown:'];
        for (const m of msgs) {
          const text = typeof m.content === 'string'
            ? m.content
            : (m.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .join('');
          const t = estimateTokens(text);
          total += t;
          lines.push(`  ${m.role.padEnd(12)} ~${t.toLocaleString()} tokens`);
        }
        lines.push(`  ${'Total'.padEnd(12)} ~${total.toLocaleString()} tokens (${msgs.length} messages)`);
        ctx.print(lines.join('\n'));
      }
    },
  });

  registry.register({
    name: 'next-error',
    aliases: ['ne'],
    description: 'Jump to the next error message in the conversation',
    handler(_args, ctx) {
      const nextLine = ctx.session.conversationManager.nextErrorLine(ctx.getScrollTop?.() ?? 0);
      if (nextLine < 0) ctx.print('[No error messages found in conversation]');
      else ctx.scrollToLine?.(nextLine);
    },
  });

  registry.register({
    name: 'profiles',
    aliases: ['profile'],
    description: 'Browse, save, and delete config profiles',
    usage: '[list|open|save <name> --yes|delete <name> --yes]',
    argsHint: '[list|open|save --yes|delete --yes]',
    handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const sub = parsed.rest[0] ?? 'open';
      const profileManager = requireProfileManager(ctx);
      if (sub === 'open') {
        if (ctx.openProfilePicker) {
          ctx.openProfilePicker();
        } else {
          const profiles = profileManager.list();
          if (profiles.length === 0) ctx.print('No profiles saved. Use /profiles save <name> --yes to save the current settings as a profile.');
          else ctx.print(['Saved profiles:', ...profiles.map(p => `  ${p.name}`)].join('\n'));
        }
        return;
      }
      if (sub === 'list') {
        const profiles = profileManager.list();
        if (profiles.length === 0) ctx.print('No profiles saved. Use /profiles save <name> --yes to save the current settings as a profile.');
        else ctx.print(['Saved profiles:', ...profiles.map(p => `  ${p.name}`)].join('\n'));
        return;
      }
      if (sub === 'save') {
        const name = parsed.rest[1];
        if (!name) {
          ctx.print('Usage: /profiles save <name> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `save config profile ${name}`, '/profiles save <name> --yes');
          return;
        }
        const all = ctx.platform.configManager.getAll();
        const data: ProfileData = {
          display: { ...all.display },
          provider: {
            model: all.provider.model,
            reasoningEffort: all.provider.reasoningEffort,
          },
          behavior: { ...all.behavior },
        };
        profileManager.save(name, data);
        ctx.print(`Profile saved: ${name}`);
        return;
      }
      if (sub === 'delete' || sub === 'remove') {
        const name = parsed.rest[1];
        if (!name) {
          ctx.print('Usage: /profiles delete <name> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `delete config profile ${name}`, '/profiles delete <name> --yes');
          return;
        }
        const deleted = profileManager.delete(name);
        ctx.print(deleted ? `Profile deleted: ${name}` : `Profile not found: ${name}`);
        return;
      }
      if (args.length === 0 && ctx.openProfilePicker) {
        ctx.openProfilePicker();
        return;
      }
      ctx.print('Usage: /profiles [list|open|save <name> --yes|delete <name> --yes]');
    },
  });

  registry.register({
    name: 'prev-error',
    aliases: ['pe'],
    description: 'Jump to the previous error message in the conversation',
    handler(_args, ctx) {
      const prevLine = ctx.session.conversationManager.prevErrorLine(ctx.getScrollTop?.() ?? 0);
      if (prevLine < 0) ctx.print('[No error messages found in conversation]');
      else ctx.scrollToLine?.(prevLine);
    },
  });

  registry.register({
    name: 'mode',
    aliases: ['hitl'],
    description: 'Manage HITL UX notification mode (quiet/balanced/operator)',
    usage: '[quiet|balanced|operator --yes|show|set-domain <domain> <verbosity> --yes]',
    argsHint: '[preset|show|set-domain]',
    handler(args, ctx) {
      const mgr = ctx.ops.modeManager;
      if (!mgr) {
        ctx.print('Interaction mode manager is not available in this runtime.');
        return;
      }
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const sub = commandArgs[0] ?? 'show';

      if (sub === 'quiet' || sub === 'balanced' || sub === 'operator') {
        if (!parsed.yes) {
          requireYesFlag(ctx, `set HITL mode to ${sub}`, '/mode <quiet|balanced|operator> --yes');
          return;
        }
        const newMode = sub as 'quiet' | 'balanced' | 'operator';
        mgr.setHITLMode(newMode);
        try {
          ctx.platform.configManager.setDynamic('behavior.hitlMode' as import('@pellux/goodvibes-sdk/platform/config').ConfigKey, newMode);
        } catch (e) {
          logger.warn('[/mode] Failed to persist mode', { error: summarizeError(e) });
        }
        const preset = mgr.getHITLPreset();
        ctx.print(`HITL mode set to: ${preset.name}\n${preset.description}`);
        ctx.renderRequest();
        return;
      }

      if (sub === 'show') {
        const current = mgr.getHITLMode();
        const preset = mgr.getHITLPreset();
        const overrides = mgr.getDomainOverrides();
        const lines: string[] = [
          `HITL mode: ${current}`,
          `  ${preset.description}`,
          `  Default domain verbosity: ${preset.defaultDomainVerbosity}`,
          `  Quiet-while-typing: ${preset.quietWhileTyping}`,
          `  Batch window: ${preset.batchWindowMs}ms`,
        ];
        const overrideEntries = Object.entries(overrides);
        if (overrideEntries.length > 0) {
          lines.push('  Per-domain overrides:');
          for (const [domain, verbosity] of overrideEntries) lines.push(`    ${domain}: ${verbosity}`);
        } else {
          lines.push('  No per-domain overrides.');
        }
        lines.push('');
        lines.push('Available presets:');
        for (const p of mgr.listHITLPresets()) {
          const marker = p.name === current ? '\u25b6' : ' ';
          lines.push(`  ${marker} ${p.name.padEnd(10)} ${p.description}`);
        }
        ctx.print(lines.join('\n'));
        return;
      }

      if (sub === 'set-domain') {
        const domain = commandArgs[1];
        const verbosity = commandArgs[2];
        if (!domain || !verbosity) {
          ctx.print('Usage: /mode set-domain <domain> <minimal|normal|verbose> --yes');
          return;
        }
        if (verbosity !== 'minimal' && verbosity !== 'normal' && verbosity !== 'verbose') {
          ctx.print(`Invalid verbosity "${verbosity}". Valid values: minimal, normal, verbose`);
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `set HITL verbosity for ${domain}`, '/mode set-domain <domain> <minimal|normal|verbose> --yes');
          return;
        }
        mgr.setDomainVerbosity(domain, verbosity as 'minimal' | 'normal' | 'verbose');
        ctx.print(`Domain "${domain}" verbosity set to: ${verbosity}`);
        return;
      }

      ctx.print(
        'Usage: /mode [quiet|balanced|operator --yes|show|set-domain <domain> <verbosity> --yes]\n'
        + '  /mode                          — show current mode and settings\n'
        + '  /mode show                     — show current mode and settings\n'
        + '  /mode quiet --yes              — suppress all non-critical notifications\n'
        + '  /mode balanced --yes           — show warnings, batch info noise (default)\n'
        + '  /mode operator --yes           — full verbosity, no suppression\n'
        + '  /mode set-domain <d> <v> --yes — per-domain verbosity override (minimal|normal|verbose)'
      );
    },
  });
}
