import type { CommandContext, CommandRegistry, SlashCommand } from '../command-registry.ts';
import type { SelectionItem } from '../selection-modal.ts';
import { EFFORT_DESCRIPTIONS } from '@pellux/goodvibes-sdk/platform/providers';
import { REASONING_BUDGET_MAP } from '@pellux/goodvibes-sdk/platform/providers';
import { compactConversation, requireKeybindingsManager, requireProviderApi } from './runtime-services.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';

function commandCategory(commandName: string): string {
  if ([
    'agent',
    'agent-profile',
    'brief',
    'health',
    'welcome',
    'setup',
    'tasks',
    'approval',
    'automation',
    'delegate',
    'schedule',
    'workplan',
    'plan',
  ].includes(commandName)) return 'Agent Operator';
  if ([
    'knowledge',
    'memory',
    'notes',
    'vibe',
    'vibes',
    'personas',
    'skills',
    'routines',
  ].includes(commandName)) return 'Knowledge & Local Context';
  if ([
    'channels',
    'notify',
    'qrcode',
    'pair',
  ].includes(commandName)) return 'Channels';
  if ([
    'model',
    'provider',
    'providers',
    'effort',
    'pin',
    'unpin',
    'refresh-models',
    'mode',
    'tts',
    'voice',
    'media',
    'image',
  ].includes(commandName)) return 'Model, Voice & Media';
  if ([
    'settings',
    'config',
    'keybindings',
    'shortcuts',
    'mcp',
    'secrets',
    'auth',
    'accounts',
    'subscription',
    'compat',
    'security',
    'trust',
    'bundle',
  ].includes(commandName)) return 'Setup & Security';
  if ([
    'save',
    'load',
    'sessions',
    'session',
    'conversation',
    'export',
    'title',
    'clear',
    'reset',
    'compact',
    'undo',
    'redo',
    'retry',
    'expand',
    'collapse',
    'context',
    'bookmarks',
    'paste',
    'next-error',
    'prev-error',
  ].includes(commandName)) return 'Conversation';
  return 'Tools & System';
}

function commandDetail(command: SlashCommand): string {
  const parts = [command.description];
  if (command.usage) parts.push(`usage: /${command.name} ${command.usage}`);
  if (command.aliases?.length) parts.push(`aliases: ${command.aliases.map((alias) => `/${alias}`).join(', ')}`);
  return parts.join(' | ');
}

function listRegisteredCommandItems(registry: CommandRegistry): SelectionItem[] {
  return registry.list()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((command) => ({
      id: `/${command.name}`,
      label: command.hidden ? `/${command.name} (hidden)` : `/${command.name}`,
      detail: commandDetail(command),
      category: commandCategory(command.name),
      primaryAction: 'select',
      actions: '[Enter] run command',
    }));
}

function registeredCommandListText(registry: CommandRegistry): string {
  const commands = listRegisteredCommandItems(registry);
  return [
    'Open the Agent workspace first, then press / inside it to search every product action.',
    '',
    'Registered slash commands:',
    ...commands.map((item) => `  ${item.label} - ${item.detail}`),
  ].join('\n');
}

function openRegisteredCommandSelection(registry: CommandRegistry, ctx: CommandContext): void {
  ctx.openSelection?.('Help  -  Commands', listRegisteredCommandItems(registry), { allowSearch: true }, (result) => {
    if (!result) return;
    const command = result.item.id;
    if (command.startsWith('/')) {
      const parts = command.slice(1).trim().split(/\s+/);
      const name = parts[0];
      const cmdArgs = parts.slice(1);
      void (ctx.executeCommand?.(name, cmdArgs) ?? registry.execute(name, cmdArgs, ctx));
    }
  });
}

export function registerShellCoreCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'model',
    aliases: ['m'],
    description: 'Select or display the current LLM model',
    usage: '[model-id]',
    argsHint: '[name]',
    async handler(args, ctx) {
      const providerApi = requireProviderApi(ctx);
      if (args.length === 0) {
        if (ctx.openModelPicker) {
          ctx.openModelPicker();
        } else {
          const models = await providerApi.listModels({ selectableOnly: true });
          const lines = ['Available models:', ...models.map((model) =>
            `  ${model.current ? '▶' : ' '} ${model.registryKey.padEnd(36)} ${model.displayName} (${model.providerId})`,
          )];
          ctx.print(lines.join('\n'));
        }
      } else {
        const modelId = args[0];
        try {
          const selected = await providerApi.selectModel(modelId);
          ctx.session.runtime.model = selected.registryKey;
          ctx.session.runtime.provider = selected.providerId;
          ctx.platform.configManager.set('provider.model', selected.registryKey);
          ctx.print([
            'Switched model',
            `  model ${selected.displayName}`,
            `  provider ${selected.providerId}`,
          ].join('\n'));
          void providerApi.recordModelUsage(selected.registryKey).catch((err) => { logger.debug('model usage record failed', { err }); });
        } catch (e) {
          ctx.print([
            'Error',
            `  message ${summarizeError(e)}`,
          ].join('\n'));
        }
      }
    },
  });

  registry.register({
    name: 'commands',
    aliases: ['cmds'],
    description: 'Browse all commands in a scrollable list',
    handler(_args, ctx) {
      if (ctx.openSelection) {
        openRegisteredCommandSelection(registry, ctx);
        return;
      }
      if (ctx.openHelpOverlay) {
        ctx.openHelpOverlay();
        return;
      }
      ctx.print('Use /help for interactive command list');
    },
  });

  registry.register({
    name: 'shortcuts',
    aliases: ['keys', 'keybinds'],
    description: 'Show keyboard shortcuts reference',
    hidden: true,
    handler(_args, ctx) {
      if (ctx.openShortcutsOverlay) {
        ctx.openShortcutsOverlay();
        return;
      }
      ctx.print('Use ? key or /help for shortcuts');
    },
  });

  registry.register({
    name: 'keybindings',
    aliases: ['kb'],
    description: 'List current keyboard bindings and their config file path',
    hidden: true,
    handler(_args, ctx) {
      const km = requireKeybindingsManager(ctx);
      const all = km.getAll();
      const lines: string[] = [
        `Keybindings config: ${km.getConfigPath()}`,
        '',
        `  ${'Action'.padEnd(28)}  ${'Binding'.padEnd(20)}  Description`,
        `  ${'─'.repeat(28)}  ${'─'.repeat(20)}  ${'─'.repeat(34)}`,
      ];
      for (const { action, combos, description } of all) {
        const label = combos.map((combo) => km.formatCombo(combo)).join(', ');
        lines.push(`  ${action.padEnd(28)}  ${label.padEnd(20)}  ${description}`);
      }
      lines.push('');
      lines.push('To customize: create the config file with { "action": { "key": "x", "ctrl": true } }');
      ctx.print(lines.join('\n'));
    },
  });

  registry.register({
    name: 'paste',
    aliases: ['clip'],
    description: 'Insert clipboard text or image into the prompt',
    handler(_args, ctx) {
      if (!ctx.pasteFromClipboard) {
        ctx.print('Paste is not available in this context.');
        return;
      }
      const result = ctx.pasteFromClipboard();
      if (!result.pasted) {
        ctx.print('Clipboard does not contain supported text or image data.');
      }
    },
  });

  registry.register({
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands and keyboard shortcuts',
    argsHint: '[command]',
    handler(_args, ctx) {
      if (ctx.openSelection) {
        openRegisteredCommandSelection(registry, ctx);
        return;
      }
      ctx.print(registeredCommandListText(registry));
    },
  });

  registry.register({
    name: 'clear',
    aliases: ['cls'],
    description: 'Clear the conversation display (keeps LLM context)',
    handler(_args, ctx) {
      ctx.session.conversationManager.clearDisplay();
      ctx.renderRequest();
    },
  });

  registry.register({
    name: 'reset',
    aliases: [],
    description: 'Full reset: clear display and conversation context',
    hidden: true,
    handler(_args, ctx) {
      ctx.session.conversationManager.resetAll();
      if (ctx.reloadSystemPrompt) {
        ctx.session.runtime.systemPrompt = ctx.reloadSystemPrompt();
      }
      ctx.session.conversationManager.rebuildHistory();
      ctx.renderRequest();
    },
  });

  registry.register({
    name: 'compact',
    aliases: [],
    description: 'Summarize conversation to free context window',
    async handler(_args, ctx) {
      ctx.print('Compacting conversation...');
      await compactConversation(ctx);
      ctx.print('Conversation compacted.');
      ctx.renderRequest();
    },
  });

  registry.register({
    name: 'quit',
    aliases: [':q'],
    description: 'Exit the application',
    handler(_args, ctx) {
      ctx.exit();
    },
  });

  registry.register({
    name: 'effort',
    aliases: ['e'],
    description: 'Show or set reasoning effort level',
    hidden: true,
    usage: '[level]',
    argsHint: '<instant|low|medium|high>',
    async handler(args, ctx) {
      const currentModel = await requireProviderApi(ctx).getCurrentModel();
      const validLevels = currentModel.reasoningEffort ?? [];

      if (validLevels.length === 0) {
        ctx.print(`Current model (${currentModel.displayName}) does not support configurable reasoning effort.`);
        return;
      }

      if (args.length === 0) {
        const current = (ctx.session.runtime.reasoningEffort || ctx.platform.configManager.get('provider.reasoningEffort') || 'medium') as string;
        if (ctx.openSelection) {
          const descriptions: Record<string, string> = {
            ...EFFORT_DESCRIPTIONS,
            medium: 'Balanced speed and quality (default)',
          };
          const items: SelectionItem[] = validLevels.map((level) => ({
            id: level,
            label: level,
            detail: level === current ? `◉ ${descriptions[level] ?? level}` : (descriptions[level] ?? level),
          }));
          ctx.openSelection('Reasoning Effort', items, { preSelectId: current, allowSearch: false }, (result) => {
            if (!result) return;
            const level = result.item.id as 'instant' | 'low' | 'medium' | 'high';
            ctx.session.runtime.reasoningEffort = level;
            ctx.platform.configManager.set('provider.reasoningEffort', level);
            ctx.print([
              'Reasoning effort set',
              `  level ${level}`,
            ].join('\n'));
            ctx.renderRequest();
          });
          return;
        }
        const budget = REASONING_BUDGET_MAP[current];
        const lines = [
          `Reasoning effort ${current}`,
          `  Mercury-2 reasoning_effort = '${current}'`,
          `  Claude thinking.budget_tokens = ${budget}`,
          `  Gemini thinking_config.thinking_budget = ${budget}`,
          `  GPT-5 (no-op)`,
          '',
          `Levels ${validLevels.join(', ')}`,
        ];
        ctx.print(lines.join('\n'));
        return;
      }

      const level = args[0] as 'instant' | 'low' | 'medium' | 'high';
      if (!validLevels.includes(level)) {
        ctx.print(`Invalid effort level ${level}\nValid levels ${validLevels.join(', ')}`);
        return;
      }

      ctx.session.runtime.reasoningEffort = level;
      ctx.platform.configManager.set('provider.reasoningEffort', level);
      ctx.print([
        'Reasoning effort set',
        `  level ${level}`,
      ].join('\n'));
    },
  });

}
