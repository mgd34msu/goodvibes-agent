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
    expect(arrayValue(packageJson, 'files')).toContain('LICENSE');
    expect(recordValue(packageJson, 'repository').url).toBe('git+https://github.com/mgd34msu/goodvibes-agent.git');
    expect(recordValue(packageJson, 'bugs').url).toBe('https://github.com/mgd34msu/goodvibes-agent/issues');
    expect(packageJson.homepage).toBe('https://github.com/mgd34msu/goodvibes-agent#readme');
    expect(recordValue(packageJson, 'publishConfig').access).toBe('public');
  });

  test('documents release checklist and manual PTY gate', async () => {
    const changelog = await readFile('CHANGELOG.md', 'utf-8');
    const evidence = await readFile('docs/release-evidence.md', 'utf-8');
    const license = await readFile('LICENSE', 'utf-8');
    const readme = await readFile('README.md', 'utf-8');
    const checklist = await readFile('docs/release-checklist.md', 'utf-8');
    const plan = await readFile('docs/release-plan.md', 'utf-8');
    const upgrade = await readFile('docs/sdk-upgrade.md', 'utf-8');
    const risks = await readFile('docs/release-risks.md', 'utf-8');

    expect(changelog).toContain('Manual PTY smoke');
    expect(changelog).toContain('docs/release-evidence.md');
    expect(license).toContain('MIT License');
    expect(license).toContain('GoodVibes contributors');
    expect(changelog).toContain('@pellux/goodvibes-sdk@0.33.30');
    expect(changelog).toContain('docs/release-risks.md');
    expect(readme).toContain('bun install -g @pellux/goodvibes-agent');
    expect(readme).toContain('goodvibes-agent compat');
    expect(readme).toContain('Current Limitations');
    expect(readme).toContain('docs/release-risks.md');
    expect(readme).toContain('docs/release-evidence.md');
    expect(checklist).toContain('bun run check:release');
    expect(checklist).toContain('goodvibes-agent compat');
    expect(checklist).toContain('bun run check:sdk');
    expect(checklist).toContain('Do not publish');
    expect(checklist).toContain('docs/manual-smoke.md');
    expect(checklist).toContain('docs/release-risks.md');
    expect(checklist).toContain('docs/release-evidence.md');
    expect(plan).toContain('goodvibes-agent compat');
    expect(plan).not.toContain('publish dry-run');
    expect(plan).toContain('skipped live delegation check is explicitly documented');
    expect(upgrade).toContain('@pellux/goodvibes-sdk@0.33.30');
    expect(upgrade).toContain('Agent-specific knowledge isolation: pending');
    expect(upgrade).toContain('## Handoff Summary');
    expect(upgrade).toContain('Switch only `ask`/`search`');
    expect(evidence).toContain('2026-05-20 M4/M5 Readiness Evidence');
    expect(evidence).toContain('Manual PTY smoke');
    expect(evidence).toContain('AGENT_SMOKE_ONE');
    expect(evidence).toContain('Live delegation dry receipt was skipped');
    expect(risks).toContain('Agent-specific knowledge isolation is pending');
    expect(risks).toContain('Manual PTY smoke was recorded as passed on `2026-05-20`');
    expect(risks).toContain('It does not start, stop, install, supervise, repair, or own daemon lifecycle');
    expect(risks).toContain('Agent-local registries');
    expect(risks).toContain('private `0.0.0`');
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
