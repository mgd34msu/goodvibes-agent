import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { handleRoutinesCommand } from '../../cli/routines-command.ts';
import { parseGoodVibesCli } from '../../cli/parser.ts';
import { createShellPathService } from '@/runtime/index.ts';

const roots: string[] = [];

function runtime(argv: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), 'gv-agent-routines-cli-'));
  roots.push(root);
  const workingDirectory = join(root, 'workspace');
  const homeDirectory = join(root, 'home');
  mkdirSync(workingDirectory, { recursive: true });
  mkdirSync(join(homeDirectory, '.goodvibes', 'daemon'), { recursive: true });
  writeFileSync(join(homeDirectory, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token: 'routine-cli-token' }));
  const configManager = new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    workingDir: workingDirectory,
    homeDir: homeDirectory,
  });
  const registry = AgentRoutineRegistry.fromShellPaths(createShellPathService({ workingDirectory, homeDirectory }));
  registry.create({
    name: 'Daily Operations Sweep',
    description: 'Review operations posture.',
    steps: 'Inspect daemon status, schedules, approvals, and Agent Knowledge. Ask before external changes.',
    enabled: true,
    tags: ['ops'],
    triggers: ['daily'],
    source: 'user',
    provenance: 'test',
  });
  return {
    cli: parseGoodVibesCli(['routines', ...argv]),
    configManager,
    workingDirectory,
    homeDirectory,
  };
}

function inputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function scheduleResponse(): Response {
  return new Response(JSON.stringify({
    id: 'sched-cli-1',
    name: 'Agent routine: Daily Operations Sweep',
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    status: 'enabled',
    enabled: true,
    schedule: { kind: 'cron', expression: '0 8 * * *' },
    execution: { prompt: 'routine prompt', target: { kind: 'main' } },
    delivery: {
      mode: 'none',
      targets: [],
      fallbackTargets: [],
      includeSummary: true,
      includeTranscript: false,
      includeLinks: true,
    },
    failure: {
      action: 'retry',
      maxConsecutiveFailures: 3,
      cooldownMs: 3600000,
      retryPolicy: { maxAttempts: 2, delayMs: 60000, strategy: 'exponential' },
    },
    source: {
      id: 'source-sched-cli-1',
      kind: 'schedule',
      label: 'schedule',
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      metadata: {},
    },
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    deleteAfterRun: false,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('routines CLI command', () => {
  test('lists and shows local Agent routines', async () => {
    const listed = await handleRoutinesCommand(runtime(['list']));
    const shown = await handleRoutinesCommand(runtime(['show', 'daily-operations-sweep']));

    expect(listed.exitCode).toBe(0);
    expect(listed.output).toContain('Daily Operations Sweep');
    expect(shown.exitCode).toBe(0);
    expect(shown.output).toContain('Ask before external changes');
  });

  test('previews schedule promotion without calling the daemon', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return scheduleResponse();
    }) satisfies typeof fetch;

    try {
      const result = await handleRoutinesCommand(runtime(['promote', 'daily-operations-sweep', '--cron', '0 8 * * *']));
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Daemon schedule preview');
      expect(result.output).toContain('schedules.create /api/automation/schedules');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('confirmed promotion posts schedules.create with Agent-only knowledge policy', async () => {
    const requests: Array<{ readonly url: string; readonly method: string; readonly body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return scheduleResponse();
    }) satisfies typeof fetch;

    try {
      const result = await handleRoutinesCommand(runtime(['promote', 'daily-operations-sweep', '--cron', '0 8 * * *', '--yes']));
      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe('http://127.0.0.1:3421/api/automation/schedules');
      const payload = JSON.parse(requests[0]!.body) as { readonly prompt?: string; readonly target?: { readonly kind?: string; readonly surfaceKind?: string } };
      expect(payload.target).toEqual(expect.objectContaining({ kind: 'main', surfaceKind: 'service' }));
      expect(payload.prompt).toContain('Use isolated Agent Knowledge routes only');
      expect(payload.prompt).toContain('never use default Knowledge/Wiki or HomeGraph');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
