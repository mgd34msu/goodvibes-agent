import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerRoutinesRuntimeCommands } from '../../input/commands/routines-runtime.ts';
import { registerScheduleRuntimeCommands } from '../../input/commands/schedule-runtime.ts';
import { createShellPathService } from '@/runtime/index.ts';

function commandHarness(): {
  readonly registry: CommandRegistry;
  readonly out: string[];
  readonly ctx: CommandContext;
} {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-routine-command-'));
  const registry = new CommandRegistry();
  registerRoutinesRuntimeCommands(registry);
  registerScheduleRuntimeCommands(registry);
  const out: string[] = [];
  mkdirSync(join(root, '.goodvibes', 'daemon'), { recursive: true });
  writeFileSync(join(root, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token: 'routine-token' }));
  const ctx = {
    print: (text: string) => out.push(text),
    workspace: {
      shellPaths: createShellPathService({ workingDirectory: root, homeDirectory: root }),
    },
    platform: {
      configManager: new ConfigManager({
        surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
        workingDir: root,
        homeDir: root,
      }),
    },
    ops: {
      automationManager: {
        listJobs: () => [],
      },
    },
  } as unknown as CommandContext;
  return { registry, out, ctx };
}

function inputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function scheduleResponse(): Response {
  return new Response(JSON.stringify({
    id: 'sched-1',
    name: 'Agent routine: Inbox Sweep',
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    status: 'enabled',
    enabled: true,
    schedule: { kind: 'cron', expression: '0 9 * * *', timezone: 'America/Chicago' },
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
      id: 'source-sched-1',
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
        id: 'sched-1',
        name: 'Agent routine: Inbox Sweep',
        labels: [],
        createdAt: 1,
        updatedAt: 1,
        status: 'enabled',
        enabled: true,
        schedule: { kind: 'cron', expression: '0 9 * * *', timezone: 'America/Chicago' },
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
          id: 'source-sched-1',
          kind: 'schedule',
          label: 'schedule',
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
          metadata: {},
        },
        nextRunAt: 1_700_000_000_000,
        runCount: 3,
        successCount: 2,
        failureCount: 1,
        deleteAfterRun: false,
      },
    ],
    runs: [],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('/routines command', () => {
  test('creates, lists, enables, starts, shows, and disables a local routine', async () => {
    const { registry, out, ctx } = commandHarness();

    await registry.execute('routines', [
      'create',
      '--name',
      'Inbox Sweep',
      '--description',
      'Summarize inbound messages without sending replies.',
      '--steps',
      'Read channel state, group by sender, summarize urgency, and ask before external replies.',
      '--tags',
      'ops,communication',
    ], ctx);
    await registry.execute('routines', ['enable', 'inbox-sweep'], ctx);
    await registry.execute('routines', ['start', 'inbox-sweep'], ctx);
    await registry.execute('routines', ['enabled'], ctx);
    await registry.execute('routines', ['show', 'inbox-sweep'], ctx);
    await registry.execute('routines', ['disable', 'inbox-sweep'], ctx);

    const text = out.join('\n');
    expect(text).toContain('Created Agent routine inbox-sweep');
    expect(text).toContain('Enabled Agent routine inbox-sweep');
    expect(text).toContain('Started Agent routine inbox-sweep');
    expect(text).toContain('no hidden job');
    expect(text).toContain('Inbox Sweep - Summarize inbound messages');
    expect(text).toContain('ask before external replies');
    expect(text).toContain('Disabled Agent routine inbox-sweep');
  });

  test('requires explicit delete confirmation and rejects secret-looking steps', async () => {
    const { registry, out, ctx } = commandHarness();

    await registry.execute('routines', ['create', '--name', 'Ops', '--description', 'Ops routine.', '--steps', 'Inspect then act.'], ctx);
    await registry.execute('routines', ['delete', 'ops'], ctx);
    await registry.execute('routines', ['delete', 'ops', '--yes'], ctx);
    await registry.execute('routines', ['create', '--name', 'Bad', '--description', 'Bad.', '--steps', 'token=super-secret-value'], ctx);

    const text = out.join('\n');
    expect(text).toContain('Refusing to delete Agent routine ops without --yes');
    expect(text).toContain('Deleted Agent routine ops');
    expect(text).toContain('secret-looking');
  });

  test('previews routine schedule promotion without calling the daemon', async () => {
    const { registry, out, ctx } = commandHarness();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return scheduleResponse();
    }) satisfies typeof fetch;

    try {
      await registry.execute('routines', ['create', '--name', 'Inbox Sweep', '--description', 'Review messages.', '--steps', 'Summarize inbound messages and ask before replies.'], ctx);
      await registry.execute('routines', ['promote', 'inbox-sweep', '--cron', '0 9 * * *', '--timezone', 'America/Chicago'], ctx);

      const text = out.join('\n');
      expect(text).toContain('GoodVibes schedule preview for Agent routine');
      expect(text).toContain('schedules.create /api/automation/schedules');
      expect(text).toContain('isolated Agent Knowledge only');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('confirmed routine promotion uses schedules.create and preserves Agent policy', async () => {
    const { registry, out, ctx } = commandHarness();
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
      await registry.execute('routines', ['create', '--name', 'Inbox Sweep', '--description', 'Review messages.', '--steps', 'Summarize inbound messages and ask before replies.'], ctx);
      await registry.execute('schedule', [
        'promote-routine',
        'inbox-sweep',
        '--cron',
        '0 9 * * *',
        '--timezone',
        'America/Chicago',
        '--delivery-webhook',
        'https://hooks.example.test/routine/secret-token',
        '--yes',
      ], ctx);

      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe('http://127.0.0.1:3421/api/automation/schedules');
      expect(requests[0]!.method).toBe('POST');
      const payload = JSON.parse(requests[0]!.body) as {
        readonly prompt?: string;
        readonly kind?: string;
        readonly cron?: string;
        readonly target?: { readonly kind?: string; readonly surfaceKind?: string };
        readonly delivery?: {
          readonly mode?: string;
          readonly targets?: readonly {
            readonly kind?: string;
            readonly address?: string;
          }[];
        };
      };
      expect(payload.kind).toBe('cron');
      expect(payload.cron).toBe('0 9 * * *');
      expect(payload.target).toEqual(expect.objectContaining({ kind: 'main', surfaceKind: 'service' }));
      expect(payload.delivery?.mode).toBe('webhook');
      expect(payload.delivery?.targets?.[0]).toEqual(expect.objectContaining({
        kind: 'webhook',
        address: 'https://hooks.example.test/routine/secret-token',
      }));
      expect(payload.prompt).toContain('Use isolated Agent Knowledge routes only');
      expect(payload.prompt).toContain('never use default Knowledge/Wiki or non-Agent knowledge spaces');
      const promotionText = out.join('\n');
      const receiptId = promotionText.match(/receipt: (routine-schedule-[a-z0-9-]+)/)?.[1];
      expect(promotionText).toContain('Created GoodVibes schedule for Agent routine');
      expect(receiptId).toBeTruthy();

      await registry.execute('schedule', ['receipts'], ctx);
      await registry.execute('schedule', ['receipt', receiptId!], ctx);
      await registry.execute('schedule', ['reconcile'], ctx);

      const receiptText = out.join('\n');
      expect(receiptText).toContain('Agent routine schedule receipts');
      expect(receiptText).toContain('schedule=sched-1');
      expect(receiptText).toContain('Agent routine schedule receipt');
      expect(receiptText).toContain('cadence: cron 0 9 * * * [America/Chicago]');
      expect(receiptText).toContain('delivery: webhook');
      expect(receiptText).toContain('delivery target: webhook address=https://hooks.example.test/...');
      expect(receiptText).not.toContain('secret-token');
      expect(receiptText).toContain('Agent routine schedule reconciliation');
      expect(receiptText).toContain('matched: 1');
      expect(receiptText).toContain('live=sched-1');
      expect(requests.some((request) => request.method === 'GET' && request.url === 'http://127.0.0.1:3421/api/automation/schedules')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects mixed routine delivery targets from slash commands without daemon calls', async () => {
    const { registry, out, ctx } = commandHarness();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return scheduleResponse();
    }) satisfies typeof fetch;

    try {
      await registry.execute('routines', ['create', '--name', 'Inbox Sweep', '--description', 'Review messages.', '--steps', 'Summarize inbound messages and ask before replies.'], ctx);
      await registry.execute('schedule', [
        'promote-routine',
        'inbox-sweep',
        '--cron',
        '0 9 * * *',
        '--delivery-surface',
        'slack',
        '--delivery-webhook',
        'https://hooks.example.test/routine',
        '--yes',
      ], ctx);

      expect(out.join('\n')).toContain('Use one delivery target kind per routine promotion command.');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
