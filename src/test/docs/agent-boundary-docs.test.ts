import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandRegistry } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';
import { createAgentWorkspaceTool } from '../../tools/agent-workspace-tool.ts';

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

function collectCatalogCommandRoots(text: string): readonly string[] {
  const roots = new Set<string>();
  const tableRowPattern = /^\|\s*`\/([a-z][a-z0-9_-]*)`\s*\|/gm;
  for (let match = tableRowPattern.exec(text); match !== null; match = tableRowPattern.exec(text)) {
    roots.add(match[1] ?? '');
  }
  return [...roots].sort();
}

describe('Agent user-first product docs', () => {
  test('source tree does not keep copied TUI release, UAT, or WRFC docs as Agent docs', () => {
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

  test('package-facing docs describe Agent as an autonomous daemon-backed harness', () => {
    const combined = [
      readRepoFile('README.md'),
      readRepoFile('docs/getting-started.md'),
      readRepoFile('docs/connected-host.md'),
    ].join('\n\n');

    expect(combined).toContain('autonomous');
    expect(combined).toContain('existing terminal renderer');
    expect(combined).toContain('GoodVibes daemon');
    expect(combined).toContain('GoodVibes settings import');
    expect(combined).toContain('visible agents');
    expect(combined).toContain('agent_operator_method');
    expect(combined).toContain('confirm:true');
    expect(combined).toContain('explicitUserRequest');
  });

  test('canonical inventory covers competitor and platform capability context', () => {
    const inventory = readRepoFile('src/agent/competitive-feature-inventory.ts');

    for (const token of ['goodVibesNow', 'targetStandard', 'bestInClassRequirement', 'openclaw', 'hermes', 'odysseus']) {
      expect(inventory).toContain(token);
    }
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

  test('tools command guide only names registered slash commands', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const missingRoots = collectSlashCommandRoots(readRepoFile('docs/tools-and-commands.md'))
      .filter((root) => registry.get(root) === undefined);

    expect(missingRoots).toEqual([]);
  });

  test('tools command guide slash-command catalog matches canonical command roots', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const canonicalRoots = registry.list().map((command) => command.name).sort();
    const documentedRoots = collectCatalogCommandRoots(readRepoFile('docs/tools-and-commands.md'));

    expect(documentedRoots).toEqual(canonicalRoots);
  });

  test('README badge version and docs/README release-line stay in sync with package.json major.minor', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as { version: string };
    const [pkgMajor, pkgMinor] = pkg.version.split('.');
    const pkgMajorMinor = `${pkgMajor}.${pkgMinor}`;

    // README.md: badge must be in the synced form `version-X.Y.Z-blue.svg`
    const readme = readRepoFile('README.md');
    const badgeMatch = /version-([0-9]+\.[0-9]+\.[0-9]+)-blue\.svg/.exec(readme);
    expect(badgeMatch).not.toBeNull();
    const [badgeMajor, badgeMinor] = (badgeMatch![1] ?? '').split('.');
    expect(`${badgeMajor}.${badgeMinor}`).toBe(pkgMajorMinor);

    // docs/README.md: release-line string must be `X.Y.x`
    const docsReadme = readRepoFile('docs/README.md');
    const releaseLineMatch = /`([0-9]+\.[0-9]+\.x)`\s+release line/.exec(docsReadme);
    expect(releaseLineMatch).not.toBeNull();
    const [rlMajor, rlMinor] = (releaseLineMatch![1] ?? '').split('.');
    expect(`${rlMajor}.${rlMinor}`).toBe(pkgMajorMinor);
  });

  test('docs workspace action tokens only reference real workspace tool actions', () => {
    // Extract the accepted action enum from the live workspace tool definition.
    // createAgentWorkspaceTool requires deps but we only need the definition, so we
    // cast to satisfy the minimal shape, execute is never called here.
    const tool = createAgentWorkspaceTool({
      commandRegistry: new CommandRegistry(),
      commandContext: {} as never,
      toolRegistry: {} as never,
    });
    const actionEnum = (tool.definition.parameters as {
      properties: { action: { enum: string[] } };
    }).properties.action.enum;
    const realActions = new Set(actionEnum);

    // Collect every `workspace action:"..."` token list from checked-in docs.
    const docFiles = [
      'README.md',
      'docs/getting-started.md',
      'docs/tools-and-commands.md',
    ] as const;

    // Matches:  workspace action:"foo|bar|baz"  or  workspace action:"foo"
    const tokenPattern = /workspace action:"([^"]+)"/g;

    const ghost: string[] = [];
    for (const docFile of docFiles) {
      const content = readRepoFile(docFile);
      tokenPattern.lastIndex = 0;
      for (let m = tokenPattern.exec(content); m !== null; m = tokenPattern.exec(content)) {
        // Markdown table cells escape pipes inside code spans as `\|` so the
        // cell renders correctly; normalize before tokenizing.
        const tokens = (m[1] ?? '').replaceAll('\\|', '|').split('|');
        for (const token of tokens) {
          const t = token.trim();
          if (t && !realActions.has(t)) {
            ghost.push(`${docFile}: "${t}" is not a valid workspace action`);
          }
        }
      }
    }

    expect(ghost).toEqual([]);
  });
});
