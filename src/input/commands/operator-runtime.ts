import type { CommandRegistry } from '../command-registry.ts';
import type { ProfileData } from '@pellux/goodvibes-sdk/platform/profiles';
import { ToolContractVerifier } from '@/runtime/index.ts';
import type { ReplaySnapshotInput } from '@/runtime/index.ts';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import { registerOperatorPanelCommand } from './operator-panel-runtime.ts';
import { requireProfileManager, requireReplayEngine } from './runtime-services.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

function printOpsMutationBlocked(print: (text: string) => void, target: string): void {
  print([
    `[Ops] ${target} mutation is blocked in GoodVibes Agent.`,
    '  policy: Agent does not control copied local task/agent lifecycle from the operator surface.',
    '  normal work: continue in the main conversation.',
    '  build/fix/review: use /delegate <task> for explicit GoodVibes TUI handoff.',
    '  result: no local task or agent state was changed.',
  ].join('\n'));
}

export function registerOperatorRuntimeCommands(registry: CommandRegistry): void {
  registerOperatorPanelCommand(registry);

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
    usage: '[quiet|balanced|operator|show|set-domain <domain> <verbosity>]',
    argsHint: '[preset|show|set-domain]',
    handler(args, ctx) {
      const mgr = ctx.ops.modeManager;
      if (!mgr) {
        ctx.print('Interaction mode manager is not available in this runtime.');
        return;
      }
      const sub = args[0] ?? 'show';

      if (sub === 'quiet' || sub === 'balanced' || sub === 'operator') {
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
        const domain = args[1];
        const verbosity = args[2];
        if (!domain || !verbosity) {
          ctx.print('Usage: /mode set-domain <domain> <minimal|normal|verbose>');
          return;
        }
        if (verbosity !== 'minimal' && verbosity !== 'normal' && verbosity !== 'verbose') {
          ctx.print(`Invalid verbosity "${verbosity}". Valid values: minimal, normal, verbose`);
          return;
        }
        mgr.setDomainVerbosity(domain, verbosity as 'minimal' | 'normal' | 'verbose');
        ctx.print(`Domain "${domain}" verbosity set to: ${verbosity}`);
        return;
      }

      ctx.print(
        'Usage: /mode [quiet|balanced|operator|show|set-domain <domain> <verbosity>]\n'
        + '  /mode                          — show current mode and settings\n'
        + '  /mode show                     — show current mode and settings\n'
        + '  /mode quiet                    — suppress all non-critical notifications\n'
        + '  /mode balanced                 — surface warnings, batch info noise (default)\n'
        + '  /mode operator                 — full verbosity, no suppression\n'
        + '  /mode set-domain <d> <v>       — per-domain verbosity override (minimal|normal|verbose)'
      );
    },
  });

  registry.register({
    name: 'ops',
    description: 'Operator Control Plane: view Agent operator posture without local task/agent lifecycle mutations',
    usage: '[view]',
    argsHint: '[view]',
    handler(args, ctx) {
      const sub = args[0];

      if (sub === 'view' || sub === undefined) {
        if (ctx.openOpsPanel) ctx.openOpsPanel();
        else ctx.print('Operator Control Plane panel is not available. Enable the operator-control-plane feature flag.');
        return;
      }

      if (sub === 'task') {
        printOpsMutationBlocked(ctx.print, 'Task');
        return;
      }

      if (sub === 'agent') {
        printOpsMutationBlocked(ctx.print, 'Agent');
        return;
      }

      ctx.print(
        'Usage: /ops <subcommand>\n'
        + '  /ops view                              — open the Ops Control panel (Ctrl+O)\n'
        + '  task/agent lifecycle commands are blocked in Agent; use /delegate for explicit build handoff'
      );
    },
  });

  registry.register({
    name: 'tool',
    description: 'Tool contract verification — verify registered tool contracts',
    usage: 'verify <name> | verify-all | contract show <name>',
    argsHint: 'verify <name> | verify-all | contract show <name>',
    handler(args, ctx) {
      const sub = args[0];
      if (sub === 'verify' && args[1]) {
        const result = ctx.extensions.toolRegistry.verifyContract(args[1]);
        if (!result) {
          ctx.print(`[tool verify] Tool '${args[1]}' is not registered.`);
          return;
        }
        ctx.print(ToolContractVerifier.formatResult(result));
        return;
      }
      if (sub === 'verify-all') {
        ctx.print(ToolContractVerifier.formatAllResults(ctx.extensions.toolRegistry.verifyAllContracts()));
        return;
      }
      if (sub === 'contract' && args[1] === 'show' && args[2]) {
        const toolName = args[2];
        const result = ctx.extensions.toolRegistry.verifyContract(toolName);
        if (!result) {
          ctx.print(`[tool contract show] Tool '${toolName}' is not registered.`);
          return;
        }
        const lines: string[] = [ToolContractVerifier.formatResult(result)];
        const tool = ctx.extensions.toolRegistry.list().find((t) => t.definition.name === toolName);
        if (tool) {
          lines.push('');
          lines.push('Tool Definition:');
          lines.push(`  Name:        ${tool.definition.name}`);
          lines.push(`  Description: ${tool.definition.description}`);
          lines.push(`  Parameters:  ${JSON.stringify(tool.definition.parameters, null, 2).replace(/\n/g, '\n               ')}`);
        }
        ctx.print(lines.join('\n'));
        return;
      }

      ctx.print(
        'Usage: /tool <subcommand>\n'
        + '  /tool verify <name>             — verify contract for a specific registered tool\n'
        + '  /tool verify-all                — verify contracts for all registered tools\n'
        + '  /tool contract show <name>      — show full contract details for a tool'
      );
    },
  });

  registry.register({
    name: 'forensics',
    aliases: ['foren'],
    description: 'Failure Forensics: view, inspect, and export auto-classified failure reports',
    usage: '[latest | show <id> | export <id>]',
    argsHint: '[latest|show|export]',
    handler(args, ctx) {
      const sub = args[0];
      if (sub === undefined || sub === 'view') {
        if (ctx.openForensicsPanel) ctx.openForensicsPanel();
        else ctx.print('Forensics panel is not available.');
        return;
      }
      if (sub === 'latest') {
        if (!ctx.extensions.forensicsRegistry) {
          ctx.print('[Forensics] Registry not active.');
          return;
        }
        const report = ctx.extensions.forensicsRegistry.latest();
        if (!report) {
          ctx.print('[Forensics] No failure reports recorded this session.');
          return;
        }
        const lines: string[] = [
          `[Forensics] Latest failure report (id: ${report.id})`,
          `  Time:           ${new Date(report.generatedAt).toISOString()}`,
          `  Classification: ${report.classification}`,
          `  Summary:        ${report.summary}`,
        ];
        if (report.errorMessage) lines.push(`  Error:          ${report.errorMessage}`);
        if (report.stopReason) lines.push(`  Stop reason:    ${report.stopReason}`);
        if (report.taskId) lines.push(`  Task ID:        ${report.taskId}`);
        if (report.turnId) lines.push(`  Turn ID:        ${report.turnId}`);
        if (report.causalChain.length > 0) {
          lines.push('  Causal chain:');
          for (const entry of report.causalChain) {
            const marker = entry.isRootCause ? '  ● ' : '  · ';
            lines.push(`  ${marker}${entry.description}`);
          }
        }
        if (report.jumpLinks.length > 0) {
          lines.push('  Jump links:');
          for (const link of report.jumpLinks) {
            lines.push(`    [${link.kind}] ${link.label} → ${link.target}${link.args ? ` (${link.args})` : ''}`);
          }
        }
        lines.push(`  Use "/forensics show ${report.id}" for full JSON.`);
        ctx.print(lines.join('\n'));
        return;
      }
      if (sub === 'show') {
        const id = args[1];
        if (!id) {
          ctx.print('Usage: /forensics show <id>');
          return;
        }
        if (!ctx.extensions.forensicsRegistry) {
          ctx.print('[Forensics] Registry not active.');
          return;
        }
        const json = ctx.extensions.forensicsRegistry.exportAsJson(id);
        if (!json) {
          ctx.print(`[Forensics] No report found with id "${id}". Use /forensics latest to see the most recent.`);
          return;
        }
        ctx.print(json);
        return;
      }
      if (sub === 'export') {
        const id = args[1];
        if (!id) {
          ctx.print('Usage: /forensics export <id>');
          return;
        }
        if (!ctx.extensions.forensicsRegistry) {
          ctx.print('[Forensics] Registry not active.');
          return;
        }
        const json = ctx.extensions.forensicsRegistry.exportBundleAsJson(id, {
          replaySnapshot: requireReplayEngine(ctx).getSnapshot() as ReplaySnapshotInput,
        });
        if (!json) {
          ctx.print(`[Forensics] No report found with id "${id}".`);
          return;
        }
        ctx.print(`[Forensics] Incident bundle ${id}:\n${json}`);
        return;
      }
      ctx.print(
        'Usage: /forensics <subcommand>\n'
        + '  /forensics             — open the Forensics panel\n'
        + '  /forensics latest      — print the most recent failure report summary\n'
        + '  /forensics show <id>   — show full JSON for a specific report\n'
        + '  /forensics export <id> — export incident bundle JSON to the conversation'
      );
    },
  });
}
