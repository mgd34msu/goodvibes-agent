import { describe, expect, test } from 'bun:test';
import { CommandRegistry } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';

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
  'setup',
  'settingssync',
  'share',
  'skills',
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
  'onboarding',
  'personas',
  'provider',
  'routines',
  'schedule',
  'secrets',
  'sessions',
  'workplan',
] as const;

describe('Agent command surface', () => {
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
});
