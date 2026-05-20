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
});
