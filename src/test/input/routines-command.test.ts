import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerRoutinesRuntimeCommands } from '../../input/commands/routines-runtime.ts';
import { createShellPathService } from '@/runtime/index.ts';

function commandHarness(): {
  readonly registry: CommandRegistry;
  readonly out: string[];
  readonly ctx: CommandContext;
} {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-routine-command-'));
  const registry = new CommandRegistry();
  registerRoutinesRuntimeCommands(registry);
  const out: string[] = [];
  const ctx = {
    print: (text: string) => out.push(text),
    workspace: {
      shellPaths: createShellPathService({ workingDirectory: root, homeDirectory: root }),
    },
  } as unknown as CommandContext;
  return { registry, out, ctx };
}

describe('/routines command', () => {
  test('creates, lists, enables, starts, shows, and disables a local routine', async () => {
    const { registry, out, ctx } = commandHarness();

    await registry.execute('routines', [
      'create',
      '--name',
      'Inbox Sweep',
      '--description',
      'Summarize inbound messages without sending replies.',
      '--steps',
      'Read channel state, group by sender, summarize urgency, and ask before external replies.',
      '--tags',
      'ops,communication',
    ], ctx);
    await registry.execute('routines', ['enable', 'inbox-sweep'], ctx);
    await registry.execute('routines', ['start', 'inbox-sweep'], ctx);
    await registry.execute('routines', ['enabled'], ctx);
    await registry.execute('routines', ['show', 'inbox-sweep'], ctx);
    await registry.execute('routines', ['disable', 'inbox-sweep'], ctx);

    const text = out.join('\n');
    expect(text).toContain('Created Agent routine inbox-sweep');
    expect(text).toContain('Enabled Agent routine inbox-sweep');
    expect(text).toContain('Started Agent routine inbox-sweep');
    expect(text).toContain('no hidden background job');
    expect(text).toContain('Inbox Sweep - Summarize inbound messages');
    expect(text).toContain('ask before external replies');
    expect(text).toContain('Disabled Agent routine inbox-sweep');
  });

  test('requires explicit delete confirmation and rejects secret-looking steps', async () => {
    const { registry, out, ctx } = commandHarness();

    await registry.execute('routines', ['create', '--name', 'Ops', '--description', 'Ops routine.', '--steps', 'Inspect then act.'], ctx);
    await registry.execute('routines', ['delete', 'ops'], ctx);
    await registry.execute('routines', ['delete', 'ops', '--yes'], ctx);
    await registry.execute('routines', ['create', '--name', 'Bad', '--description', 'Bad.', '--steps', 'token=super-secret-value'], ctx);

    const text = out.join('\n');
    expect(text).toContain('Refusing to delete Agent routine ops without --yes');
    expect(text).toContain('Deleted Agent routine ops');
    expect(text).toContain('secret-looking');
  });
});
