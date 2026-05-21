import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { isRecord } from '../src/types.js';
import { EXPECTED_GOODVIBES_SDK_VERSION, GOODVIBES_AGENT_PACKAGE_VERSION, GOODVIBES_SDK_PACKAGE_PIN } from '../src/version.js';

describe('release metadata', () => {
  test('keeps private 0.0.0 package metadata and exact SDK pin', async () => {
    const packageJson = await readJsonObject('package.json');

    expect(packageJson.name).toBe('@pellux/goodvibes-agent');
    expect(packageJson.version).toBe(GOODVIBES_AGENT_PACKAGE_VERSION);
    expect(packageJson.private).toBe(true);
    expect(recordValue(packageJson, 'bin')['goodvibes-agent']).toBe('bin/goodvibes-agent.ts');
    expect(recordValue(packageJson, 'dependencies')['@pellux/goodvibes-sdk']).toBe(GOODVIBES_SDK_PACKAGE_PIN);
    expect(GOODVIBES_SDK_PACKAGE_PIN).toBe(EXPECTED_GOODVIBES_SDK_VERSION);
    expect(recordValue(packageJson, 'scripts')['check:source']).toBe('bun run scripts/release-check.ts');
    expect(recordValue(packageJson, 'scripts')['check:release']).toBe('bun run scripts/release-check.ts --release');
    expect(recordValue(packageJson, 'scripts')['check:sdk']).toBe('bun run src/main.ts compat');
    expect(arrayValue(packageJson, 'files')).toContain('CHANGELOG.md');
  });

  test('documents release checklist and manual PTY gate', async () => {
    const changelog = await readFile('CHANGELOG.md', 'utf-8');
    const readme = await readFile('README.md', 'utf-8');
    const checklist = await readFile('docs/release-checklist.md', 'utf-8');
    const upgrade = await readFile('docs/sdk-upgrade.md', 'utf-8');

    expect(changelog).toContain('Manual PTY smoke');
    expect(changelog).toContain('@pellux/goodvibes-sdk@0.33.30');
    expect(readme).toContain('bun install -g @pellux/goodvibes-agent');
    expect(readme).toContain('Current Limitations');
    expect(checklist).toContain('bun run check:release');
    expect(checklist).toContain('bun run check:sdk');
    expect(checklist).toContain('Do not publish');
    expect(checklist).toContain('docs/manual-smoke.md');
    expect(upgrade).toContain('@pellux/goodvibes-sdk@0.33.30');
    expect(upgrade).toContain('Agent-specific knowledge isolation: pending');
  });
});

async function readJsonObject(path: string): Promise<Readonly<Record<string, unknown>>> {
  const value: unknown = JSON.parse(await readFile(path, 'utf-8'));
  if (!isRecord(value)) throw new Error(`${path} is not a JSON object`);
  return value;
}

function recordValue(record: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`${key} is not a JSON object`);
  return value;
}

function arrayValue(record: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${key} is not an array`);
  return value;
}
