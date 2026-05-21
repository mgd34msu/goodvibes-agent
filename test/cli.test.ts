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
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'no' }, { status: 401 });
      },
    });
    try {
      const result = await runCliWithHome({
        command: ['chat', 'hello'],
        env: {
          GOODVIBES_AGENT_BASE_URL: `http://127.0.0.1:${server.port}`,
          GOODVIBES_AGENT_TOKEN: 'invalid-token',
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.body.ok).toBe(false);
      expect(result.body.kind).toBe('auth_required');
      expect(String(result.body.error)).toContain('Auth failed');
      expect(result.stdout).not.toContain('invalid-token');
      expect(result.stderr).not.toContain('invalid-token');
    } finally {
      await server.stop(true);
    }
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

  test('compat reports SDK pin, daemon version, and active Agent knowledge isolation', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/status') return Response.json({ status: 'running', version: '0.33.32' });
        return Response.json({ error: 'not found' }, { status: 404 });
      },
    });
    try {
      const result = await runCliWithHome({
        command: ['compat'],
        env: { GOODVIBES_AGENT_BASE_URL: `http://127.0.0.1:${server.port}` },
      });

      expect(result.exitCode).toBe(0);
      expect(result.body.ok).toBe(true);
      expect(result.body.kind).toBe('sdk.compatibility');

      const data = recordValue(result.body, 'data');
      const agent = recordValue(data, 'agent');
      const daemon = recordValue(data, 'daemon');
      const knowledge = recordValue(data, 'knowledge');
      expect(agent.sdkPackagePin).toBe('0.33.32');
      expect(agent.expectedDaemonVersion).toBe('0.33.32');
      expect(daemon.daemonVersion).toBe('0.33.32');
      expect(daemon.compatible).toBe(true);
      expect(knowledge.agentSpecificIsolation).toBe('active');
      expect(knowledge.activeAskRoute).toBe('/api/goodvibes-agent/knowledge/ask');
      expect(knowledge.activeSearchRoute).toBe('/api/goodvibes-agent/knowledge/search');
      expect(knowledge.routeSwitchAllowed).toBe(true);
    } finally {
      await server.stop(true);
    }
  });

  test('compat preserves SDK and knowledge state when daemon is unavailable', async () => {
    const result = await runCliWithHome({
      command: ['compat'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.body.ok).toBe(false);
    expect(result.body.kind).toBe('daemon_unavailable');

    const data = recordValue(result.body, 'data');
    const agent = recordValue(data, 'agent');
    const daemon = recordValue(data, 'daemon');
    const knowledge = recordValue(data, 'knowledge');
    expect(agent.sdkPackagePin).toBe('0.33.32');
    expect(daemon.reachable).toBe(false);
    expect(daemon.expectedVersion).toBe('0.33.32');
    expect(knowledge.agentSpecificIsolation).toBe('active');
  });

  test('compat fails clearly when daemon contract is older than the SDK pin', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/status') return Response.json({ status: 'running', version: '0.33.31' });
        return Response.json({ error: 'not found' }, { status: 404 });
      },
    });
    try {
      const result = await runCliWithHome({
        command: ['compat'],
        env: { GOODVIBES_AGENT_BASE_URL: `http://127.0.0.1:${server.port}` },
      });

      expect(result.exitCode).toBe(1);
      expect(result.body.ok).toBe(false);
      expect(result.body.kind).toBe('version_mismatch');

      const data = recordValue(result.body, 'data');
      const daemon = recordValue(data, 'daemon');
      expect(daemon.daemonVersion).toBe('0.33.31');
      expect(daemon.expectedVersion).toBe('0.33.32');
      expect(String(daemon.reason)).toContain('older than goodvibes-agent expects');
    } finally {
      await server.stop(true);
    }
  });

  test('ask and search use Agent-specific knowledge routes', async () => {
    const calls: { readonly method: string; readonly path: string; readonly body: unknown }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        const bodyText = await request.text();
        const body = bodyText.trim() ? JSON.parse(bodyText) as unknown : null;
        calls.push({ method: request.method, path, body });
        switch (path) {
          case '/api/goodvibes-agent/knowledge/ask':
            return Response.json({ answer: { text: 'GoodVibes Agent isolated answer.', confidence: 1, sources: [] }, results: [] });
          case '/api/goodvibes-agent/knowledge/search':
            return Response.json({ results: [] });
          default:
            return Response.json({ error: 'not found' }, { status: 404 });
        }
      },
    });
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const ask = await runCliWithHome({
        command: ['ask', 'What is GoodVibes Agent?', '--json'],
        env: { GOODVIBES_AGENT_BASE_URL: baseUrl },
      });
      const search = await runCliWithHome({
        command: ['search', 'What is GoodVibes Agent?', '--json'],
        env: { GOODVIBES_AGENT_BASE_URL: baseUrl },
      });

      expect(ask.exitCode).toBe(0);
      expect(ask.body.kind).toBe('knowledge.ask');
      expect(search.exitCode).toBe(0);
      expect(search.body.kind).toBe('knowledge.search');
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        'POST /api/goodvibes-agent/knowledge/ask',
        'POST /api/goodvibes-agent/knowledge/search',
      ]);
      const [askCall, searchCall] = calls;
      if (!askCall || !searchCall || !isRecord(askCall.body) || !isRecord(searchCall.body)) {
        throw new Error('Expected Agent knowledge request bodies.');
      }
      expect(recordValue(askCall.body, 'metadata').originProduct).toBe('goodvibes-agent');
      expect(recordValue(searchCall.body, 'metadata').originProduct).toBe('goodvibes-agent');
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

  test('mutation commands require confirmation before daemon calls', async () => {
    let requestCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        requestCount += 1;
        return Response.json({ ok: true });
      },
    });
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const cases = [
        ['approvals', 'approve', 'approval-1'],
        ['automation', 'run', 'job-1'],
        ['schedules', 'run', 'schedule-1'],
      ] as const;

      for (const command of cases) {
        const result = await runCliWithHome({
          command,
          env: { GOODVIBES_AGENT_BASE_URL: baseUrl },
        });
        expect(result.exitCode).toBe(1);
        expect(result.body.ok).toBe(false);
        expect(result.body.kind).toBe('confirmation_required');
      }
      expect(requestCount).toBe(0);
    } finally {
      await server.stop(true);
    }
  });

  test('mutation commands use exact route paths and success kinds', async () => {
    const calls: { readonly method: string; readonly path: string; readonly body: unknown }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const bodyText = await request.text();
        calls.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: bodyText.trim() ? JSON.parse(bodyText) as unknown : null,
        });
        return Response.json({ id: 'result-1', status: 'accepted', jobId: 'job-1', runId: 'run-1' });
      },
    });
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const cases = [
        {
          command: ['approvals', 'approve', 'approval-1', '--yes', '--note', 'looks good', '--json'],
          kind: 'approvals.approve',
          call: { method: 'POST', path: '/api/approvals/approval-1/approve', body: { note: 'looks good' } },
        },
        {
          command: ['approvals', 'deny', 'approval-2', '--yes', '--json'],
          kind: 'approvals.deny',
          call: { method: 'POST', path: '/api/approvals/approval-2/deny', body: {} },
        },
        {
          command: ['approvals', 'cancel', 'approval-3', '--yes', '--json'],
          kind: 'approvals.cancel',
          call: { method: 'POST', path: '/api/approvals/approval-3/cancel', body: {} },
        },
        {
          command: ['automation', 'run', 'job-1', '--yes', '--json'],
          kind: 'automation.jobs.run',
          call: { method: 'POST', path: '/api/automation/jobs/job-1/run', body: {} },
        },
        {
          command: ['automation', 'pause', 'job-2', '--yes', '--json'],
          kind: 'automation.jobs.pause',
          call: { method: 'POST', path: '/api/automation/jobs/job-2/pause', body: {} },
        },
        {
          command: ['automation', 'resume', 'job-3', '--yes', '--json'],
          kind: 'automation.jobs.resume',
          call: { method: 'POST', path: '/api/automation/jobs/job-3/resume', body: {} },
        },
        {
          command: ['automation', 'cancel', 'run-1', '--yes', '--json'],
          kind: 'automation.runs.cancel',
          call: { method: 'POST', path: '/api/automation/runs/run-1/cancel', body: {} },
        },
        {
          command: ['automation', 'retry', 'run-2', '--yes', '--json'],
          kind: 'automation.runs.retry',
          call: { method: 'POST', path: '/api/automation/runs/run-2/retry', body: {} },
        },
        {
          command: ['schedules', 'run', 'schedule-1', '--yes', '--json'],
          kind: 'schedules.run',
          call: { method: 'POST', path: '/api/automation/schedules/schedule-1/run', body: {} },
        },
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
      expect(calls).toEqual(cases.map((entry) => entry.call));
    } finally {
      await server.stop(true);
    }
  });

  test('mutation command daemon and auth failures are structured', async () => {
    const unavailable = await runCliWithHome({
      command: ['automation', 'run', 'job-1', '--yes', '--json'],
      env: { GOODVIBES_AGENT_BASE_URL: 'http://127.0.0.1:1' },
    });
    expect(unavailable.exitCode).toBe(1);
    expect(unavailable.body.kind).toBe('daemon_unavailable');

    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'no' }, { status: 401 });
      },
    });
    try {
      const denied = await runCliWithHome({
        command: ['approvals', 'approve', 'approval-1', '--yes', '--json'],
        env: {
          GOODVIBES_AGENT_BASE_URL: `http://127.0.0.1:${server.port}`,
          GOODVIBES_AGENT_TOKEN: 'invalid-token',
        },
      });
      expect(denied.exitCode).toBe(1);
      expect(denied.body.ok).toBe(false);
      expect(denied.body.kind).toBe('auth_required');
      expect(denied.stdout).not.toContain('invalid-token');
      expect(denied.stderr).not.toContain('invalid-token');
    } finally {
      await server.stop(true);
    }
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

function recordValue(record: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`${key} is not a JSON object`);
  return value;
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
