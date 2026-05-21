import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { buildDashboard } from '../src/tui/dashboard.js';
import { createAgentRuntimeServices } from '../src/runtime/services.js';
import type { AgentConfig } from '../src/config.js';

const config: AgentConfig = {
  baseUrl: 'http://127.0.0.1:3421',
  surfaceKind: 'goodvibes-agent',
  surfaceId: 'dashboard-test',
  defaultChatTitle: 'GoodVibes Agent',
  companionTimeoutMs: 90_000,
  autoRemember: true,
  autoDelegateBuildRequests: true,
};

let previousHome: string | undefined;
let testHome = '';

beforeEach(async () => {
  previousHome = process.env.GOODVIBES_AGENT_HOME;
  testHome = await mkdtemp(join(tmpdir(), 'goodvibes-agent-dashboard-'));
  process.env.GOODVIBES_AGENT_HOME = testHome;
});

afterEach(async () => {
  if (previousHome === undefined) {
    delete process.env.GOODVIBES_AGENT_HOME;
  } else {
    process.env.GOODVIBES_AGENT_HOME = previousHome;
  }
  await rm(testHome, { recursive: true, force: true });
});

describe('operator dashboard', () => {
  test('formats local counts and remote summaries', () => {
    const services = createAgentRuntimeServices(config);
    services.memory.remember({ summary: 'We use Bun', cls: 'constraint' });
    services.skills.create({ name: 'weekly-plan' });

    const lines = buildDashboard({
      runtime: services.assistant,
      daemon: {
        ok: true,
        kind: 'ok',
        baseUrl: 'http://127.0.0.1:3421',
        compatibility: {
          ok: true,
          daemonVersion: '0.33.30',
          expectedVersion: '0.33.30',
          status: { status: 'running' },
          reason: 'ok',
        },
        auth: { authenticated: true },
        message: 'ok',
      },
      remote: {
        workPlan: {
          error: null,
          data: {
            counts: { total: 2, pending: 1, in_progress: 1, blocked: 0 },
            tasks: [
              { title: 'Wire status panes', status: 'in_progress' },
            ],
          },
        },
        approvals: {
          error: null,
          data: {
            mode: 'default',
            approvals: [
              { status: 'pending', request: { tool: 'write:file' } },
            ],
          },
        },
        automation: {
          error: null,
          data: {
            totals: { jobs: 1, enabled: 1, paused: 0, runs: 3 },
            jobs: [
              { id: 'job-1', name: 'Daily summary', status: 'enabled', enabled: true, schedule: { kind: 'cron', expression: '0 9 * * *' }, runCount: 3, failureCount: 0 },
            ],
            recentRuns: [],
          },
        },
        capacity: {
          error: null,
          data: { slotsTotal: 2, slotsInUse: 1, queueDepth: 0, oldestQueuedAgeMs: null },
        },
      },
    });

    expect(lines).toContain('Daemon ok 0.33.30');
    expect(lines).toContain('Local 1 memory, 1 skills, 2 personas');
    expect(lines).toContain('Active operator; skills none');
    expect(lines).toContain('2 total, 1 active, 1 pending, 0 blocked');
    expect(lines).toContain('pending write:file');
    expect(lines).toContain('1 jobs, 1 enabled, 0 paused, 3 runs');
    expect(lines).toContain('capacity 1/2, queue 0');
    expect(lines).toContain('constraint/fresh We use Bun');
    expect(lines).toContain('fresh weekly-plan');
  });

  test('degrades remote route failures into pane warnings', () => {
    const services = createAgentRuntimeServices(config);
    const lines = buildDashboard({
      runtime: services.assistant,
      daemon: null,
      remote: {
        workPlan: { data: null, error: 'work plan route failed' },
        approvals: { data: null, error: 'approvals route failed' },
        automation: { data: null, error: 'automation route failed' },
        capacity: { data: null, error: 'capacity route failed' },
      },
    });

    expect(lines).toContain('Daemon checking');
    expect(lines).toContain('warn work plan route failed');
    expect(lines).toContain('warn approvals route failed');
    expect(lines).toContain('warn automation route failed');
    expect(lines).toContain('warn capacity route failed');
  });
});
