import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandRegistry } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';

const ROOT = join(import.meta.dir, '../../..');

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

function collectSlashCommandRoots(text: string): readonly string[] {
  const roots = new Set<string>();
  const commandPattern = /(^|[\s`([])\/([a-z][a-z0-9_-]*)(?=$|[\s`.,;:)\]])/g;
  for (const line of text.split(/\r?\n/)) {
    commandPattern.lastIndex = 0;
    for (let match = commandPattern.exec(line); match !== null; match = commandPattern.exec(line)) {
      const root = match[2] ?? '';
      if (root === 'api') continue;
      roots.add(root);
    }
  }
  return [...roots].sort();
}

describe('Agent boundary docs', () => {
  test('source tree does not keep copied TUI release, UAT, or WRFC artifacts as Agent docs', () => {
    const forbiddenPaths = [
      'docs/releases',
      'docs/uat',
      'docs/wrfc',
    ] as const;

    for (const path of forbiddenPaths) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
  });

  test('source docs describe isolated Agent Knowledge without default wiki fallback', () => {
    const paths = [
      'docs/tools-and-commands.md',
      'docs/knowledge-artifacts-and-multimodal.md',
    ] as const;
    const forbidden = [
      'POST /api/knowledge/ask',
      '/api/knowledge/refinement',
      '--space <knowledgeSpaceId>',
      'TUI-owned',
      'default Knowledge/Wiki store',
      'product-specific graph',
    ] as const;

    for (const path of paths) {
      const content = readRepoFile(path);
      expect(content).toContain('/api/goodvibes-agent/knowledge');
      expect(content).toContain('default Knowledge/Wiki');
      for (const token of forbidden) {
        expect(content).not.toContain(token);
      }
    }
  });

  test('active planning source uses Agent-owned product language', () => {
    const commandSource = readRepoFile('src/input/commands/planning-runtime.ts');
    const panelSource = readRepoFile('src/panels/project-planning-panel.ts');
    const coordinatorSource = readRepoFile('src/planning/project-planning-coordinator.ts');
    const docsSource = readRepoFile('docs/project-planning.md');
    const combined = `${commandSource}\n${panelSource}\n${coordinatorSource}\n${docsSource}`;

    expect(combined).toContain('Agent workspace planning state');
    expect(combined).toContain('Agent-owned workspace planning state');
    expect(combined).toContain('Agent main conversation');
    expect(combined).toContain('Agent-owned planning loop');
    expect(coordinatorSource).toContain('Planning namespace:');
    expect(coordinatorSource).not.toContain('Knowledge space:');
    expect(combined).not.toContain('TUI-owned');
    expect(combined).not.toContain('non-Agent product setup');
  });

  test('tools command guide only names registered slash commands', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const missingRoots = collectSlashCommandRoots(readRepoFile('docs/tools-and-commands.md'))
      .filter((root) => registry.get(root) === undefined);

    expect(missingRoots).toEqual([]);
  });
});
