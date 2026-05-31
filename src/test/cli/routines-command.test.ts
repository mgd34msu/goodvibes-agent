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

function schedulesListResponse(): Response {
  return new Response(JSON.stringify({
    jobs: [
      {
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
        nextRunAt: 1_700_000_000_000,
        runCount: 2,
        successCount: 2,
        failureCount: 0,
        deleteAfterRun: false,
      },
    ],
    runs: [],
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

  test('previews schedule promotion with explicit delivery without calling the daemon', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return scheduleResponse();
    }) satisfies typeof fetch;

    try {
      const result = await handleRoutinesCommand(runtime([
        'promote',
        'daily-operations-sweep',
        '--cron',
        '0 8 * * *',
        '--delivery-webhook',
        'https://hooks.example.test/routine/secret-token',
      ]));
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('GoodVibes schedule preview');
      expect(result.output).toContain('schedules.create /api/automation/schedules');
      expect(result.output).toContain('delivery: webhook (1 target)');
      expect(result.output).not.toContain('secret-token');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('confirmed promotion posts schedules.create with Agent-only knowledge policy and delivery target', async () => {
    const requests: Array<{ readonly url: string; readonly method: string; readonly body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      });
      if ((init?.method ?? 'GET') === 'GET') return schedulesListResponse();
      return scheduleResponse();
    }) satisfies typeof fetch;

    try {
      const baseRuntime = runtime([
        'promote',
        'daily-operations-sweep',
        '--cron',
        '0 8 * * *',
        '--delivery-surface',
        'slack:route-slack:Ops',
        '--yes',
      ]);
      const result = await handleRoutinesCommand(baseRuntime);
      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe('http://127.0.0.1:3421/api/automation/schedules');
      const payload = JSON.parse(requests[0]!.body) as {
        readonly prompt?: string;
        readonly target?: { readonly kind?: string; readonly surfaceKind?: string };
        readonly delivery?: {
          readonly mode?: string;
          readonly targets?: readonly {
            readonly kind?: string;
            readonly surfaceKind?: string;
            readonly routeId?: string;
            readonly label?: string;
          }[];
        };
      };
      expect(payload.target).toEqual(expect.objectContaining({ kind: 'main', surfaceKind: 'service' }));
      expect(payload.delivery?.mode).toBe('surface');
      expect(payload.delivery?.targets?.[0]).toEqual(expect.objectContaining({
        kind: 'surface',
        surfaceKind: 'slack',
        routeId: 'route-slack',
        label: 'Ops',
      }));
      expect(payload.prompt).toContain('Use isolated Agent Knowledge routes only');
      expect(payload.prompt).toContain('never use default Knowledge/Wiki or non-Agent knowledge spaces');
      const receiptId = result.output.match(/receipt: (routine-schedule-[a-z0-9-]+)/)?.[1];
      expect(receiptId).toBeTruthy();

      const receipts = await handleRoutinesCommand({ ...baseRuntime, cli: parseGoodVibesCli(['routines', 'receipts']) });
      expect(receipts.exitCode).toBe(0);
      expect(receipts.output).toContain('Agent routine schedule receipts');
      expect(receipts.output).toContain('schedule=sched-cli-1');

      const receipt = await handleRoutinesCommand({ ...baseRuntime, cli: parseGoodVibesCli(['routines', 'receipt', receiptId!]) });
      expect(receipt.exitCode).toBe(0);
      expect(receipt.output).toContain('Agent routine schedule receipt');
      expect(receipt.output).toContain('cadence: cron 0 8 * * *');
      expect(receipt.output).toContain('delivery: surface');
      expect(receipt.output).toContain('delivery target: surface/slack route=route-slack label=Ops');

      const reconciled = await handleRoutinesCommand({ ...baseRuntime, cli: parseGoodVibesCli(['routines', 'reconcile']) });
      expect(reconciled.exitCode).toBe(0);
      expect(reconciled.output).toContain('Agent routine schedule reconciliation');
      expect(reconciled.output).toContain('matched: 1');
      expect(reconciled.output).toContain('live=sched-cli-1');
      expect(requests.some((request) => request.method === 'GET' && request.url === 'http://127.0.0.1:3421/api/automation/schedules')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects mixed delivery target kinds without calling the daemon', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return scheduleResponse();
    }) satisfies typeof fetch;

    try {
      const result = await handleRoutinesCommand(runtime([
        'promote',
        'daily-operations-sweep',
        '--cron',
        '0 8 * * *',
        '--delivery-surface',
        'slack',
        '--delivery-webhook',
        'https://hooks.example.test/routine',
        '--yes',
      ]));
      expect(result.exitCode).toBe(2);
      expect(result.output).toContain('Use one delivery target kind per routine promotion command.');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
