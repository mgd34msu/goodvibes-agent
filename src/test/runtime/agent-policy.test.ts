import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { normalizeEverySchedule } from '@pellux/goodvibes-sdk/platform/automation';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { createRuntimeServices } from '../../runtime/services.ts';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerScheduleRuntimeCommands } from '../../input/commands/schedule-runtime.ts';

describe('Agent operator policy hidden spawn gates', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function makeRuntimeServices() {
    root = mkdtempSync(join(tmpdir(), 'gv-agent-policy-'));
    return createRuntimeServices({
      runtimeBus: new RuntimeEventBus(),
      runtimeStore: createRuntimeStore(),
      configManager: new ConfigManager({
        surfaceRoot: 'tui',
        workingDir: root,
        homeDir: root,
        configDir: join(root, '.goodvibes', 'tui'),
      }),
      workingDir: root,
      homeDirectory: root,
      getConversationTitle: () => 'Agent policy test',
    });
  }

  test('bootstrap does not register the copied ACP delegate tool', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap.ts'), 'utf8');
    expect(source).not.toContain('registerDelegateTool');
  });

  test('bootstrap does not start the copied local automation runner', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap.ts'), 'utf8');
    expect(source).not.toContain('automationManager.start(');
    expect(source).toContain('Local automation runners are disabled in GoodVibes Agent');
  });

  test('shared-session task continuation fails closed instead of spawning a local agent', async () => {
    const services = makeRuntimeServices();
    await services.sessionBroker.start();

    const submission = await services.sessionBroker.followUpMessage({
      surfaceKind: 'goodvibes-agent',
      surfaceId: 'agent-policy-test',
      body: 'Build the thing',
    });
    const broker = services.sessionBroker as unknown as {
      runQueuedFollowUp(sessionId: string): Promise<unknown>;
    };

    await expect(broker.runQueuedFollowUp(submission.session.id)).rejects.toThrow('does not own shared-session task execution');
    expect(services.agentManager.list()).toHaveLength(0);
  });

  test('automation spawnTask fails closed instead of spawning a local agent', async () => {
    const services = makeRuntimeServices();
    const job = await services.automationManager.createJob({
      name: 'Blocked local automation',
      prompt: 'Run local automation task',
      schedule: normalizeEverySchedule('15m'),
      enabled: false,
    });

    await expect(services.automationManager.runNow(job.id)).rejects.toThrow('does not spawn local automation agents');
    expect(services.agentManager.list()).toHaveLength(0);
  });

  test('schedule command is read-only and does not call automation mutations', async () => {
    const registry = new CommandRegistry();
    registerScheduleRuntimeCommands(registry);
    const schedule = registry.get('schedule');
    expect(schedule).toBeDefined();

    const out: string[] = [];
    const manager = {
      listJobs: mock(() => []),
      start: mock(async () => undefined),
      createJob: mock(async () => ({ id: 'job-created' })),
      removeJob: mock(async () => undefined),
      setEnabled: mock(async () => null),
      runNow: mock(async () => ({ id: 'run-created' })),
    } as unknown as NonNullable<CommandContext['ops']['automationManager']>;
    const ctx = {
      ops: { automationManager: manager },
      print: (text: string) => out.push(text),
    } as unknown as CommandContext;

    await schedule!.handler(['add', 'every', '15m', 'Build something'], ctx);
    await schedule!.handler(['run', 'job-1'], ctx);
    await schedule!.handler(['remove', 'job-1'], ctx);
    await schedule!.handler(['enable', 'job-1'], ctx);
    await schedule!.handler(['disable', 'job-1'], ctx);

    const text = out.join('\n');
    expect(text).toContain('schedule commands are read-only');
    expect(text).toContain('no local Agent automation jobs');
    expect(manager.start).toHaveBeenCalledTimes(0);
    expect(manager.createJob).toHaveBeenCalledTimes(0);
    expect(manager.removeJob).toHaveBeenCalledTimes(0);
    expect(manager.setEnabled).toHaveBeenCalledTimes(0);
    expect(manager.runNow).toHaveBeenCalledTimes(0);
  });
});
