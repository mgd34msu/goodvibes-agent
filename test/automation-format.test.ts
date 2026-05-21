import { describe, expect, test } from 'bun:test';
import {
  formatAutomationJobs,
  formatAutomationRuns,
  formatAutomationSnapshot,
  formatCapacity,
  formatHeartbeat,
  formatSchedules,
} from '../src/assistant/automation-format.js';

describe('automation formatting', () => {
  test('formats automation snapshot concisely', () => {
    const output = formatAutomationSnapshot({
      totals: { jobs: 1, enabled: 1, paused: 0, runs: 2 },
      jobs: [
        {
          id: 'job-1',
          name: 'Daily summary',
          enabled: true,
          status: 'enabled',
          schedule: { kind: 'cron', expression: '0 9 * * *' },
          nextRunAt: 1_700_000_000_000,
          runCount: 2,
          failureCount: 0,
        },
      ],
      recentRuns: [
        { id: 'run-1', jobId: 'job-1', status: 'completed', trigger: 'scheduled', queuedAt: 1_700_000_000_000 },
      ],
    });

    expect(output).toContain('1 jobs, 1 enabled, 0 paused, 2 runs');
    expect(output).toContain('[enabled] Daily summary (job-1)');
    expect(output).toContain('[completed] run-1');
  });

  test('formats empty jobs, runs, schedules, heartbeat, and capacity', () => {
    expect(formatAutomationJobs({ jobs: [] })).toContain('No automation jobs.');
    expect(formatAutomationRuns({ runs: [] })).toContain('No automation runs.');
    expect(formatSchedules({ jobs: [], runs: [] })).toContain('No schedules.');
    expect(formatHeartbeat({ pending: [] })).toContain('No pending heartbeat work.');
    expect(formatCapacity({ slotsTotal: 4, slotsInUse: 1, queueDepth: 2, oldestQueuedAgeMs: 12_000 })).toContain('1/4 slots in use, queue depth 2');
  });
});
