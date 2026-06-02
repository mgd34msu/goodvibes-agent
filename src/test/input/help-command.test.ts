import { describe, expect, test } from 'bun:test';
import type { CommandContext } from '../../input/command-registry.ts';
import { CommandRegistry } from '../../input/command-registry.ts';
import { registerShellCoreCommands } from '../../input/commands/shell-core.ts';
import type { SelectionItem } from '../../input/selection-modal.ts';

describe('/help command', () => {
  test('surfaces Agent-first operator actions in the help picker', async () => {
    const registry = new CommandRegistry();
    registerShellCoreCommands(registry);

    let capturedItems: readonly SelectionItem[] = [];
    const context = {
      openSelection: (_title: string, items: readonly SelectionItem[]) => {
        capturedItems = items;
      },
      print: () => {},
    } as unknown as CommandContext;

    await registry.execute('help', [], context);

    const ids = capturedItems.map((item) => item.id);
    expect(ids).toContain('/agent');
    expect(ids).toContain('/brief');
    expect(ids).toContain('/knowledge');
    expect(ids).toContain('/memory');
    expect(ids).toContain('/personas');
    expect(ids).toContain('/agent-skills');
    expect(ids).toContain('/routines');
    expect(ids).toContain('/delegate');
    expect(ids).toContain('/pair');
    expect(ids).not.toContain('/debug');
    expect(ids).not.toContain('/intelligence');
  });
});
