import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CommandRegistry } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';

const hiddenCopiedOperatorCommands = [
  'cockpit',
  'communication',
  'forensics',
  'hooks',
  'incident',
  'marketplace',
  'ops',
  'orchestration',
  'panel',
  'remote',
  'services',
  'storage',
  'deeplink',
] as const;

const visibleOperatorCommands = [
  'agent',
  'approval',
  'health',
  'knowledge',
  'mcp',
  'policy',
  'provider',
  'security',
  'session',
  'subscription',
  'trust',
] as const;

describe('operator surfaces gate', () => {
  function walkProductionSource(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'test') continue;
        files.push(...walkProductionSource(fullPath));
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.ts')) files.push(fullPath);
    }
    return files;
  }

  test('production runtime source does not advertise itself as the TUI surface', () => {
    const root = join(process.cwd(), 'src');
    expect(statSync(root).isDirectory()).toBe(true);
    const leaks = walkProductionSource(root).flatMap((filePath) => {
      const content = readFileSync(filePath, 'utf8');
      const markers = [
        "surface: 'tui'",
        'surface: "tui"',
        "surfaceKind: 'tui'",
        "surfaceId: 'surface:tui'",
        "id: 'client:tui'",
        "kind: 'tui'",
        "getOrCreateCompanionToken('tui'",
      ];
      return markers
        .filter((marker) => content.includes(marker))
        .map((marker) => `${filePath.replace(`${root}/`, 'src/')}: ${marker}`);
    });
    expect(leaks).toEqual([]);
  });

  test('hides copied operator panels and lifecycle surfaces from slash-command discovery', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    for (const commandName of hiddenCopiedOperatorCommands) {
      expect(registry.get(commandName)).toBeUndefined();
    }
  });

  test('keeps Agent operator commands available', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    for (const commandName of visibleOperatorCommands) {
      expect(registry.get(commandName)?.name).toBe(commandName);
    }
  });
});
