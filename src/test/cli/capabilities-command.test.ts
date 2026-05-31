import { describe, expect, test } from 'bun:test';
import { handleCapabilitiesCommand } from '../../cli/capabilities-command.ts';
import type { CliCommandRuntime } from '../../cli/management.ts';
import { parseGoodVibesCli } from '../../cli/parser.ts';

function makeRuntime(args: readonly string[]): CliCommandRuntime {
  return {
    cli: parseGoodVibesCli(args),
    configManager: {} as CliCommandRuntime['configManager'],
    workingDirectory: '/tmp/goodvibes-agent-workspace',
    homeDirectory: '/tmp/goodvibes-agent-home',
  };
}

describe('CLI capabilities command', () => {
  test('renders competitor benchmark text', async () => {
    const result = await handleCapabilitiesCommand(makeRuntime(['capabilities']));

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('GoodVibes Agent capability benchmark');
    expect(result.output).toContain('OpenClaw/Hermes');
    expect(result.output).toContain('Isolated Agent Knowledge / Wiki');
  });

  test('returns structured JSON with filtered capability rows', async () => {
    const result = await handleCapabilitiesCommand(makeRuntime(['capabilities', 'hermes', '--json']));
    const parsed = JSON.parse(result.output) as {
      readonly packageName?: string;
      readonly capabilities?: readonly { readonly competitors?: readonly string[] }[];
    };

    expect(result.exitCode).toBe(0);
    expect(parsed.packageName).toBe('@pellux/goodvibes-agent');
    expect(parsed.capabilities?.length).toBeGreaterThan(0);
    expect(parsed.capabilities?.every((capability) => capability.competitors?.includes('hermes'))).toBe(true);
  });
});
