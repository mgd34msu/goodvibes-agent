import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

describe('Agent boundary docs', () => {
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
      'Home Assistant graph',
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
    const combined = `${commandSource}\n${panelSource}`;

    expect(combined).toContain('Agent workspace planning state');
    expect(combined).toContain('Agent-owned workspace planning state');
    expect(combined).toContain('Agent main conversation');
    expect(combined).not.toContain('TUI-owned');
    expect(combined).not.toContain('Home Assistant');
  });
});
