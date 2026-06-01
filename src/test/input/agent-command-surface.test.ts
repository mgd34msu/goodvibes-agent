import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandContext } from '../../input/command-registry.ts';
import { CommandRegistry } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';

const ROOT = join(import.meta.dir, '../../..');

const hiddenCopiedCommands = [
  'bootstrap',
  'branch',
  'bridge',
  'cockpit',
  'communication',
  'deeplink',
  'forensics',
  'fork',
  'guidance',
  'handoff',
  'helpers',
  'hooks',
  'incident',
  'incident-review',
  'install',
  'managed',
  'marketplace',
  'merge',
  'memory-review',
  'memory-sync',
  'ops',
  'orchestration',
  'panel',
  'plugin',
  'profilesync',
  'provider-opt',
  'remote',
  'remote-env',
  'remote-setup',
  'replay',
  'scan',
  'services',
  'settingssync',
  'share',
  'storage',
  'team-memory',
  'teleport',
  'template',
  'tools',
  'tunnel',
  'update',
  'worker-pool',
  'wrfc',
  'wq',
] as const;

const expectedAgentCommands = [
  'agent',
  'agent-profile',
  'agent-skills',
  'auth',
  'config',
  'delegate',
  'help',
  'knowledge',
  'memory',
  'model',
  'personas',
  'provider',
  'routines',
  'schedule',
  'secrets',
  'sessions',
  'setup',
  'workplan',
] as const;

describe('Agent command interface', () => {
  test('hides copied TUI coding/lifecycle/developer commands from the Agent slash registry', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const names = new Set(registry.list().map((command) => command.name));

    for (const commandName of hiddenCopiedCommands) {
      expect(names.has(commandName)).toBe(false);
      expect(registry.get(commandName)).toBeUndefined();
    }
  });

  test('keeps first-class Agent operator commands available', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const names = new Set(registry.list().map((command) => command.name));

    for (const commandName of expectedAgentCommands) {
      expect(names.has(commandName)).toBe(true);
    }
  });

  test('auth and login command discovery does not advertise runtime service session exchange', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const login = registry.get('login');
    const auth = registry.get('auth');

    expect(login?.description).toBe('Front-door login flow for provider subscriptions');
    expect(login?.usage).toBe('provider <name> start|finish <code> --yes');
    expect(auth?.description).toBe('Review provider auth posture and export redacted auth review bundles');
    expect(auth?.usage).not.toContain('listener');
    expect(auth?.usage).not.toContain('service');
  });

  test('runtime service login paths fail closed in Agent commands', async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const printed: string[] = [];
    const dispatched: string[] = [];
    const context = {
      print: (message: string) => printed.push(message),
      executeCommand: async (name: string, args: string[]) => {
        dispatched.push([name, ...args].join(' '));
        return true;
      },
    } as unknown as CommandContext;

    await registry.execute('login', ['service', 'runtime', 'http://127.0.0.1:3421', 'user', 'pass', '--yes'], context);
    await registry.execute('auth', ['login', 'runtime', 'http://127.0.0.1:3421', 'user', 'pass', '--yes'], context);

    expect(dispatched).toEqual([]);
    expect(printed.join('\n')).toContain('Runtime service login is external to GoodVibes Agent.');
    expect(printed.join('\n')).toContain('provider subscriptions only');
  });

  test('routes /skills to the Agent-local skills command, not the copied TUI skill-pack command', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    expect(registry.get('skills')?.name).toBe('agent-skills');
    expect(registry.get('skill')?.name).toBe('agent-skills');
  });

  test('routes /memory to Agent-local durable memory instead of session-pinned compaction memory', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    expect(registry.get('memory')?.description).toContain('Agent-local memory');
    expect(registry.get('memory')?.description).not.toContain('session memories');
    expect(registry.get('mem')?.name).toBe('memory');
    expect(registry.get('session-memory')?.description).toContain('conversation-pinned memories');
    expect(registry.get('smemory')?.name).toBe('session-memory');
  });

  test('visible Agent guidance does not advertise hidden copied TUI lifecycle commands', () => {
    const visibleGuidanceFiles = [
      'src/input/agent-workspace-setup.ts',
      'src/input/commands/health-runtime.ts',
      'src/input/commands/mcp-runtime.ts',
      'src/input/commands/session-workflow.ts',
      'src/panels/approval-panel.ts',
      'src/panels/automation-control-panel.ts',
      'src/panels/provider-account-snapshot.ts',
      'src/panels/provider-health-domains.ts',
      'src/panels/session-browser-panel.ts',
      'src/panels/session-maintenance.ts',
      'src/panels/subscription-panel.ts',
      'src/renderer/help-overlay.ts',
      'src/renderer/settings-modal.ts',
      'src/runtime/bootstrap-hook-bridge.ts',
    ] as const;
    const forbiddenGuidance = [
      ['slash /status', /(^|[\s`'"([])\/status\b/],
      ['slash /compat', /(^|[\s`'"([])\/compat\b/],
      ['slash /automation jobs', /(^|[\s`'"([])\/automation jobs\b/],
      ['slash /remote supervisor', /(^|[\s`'"([])\/remote supervisor\b/],
      ['slash /remote recover', /(^|[\s`'"([])\/remote recover\b/],
      ['slash /remote setup', /(^|[\s`'"([])\/remote setup\b/],
      ['slash /services doctor', /(^|[\s`'"([])\/services doctor\b/],
      ['slash /services auth-review', /(^|[\s`'"([])\/services auth-review\b/],
      ['slash /settingssync', /(^|[\s`'"([])\/settingssync\b/],
      ['slash /managed staged', /(^|[\s`'"([])\/managed staged\b/],
      ['slash /panel tokens', /(^|[\s`'"([])\/panel tokens\b/],
      ['slash /setup onboarding', /(^|[\s`'"([])\/setup onboarding\b/],
      ['slash /providers', /(^|[\s`'"([])\/providers\b/],
    ] as const;

    for (const path of visibleGuidanceFiles) {
      const source = readFileSync(join(ROOT, path), 'utf-8');
      for (const [label, pattern] of forbiddenGuidance) {
        expect(pattern.test(source), `${path} should not advertise ${label}`).toBe(false);
      }
    }
  });
});
