import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type { CommandRegistry } from '../command-registry.ts';
import type { SelectionItem } from '../selection-modal.ts';
import { exportToMarkdown } from '@pellux/goodvibes-sdk/platform/export';
import { requireSessionManager, requireSessionMemoryStore, requireShellPaths } from './runtime-services.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

export function registerSessionContentCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'export',
    description: 'Export conversation to a Markdown file',
    usage: '[format] [path] --yes',
    argsHint: '[markdown] [path]',
    async handler(args, ctx) {
      const shellPaths = requireShellPaths(ctx);
      const { rest, yes } = stripYesFlag(args);
      let format = 'markdown';
      let outPath: string | undefined;
      for (const arg of rest) {
        if (arg === 'markdown' || arg === 'md' || arg === 'text' || arg === 'txt') {
          format = arg === 'md' ? 'markdown' : arg === 'txt' ? 'text' : arg;
        } else {
          outPath = arg;
        }
      }
      if (!outPath) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        outPath = `./conversation-${ts}.${format === 'markdown' ? 'md' : 'txt'}`;
      }
      const resolvedPath = shellPaths.resolveWorkspacePath(outPath);
      if (!shellPaths.isWithinWorkingDirectory(resolvedPath)) {
        ctx.print('Error: Export path must be within the current directory.');
        return;
      }
      if (!yes) {
        requireYesFlag(ctx, `export conversation to ${resolvedPath}`, '/export [format] [path] --yes');
        return;
      }

      try {
        const data = ctx.session.conversationManager.toJSON() as { messages: Array<Record<string, unknown>> };
        const msgs = data.messages ?? [];
        let fileContent: string;
        if (format === 'markdown') {
          const exportMsgs = msgs.map(m => ({
            role: String(m.role ?? 'user') as 'user' | 'assistant' | 'system' | 'tool',
            content: Array.isArray(m.content)
              ? m.content as import('@pellux/goodvibes-sdk/platform/providers').ContentPart[]
              : String(m.content ?? ''),
            toolCalls: m.toolCalls as import('@pellux/goodvibes-sdk/platform/types').ToolCall[] | undefined,
            callId: m.callId as string | undefined,
            toolName: m.toolName as string | undefined,
            reasoningContent: m.reasoningContent as string | undefined,
            reasoningSummary: m.reasoningSummary as string | undefined,
            usage: m.usage as { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined,
          }));
          fileContent = exportToMarkdown(exportMsgs, {
            model: ctx.session.runtime.model,
            provider: ctx.session.runtime.provider,
            sessionId: ctx.session.runtime.sessionId,
            title: ctx.session.conversationManager.title || undefined,
          });
        } else {
          const lines: string[] = [];
          for (const m of msgs) {
            const role = String(m.role ?? 'unknown').toUpperCase();
            const content = typeof m.content === 'string' ? m.content : '';
            if (!content.trim()) continue;
            lines.push(`[${role}]`);
            lines.push(content);
            lines.push('');
          }
          fileContent = lines.join('\n');
        }
        const { dirname } = await import('node:path');
        const dir = dirname(resolvedPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        await writeFile(resolvedPath, fileContent, 'utf-8');
        ctx.print(`Exported ${msgs.length} messages to: ${resolvedPath}`);
      } catch (err) {
        ctx.print(`Export failed: ${summarizeError(err)}`);
      }
    },
  });

  registry.register({
    name: 'title',
    description: 'Show or set the conversation title',
    usage: '[text]',
    argsHint: '[text]',
    handler(args, ctx) {
      if (args.length === 0) ctx.print(ctx.session.conversationManager.title ? `Conversation title: ${ctx.session.conversationManager.title}` : 'No title set.');
      else {
        ctx.session.conversationManager.title = args.join(' ');
        ctx.print(`Title set to: ${ctx.session.conversationManager.title}`);
        ctx.renderRequest();
      }
    },
  });

  registry.register({
    name: 'save',
    description: 'Save current session to .goodvibes/agent/sessions/',
    usage: '[name]',
    argsHint: '[name]',
    handler(args, ctx) {
      const sessionManager = requireSessionManager(ctx);
      const rawName = args[0] || ctx.session.conversationManager.title || `session-${Date.now()}`;
      const exportData = ctx.session.conversationManager.toJSON() as { messages: object[] };
      const messages = exportData.messages ?? [];
      const meta = {
        title: ctx.session.conversationManager.title,
        model: ctx.session.runtime.model,
        provider: ctx.session.runtime.provider,
        timestamp: Date.now(),
      };
      try {
        const { filePath, sanitizedName } = sessionManager.save(rawName, messages, meta);
        ctx.print(`Session saved: ${rawName}${sanitizedName !== rawName ? ` (saved as "${sanitizedName}")` : ''}\n  → ${filePath}`);
      } catch (e) {
        ctx.print(`Failed to save session: ${summarizeError(e)}`);
      }
    },
  });

  registry.register({
    name: 'load',
    description: 'Load a saved session',
    usage: '<name>',
    argsHint: '<name>',
    handler(args, ctx) {
      if (!args[0]) {
        ctx.print('Usage: /load <session-name>\nRun /sessions to list available sessions.');
        return;
      }
      const sessionManager = requireSessionManager(ctx);
      try {
        const { meta, messages, agentRecords } = sessionManager.load(args[0]);
        ctx.session.conversationManager.resetAll();
        ctx.session.conversationManager.fromJSON({ messages: messages as never[] });
        if (meta.title) ctx.session.conversationManager.title = meta.title;
        ctx.session.conversationManager.rebuildHistory();
        ctx.renderRequest();
        ctx.print(`Session loaded: ${args[0]} (${messages.length} messages)${agentRecords.length > 0 ? ` [ignored ${agentRecords.length} runtime-owned local agent record${agentRecords.length !== 1 ? 's' : ''}]` : ''}`);
      } catch (e) {
        ctx.print(`Failed to load session: ${summarizeError(e)}`);
      }
    },
  });

  registry.register({
    name: 'undo',
    aliases: [],
    description: 'Undo the last conversation turn',
    usage: '',
    argsHint: '',
    handler(args, ctx) {
      if (args.length > 0) {
        ctx.print('Usage: /undo\n  Removes the last conversation turn. File edit undo belongs to the delegated GoodVibes TUI session.');
        return;
      }
      const success = ctx.session.conversationManager.undo();
      if (success) {
        ctx.print('Last turn undone. Use /redo to restore.');
        ctx.renderRequest();
      } else {
        ctx.print('Nothing to undo.');
      }
    },
  });

  registry.register({
    name: 'redo',
    description: 'Redo the last undone conversation turn',
    usage: '',
    argsHint: '',
    handler(args, ctx) {
      if (args.length > 0) {
        ctx.print('Usage: /redo\n  Restores the last undone conversation turn. File edit redo belongs to the delegated GoodVibes TUI session.');
        return;
      }
      const success = ctx.session.conversationManager.redo();
      if (success) {
        ctx.print('Turn restored.');
        ctx.renderRequest();
      } else {
        ctx.print('Nothing to redo.');
      }
    },
  });

  registry.register({
    name: 'retry',
    aliases: ['r'],
    description: 'Re-send the last user message',
    usage: '[modified text]',
    argsHint: '[modified text]',
    handler(args, ctx) {
      const lastMsg = ctx.session.conversationManager.getLastUserMessage();
      if (!lastMsg) {
        ctx.print('No message to retry.');
        return;
      }
      ctx.session.conversationManager.undo();
      ctx.submitInput?.(args.length > 0 ? args.join(' ') : lastMsg);
    },
  });

  registry.register({
    name: 'sessions',
    description: 'List saved sessions',
    async handler(_args, ctx) {
      const sessionManager = requireSessionManager(ctx);
      const sessions = sessionManager.list();
      if (ctx.openSelection) {
        const items: SelectionItem[] = sessions.length === 0
          ? [{ id: '_empty', label: 'No saved sessions', detail: 'Use /save [name] to save' }]
          : sessions.map(s => ({ id: s.name, label: s.name, detail: s.title || '(untitled)', actions: 'Enter to load' }));
        ctx.openSelection('Sessions', items, { allowSearch: true }, (result) => {
          if (!result) return;
          try {
            const { meta, messages } = sessionManager.load(result.item.id);
            ctx.session.conversationManager.resetAll();
            ctx.session.conversationManager.fromJSON({ messages: messages as never[] });
            if (meta.title) ctx.session.conversationManager.title = meta.title;
            ctx.session.conversationManager.rebuildHistory();
            ctx.renderRequest();
            ctx.print(`Session loaded: ${result.item.id} (${messages.length} messages)`);
          } catch (e) {
            ctx.print(`Failed to load session: ${summarizeError(e)}`);
          }
        });
        return;
      }
      const lines = ['Saved sessions:', ''];
      for (const s of sessions) lines.push(`  ${s.name.padEnd(30)} ${(s.title || '(untitled)').padEnd(24)} ${new Date(s.timestamp).toLocaleString()}  (${s.messageCount} msgs)`);
      ctx.print(lines.join('\n'));
    },
  });

  registry.register({
    name: 'session-memory',
    aliases: ['smemory'],
    description: 'Manage conversation-pinned memories used during context compaction',
    usage: '[list|add <text>|remove <id> --yes]',
    argsHint: '[list|add|remove]',
    handler(args, ctx) {
      const sub = args[0] ?? 'list';
      if (sub === 'list' || args.length === 0) {
        const memories = requireSessionMemoryStore(ctx).list();
        ctx.print(memories.length === 0
          ? 'No conversation-pinned memories. Use !# prefix or /session-memory add <text> to create one.'
          : [`Conversation-Pinned Memories (${memories.length}):`, ...memories.map(m => `  [${m.id}] ${m.text}`)].join('\n'));
      } else if (sub === 'add') {
        const text = args.slice(1).join(' ').trim();
        if (!text) {
          ctx.print('Usage: /session-memory add <text>');
          return;
        }
        const id = requireSessionMemoryStore(ctx).add(text);
        ctx.print(`Memory added: [${id}] ${text}`);
      } else if (sub === 'remove') {
        const parsed = stripYesFlag(args);
        const id = parsed.rest[1];
        if (!id) {
          ctx.print('Usage: /session-memory remove <id> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `remove conversation-pinned memory ${id}`, '/session-memory remove <id> --yes');
          return;
        }
        const store = requireSessionMemoryStore(ctx);
        ctx.print(store.remove(id) ? `Memory removed: [${id}]` : `Memory not found: ${id}`);
      } else {
        ctx.print('Usage: /session-memory [list|add <text>|remove <id> --yes]\n  /session-memory                    — list conversation-pinned memories\n  /session-memory list               — list conversation-pinned memories\n  /session-memory add <text>         — add a memory without sending a message\n  /session-memory remove <id> --yes  — remove a specific memory');
      }
    },
  });
}
