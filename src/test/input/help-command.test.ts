import { describe, expect, test } from 'bun:test';
import type { CommandContext } from '../../input/command-registry.ts';
import { CommandRegistry } from '../../input/command-registry.ts';
import { registerShellCoreCommands } from '../../input/commands/shell-core.ts';
import type { SelectionItem } from '../../input/selection-modal.ts';

describe('/help command', () => {
  test('surfaces the live command registry in the help picker', async () => {
    const registry = new CommandRegistry();
    registerShellCoreCommands(registry);
    registry.register({
      name: 'custom-agent-action',
      aliases: ['caa'],
      description: 'Late registered Agent action',
      usage: '<target>',
      handler: () => {},
    });

    let capturedTitle = '';
    let capturedItems: readonly SelectionItem[] = [];
    const context = {
      openSelection: (title: string, items: readonly SelectionItem[]) => {
        capturedTitle = title;
        capturedItems = items;
      },
      print: () => {},
    } as unknown as CommandContext;

    await registry.execute('help', [], context);

    const ids = capturedItems.map((item) => item.id);
    expect(capturedTitle).toBe('Help  -  Commands');
    expect(ids).toContain('/custom-agent-action');
    expect(ids).toContain('/commands');
    expect(ids).toContain('/model');
    expect(ids).toContain('/help');
    expect(ids).not.toContain('/agent setup');
    expect(ids).not.toContain('/debug');
    expect(ids).not.toContain('/intelligence');

    const custom = capturedItems.find((item) => item.id === '/custom-agent-action');
    expect(custom?.label).toBe('/custom-agent-action');
    expect(custom?.detail).toContain('Late registered Agent action');
    expect(custom?.detail).toContain('usage: /custom-agent-action <target>');
    expect(custom?.detail).toContain('aliases: /caa');
  });

  test('/commands uses the same registry-backed command picker', async () => {
    const registry = new CommandRegistry();
    registerShellCoreCommands(registry);

    let capturedItems: readonly SelectionItem[] = [];
    const context = {
      openSelection: (_title: string, items: readonly SelectionItem[]) => {
        capturedItems = items;
      },
      print: () => {},
    } as unknown as CommandContext;

    await registry.execute('commands', [], context);

    const ids = capturedItems.map((item) => item.id);
    expect(ids).toContain('/commands');
    expect(ids).toContain('/help');
    expect(ids).toContain('/model');
    expect(ids).not.toContain('/agent setup');
  });
});
