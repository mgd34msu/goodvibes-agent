import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerWorkPlanRuntimeCommands } from '../../input/commands/work-plan-runtime.ts';
import { WorkPlanStore } from '../../work-plans/work-plan-store.ts';

function makeContext(out: string[], opened: string[], store: WorkPlanStore): CommandContext {
  return {
    session: {
      conversationManager: {} as never,
      runtime: {
        model: '',
        provider: '',
        debugMode: false,
        systemPrompt: '',
        reasoningEffort: '',
        sessionId: 'sess-work-plan',
      },
    },
    provider: {
      providerRegistry: {} as never,
    },
    workspace: {
      workPlanStore: store,
    },
    platform: {
      config: {} as never,
      configManager: {} as never,
    },
    ops: {},
    extensions: {
      toolRegistry: {} as never,
      mcpRegistry: {} as never,
    },
    renderRequest: () => {},
    print: (text: string) => { out.push(text); },
    exit: () => {},
    showPanel: (panelId) => { opened.push(panelId); },
  };
}

describe('workplan command', () => {
  test('adds, lists, and updates persistent work plan items', async () => {
    const registry = new CommandRegistry();
    registerWorkPlanRuntimeCommands(registry);
    const command = registry.get('workplan');
    expect(command).toBeDefined();
    const store = new WorkPlanStore({
      homeDirectory: mkdtempSync(join(tmpdir(), 'gv-work-plan-command-')),
      projectId: 'project:command',
      projectRoot: '/tmp/command',
    });
    const out: string[] = [];
    const opened: string[] = [];
    const ctx = makeContext(out, opened, store);

    await command!.handler(['add', 'Ship', 'persistent', 'plan', '--owner', 'tui'], ctx);
    expect(opened).toContain('work-plan');
    const item = store.listItems()[0]!;
    expect(item.title).toBe('Ship persistent plan');
    expect(item.owner).toBe('tui');

    await command!.handler(['done', item.id.slice(0, 8)], ctx);
    expect(store.listItems()[0]?.status).toBe('done');

    out.length = 0;
    await command!.handler(['list'], ctx);
    expect(out.join('\n')).toContain('Ship persistent plan');
    expect(out.join('\n')).toContain('done');
  });

  test('requires --yes for destructive work plan cleanup', async () => {
    const registry = new CommandRegistry();
    registerWorkPlanRuntimeCommands(registry);
    const command = registry.get('workplan');
    expect(command).toBeDefined();
    const store = new WorkPlanStore({
      homeDirectory: mkdtempSync(join(tmpdir(), 'gv-work-plan-command-')),
      projectId: 'project:command',
      projectRoot: '/tmp/command',
    });
    const out: string[] = [];
    const opened: string[] = [];
    const ctx = makeContext(out, opened, store);

    await command!.handler(['add', 'Clean', 'this', 'up'], ctx);
    const item = store.listItems()[0]!;

    await command!.handler(['remove', item.id], ctx);
    expect(store.listItems()).toHaveLength(1);
    expect(out.join('\n')).toContain(`Refusing to remove work plan item ${item.id} without --yes`);

    await command!.handler(['done', item.id], ctx);
    await command!.handler(['clear-done'], ctx);
    expect(store.listItems()).toHaveLength(1);
    expect(out.join('\n')).toContain('Refusing to clear completed work plan items without --yes');

    await command!.handler(['clear-done', '--yes'], ctx);
    expect(store.listItems()).toHaveLength(0);
  });
});
