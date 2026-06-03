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
    expect(out.join('\n')).toContain('Open Agent Workspace -> Work -> Review approvals');
    expect(out.join('\n')).toContain('or run /approval matrix');
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
    expect(out.join('\n')).toContain('Open Agent Workspace -> Setup -> Provider accounts');
    expect(out.join('\n')).toContain('or run /accounts review');
  });

  test('health open is guidance-only in Agent before read-model requirements', async () => {
    const registry = new CommandRegistry();
    registerHealthRuntimeCommands(registry);
    const command = registry.get('health');
    expect(command).toBeDefined();
    const out: string[] = [];

    await command!.handler(['open'], makeContext(out, []));

    expect(out.join('\n')).toContain('Open Agent Workspace -> Home -> Review health');
    expect(out.join('\n')).toContain('or run /health review');
  });

  test('health remote repair guidance uses remote runner wording', async () => {
    const registry = new CommandRegistry();
    registerHealthRuntimeCommands(registry);
    const command = registry.get('health');
    expect(command).toBeDefined();
    const out: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      platform: {
        readModels: {
          remote: {
            getSnapshot: () => ({
              supervisor: {
                sessions: [],
                activeConnections: 0,
                degradedConnections: 0,
              },
            }),
          },
        },
      },
    } as unknown as CommandContext;

    await command!.handler(['remote'], context);

    const text = out.join('\n');
    expect(text).toContain('repair remote runner state outside Agent');
    expect(text).not.toContain('repair remote worker state');
  });
});
