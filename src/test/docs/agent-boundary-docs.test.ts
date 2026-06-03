import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

function walkProductionFiles(dir: string): readonly string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue;
      files.push(...walkProductionFiles(fullPath));
      continue;
    }
    if (entry.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.md'))) files.push(fullPath);
  }
  return files;
}

describe('Agent boundary docs', () => {
  test('source tree does not keep copied TUI release, UAT, or WRFC artifacts as Agent docs', () => {
    const forbiddenPaths = [
      'docs/releases',
      'docs/uat',
      'docs/wrfc',
      'docs/panel-authoring.md',
    ] as const;

    for (const path of forbiddenPaths) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
  });

  test('package-facing docs and production source do not expose internal comparison or copied non-Agent product language', () => {
    const packageFacingPaths = [
      'README.md',
      'docs/README.md',
      'docs/getting-started.md',
      'docs/connected-host.md',
      'docs/release-and-publishing.md',
    ] as const;
    const productionSourcePaths = walkProductionFiles(join(ROOT, 'src'))
      .map((filePath) => filePath.slice(ROOT.length + 1));
    const forbidden = [
      `Home ${'Assistant'}`,
      `Home${'Graph'}`,
      `@pellux/goodvibes-${'tui'}`,
      `@pellux/goodvibes-${'daemon'}`,
      `goodvibes-${'daemon'}`,
      'TUI-owned',
      'current TUI session',
      'No service restart was attempted',
      'external-service-owned',
      'service controller',
      'Service lifecycle commands',
      'service switches',
      'services, and automation',
      'connected-service',
      'background agents',
      'wrfc route',
      'WRFC messages',
      'configured service providers',
      'Knowledge/Wiki',
      'default Knowledge',
      'Default Knowledge',
      'local worker',
      'local workers',
      'local background workers',
      'worker agents',
      'separate workers',
      'hidden worker flow',
      'hidden local agents',
    ] as const;
    const offenders: string[] = [];

    for (const path of [...packageFacingPaths, ...productionSourcePaths]) {
      const content = readRepoFile(path);
      for (const token of forbidden) {
        if (content.includes(token)) offenders.push(`${path}: ${token}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test('source docs describe isolated Agent Knowledge without default knowledge fallback', () => {
    const paths = [
      'docs/tools-and-commands.md',
      'docs/knowledge-artifacts-and-multimodal.md',
    ] as const;
    const forbidden = [
      'POST /api/knowledge/ask',
      '/api/knowledge/refinement',
      '--space <knowledgeSpaceId>',
      'TUI-owned',
      'default knowledge store',
      'product-specific graph',
    ] as const;

    for (const path of paths) {
      const content = readRepoFile(path);
      expect(content).toContain('/api/goodvibes-agent/knowledge');
      expect(content).toContain('default knowledge');
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
    expect(docsSource).not.toContain('opens the planning surface');
    expect(docsSource).not.toContain('planning panel or fullscreen planning view');
  });

  test('tools command guide only names registered slash commands', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const missingRoots = collectSlashCommandRoots(readRepoFile('docs/tools-and-commands.md'))
      .filter((root) => registry.get(root) === undefined);

    expect(missingRoots).toEqual([]);
  });

  test('package-facing onboarding stays TUI-first instead of CLI-first', () => {
    const readme = readRepoFile('README.md');
    const gettingStarted = readRepoFile('docs/getting-started.md');
    const tools = readRepoFile('docs/tools-and-commands.md');

    const readmeInstallSection = readme.slice(0, readme.indexOf('## Source Usage'));
    const gettingStartedInstallSection = gettingStarted.slice(0, gettingStarted.indexOf('## Run From Source'));

    expect(readmeInstallSection).toContain('goodvibes-agent\n```');
    expect(readmeInstallSection).not.toContain('goodvibes-agent personas');
    expect(readmeInstallSection).not.toContain('goodvibes-agent skills');
    expect(readmeInstallSection).not.toContain('goodvibes-agent memory');
    expect(readmeInstallSection).not.toContain('goodvibes-agent knowledge');
    expect(gettingStartedInstallSection).not.toContain('goodvibes-agent personas');
    expect(gettingStartedInstallSection).not.toContain('goodvibes-agent skills');
    expect(gettingStartedInstallSection).not.toContain('goodvibes-agent memory');
    expect(tools).not.toContain(`goodvibes-agent ${'automation'}`);
    expect(readme).toContain('Use the workspace as the primary product surface');
    expect(gettingStarted).toContain('configured in the TUI first');
  });
});
