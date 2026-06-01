import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerAgentSkillsRuntimeCommands } from '../../input/commands/agent-skills-runtime.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';
import { createShellPathService } from '@/runtime/index.ts';

function commandHarness(): {
  readonly registry: CommandRegistry;
  readonly out: string[];
  readonly ctx: CommandContext;
} {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-skill-command-'));
  const registry = new CommandRegistry();
  registerAgentSkillsRuntimeCommands(registry);
  const out: string[] = [];
  const ctx = {
    print: (text: string) => out.push(text),
    workspace: {
      shellPaths: createShellPathService({ workingDirectory: root, homeDirectory: root }),
    },
  } as unknown as CommandContext;
  return { registry, out, ctx };
}

describe('/agent-skills command', () => {
  test('creates, lists, enables, shows, and disables a local skill', async () => {
    const { registry, out, ctx } = commandHarness();

    await registry.execute('agent-skills', [
      'create',
      '--name',
      'Inbox Triage',
      '--description',
      'Prioritize messages without sending replies.',
      '--procedure',
      'Summarize senders, urgency, and next actions. Do not send external messages.',
      '--tags',
      'ops,communication',
    ], ctx);
    await registry.execute('agent-skills', ['enable', 'inbox-triage'], ctx);
    await registry.execute('agent-skills', ['enabled'], ctx);
    await registry.execute('agent-skills', ['show', 'inbox-triage'], ctx);
    await registry.execute('agent-skills', ['disable', 'inbox-triage'], ctx);

    const text = out.join('\n');
    expect(text).toContain('Created Agent skill inbox-triage');
    expect(text).toContain('Enabled Agent skill inbox-triage');
    expect(text).toContain('Inbox Triage - Prioritize messages');
    expect(text).toContain('Do not send external messages');
    expect(text).toContain('Disabled Agent skill inbox-triage');
  });

  test('requires explicit delete confirmation and rejects secret-looking procedure content', async () => {
    const { registry, out, ctx } = commandHarness();

    await registry.execute('agent-skills', ['create', '--name', 'Ops', '--description', 'Ops procedure.', '--procedure', 'Inspect then act.'], ctx);
    await registry.execute('agent-skills', ['delete', 'ops'], ctx);
    await registry.execute('agent-skills', ['delete', 'ops', '--yes'], ctx);
    await registry.execute('agent-skills', ['create', '--name', 'Bad', '--description', 'Bad.', '--procedure', 'token=super-secret-value'], ctx);

    const text = out.join('\n');
    expect(text).toContain('Refusing to delete Agent skill ops without --yes');
    expect(text).toContain('Deleted Agent skill ops');
    expect(text).toContain('secret-looking');
  });

  test('creates and enables local skill bundles', async () => {
    const { registry, out, ctx } = commandHarness();

    await registry.execute('agent-skills', ['create', '--name', 'Briefing', '--description', 'Summarize status.', '--procedure', 'Review state and report next actions.'], ctx);
    await registry.execute('agent-skills', ['create', '--name', 'Approvals', '--description', 'Review approvals.', '--procedure', 'Explain pending approval risk and decision.'], ctx);
    await registry.execute('agent-skills', [
      'bundle',
      'create',
      '--name',
      'Operator Pack',
      '--description',
      'Use briefing and approval review together.',
      '--skills',
      'briefing,approvals',
    ], ctx);
    await registry.execute('agent-skills', ['bundle', 'enable', 'operator-pack'], ctx);
    await registry.execute('agent-skills', ['bundle', 'enabled'], ctx);
    await registry.execute('agent-skills', ['bundle', 'show', 'operator-pack'], ctx);

    const text = out.join('\n');
    expect(text).toContain('Created Agent skill bundle operator-pack');
    expect(text).toContain('Enabled Agent skill bundle operator-pack');
    expect(text).toContain('Operator Pack - Use briefing and approval review together.');
    expect(text).toContain('active skills: 2');
    expect(text).toContain('- briefing: Briefing');
    expect(text).toContain('- approvals: Approvals');
  });

  test('/skills local routes to Agent-local skills through the Agent command registry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-skill-local-alias-'));
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const out: string[] = [];
    const ctx = {
      print: (text: string) => out.push(text),
      workspace: {
        shellPaths: createShellPathService({ workingDirectory: root, homeDirectory: root }),
      },
    } as unknown as CommandContext;

    expect(registry.get('skills')?.name).toBe('agent-skills');
    await registry.execute('skills', ['local', 'create', '--name', 'Prep', '--description', 'Prepare context.', '--procedure', 'Read current state first.'], ctx);
    await registry.execute('skills', ['local', 'list'], ctx);

    const text = out.join('\n');
    expect(text).toContain('Created Agent skill prep');
    expect(text).toContain('Prep - Prepare context.');
  });
});
