import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { createInitialTasksState } from '@/runtime/index.ts';
import { TasksPanel } from '../../panels/tasks-panel.ts';
import { PanelManager } from '../../panels/panel-manager.ts';
import type { Line } from '../../types/grid.ts';
import { createTasksReadModel } from '../helpers/ui-read-models.ts';
import type { ProviderAccountSnapshot } from '../../panels/provider-account-snapshot.ts';

function linesText(lines: Line[]): string {
  return lines
    .map((line) => line.map((cell) => cell.char ?? ' ').join('').trimEnd())
    .filter(Boolean)
    .join('\n');
}

describe('TasksPanel', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gv-tasks-panel-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('renders empty guidance when no tasks exist', () => {
    const store = createRuntimeStore();
    const panel = new TasksPanel(createTasksReadModel(store));
    const text = linesText(panel.render(120, 12));
    expect(text).toContain('Task Control Room');
    expect(text).toContain('No tasks recorded yet');
    expect(text).not.toContain('deferred');
  });

  test('renders unavailable state as a read-only operator view', () => {
    const panel = new TasksPanel(undefined);
    const text = linesText(panel.render(120, 12));

    expect(text).toContain('Task Control Room');
    expect(text).toContain('Connected-host task state is unavailable');
    expect(text).toContain('This operator view is read-only');
    expect(text).toContain('/tasks list');
    expect(text).not.toContain('deferred');
  });

  test('renders task summaries and selection detail from the runtime store', () => {
    const store = createRuntimeStore();
    const now = Date.now();
    store.setState((state) => ({
      ...state,
      tasks: {
        ...createInitialTasksState(),
        revision: 1,
        lastUpdatedAt: now,
        source: 'test',
        tasks: new Map([
          ['queued-1', {
            id: 'queued-1',
            kind: 'exec',
            title: 'Queued task',
            status: 'queued',
            owner: 'shell',
            cancellable: true,
            childTaskIds: [],
            queuedAt: now - 5_000,
          }],
          ['running-1', {
            id: 'running-1',
            kind: 'agent',
            title: 'Running agent task',
            status: 'running',
            owner: 'agent-orchestrator',
            cancellable: true,
            childTaskIds: ['blocked-1'],
            queuedAt: now - 20_000,
            startedAt: now - 15_000,
            correlationId: 'corr-1',
          }],
          ['blocked-1', {
            id: 'blocked-1',
            kind: 'integration',
            title: 'Blocked integration task',
            status: 'blocked',
            owner: 'plugin:alpha',
            cancellable: false,
            parentTaskId: 'running-1',
            childTaskIds: [],
            queuedAt: now - 18_000,
            startedAt: now - 17_000,
            error: 'waiting on dependency',
          }],
          ['failed-1', {
            id: 'failed-1',
            kind: 'daemon',
            title: 'Failed daemon task',
            status: 'failed',
            owner: 'daemon-server',
            cancellable: true,
            childTaskIds: [],
            queuedAt: now - 60_000,
            startedAt: now - 55_000,
            endedAt: now - 50_000,
            error: 'boom',
          }],
          ['completed-1', {
            id: 'completed-1',
            kind: 'scheduler',
            title: 'Completed scheduler task',
            status: 'completed',
            owner: 'scheduler',
            cancellable: false,
            childTaskIds: [],
            queuedAt: now - 120_000,
            startedAt: now - 100_000,
            endedAt: now - 95_000,
            result: { ok: true },
          }],
        ]),
        queuedIds: ['queued-1'],
        runningIds: ['running-1'],
        blockedIds: ['blocked-1'],
        totalCreated: 5,
        totalCompleted: 1,
        totalFailed: 1,
        totalCancelled: 0,
        maxConcurrency: 8,
      },
    }));

    const panel = new TasksPanel(createTasksReadModel(store));
    const initial = linesText(panel.render(120, 24));
    expect(initial).toContain('Task posture');
    expect(initial).toContain('queued 1');
    expect(initial).toContain('running 1');
    expect(initial).toContain('blocked 1');
    expect(initial).toContain('failed 1');
    expect(initial).toContain('completed 1');
    expect(initial).toContain('/delegate <task>');
    expect(initial).toContain('review connected-host task posture without changing execution');
    expect(initial).not.toContain('local workers');
    expect(initial).toContain('Queued task');
    expect(initial).toContain('Status: queued');

    panel.handleInput('down');
    const second = linesText(panel.render(120, 24));
    expect(second).toContain('Running agent task');
    expect(second).toContain('Owner: agent-orchestrator');
    expect(second).toContain('Children: blocked-1');
    expect(second).toContain('Correlation:');
    expect(second).toContain('running');

    panel.handleInput('end');
    const last = linesText(panel.render(120, 24));
    expect(last).toContain('Completed scheduler task');
    expect(last).toContain('Result:');
  });

  test('is registerable in a panel manager when a runtime store is provided', () => {
    const manager = new PanelManager();
    manager.registerType({
      id: 'tasks',
      name: 'Tasks',
      icon: 'T',
      category: 'session',
      description: 'Task Control Room',
      factory: () => new TasksPanel(createTasksReadModel(createRuntimeStore())),
    });
    expect(manager.getRegisteredTypes().map((entry) => entry.id)).toContain('tasks');
  });

  test('provider accounts panel renders posture-first summaries', async () => {
    const { ProviderAccountsPanel } = await import('../../panels/provider-accounts-panel.ts');
    const snapshot: ProviderAccountSnapshot = {
      capturedAt: Date.now(),
      configuredCount: 1,
      issueCount: 0,
      providers: [{
        providerId: 'openai',
        active: true,
        modelCount: 1,
        configured: true,
        oauthReady: true,
        pendingLogin: false,
        availableRoutes: ['service-oauth'],
        preferredRoute: 'service-oauth',
        activeRoute: 'service-oauth',
        activeRouteReason: 'Provider OAuth route is currently preferred.',
        authFreshness: 'healthy',
        notes: ['1 model registered'],
        usageWindows: [],
        issues: [],
        recommendedActions: [],
        routeRecords: [{
          route: 'service-oauth',
          usable: true,
          freshness: 'healthy',
          detail: 'Provider OAuth credential is available for this provider.',
          issues: [],
        }],
      }],
    };

    const accountsPanel = new ProviderAccountsPanel({
      providerAccounts: {
        loadSnapshot: () => Promise.resolve(snapshot),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const accountsText = linesText(accountsPanel.render(120, 18));
    expect(accountsText).toContain('Provider posture');
    expect(accountsText).toContain('/accounts repair <provider>');
    expect(accountsText).toContain('provider-oauth');
    expect(accountsText).not.toContain('service-oauth');
  });
});
