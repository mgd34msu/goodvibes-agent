import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { handleGoodVibesCliCommand, parseGoodVibesCli } from '../../cli/index.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';

async function runProfilesCli(args: readonly string[], homeDirectory: string) {
  const output: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (value?: unknown) => { output.push(String(value)); };
    const result = await handleGoodVibesCliCommand({
      cli: parseGoodVibesCli(args),
      configManager: new ConfigManager({ workingDir: homeDirectory, homeDir: homeDirectory, surfaceRoot: 'agent' }),
      workingDirectory: homeDirectory,
      homeDirectory,
    });
    return {
      result,
      output: output.join('\n'),
    };
  } finally {
    console.log = originalLog;
  }
}

describe('profiles CLI command', () => {
  test('parses profiles command and --agent-profile flag', () => {
    const parsed = parseGoodVibesCli(['--agent-profile', 'household', 'status']);
    expect(parsed.flags.agentProfile).toBe('household');
    expect(parsed.command).toBe('status');

    const inline = parseGoodVibesCli(['--agent-profile=travel', 'profiles', 'list']);
    expect(inline.flags.agentProfile).toBe('travel');
    expect(inline.command).toBe('profiles');

    const profiles = parseGoodVibesCli(['profiles', 'list']);
    expect(profiles.command).toBe('profiles');
  });

  test('creates, lists, shows, and deletes Agent runtime profiles with confirmation', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-profiles-cli-'));

    const refused = await runProfilesCli(['profiles', 'create', 'Household'], home);
    expect(refused.result.exitCode).toBe(2);
    expect(refused.output).toContain('without --yes');

    const created = await runProfilesCli(['profiles', 'create', 'Household', '--yes'], home);
    expect(created.result.exitCode).toBe(0);
    expect(created.output).toContain('Agent runtime profile created: household');
    expect(created.output).toContain('goodvibes-agent --agent-profile household');

    const listed = await runProfilesCli(['profiles', 'list'], home);
    expect(listed.output).toContain('Agent runtime profiles (1)');
    expect(listed.output).toContain('household');

    const shown = await runProfilesCli(['profiles', 'show', 'household'], home);
    expect(shown.output).toContain('Agent runtime profile: household');

    const shownJson = await runProfilesCli(['profiles', 'show', 'household', '--json'], home);
    expect((JSON.parse(shownJson.output) as { kind?: unknown }).kind).toBe('agent.profiles.show');

    const deleteRefused = await runProfilesCli(['profiles', 'delete', 'household'], home);
    expect(deleteRefused.result.exitCode).toBe(2);
    expect(deleteRefused.output).toContain('without --yes');

    const deleted = await runProfilesCli(['profiles', 'delete', 'household', '--yes'], home);
    expect(deleted.result.exitCode).toBe(0);
    expect(deleted.output).toContain('Agent runtime profile deleted: household');
  });

  test('returns structured json envelopes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-profiles-json-'));
    const result = await runProfilesCli(['profiles', 'list', '--json'], home);
    const parsed = JSON.parse(result.output) as { ok?: unknown; kind?: unknown };
    expect(parsed.ok).toBe(true);
    expect(parsed.kind).toBe('agent.profiles.list');
  });

  test('lists starter templates and creates a seeded profile', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-profiles-starter-'));
    const templates = await runProfilesCli(['profiles', 'templates'], home);
    expect(templates.result.exitCode).toBe(0);
    expect(templates.output).toContain('household');
    expect(templates.output).toContain('personal-productivity');

    const created = await runProfilesCli(['profiles', 'create', 'research-lab', '--template', 'research', '--yes'], home);
    expect(created.result.exitCode).toBe(0);
    expect(created.output).toContain('starter: research');
    expect(created.output).toContain('seeded: 1 persona, 2 skills, 1 routine');

    const skillRegistry = new AgentSkillRegistry(join(home, '.goodvibes', 'agent', 'profile-homes', 'research-lab', '.goodvibes', 'agent', 'skills', 'skills.json'));
    expect(skillRegistry.snapshot().enabledSkills.map((skill) => skill.name)).toContain('Source-grounded Brief');

    const listed = await runProfilesCli(['profiles', 'list'], home);
    expect(listed.output).toContain('starter=research');

    const shown = await runProfilesCli(['profiles', 'show', 'research-lab'], home);
    expect(shown.output).toContain('starter: research');
  });

  test('rejects unknown starter templates before writing profile records', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-profiles-starter-error-'));
    const result = await runProfilesCli(['profiles', 'create', 'bad', '--template', 'unknown', '--yes'], home);
    expect(result.result.exitCode).toBe(2);
    expect(result.output).toContain('Unknown Agent starter profile template');
  });
});
