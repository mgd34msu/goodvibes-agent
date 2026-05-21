import { describe, expect, test } from 'bun:test';
import { formatApprovals, formatWorkPlan } from '../src/assistant/operator-format.js';

describe('operator route formatting', () => {
  test('formats populated work-plan snapshots', () => {
    const output = formatWorkPlan({
      ok: true,
      projectId: 'project-1',
      knowledgeSpaceId: 'project:project-1',
      workPlanId: 'current',
      tasks: [
        {
          taskId: 'task-1',
          title: 'Polish operator task output',
          status: 'in_progress',
          owner: 'goodvibes-agent',
          phaseId: 'm1',
          priority: 2,
          tags: ['cli', 'operator'],
          notes: 'Keep output concise.',
          linkedArtifactIds: [],
          linkedSourceIds: [],
          linkedNodeIds: [],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      counts: {
        total: 1,
        pending: 0,
        in_progress: 1,
        blocked: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
      },
      updatedAt: 2,
    });

    expect(output).toContain('Work plan current');
    expect(output).toContain('1 total, 1 active, 0 pending, 0 blocked, 0 done, 0 failed, 0 cancelled');
    expect(output).toContain('Project: project-1 (project:project-1)');
    expect(output).toContain('[in_progress] Polish operator task output (task-1)');
    expect(output).toContain('owner goodvibes-agent; phase m1; priority 2; tags cli, operator');
    expect(output).toContain('Keep output concise.');
  });

  test('formats empty work-plan snapshots', () => {
    const output = formatWorkPlan({
      ok: true,
      workPlanId: 'current',
      tasks: [],
      counts: {
        total: 0,
        pending: 0,
        in_progress: 0,
        blocked: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
      },
    });

    expect(output).toContain('0 total, 0 active, 0 pending, 0 blocked, 0 done, 0 failed, 0 cancelled');
    expect(output).toContain('No work-plan tasks.');
  });

  test('formats unsuccessful work-plan snapshots', () => {
    const output = formatWorkPlan({
      ok: false,
      error: 'snapshot unavailable',
      tasks: [],
      counts: {
        total: 0,
        pending: 0,
        in_progress: 0,
        blocked: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
      },
    });

    expect(output).toContain('Warning: snapshot unavailable');
    expect(output).toContain('No work-plan tasks.');
  });

  test('formats populated approvals with request details', () => {
    const output = formatApprovals({
      awaitingDecision: true,
      mode: 'default',
      approvalCount: 3,
      denialCount: 1,
      cachedChecks: 2,
      totalChecks: 8,
      approvals: [
        {
          id: 'approval-1',
          callId: 'call-1',
          status: 'approved',
          request: {
            callId: 'call-1',
            tool: 'shell.exec',
            args: {},
            category: 'execute',
            analysis: {
              classification: 'command',
              riskLevel: 'medium',
              summary: 'Runs a shell command.',
              reasons: ['execute'],
            },
          },
          metadata: {},
          audit: [],
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: 'approval-2',
          callId: 'call-2',
          status: 'pending',
          request: {
            callId: 'call-2',
            tool: 'sessions.messages.create',
            args: {},
            category: 'delegate',
            analysis: {
              classification: 'delegation',
              riskLevel: 'high',
              summary: 'Delegates build work.',
              reasons: ['delegate'],
            },
          },
          metadata: {},
          audit: [],
          createdAt: 3,
          updatedAt: 4,
        },
      ],
    });

    expect(output).toContain('Approvals 1 pending, mode default');
    expect(output).toContain('8 total checks, 2 cached checks, 3 approved, 1 denied');
    expect(output).toContain('A decision is currently awaiting user action.');
    expect(output.indexOf('[pending] sessions.messages.create (call-2)')).toBeLessThan(output.indexOf('[approved] shell.exec (call-1)'));
    expect(output).toContain('risk high; delegate; Delegates build work.');
  });

  test('formats empty approvals', () => {
    const output = formatApprovals({
      awaitingDecision: false,
      mode: 'default',
      approvalCount: 0,
      denialCount: 0,
      cachedChecks: 0,
      totalChecks: 0,
      approvals: [],
    });

    expect(output).toContain('Approvals 0 pending, mode default');
    expect(output).toContain('No approval records.');
  });
});
