import { describe, expect, test } from 'bun:test';
import { CommandRegistry } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';

const hiddenCopiedBreadthCommands = [
  'bridge',
  'cockpit',
  'communication',
  'deeplink',
  'forensics',
  'guidance',
  'handoff',
  'helpers',
  'hooks',
  'incident',
  'incident-review',
  'install',
  'managed',
  'marketplace',
  'memory-review',
  'memory-sync',
  'ops',
  'orchestration',
  'plugin',
  'profilesync',
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
] as const;

const visibleAgentBreadthCommands = [
  'agent',
  'agent-profile',
  'agent-skills',
  'approval',
  'auth',
  'health',
  'knowledge',
  'login',
  'logout',
  'mcp',
  'memory',
  'notify',
  'personas',
  'policy',
  'provider',
  'qrcode',
  'recall',
  'routines',
  'schedule',
  'secrets',
  'security',
  'setup',
  'subscription',
  'tasks',
  'trust',
  'voice',
  'workplan',
] as const;

describe('product breadth commands', () => {
  test('does not expose copied TUI breadth commands as Agent product workflows', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    for (const commandName of hiddenCopiedBreadthCommands) {
      expect(registry.get(commandName)).toBeUndefined();
    }
  });

  test('keeps Agent operator breadth commands visible', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    for (const commandName of visibleAgentBreadthCommands) {
      expect(registry.get(commandName)?.name).toBe(commandName);
    }
  });
});
