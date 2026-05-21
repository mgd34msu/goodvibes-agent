import { describe, expect, test } from 'bun:test';
import type { RouteId } from '../src/daemon/routes.js';
import {
  executeOperatorMutation,
  formatOperatorMutationResult,
  isAutomationMutationAction,
  OPERATOR_MUTATION_ROUTE_ALLOWLIST,
  OperatorMutationError,
  type OperatorMutationRequest,
} from '../src/assistant/operator-mutations.js';

type AllowedMutationRoute = typeof OPERATOR_MUTATION_ROUTE_ALLOWLIST[number];

interface MutationCall {
  readonly routeId: RouteId;
  readonly input: Record<string, unknown>;
}

class FakeMutationClient {
  readonly calls: MutationCall[] = [];

  async invoke<T = unknown>(routeId: RouteId, input: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ routeId, input });
    return { routeId, input, status: 'ok' } as T;
  }
}

describe('operator mutations', () => {
  test('requires confirmation before daemon calls', async () => {
    const client = new FakeMutationClient();
    await expect(executeOperatorMutation(client, {
      kind: 'automation',
      action: 'run',
      targetId: 'job-1',
      confirmed: false,
    })).rejects.toBeInstanceOf(OperatorMutationError);
    expect(client.calls).toHaveLength(0);
  });

  test('rejects unknown mutation actions', async () => {
    const client = new FakeMutationClient();
    await expect(executeOperatorMutation(client, {
      kind: 'automation',
      action: 'enable',
      targetId: 'job-1',
      confirmed: true,
    })).rejects.toBeInstanceOf(OperatorMutationError);
    expect(isAutomationMutationAction('enable')).toBe(false);
    expect(client.calls).toHaveLength(0);
  });

  test('uses exact allowlisted route ids and payloads', async () => {
    const cases: readonly {
      readonly request: OperatorMutationRequest;
      readonly routeId: AllowedMutationRoute;
      readonly input: Record<string, unknown>;
    }[] = [
      {
        request: { kind: 'approval', action: 'approve', targetId: 'approval-1', confirmed: true, note: 'looks good' },
        routeId: 'approvals.approve',
        input: { approvalId: 'approval-1', note: 'looks good' },
      },
      {
        request: { kind: 'approval', action: 'deny', targetId: 'approval-2', confirmed: true },
        routeId: 'approvals.deny',
        input: { approvalId: 'approval-2' },
      },
      {
        request: { kind: 'approval', action: 'cancel', targetId: 'approval-3', confirmed: true },
        routeId: 'approvals.cancel',
        input: { approvalId: 'approval-3' },
      },
      {
        request: { kind: 'automation', action: 'run', targetId: 'job-1', confirmed: true },
        routeId: 'automation.jobs.run',
        input: { jobId: 'job-1' },
      },
      {
        request: { kind: 'automation', action: 'pause', targetId: 'job-2', confirmed: true },
        routeId: 'automation.jobs.pause',
        input: { jobId: 'job-2' },
      },
      {
        request: { kind: 'automation', action: 'resume', targetId: 'job-3', confirmed: true },
        routeId: 'automation.jobs.resume',
        input: { jobId: 'job-3' },
      },
      {
        request: { kind: 'automation', action: 'cancel', targetId: 'run-1', confirmed: true },
        routeId: 'automation.runs.cancel',
        input: { runId: 'run-1' },
      },
      {
        request: { kind: 'automation', action: 'retry', targetId: 'run-2', confirmed: true },
        routeId: 'automation.runs.retry',
        input: { runId: 'run-2' },
      },
      {
        request: { kind: 'schedule', action: 'run', targetId: 'schedule-1', confirmed: true },
        routeId: 'schedules.run',
        input: { scheduleId: 'schedule-1' },
      },
    ];

    for (const entry of cases) {
      const client = new FakeMutationClient();
      const result = await executeOperatorMutation(client, entry.request);
      expect(client.calls).toEqual([{ routeId: entry.routeId, input: entry.input }]);
      expect(result.routeId).toBe(entry.routeId);
      expect(OPERATOR_MUTATION_ROUTE_ALLOWLIST).toContain(entry.routeId);
      expect(formatOperatorMutationResult(result)).toContain(`Route: ${entry.routeId}`);
    }
  });
});
