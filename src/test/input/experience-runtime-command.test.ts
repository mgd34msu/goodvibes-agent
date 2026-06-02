import { describe, expect, test } from 'bun:test';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerExperienceRuntimeCommands } from '../../input/commands/experience-runtime.ts';
import { registerHealthRuntimeCommands } from '../../input/commands/health-runtime.ts';
import { registerProviderAccountsRuntimeCommands } from '../../input/commands/provider-accounts-runtime.ts';

function makeContext(out: string[], opened: string[]): CommandContext {
  return {
    print: (text: string) => { out.push(text); },
    showPanel: (panelId: string) => { opened.push(panelId); },
  } as unknown as CommandContext;
}

describe('experience runtime commands', () => {
  test('approval open is guidance-only in Agent and does not open copied panels', async () => {
    const registry = new CommandRegistry();
    registerExperienceRuntimeCommands(registry);
    const command = registry.get('approval');
    expect(command).toBeDefined();
    const out: string[] = [];
    const opened: string[] = [];

    await command!.handler(['open'], makeContext(out, opened));

    expect(opened).toEqual([]);
    expect(out.join('\n')).toContain('Use /approval matrix');
  });

  test('approval matrix remains a read-only transcript summary', async () => {
    const registry = new CommandRegistry();
    registerExperienceRuntimeCommands(registry);
    const command = registry.get('approval');
    expect(command).toBeDefined();
    const out: string[] = [];

    await command!.handler(['matrix'], makeContext(out, []));

    expect(out.join('\n')).toContain('Approval Matrix');
    expect(out.join('\n')).toContain('delegate');
  });

  test('accounts open is guidance-only in Agent and does not open copied panels', async () => {
    const registry = new CommandRegistry();
    registerProviderAccountsRuntimeCommands(registry);
    const command = registry.get('accounts');
    expect(command).toBeDefined();
    const out: string[] = [];
    const opened: string[] = [];

    await command!.handler(['open'], makeContext(out, opened));

    expect(opened).toEqual([]);
    expect(out.join('\n')).toContain('Use /accounts review');
  });

  test('health open is guidance-only in Agent before read-model requirements', async () => {
    const registry = new CommandRegistry();
    registerHealthRuntimeCommands(registry);
    const command = registry.get('health');
    expect(command).toBeDefined();
    const out: string[] = [];

    await command!.handler(['open'], makeContext(out, []));

    expect(out.join('\n')).toContain('Use /health review');
  });
});
