import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { isRecord } from '../src/types.js';

describe('release metadata', () => {
  test('keeps private 0.0.0 package metadata and exact SDK pin', async () => {
    const packageJson = await readJsonObject('package.json');

    expect(packageJson.name).toBe('@pellux/goodvibes-agent');
    expect(packageJson.version).toBe('0.0.0');
    expect(packageJson.private).toBe(true);
    expect(recordValue(packageJson, 'bin')['goodvibes-agent']).toBe('bin/goodvibes-agent.ts');
    expect(recordValue(packageJson, 'dependencies')['@pellux/goodvibes-sdk']).toBe('0.33.30');
    expect(recordValue(packageJson, 'scripts')['check:source']).toBe('bun run scripts/release-check.ts');
    expect(recordValue(packageJson, 'scripts')['check:release']).toBe('bun run scripts/release-check.ts --release');
    expect(arrayValue(packageJson, 'files')).toContain('CHANGELOG.md');
  });

  test('documents release checklist and manual PTY gate', async () => {
    const changelog = await readFile('CHANGELOG.md', 'utf-8');
    const readme = await readFile('README.md', 'utf-8');
    const checklist = await readFile('docs/release-checklist.md', 'utf-8');

    expect(changelog).toContain('Manual PTY smoke');
    expect(changelog).toContain('@pellux/goodvibes-sdk@0.33.30');
    expect(readme).toContain('bun install -g @pellux/goodvibes-agent');
    expect(checklist).toContain('bun run check:release');
    expect(checklist).toContain('Do not publish');
    expect(checklist).toContain('docs/manual-smoke.md');
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
