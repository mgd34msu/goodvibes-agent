import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { handleGoodVibesCliCommand, parseGoodVibesCli } from '../../cli/index.ts';
import { renderGoodVibesCommandHelp, renderGoodVibesHelp } from '../../cli/help.ts';

const roots: string[] = [];

async function runCli(args: readonly string[], homeDirectory?: string): Promise<{
  readonly exitCode: number;
  readonly output: string;
}> {
  const root = homeDirectory ?? mkdtempSync(join(tmpdir(), 'goodvibes-agent-local-library-cli-'));
  if (!homeDirectory) roots.push(root);
  const output: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (value?: unknown) => { output.push(String(value)); };
    const result = await handleGoodVibesCliCommand({
      cli: parseGoodVibesCli(args),
      configManager: new ConfigManager({ workingDir: root, homeDir: root, surfaceRoot: 'agent' }),
      workingDirectory: root,
      homeDirectory: root,
    });
    return {
      exitCode: result.exitCode,
      output: output.join('\n'),
    };
  } finally {
    console.log = originalLog;
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('local Agent library CLI commands', () => {
  test('parses personas and skills commands plus aliases', () => {
    expect(parseGoodVibesCli(['personas', 'list']).command).toBe('personas');
    expect(parseGoodVibesCli(['persona', 'list']).command).toBe('personas');
    expect(parseGoodVibesCli(['skills', 'list']).command).toBe('skills');
    expect(parseGoodVibesCli(['agent-skills', 'list']).command).toBe('skills');
  });

  test('creates lists activates reviews and deletes local personas', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-personas-cli-'));
    roots.push(home);

    const created = await runCli([
      'personas',
      'create',
      '--name',
      'Travel Planner',
      '--description',
      'Plan trips',
      '--body',
      'Compare options before booking.',
      '--tags',
      'travel,planning',
      '--use',
    ], home);
    expect(created.exitCode).toBe(0);
    expect(created.output).toContain('travel-planner');
    expect(created.output).toContain('(active)');

    const active = await runCli(['personas', 'active'], home);
    expect(active.output).toContain('Travel Planner');
    expect(active.output).toContain('active: yes');

    const searched = await runCli(['personas', 'search', 'booking'], home);
    expect(searched.output).toContain('Travel Planner');

    const reviewed = await runCli(['personas', 'review', 'travel-planner', '--json'], home);
    const reviewedJson = JSON.parse(reviewed.output) as { readonly kind?: unknown; readonly data?: { readonly reviewState?: unknown } };
    expect(reviewedJson.kind).toBe('agent.personas.review');
    expect(reviewedJson.data?.reviewState).toBe('reviewed');

    const refused = await runCli(['personas', 'delete', 'travel-planner'], home);
    expect(refused.exitCode).toBe(2);
    expect(refused.output).toContain('without --yes');

    const deleted = await runCli(['personas', 'delete', 'travel-planner', '--yes'], home);
    expect(deleted.exitCode).toBe(0);
    expect(deleted.output).toContain('Agent persona deleted: travel-planner');
  });

  test('rejects secret-looking persona content', async () => {
    const result = await runCli([
      'personas',
      'create',
      '--name',
      'Bad',
      '--description',
      'Contains secret',
      '--body',
      'api_key=supersecretvalue',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('cannot store secret-looking values');
  });

  test('creates enables bundles reviews and deletes local skills', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-skills-cli-'));
    roots.push(home);

    const created = await runCli([
      'skills',
      'create',
      '--name',
      'Daily Brief',
      '--description',
      'Summarize operator state',
      '--procedure',
      'Review Agent Knowledge, work plans, approvals, and routines.',
      '--triggers',
      'morning,daily',
      '--enabled',
    ], home);
    expect(created.exitCode).toBe(0);
    expect(created.output).toContain('daily-brief');
    expect(created.output).toContain('(enabled)');

    const active = await runCli(['skills', 'active'], home);
    expect(active.output).toContain('Daily Brief');

    const bundle = await runCli([
      'skills',
      'bundle',
      'create',
      '--name',
      'Ops Pack',
      '--description',
      'Daily operations bundle',
      '--skills',
      'daily-brief',
      '--enabled',
    ], home);
    expect(bundle.exitCode).toBe(0);
    expect(bundle.output).toContain('ops-pack');

    const bundleJson = await runCli(['skills', 'bundle', 'show', 'ops-pack', '--json'], home);
    const parsed = JSON.parse(bundleJson.output) as { readonly kind?: unknown; readonly data?: { readonly skillIds?: readonly string[] } };
    expect(parsed.kind).toBe('agent.skills.bundles.show');
    expect(parsed.data?.skillIds).toContain('daily-brief');

    const stale = await runCli(['skills', 'stale', 'daily-brief', 'Needs update'], home);
    expect(stale.exitCode).toBe(0);
    expect(stale.output).toContain('daily-brief');

    const refused = await runCli(['skills', 'delete', 'daily-brief'], home);
    expect(refused.exitCode).toBe(2);
    expect(refused.output).toContain('without --yes');

    const deleted = await runCli(['skills', 'delete', 'daily-brief', '--yes'], home);
    expect(deleted.exitCode).toBe(0);
    expect(deleted.output).toContain('Agent skill deleted: daily-brief');
  });

  test('top-level help advertises local personas and skills', async () => {
    const help = renderGoodVibesHelp();
    expect(help).toContain('personas');
    expect(help).toContain('skills');
    expect(help).toContain('Manage local Agent personas');
    expect(help).toContain('Manage local Agent skills');

    const personaHelp = renderGoodVibesCommandHelp('personas');
    expect(personaHelp).toContain('GoodVibes personas');
    expect(personaHelp).toContain('personas create');

    const skillsHelp = renderGoodVibesCommandHelp('skills');
    expect(skillsHelp).toContain('GoodVibes skills');
    expect(skillsHelp).toContain('skills bundle create');
  });
});
