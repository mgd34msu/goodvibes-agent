import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEATURE_FLAG_MAP } from '@pellux/goodvibes-sdk/platform/runtime/state';
import { ConfigManager } from '../../config/index.ts';
import { handleGoodVibesCliCommand, parseGoodVibesCli } from '../../cli/index.ts';

async function runRelayCli(args: readonly string[], workingDirectory: string, homeDirectory: string) {
  const output: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (value?: unknown) => { output.push(String(value)); };
    const result = await handleGoodVibesCliCommand({
      cli: parseGoodVibesCli(args),
      configManager: new ConfigManager({ workingDir: workingDirectory, homeDir: homeDirectory, surfaceRoot: 'agent' }),
      workingDirectory,
      homeDirectory,
    });
    return { result, output: output.join('\n') };
  } finally {
    console.log = originalLog;
  }
}

describe('relay CLI command', () => {
  test('parses the relay command', () => {
    expect(parseGoodVibesCli(['relay', 'status']).command).toBe('relay');
  });

  test('status reports config off by default and is explicit that it is not a live check', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-relay-cli-'));
    const work = mkdtempSync(join(tmpdir(), 'goodvibes-agent-relay-cli-work-'));

    const { result, output } = await runRelayCli(['relay', 'status'], work, home);
    expect(result.exitCode).toBe(0);
    expect(output).toContain('relay.enabled: false');
    expect(output).toContain('not live-verified');
  });

  test('status --output-format=json reports the honest liveVerified:false shape', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-relay-cli-'));
    const work = mkdtempSync(join(tmpdir(), 'goodvibes-agent-relay-cli-work-'));

    const { result, output } = await runRelayCli(['relay', 'status', '--output-format=json'], work, home);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(output) as { liveVerified: boolean; config: { enabled: boolean }; flag: { id: string } };
    expect(parsed.liveVerified).toBe(false);
    expect(parsed.config.enabled).toBe(false);
    expect(parsed.flag.id).toBe('relay-connect');
  });

  test('pair honestly refuses rather than fabricating a pairing payload', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-relay-cli-'));
    const work = mkdtempSync(join(tmpdir(), 'goodvibes-agent-relay-cli-work-'));

    const { result, output } = await runRelayCli(['relay', 'pair'], work, home);
    expect(result.exitCode).toBe(1);
    expect(output).toContain('cannot mint a relay pairing payload');
  });

  test('unknown relay subcommand is a usage error, not a silent success', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-relay-cli-'));
    const work = mkdtempSync(join(tmpdir(), 'goodvibes-agent-relay-cli-work-'));

    const { result, output } = await runRelayCli(['relay', 'bogus'], work, home);
    expect(result.exitCode).toBe(2);
    expect(output).toContain('Unknown relay subcommand');
  });

  test('the relay-connect feature flag is present in the vendored flag registry (SDK 1.6.1)', () => {
    // Pin for "the relay-connect flag flows through this fork's flags surface": Agent's
    // createFeatureFlagManager (src/runtime/index.ts) filters persisted config against
    // FEATURE_FLAG_MAP, so any SDK-registered flag — including relay-connect — is
    // automatically part of this fork's flags surface with no per-flag repo change
    // needed. This test pins that the flag genuinely exists in the vendored SDK so a
    // future SDK downgrade or rename would fail loudly here instead of silently
    // dropping relay-connect from Settings > Feature Controls.
    const flag = FEATURE_FLAG_MAP.get('relay-connect');
    expect(flag).toBeTruthy();
    expect(flag?.defaultState).toBe('disabled');
    expect(flag?.runtimeToggleable).toBe(true);
  });
});
