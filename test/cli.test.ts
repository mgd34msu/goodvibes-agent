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

  test('ask daemon connection failures return actionable JSON', async () => {
    const result = await runCliWithHome({
      command: ['ask', 'hello'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('daemon_unavailable');
  });

  test('search daemon connection failures return actionable JSON', async () => {
    const result = await runCliWithHome({
      command: ['search', 'hello'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('daemon_unavailable');
  });

  test('workplan daemon connection failures return actionable JSON', async () => {
    const result = await runCliWithHome({
      command: ['workplan'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('daemon_unavailable');
  });

  test('approvals daemon connection failures return actionable JSON', async () => {
    const result = await runCliWithHome({
      command: ['approvals'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('daemon_unavailable');
  });

  test('automation daemon connection failures return actionable JSON', async () => {
    const result = await runCliWithHome({
      command: ['automation', '--json'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('daemon_unavailable');
  });

  test('automation json views use exact route id failure kinds', async () => {
    const cases = [
      { command: ['automation', '--json'], kind: 'daemon_unavailable' },
      { command: ['automation', 'status', '--json'], kind: 'daemon_unavailable' },
      { command: ['automation', 'jobs', '--json'], kind: 'daemon_unavailable' },
      { command: ['automation', 'runs', '--json'], kind: 'daemon_unavailable' },
      { command: ['automation', 'heartbeat', '--json'], kind: 'daemon_unavailable' },
      { command: ['automation', 'capacity', '--json'], kind: 'daemon_unavailable' },
    ] as const;

    for (const entry of cases) {
      const result = await runCliWithHome({
        command: entry.command,
        env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
      });
      expect(result.body.kind).toBe(entry.kind);
    }
  });

  test('automation json views use exact route id success kinds', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        switch (path) {
          case '/api/automation':
            return Response.json({ totals: { jobs: 0, enabled: 0, paused: 0, runs: 0 }, jobs: [], recentRuns: [] });
          case '/status':
            return Response.json({ status: 'running', version: '0.33.30' });
          case '/api/automation/jobs':
            return Response.json({ jobs: [] });
          case '/api/automation/runs':
            return Response.json({ runs: [] });
          case '/api/automation/heartbeat':
            return Response.json({ pending: [] });
          case '/api/runtime/scheduler':
            return Response.json({ slotsTotal: 1, slotsInUse: 0, queueDepth: 0, oldestQueuedAgeMs: null });
          default:
            return Response.json({ error: 'not found' }, { status: 404 });
        }
      },
    });
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const cases = [
        { command: ['automation', '--json'], kind: 'automation.integration.snapshot' },
        { command: ['automation', 'status', '--json'], kind: 'automation.integration.snapshot' },
        { command: ['automation', 'jobs', '--json'], kind: 'automation.jobs.list' },
        { command: ['automation', 'runs', '--json'], kind: 'automation.runs.list' },
        { command: ['automation', 'heartbeat', '--json'], kind: 'automation.heartbeat.list' },
        { command: ['automation', 'capacity', '--json'], kind: 'scheduler.capacity' },
      ] as const;

      for (const entry of cases) {
        const result = await runCliWithHome({
          command: entry.command,
          env: { GOODVIBES_AGENT_BASE_URL: baseUrl },
        });
        expect(result.exitCode).toBe(0);
        expect(result.body.ok).toBe(true);
        expect(result.body.kind).toBe(entry.kind);
      }
    } finally {
      await server.stop(true);
    }
  });

  test('schedules daemon connection failures return actionable JSON', async () => {
    const result = await runCliWithHome({
      command: ['schedules', '--json'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('daemon_unavailable');
  });

  test('delegate daemon connection failures return actionable JSON', async () => {
    const result = await runCliWithHome({
      command: ['delegate', '--wrfc', 'Build a harmless diagnostics note'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('daemon_unavailable');
  });

  test('empty delegate input returns validation JSON', async () => {
    const result = await runCliWithHome({
      command: ['delegate'],
      env: {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('validation_error');
  });

  test('delegations status degrades daemon failures into local history output', async () => {
    const result = await runTextCliWithHome({
      command: ['delegations'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Delegations');
    expect(result.stdout).toContain('Sessions warning: daemon_unavailable');
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
    const result = Bun.spawn({
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
    const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
      new Response(result.stdout).arrayBuffer(),
      new Response(result.stderr).arrayBuffer(),
      result.exited,
    ]);
    const stdout = decode(new Uint8Array(stdoutBytes));
    const parsed: unknown = JSON.parse(stdout);
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) throw new Error('CLI output was not a JSON object');
    return {
      exitCode,
      stdout,
      stderr: decode(new Uint8Array(stderrBytes)),
      body: parsed,
    };
  } finally {
    await rm(agentHome, { recursive: true, force: true });
  }
}

async function runTextCliWithHome(input: {
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
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
    return {
      exitCode: result.exitCode,
      stdout: decode(result.stdout),
      stderr: decode(result.stderr),
    };
  } finally {
    await rm(agentHome, { recursive: true, force: true });
  }
}
