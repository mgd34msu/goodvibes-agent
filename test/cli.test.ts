import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { isRecord } from '../src/types.js';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const decoder = new TextDecoder();

function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes).trim();
}

describe('cli failure envelope', () => {
  test('invalid config parse failures return structured JSON', async () => {
    const agentHome = await mkdtemp(join(tmpdir(), 'goodvibes-agent-cli-'));
    try {
      const result = Bun.spawnSync({
        cmd: [process.execPath, 'run', 'src/main.ts', 'config'],
        cwd: repoRoot,
        env: {
          ...process.env,
          GOODVIBES_AGENT_HOME: agentHome,
          GOODVIBES_AGENT_BASE_URL: 'not-a-url',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(result.exitCode).toBe(1);
      expect(decode(result.stderr)).toBe('');

      const parsed: unknown = JSON.parse(decode(result.stdout));
      expect(isRecord(parsed)).toBe(true);
      if (!isRecord(parsed)) throw new Error('CLI output was not a JSON object');

      expect(parsed.ok).toBe(false);
      expect(parsed.kind).toBe('config_error');
      expect(parsed.error).toBeString();
      expect(String(parsed.error)).toContain('baseUrl');
    } finally {
      await rm(agentHome, { recursive: true, force: true });
    }
  });

  test('chat daemon connection failures return actionable JSON', async () => {
    const result = await runCliWithHome({
      command: ['chat', 'hello'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('daemon_unavailable');
    expect(String(result.body.error)).toContain('GoodVibes daemon');
  });

  test('chat auth failures return auth_required JSON', async () => {
    const result = await runCliWithHome({
      command: ['chat', 'hello'],
      env: { GOODVIBES_AGENT_TOKEN: 'invalid-token' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('auth_required');
    expect(String(result.body.error)).toContain('Auth failed');
  });
});

async function runCliWithHome(input: {
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly body: Record<string, unknown>;
}> {
  const agentHome = await mkdtemp(join(tmpdir(), 'goodvibes-agent-cli-'));
  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'run', 'src/main.ts', ...input.command],
      cwd: repoRoot,
      env: {
        ...process.env,
        ...input.env,
        GOODVIBES_AGENT_HOME: agentHome,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = decode(result.stdout);
    const parsed: unknown = JSON.parse(stdout);
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) throw new Error('CLI output was not a JSON object');
    return {
      exitCode: result.exitCode,
      stdout,
      stderr: decode(result.stderr),
      body: parsed,
    };
  } finally {
    await rm(agentHome, { recursive: true, force: true });
  }
}
