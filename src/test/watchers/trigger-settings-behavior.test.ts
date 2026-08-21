/**
 * trigger-settings-behavior.test.ts, behaviour verification for the nineteen
 * `watchers.triggers.*` settings.
 *
 * Every test here drives one setting to two distinct values (its shipped
 * default and a clearly different non-default), runs the real consuming code
 * path in the SDK's trigger supervisor, and asserts an outcome that DIFFERS
 * between the two. Nothing here asserts that a key exists in the schema, that a
 * value round-trips through the config manager, or that an options object
 * carries a number: those pass whether or not the setting is honoured, which is
 * exactly what this file exists not to do.
 *
 * All effects are injected, a scripted probe I/O, a modelled process host, a
 * modelled stream host, a mutable clock and a temp store directory, so no test
 * spawns a process, opens a socket, or waits on wall-clock time.
 *
 * The two cadence settings (sweepIntervalMs, supervisionTickMs) have no outcome
 * other than timing, so they are verified at the scheduling seam: the interval
 * the supervisor actually registers is captured, and the captured callback is
 * then invoked to prove it performs the real housekeeping/supervision work.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadTriggerSnapshot,
  TriggerManager,
  type LaunchedProcess,
  type ObservedTermination,
  type ProbeCommandResult,
  type ProbeIo,
  type TriggerActionExecutor,
  type TriggerActionGrant,
  type TriggerEventLogEntry,
  type TriggerManagerConfig,
  type TriggerProcessHost,
  type TriggerRecord,
  type TriggerStreamHost,
  type TriggerValue,
} from '@pellux/goodvibes-sdk/platform/triggers';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

// ─── Temp stores ──────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

function tempStorePath(): string {
  const root = makeProjectTempDir('gv-agent-trigger-settings');
  tempRoots.push(root);
  return join(root, 'triggers.json');
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// ─── Seams ────────────────────────────────────────────────────────────────────

/** A mutable virtual clock. Every manager below reads time through this. */
interface Clock {
  t: number;
}

/** Lets voided fire paths (`void this.fireAction(...)`) settle. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

class RecordingExecutor implements TriggerActionExecutor {
  readonly turns: Array<{ readonly triggerId: string; readonly prompt: string }> = [];
  readonly grants: string[] = [];

  runAgentTurn(input: { readonly triggerId: string; readonly prompt: string }): Promise<string> {
    this.turns.push({ triggerId: input.triggerId, prompt: input.prompt });
    return Promise.resolve('ok');
  }

  runGrant(input: { readonly triggerId: string; readonly grant: TriggerActionGrant }): Promise<string> {
    this.grants.push(input.grant.id);
    return Promise.resolve('granted');
  }

  turnsFor(triggerId: string): Array<{ readonly triggerId: string; readonly prompt: string }> {
    return this.turns.filter((turn) => turn.triggerId === triggerId);
  }
}

/**
 * A scripted probe host. `workMs` models how long the measured command would
 * take: a budget below it aborts, exactly as a real timeout would, so the
 * probe-timeout setting produces a real failed check rather than a recorded
 * parameter.
 */
class ScriptedProbeIo implements ProbeIo {
  readonly commandCalls: Array<{ readonly command: string; readonly timeoutMs: number }> = [];

  constructor(private readonly script: {
    readonly stdout?: string;
    readonly exitCode?: number;
    readonly alwaysFail?: boolean;
    /** Virtual work the measured command performs before it can answer. */
    readonly workMs?: number;
    readonly onEnter?: () => void;
    readonly onLeave?: () => void;
  } = {}) {}

  fetch(): Promise<{ readonly status: number; readonly ok: boolean; readonly text: () => Promise<string> }> {
    return Promise.reject(new Error('no http probe is used in these tests'));
  }

  readFile(): Promise<string> {
    return Promise.resolve('');
  }

  statFile(): { readonly size: number; readonly mtimeMs: number } | null {
    return null;
  }

  callTool(): Promise<TriggerValue> {
    return Promise.reject(new Error('no sdk-tool probe is used in these tests'));
  }

  async runCommand(
    command: string,
    _args: readonly string[],
    options: { readonly cwd?: string | undefined; readonly timeoutMs: number },
  ): Promise<ProbeCommandResult> {
    this.commandCalls.push({ command, timeoutMs: options.timeoutMs });
    this.script.onEnter?.();
    try {
      // Two microtask turns: enough for every concurrently started probe to be
      // in flight at once, so a concurrency cap is observable.
      await Promise.resolve();
      await Promise.resolve();
      if (this.script.alwaysFail === true) {
        throw new Error('the probe endpoint refused the connection');
      }
      const workMs = this.script.workMs ?? 0;
      if (workMs > options.timeoutMs) {
        throw new Error(`command probe exceeded its ${options.timeoutMs}ms budget`);
      }
      return { exitCode: this.script.exitCode ?? 0, stdout: this.script.stdout ?? '', stderr: '' };
    } finally {
      this.script.onLeave?.();
    }
  }
}

interface ChildScript {
  /** Virtual milliseconds before the child would finish on its own. */
  readonly runsForMs: number;
  readonly exitCode?: number;
  readonly stdout?: string;
  /** The child blocks unless it is handed a readable stdin handle. */
  readonly needsStdin?: boolean;
}

/**
 * A modelled process host. It enforces the max-duration ceiling it was handed
 * and reacts to the stdin mode it was handed, so both settings change the
 * termination the trigger actually reports rather than only a launch argument.
 */
class ModelledProcessHost implements TriggerProcessHost {
  readonly launched: Array<{
    readonly command: string;
    readonly args: readonly string[];
    readonly stdin: 'none' | 'empty';
    readonly maxDurationMs: number;
  }> = [];
  readonly cancelled: string[] = [];
  private readonly children = new Map<string, {
    readonly startedAt: number;
    readonly stdin: 'none' | 'empty';
    readonly maxDurationMs: number;
  }>();
  private counter = 0;

  constructor(private readonly clock: Clock, private readonly script: ChildScript) {}

  launch(spec: {
    readonly command: string;
    readonly args: readonly string[];
    readonly stdin: 'none' | 'empty';
    readonly maxDurationMs: number;
  }): Promise<LaunchedProcess> {
    this.counter += 1;
    const processId = `proc-${this.counter}`;
    this.launched.push({
      command: spec.command,
      args: spec.args,
      stdin: spec.stdin,
      maxDurationMs: spec.maxDurationMs,
    });
    this.children.set(processId, {
      startedAt: this.clock.t,
      stdin: spec.stdin,
      maxDurationMs: spec.maxDurationMs,
    });
    return Promise.resolve({ processId, pid: 4_000 + this.counter, startedAt: this.clock.t });
  }

  observe(processId: string): ObservedTermination | null {
    const child = this.children.get(processId);
    if (!child) return null;
    const elapsed = this.clock.t - child.startedAt;
    const stdout = this.script.stdout ?? '';
    if (elapsed >= child.maxDurationMs) {
      return {
        running: false,
        exitCode: null,
        signal: 'SIGKILL',
        timedOut: true,
        stdoutTail: stdout,
        stderrTail: 'the child was terminated at its max-duration ceiling',
        endedAt: child.startedAt + child.maxDurationMs,
      };
    }
    if (this.script.needsStdin === true && child.stdin === 'none') {
      return {
        running: false,
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdoutTail: stdout,
        stderrTail: 'stdin was closed: the read returned EOF',
        endedAt: child.startedAt,
      };
    }
    if (elapsed >= this.script.runsForMs) {
      return {
        running: false,
        exitCode: this.script.exitCode ?? 0,
        signal: null,
        timedOut: false,
        stdoutTail: stdout,
        stderrTail: '',
        endedAt: child.startedAt + this.script.runsForMs,
      };
    }
    return { running: true, exitCode: null, signal: null, timedOut: false, stdoutTail: '', stderrTail: '' };
  }

  cancel(processId: string): void {
    this.cancelled.push(processId);
    this.children.delete(processId);
  }

  isSameProcessAlive(): boolean {
    return false;
  }
}

/** A stream host whose output the test drives by hand. */
class ScriptedStreamHost implements TriggerStreamHost {
  readonly started: Array<{ readonly triggerId: string; readonly command: string }> = [];
  readonly stopped: string[] = [];
  private readonly handlers = new Map<string, {
    readonly onChunk: (chunk: string) => void;
    readonly onExit: (exitCode: number | null) => void;
  }>();
  private counter = 0;

  start(input: {
    readonly triggerId: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly onChunk: (chunk: string) => void;
    readonly onExit: (exitCode: number | null) => void;
  }): Promise<{ readonly streamId: string; readonly pid: number }> {
    this.counter += 1;
    this.started.push({ triggerId: input.triggerId, command: input.command });
    this.handlers.set(input.triggerId, { onChunk: input.onChunk, onExit: input.onExit });
    return Promise.resolve({ streamId: `stream-${this.counter}`, pid: 5_000 + this.counter });
  }

  stop(streamId: string): void {
    this.stopped.push(streamId);
  }

  emit(triggerId: string, chunk: string): void {
    const handler = this.handlers.get(triggerId);
    if (!handler) throw new Error(`no stream was started for ${triggerId}`);
    handler.onChunk(chunk);
  }

  exit(triggerId: string, exitCode: number | null): void {
    const handler = this.handlers.get(triggerId);
    if (!handler) throw new Error(`no stream was started for ${triggerId}`);
    handler.onExit(exitCode);
  }
}

/**
 * Captures the intervals the supervisor registers. The handle handed back is a
 * real (unref'd, far-future) timer so `clearInterval` in `shutdown()` behaves
 * normally and nothing is left holding the process open.
 */
class IntervalCapture {
  readonly scheduled: Array<{ readonly delayMs: number; readonly callback: () => void }> = [];
  private readonly realSetInterval = globalThis.setInterval;

  install(): void {
    const real = this.realSetInterval;
    const scheduled = this.scheduled;
    globalThis.setInterval = ((callback: () => void, delayMs: number) => {
      scheduled.push({ delayMs, callback });
      const handle = real(() => { /* parked: these tests drive the callback by hand */ }, 3_600_000);
      handle.unref?.();
      return handle;
    }) as unknown as typeof setInterval;
  }

  restore(): void {
    globalThis.setInterval = this.realSetInterval;
  }
}

// ─── Manager construction ─────────────────────────────────────────────────────

interface ManagerSetup {
  readonly manager: TriggerManager;
  readonly storePath: string;
}

function createManager(input: {
  readonly config: TriggerManagerConfig | (() => TriggerManagerConfig);
  readonly actions: TriggerActionExecutor;
  readonly clock: Clock;
  readonly probeIo?: ProbeIo;
  readonly processHost?: TriggerProcessHost;
  readonly streamHost?: TriggerStreamHost;
}): ManagerSetup {
  const storePath = tempStorePath();
  const manager = new TriggerManager({
    storePath,
    config: input.config,
    actions: input.actions,
    daemonBootId: 'boot-under-test',
    now: () => input.clock.t,
    ...(input.probeIo ? { probeIo: input.probeIo } : {}),
    ...(input.processHost ? { processHost: input.processHost } : {}),
    ...(input.streamHost ? { streamHost: input.streamHost } : {}),
  });
  return { manager, storePath };
}

function requireRecord(manager: TriggerManager, id: string): TriggerRecord {
  const record = manager.get(id);
  if (!record) throw new Error(`trigger "${id}" is not present on the manager`);
  return record;
}

function eventLogOnDisk(storePath: string): readonly TriggerEventLogEntry[] {
  return loadTriggerSnapshot(storePath).snapshot?.eventLog ?? [];
}

// ─── Definition builders ──────────────────────────────────────────────────────

function conditionDefinition(input: {
  readonly id: string;
  readonly rule: Record<string, unknown>;
  readonly capture?: 'stdout' | 'exit-code';
  readonly intervalMs?: number;
  readonly probeTimeoutMs?: number;
}): Record<string, unknown> {
  return {
    id: input.id,
    label: `condition ${input.id}`,
    spec: {
      kind: 'condition',
      probe: {
        kind: 'command',
        command: 'measure',
        args: ['--once'],
        capture: input.capture ?? 'stdout',
        ...(input.probeTimeoutMs !== undefined ? { timeoutMs: input.probeTimeoutMs } : {}),
      },
      extract: { kind: 'raw' },
      rule: input.rule,
      ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
    },
    action: { kind: 'agent-turn' },
    createdAt: 0,
  };
}

function streamDefinition(id: string, spec: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    label: `stream ${id}`,
    spec: {
      kind: 'stream',
      command: 'tail',
      args: ['-f', 'service.log'],
      match: { kind: 'regex', pattern: 'ERROR' },
      ...spec,
    },
    action: { kind: 'agent-turn' },
    createdAt: 0,
  };
}

function onExitDefinition(id: string, spec: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    label: `on-exit ${id}`,
    spec: { kind: 'on-exit', command: 'build', args: ['--release'], ...spec },
    action: { kind: 'agent-turn' },
    createdAt: 0,
  };
}

// ─── watchers.triggers.enabled ────────────────────────────────────────────────

describe('watchers.triggers.enabled', () => {
  test('watchers.triggers.enabled: false refuses to create a trigger, true creates one and fires it', async () => {
    const clock: Clock = { t: 1_000 };
    const offExecutor = new RecordingExecutor();
    const offHost = new ModelledProcessHost(clock, { runsForMs: 0 });
    const off = createManager({
      config: { enabled: false },
      actions: offExecutor,
      clock,
      processHost: offHost,
    });

    await expect(off.manager.create(onExitDefinition('build-watch'))).rejects.toThrow(
      /watchers\.triggers\.enabled/,
    );
    expect(offHost.launched).toHaveLength(0);

    const onExecutor = new RecordingExecutor();
    const onHost = new ModelledProcessHost(clock, { runsForMs: 0, exitCode: 0 });
    const on = createManager({
      config: { enabled: true },
      actions: onExecutor,
      clock,
      processHost: onHost,
    });

    await on.manager.create(onExitDefinition('build-watch'));
    expect(onHost.launched).toHaveLength(1);
    await on.manager.pollProcesses();
    expect(onExecutor.turns).toHaveLength(1);
  });

  test('watchers.triggers.enabled: flipping it off mid-run stops the supervisor firing, flipping it back on resumes', async () => {
    const clock: Clock = { t: 1_000 };
    const executor = new RecordingExecutor();
    const host = new ModelledProcessHost(clock, { runsForMs: 0, exitCode: 0 });
    const live = { enabled: true };
    const { manager } = createManager({
      config: () => ({ enabled: live.enabled }),
      actions: executor,
      clock,
      processHost: host,
    });

    await manager.create(onExitDefinition('nightly'));
    clock.t = 2_000;

    live.enabled = false;
    await manager.supervisionTick();
    expect(executor.turns).toHaveLength(0);
    expect(requireRecord(manager, 'nightly').state).toBe('running');

    live.enabled = true;
    await manager.supervisionTick();
    expect(executor.turns).toHaveLength(1);
    expect(requireRecord(manager, 'nightly').state).toBe('fired');
  });

  test('watchers.triggers.enabled: every supervisor entry point no-ops while it is off, not just the outer tick', async () => {
    const clock: Clock = { t: 1_000 };
    const executor = new RecordingExecutor();
    const host = new ModelledProcessHost(clock, { runsForMs: 0, exitCode: 0 });
    const probeIo = new ScriptedProbeIo({ stdout: 'steady' });
    const live = { enabled: true };
    const { manager } = createManager({
      config: () => ({ enabled: live.enabled }),
      actions: executor,
      clock,
      processHost: host,
      probeIo,
    });

    await manager.create(onExitDefinition('nightly'));
    await manager.create(conditionDefinition({ id: 'health', rule: { kind: 'change' } }));
    clock.t = 2_000;

    live.enabled = false;
    // The finished child is right there to be reaped and the check is due,
    // each of these must still decline to do the work.
    await manager.pollProcesses();
    await manager.tick();
    await expect(manager.runCheck('health')).rejects.toThrow(/watchers\.triggers\.enabled/);
    expect(executor.turns).toHaveLength(0);
    expect(probeIo.commandCalls).toHaveLength(0);
    expect(requireRecord(manager, 'nightly').state).toBe('running');

    live.enabled = true;
    await manager.pollProcesses();
    await manager.tick();
    expect(requireRecord(manager, 'nightly').state).toBe('fired');
    expect(probeIo.commandCalls).toHaveLength(1);
    expect(executor.turns).toHaveLength(1);
  });
});

// ─── Supervision spine ────────────────────────────────────────────────────────

describe('supervision spine settings', () => {
  function failingConditionManager(config: Partial<TriggerManagerConfig>): ManagerSetup & {
    readonly clock: Clock;
    readonly executor: RecordingExecutor;
  } {
    const clock: Clock = { t: 1_000 };
    const executor = new RecordingExecutor();
    const setup = createManager({
      config: { enabled: true, ...config },
      actions: executor,
      clock,
      probeIo: new ScriptedProbeIo({ alwaysFail: true }),
    });
    return { ...setup, clock, executor };
  }

  test('watchers.triggers.breakerStrikes: the breaker opens after exactly N consecutive failures', async () => {
    const strict = failingConditionManager({ breakerStrikes: 2 });
    await strict.manager.create(conditionDefinition({ id: 'flaky', rule: { kind: 'change' } }));

    await strict.manager.runCheck('flaky');
    expect(requireRecord(strict.manager, 'flaky').state).toBe('backoff');
    await strict.manager.runCheck('flaky');
    const opened = requireRecord(strict.manager, 'flaky');
    expect(opened.state).toBe('circuit-open');
    expect(opened.strikes).toBe(2);
    expect(opened.runs[opened.runs.length - 1]?.detail).toContain('breaker opened after 2');

    // The shipped default is five, so the same two failures must NOT park it.
    const shipped = failingConditionManager({});
    await shipped.manager.create(conditionDefinition({ id: 'flaky', rule: { kind: 'change' } }));
    await shipped.manager.runCheck('flaky');
    await shipped.manager.runCheck('flaky');
    expect(requireRecord(shipped.manager, 'flaky').state).toBe('backoff');
    for (let attempt = 0; attempt < 3; attempt += 1) await shipped.manager.runCheck('flaky');
    const shippedRecord = requireRecord(shipped.manager, 'flaky');
    expect(shippedRecord.state).toBe('circuit-open');
    expect(shippedRecord.strikes).toBe(5);
  });

  test('watchers.triggers.backoffLadderMs: the retry delay after a failure follows the configured ladder', async () => {
    const custom = failingConditionManager({ backoffLadderMs: '1000,2000', breakerStrikes: 10 });
    await custom.manager.create(conditionDefinition({ id: 'ladder', rule: { kind: 'change' } }));

    await custom.manager.runCheck('ladder');
    const first = requireRecord(custom.manager, 'ladder');
    expect(first.nextCheckAt).toBe(custom.clock.t + 1_000);
    expect(first.runs[first.runs.length - 1]?.detail).toContain('retrying in 1000ms');

    await custom.manager.runCheck('ladder');
    const second = requireRecord(custom.manager, 'ladder');
    expect(second.nextCheckAt).toBe(custom.clock.t + 2_000);

    // The last rung repeats rather than growing without bound.
    await custom.manager.runCheck('ladder');
    expect(requireRecord(custom.manager, 'ladder').nextCheckAt).toBe(custom.clock.t + 2_000);

    const shipped = failingConditionManager({ breakerStrikes: 10 });
    await shipped.manager.create(conditionDefinition({ id: 'ladder', rule: { kind: 'change' } }));
    await shipped.manager.runCheck('ladder');
    expect(requireRecord(shipped.manager, 'ladder').nextCheckAt).toBe(shipped.clock.t + 30_000);
    await shipped.manager.runCheck('ladder');
    expect(requireRecord(shipped.manager, 'ladder').nextCheckAt).toBe(shipped.clock.t + 60_000);
  });

  test('watchers.triggers.backoffLadderMs: a malformed ladder falls back to the shipped one instead of stalling the supervisor', async () => {
    const broken = failingConditionManager({ backoffLadderMs: 'soon,later', breakerStrikes: 10 });
    await broken.manager.create(conditionDefinition({ id: 'ladder', rule: { kind: 'change' } }));
    await broken.manager.runCheck('ladder');
    expect(requireRecord(broken.manager, 'ladder').nextCheckAt).toBe(broken.clock.t + 30_000);
  });

  test('watchers.triggers.maxConcurrentChecks: no more than N condition checks are ever in flight at once', async () => {
    async function peakConcurrency(limit: number | undefined): Promise<number> {
      const clock: Clock = { t: 1_000 };
      let active = 0;
      let peak = 0;
      const probeIo = new ScriptedProbeIo({
        stdout: 'steady',
        onEnter: () => {
          active += 1;
          peak = Math.max(peak, active);
        },
        onLeave: () => {
          active -= 1;
        },
      });
      const { manager } = createManager({
        config: {
          enabled: true,
          ...(limit !== undefined ? { maxConcurrentChecks: limit } : {}),
        },
        actions: new RecordingExecutor(),
        clock,
        probeIo,
      });
      for (let index = 0; index < 6; index += 1) {
        await manager.create(conditionDefinition({ id: `check-${index}`, rule: { kind: 'change' } }));
      }
      await manager.tick();
      expect(probeIo.commandCalls).toHaveLength(6);
      return peak;
    }

    expect(await peakConcurrency(1)).toBe(1);
    // The shipped default is four; six due checks must therefore overlap four-wide.
    expect(await peakConcurrency(undefined)).toBe(4);
  });

  test('watchers.triggers.probeTimeoutMs: a probe slower than the budget fails the check instead of producing an observation', async () => {
    async function runOne(probeTimeoutMs: number | undefined): Promise<TriggerRecord> {
      const clock: Clock = { t: 1_000 };
      const { manager } = createManager({
        // The measured command needs 5s of work; only a budget above that answers.
        config: { enabled: true, ...(probeTimeoutMs !== undefined ? { probeTimeoutMs } : {}) },
        actions: new RecordingExecutor(),
        clock,
        probeIo: new ScriptedProbeIo({ stdout: 'healthy', workMs: 5_000 }),
      });
      await manager.create(conditionDefinition({ id: 'slow-endpoint', rule: { kind: 'change' } }));
      await manager.runCheck('slow-endpoint');
      return requireRecord(manager, 'slow-endpoint');
    }

    const tight = await runOne(1_000);
    expect(tight.state).toBe('backoff');
    expect(tight.observations).toHaveLength(0);
    expect(tight.lastError).toContain('1000ms budget');

    // The shipped 15s default is generous enough for the same probe.
    const shipped = await runOne(undefined);
    expect(shipped.state).toBe('idle');
    expect(shipped.observations).toHaveLength(1);
    expect(shipped.observations[0]?.text).toBe('healthy');
  });

  test('watchers.triggers.probeTimeoutMs: a probe-level timeout overrides the family budget', async () => {
    const clock: Clock = { t: 1_000 };
    const { manager } = createManager({
      config: { enabled: true, probeTimeoutMs: 1_000 },
      actions: new RecordingExecutor(),
      clock,
      probeIo: new ScriptedProbeIo({ stdout: 'healthy', workMs: 5_000 }),
    });
    await manager.create(conditionDefinition({
      id: 'slow-but-allowed',
      rule: { kind: 'change' },
      probeTimeoutMs: 9_000,
    }));
    await manager.runCheck('slow-but-allowed');
    expect(requireRecord(manager, 'slow-but-allowed').state).toBe('idle');
  });

  test('watchers.triggers.defaultCheckIntervalMs: it sets when a condition trigger next becomes due', async () => {
    async function scheduleAfterSuccess(defaultCheckIntervalMs: number | undefined): Promise<{
      readonly nextCheckAt: number | undefined;
      readonly probeCallsAfterTenSeconds: number;
    }> {
      const clock: Clock = { t: 1_000 };
      const probeIo = new ScriptedProbeIo({ stdout: 'steady' });
      const { manager } = createManager({
        config: {
          enabled: true,
          ...(defaultCheckIntervalMs !== undefined ? { defaultCheckIntervalMs } : {}),
        },
        actions: new RecordingExecutor(),
        clock,
        probeIo,
      });
      await manager.create(conditionDefinition({ id: 'cadence', rule: { kind: 'change' } }));
      await manager.runCheck('cadence');
      const nextCheckAt = requireRecord(manager, 'cadence').nextCheckAt;
      clock.t = 11_000;
      await manager.tick();
      return { nextCheckAt, probeCallsAfterTenSeconds: probeIo.commandCalls.length };
    }

    const brisk = await scheduleAfterSuccess(5_000);
    expect(brisk.nextCheckAt).toBe(6_000);
    expect(brisk.probeCallsAfterTenSeconds).toBe(2);

    // The shipped 60s default leaves the trigger not yet due ten seconds later.
    const shipped = await scheduleAfterSuccess(undefined);
    expect(shipped.nextCheckAt).toBe(61_000);
    expect(shipped.probeCallsAfterTenSeconds).toBe(1);
  });

  test('watchers.triggers.defaultCheckIntervalMs: a trigger that declares its own interval keeps it', async () => {
    const clock: Clock = { t: 1_000 };
    const { manager } = createManager({
      config: { enabled: true, defaultCheckIntervalMs: 5_000 },
      actions: new RecordingExecutor(),
      clock,
      probeIo: new ScriptedProbeIo({ stdout: 'steady' }),
    });
    await manager.create(conditionDefinition({ id: 'own-cadence', rule: { kind: 'change' }, intervalMs: 2_000 }));
    await manager.runCheck('own-cadence');
    expect(requireRecord(manager, 'own-cadence').nextCheckAt).toBe(3_000);
  });
});

// ─── Retention ────────────────────────────────────────────────────────────────

describe('retention settings', () => {
  /** Six successive checks, each observing the numeric value 1. */
  async function runSixNumericChecks(config: Partial<TriggerManagerConfig>, rule: Record<string, unknown>): Promise<{
    readonly record: TriggerRecord;
    readonly executor: RecordingExecutor;
  }> {
    const clock: Clock = { t: 1_000 };
    const executor = new RecordingExecutor();
    const { manager } = createManager({
      config: { enabled: true, ...config },
      actions: executor,
      clock,
      probeIo: new ScriptedProbeIo({ exitCode: 1 }),
    });
    await manager.create(conditionDefinition({ id: 'metric', rule, capture: 'exit-code' }));
    for (let index = 0; index < 6; index += 1) {
      await manager.runCheck('metric');
      await flush();
    }
    return { record: requireRecord(manager, 'metric'), executor };
  }

  test('watchers.triggers.observationRingSize: it caps the ring AND bounds what a windowed rule can see', async () => {
    const sumRule = {
      kind: 'windowed-aggregate',
      windowMs: 3_600_000,
      aggregate: 'sum',
      operator: 'gte',
      operand: 5,
    };

    const shallow = await runSixNumericChecks({ observationRingSize: 2 }, sumRule);
    expect(shallow.record.observations).toHaveLength(2);
    // Only two samples of 1 are ever visible, so the sum can never reach five.
    expect(shallow.executor.turns).toHaveLength(0);
    expect(shallow.record.firedCount).toBe(0);

    const deep = await runSixNumericChecks({ observationRingSize: 6 }, sumRule);
    expect(deep.record.observations).toHaveLength(6);
    // Six samples of 1: the window crosses five on the fifth and sixth checks.
    expect(deep.executor.turns).toHaveLength(2);
    expect(deep.record.firedCount).toBe(2);
  });

  test('watchers.triggers.runHistoryLimit: run history is capped at N records, newest kept', async () => {
    const capped = await runSixNumericChecks({ runHistoryLimit: 2 }, { kind: 'change' });
    expect(capped.record.runs).toHaveLength(2);

    // The shipped default of fifty keeps all six.
    const shipped = await runSixNumericChecks({}, { kind: 'change' });
    expect(shipped.record.runs).toHaveLength(6);
    expect(capped.record.runs[capped.record.runs.length - 1]?.at)
      .toBe(shipped.record.runs[shipped.record.runs.length - 1]?.at);
  });

  test('watchers.triggers.runHistoryTtlHours: run records older than the TTL are reaped even under the count cap', async () => {
    async function runsAfterTwoHours(runHistoryTtlHours: number | undefined): Promise<number> {
      const clock: Clock = { t: 1_000 };
      const { manager } = createManager({
        config: {
          enabled: true,
          ...(runHistoryTtlHours !== undefined ? { runHistoryTtlHours } : {}),
        },
        actions: new RecordingExecutor(),
        clock,
        probeIo: new ScriptedProbeIo({ stdout: 'steady' }),
      });
      await manager.create(conditionDefinition({ id: 'aging', rule: { kind: 'change' } }));
      await manager.runCheck('aging');
      await manager.runCheck('aging');
      clock.t = 1_000 + 2 * 60 * 60 * 1_000;
      await manager.runCheck('aging');
      return requireRecord(manager, 'aging').runs.length;
    }

    expect(await runsAfterTwoHours(1)).toBe(1);
    // The shipped 168-hour default keeps all three.
    expect(await runsAfterTwoHours(undefined)).toBe(3);
  });

  test('watchers.triggers.eventLogLimit: an evicted fire is invisible to a correlation rule', async () => {
    async function correlate(eventLogLimit: number | undefined): Promise<{
      readonly beta: TriggerRecord;
      readonly retainedEvents: number;
    }> {
      const clock: Clock = { t: 1_000 };
      const executor = new RecordingExecutor();
      const { manager, storePath } = createManager({
        config: { enabled: true, ...(eventLogLimit !== undefined ? { eventLogLimit } : {}) },
        actions: executor,
        clock,
        probeIo: new ScriptedProbeIo({ stdout: '7' }),
      });
      await manager.create(conditionDefinition({
        id: 'alpha',
        rule: { kind: 'change', fireOnFirst: true },
      }));
      await manager.create({
        id: 'beta',
        label: 'correlated follow-up',
        spec: {
          kind: 'condition',
          probe: { kind: 'command', command: 'measure', args: ['--once'], capture: 'stdout' },
          extract: { kind: 'raw' },
          rule: { kind: 'correlation', triggerIds: ['alpha'], withinMs: 3_600_000, require: 'any' },
        },
        action: { kind: 'agent-turn' },
        createdAt: 0,
      });

      // One fire, then eleven quiet observations that push the log forward.
      for (let index = 0; index < 12; index += 1) {
        await manager.runCheck('alpha');
        await flush();
      }
      await manager.runCheck('beta');
      await flush();
      return { beta: requireRecord(manager, 'beta'), retainedEvents: eventLogOnDisk(storePath).length };
    }

    const tight = await correlate(10);
    expect(tight.retainedEvents).toBe(10);
    expect(tight.beta.firedCount).toBe(0);
    expect(tight.beta.runs[tight.beta.runs.length - 1]?.detail).toContain('no correlated trigger fired');

    // The shipped 500-entry default still holds alpha's fire.
    const shipped = await correlate(undefined);
    expect(shipped.retainedEvents).toBeGreaterThan(10);
    expect(shipped.beta.firedCount).toBe(1);
  });

  test('watchers.triggers.eventLogTtlHours: a fire older than the TTL drops out of the correlation window', async () => {
    async function correlateAcrossTwoHours(eventLogTtlHours: number | undefined): Promise<{
      readonly beta: TriggerRecord;
      readonly retainedEvents: number;
    }> {
      const clock: Clock = { t: 1_000 };
      const { manager, storePath } = createManager({
        config: { enabled: true, ...(eventLogTtlHours !== undefined ? { eventLogTtlHours } : {}) },
        actions: new RecordingExecutor(),
        clock,
        probeIo: new ScriptedProbeIo({ stdout: '7' }),
      });
      await manager.create(conditionDefinition({ id: 'alpha', rule: { kind: 'change', fireOnFirst: true } }));
      await manager.create({
        id: 'beta',
        label: 'correlated follow-up',
        spec: {
          kind: 'condition',
          probe: { kind: 'command', command: 'measure', args: ['--once'], capture: 'stdout' },
          extract: { kind: 'raw' },
          // A three-hour correlation window: only the TTL can hide alpha's fire.
          rule: { kind: 'correlation', triggerIds: ['alpha'], withinMs: 3 * 60 * 60 * 1_000, require: 'any' },
        },
        action: { kind: 'agent-turn' },
        createdAt: 0,
      });

      await manager.runCheck('alpha');
      await flush();
      clock.t = 1_000 + 2 * 60 * 60 * 1_000;
      await manager.runCheck('alpha');
      await flush();
      await manager.runCheck('beta');
      await flush();
      return { beta: requireRecord(manager, 'beta'), retainedEvents: eventLogOnDisk(storePath).length };
    }

    const shortLived = await correlateAcrossTwoHours(1);
    expect(shortLived.beta.firedCount).toBe(0);
    expect(shortLived.retainedEvents).toBe(2);

    // The shipped 24-hour default still sees a fire from two hours ago.
    const shipped = await correlateAcrossTwoHours(undefined);
    expect(shipped.beta.firedCount).toBe(1);
    expect(shipped.retainedEvents).toBeGreaterThan(2);
  });
});

// ─── Cadence (scheduling seam) ────────────────────────────────────────────────

describe('cadence settings', () => {
  test('watchers.triggers.sweepIntervalMs: the housekeeping sweep is scheduled at the configured cadence and really sweeps', async () => {
    async function scheduleSweep(sweepIntervalMs: number | undefined): Promise<{
      readonly delayMs: number;
      readonly runSweep: () => void;
      readonly manager: TriggerManager;
      readonly executor: RecordingExecutor;
    }> {
      const clock: Clock = { t: 1_000 };
      const executor = new RecordingExecutor();
      const host = new ModelledProcessHost(clock, { runsForMs: 0, exitCode: 0 });
      const { manager } = createManager({
        config: { enabled: true, ...(sweepIntervalMs !== undefined ? { sweepIntervalMs } : {}) },
        actions: executor,
        clock,
        processHost: host,
      });
      const capture = new IntervalCapture();
      capture.install();
      try {
        manager.start();
      } finally {
        capture.restore();
      }
      expect(capture.scheduled).toHaveLength(2);
      const sweep = capture.scheduled[0];
      if (!sweep) throw new Error('the supervisor scheduled no sweep');
      await manager.create(onExitDefinition('one-shot'));
      await manager.pollProcesses();
      expect(requireRecord(manager, 'one-shot').state).toBe('fired');
      return { delayMs: sweep.delayMs, runSweep: sweep.callback, manager, executor };
    }

    const brisk = await scheduleSweep(20_000);
    expect(brisk.delayMs).toBe(20_000);

    const shipped = await scheduleSweep(undefined);
    expect(shipped.delayMs).toBe(300_000);

    // The scheduled callback is the real sweep: a fired one-shot retires.
    brisk.runSweep();
    expect(brisk.manager.get('one-shot')).toBeNull();
    expect(brisk.manager.recoveryReport?.reason).toBe('sweep');
    expect(brisk.manager.recoveryReport?.reapedIds).toContain('one-shot');
    brisk.manager.shutdown();
    shipped.manager.shutdown();
  });

  test('watchers.triggers.supervisionTickMs: the supervision tick is scheduled at the configured cadence and really supervises', async () => {
    async function scheduleTick(supervisionTickMs: number | undefined): Promise<{
      readonly delayMs: number;
      readonly runTick: () => void;
      readonly manager: TriggerManager;
      readonly executor: RecordingExecutor;
    }> {
      const clock: Clock = { t: 1_000 };
      const executor = new RecordingExecutor();
      const host = new ModelledProcessHost(clock, { runsForMs: 0, exitCode: 0 });
      const { manager } = createManager({
        config: { enabled: true, ...(supervisionTickMs !== undefined ? { supervisionTickMs } : {}) },
        actions: executor,
        clock,
        processHost: host,
      });
      const capture = new IntervalCapture();
      capture.install();
      try {
        manager.start();
      } finally {
        capture.restore();
      }
      expect(capture.scheduled).toHaveLength(2);
      const tick = capture.scheduled[1];
      if (!tick) throw new Error('the supervisor scheduled no supervision tick');
      await manager.create(onExitDefinition('supervised'));
      return { delayMs: tick.delayMs, runTick: tick.callback, manager, executor };
    }

    const brisk = await scheduleTick(400);
    expect(brisk.delayMs).toBe(400);

    const shipped = await scheduleTick(undefined);
    expect(shipped.delayMs).toBe(1_000);

    // The scheduled callback is the real supervision pass: it reaps the child.
    expect(brisk.executor.turns).toHaveLength(0);
    brisk.runTick();
    await flush();
    expect(brisk.executor.turns).toHaveLength(1);
    expect(requireRecord(brisk.manager, 'supervised').state).toBe('fired');
    brisk.manager.shutdown();
    shipped.manager.shutdown();
  });
});

// ─── Stream watchers ──────────────────────────────────────────────────────────

describe('stream watcher settings', () => {
  async function startStream(config: Partial<TriggerManagerConfig>, spec: Record<string, unknown> = {}): Promise<{
    readonly manager: TriggerManager;
    readonly host: ScriptedStreamHost;
    readonly executor: RecordingExecutor;
    readonly clock: Clock;
  }> {
    const clock: Clock = { t: 1_000 };
    const executor = new RecordingExecutor();
    const host = new ScriptedStreamHost();
    const { manager } = createManager({
      config: { enabled: true, ...config },
      actions: executor,
      clock,
      streamHost: host,
    });
    await manager.create(streamDefinition('log-watch', spec));
    return { manager, host, executor, clock };
  }

  test('watchers.triggers.streamQueueLimit: matched lines beyond the bound are dropped and counted', async () => {
    const chunk = Array.from({ length: 10 }, (_, index) => `ERROR line ${index}`).join('\n').concat('\n');

    const bounded = await startStream({ streamQueueLimit: 2, streamBatchLines: 2 });
    try {
      bounded.host.emit('log-watch', chunk);
      await flush();
      const record = requireRecord(bounded.manager, 'log-watch');
      expect(record.droppedLines).toBe(8);
      expect(bounded.executor.turns).toHaveLength(1);
      expect(bounded.executor.turns[0]?.prompt).toContain('DROPPED because the bounded queue overflowed: 8');
    } finally {
      bounded.manager.shutdown();
    }

    // The shipped 1000-line default holds all ten, so nothing is lost.
    const roomy = await startStream({ streamBatchLines: 2 });
    try {
      roomy.host.emit('log-watch', chunk);
      await flush();
      expect(requireRecord(roomy.manager, 'log-watch').droppedLines).toBe(0);
      expect(roomy.executor.turns).toHaveLength(5);
    } finally {
      roomy.manager.shutdown();
    }
  });

  test('watchers.triggers.streamBatchLines: an agent turn starts once N matched lines have accumulated', async () => {
    const chunk = Array.from({ length: 6 }, (_, index) => `ERROR line ${index}`).join('\n').concat('\n');

    const small = await startStream({ streamBatchLines: 2 });
    try {
      small.host.emit('log-watch', chunk);
      await flush();
      expect(small.executor.turns).toHaveLength(3);
      expect(small.executor.turns[0]?.prompt).toContain('Matched lines in this batch: 2');
    } finally {
      small.manager.shutdown();
    }

    // The shipped default of 25 has not been reached, so no agent runs yet.
    const shipped = await startStream({});
    try {
      shipped.host.emit('log-watch', chunk);
      await flush();
      expect(shipped.executor.turns).toHaveLength(0);
    } finally {
      shipped.manager.shutdown();
    }
  });

  test('watchers.triggers.streamBatchIntervalMs: a partial batch is flushed once it has waited that long', async () => {
    async function partialBatchTurns(streamBatchIntervalMs: number | undefined): Promise<number> {
      const stream = await startStream(
        streamBatchIntervalMs !== undefined ? { streamBatchIntervalMs } : {},
      );
      try {
        stream.host.emit('log-watch', 'ERROR just one\n');
        await flush();
        expect(stream.executor.turns).toHaveLength(0);
        // 200ms later a non-matching line arrives; the partial batch is only
        // flushed if it has now waited longer than the configured interval.
        stream.clock.t = 1_200;
        stream.host.emit('log-watch', 'INFO unrelated\n');
        await flush();
        return stream.executor.turns.length;
      } finally {
        stream.manager.shutdown();
      }
    }

    expect(await partialBatchTurns(100)).toBe(1);
    // The shipped 1000ms default is not up yet after 200ms.
    expect(await partialBatchTurns(undefined)).toBe(0);
  });
});

// ─── on-exit process triggers ─────────────────────────────────────────────────

describe('on-exit process trigger settings', () => {
  test('watchers.triggers.onExitMaxDurationMs: a child past the ceiling fires with an explicit timed-out termination', async () => {
    async function terminationAt(input: {
      readonly onExitMaxDurationMs?: number | undefined;
      readonly observeAt: number;
    }): Promise<{ readonly record: TriggerRecord; readonly turns: number }> {
      const clock: Clock = { t: 1_000 };
      const executor = new RecordingExecutor();
      const host = new ModelledProcessHost(clock, { runsForMs: 5_000, exitCode: 0 });
      const { manager } = createManager({
        config: {
          enabled: true,
          ...(input.onExitMaxDurationMs !== undefined ? { onExitMaxDurationMs: input.onExitMaxDurationMs } : {}),
        },
        actions: executor,
        clock,
        processHost: host,
      });
      await manager.create(onExitDefinition('long-build'));
      clock.t = input.observeAt;
      await manager.pollProcesses();
      return { record: requireRecord(manager, 'long-build'), turns: executor.turns.length };
    }

    const capped = await terminationAt({ onExitMaxDurationMs: 1_000, observeAt: 3_000 });
    expect(capped.turns).toBe(1);
    const cappedRun = capped.record.runs.find((run) => run.outcome === 'fired');
    expect(cappedRun?.termination?.state).toBe('timed-out');
    expect(cappedRun?.termination?.reason).toBe('max-duration');
    expect(cappedRun?.termination?.timedOut).toBe(true);

    // The shipped six-hour default leaves the same child running at 3s...
    const shippedEarly = await terminationAt({ observeAt: 3_000 });
    expect(shippedEarly.turns).toBe(0);
    expect(shippedEarly.record.state).toBe('running');

    // ...and lets it finish normally once it is done.
    const shippedLate = await terminationAt({ observeAt: 7_000 });
    expect(shippedLate.turns).toBe(1);
    const shippedRun = shippedLate.record.runs.find((run) => run.outcome === 'fired');
    expect(shippedRun?.termination?.state).toBe('exited');
    expect(shippedRun?.termination?.reason).toBe('normal');
  });

  test('watchers.triggers.onExitMaxDurationMs: a trigger that declares its own ceiling keeps it', async () => {
    const clock: Clock = { t: 1_000 };
    const host = new ModelledProcessHost(clock, { runsForMs: 5_000, exitCode: 0 });
    const { manager } = createManager({
      config: { enabled: true, onExitMaxDurationMs: 60_000 },
      actions: new RecordingExecutor(),
      clock,
      processHost: host,
    });
    await manager.create(onExitDefinition('short-leash', { maxDurationMs: 2_000 }));
    expect(host.launched[0]?.maxDurationMs).toBe(2_000);
    clock.t = 3_500;
    await manager.pollProcesses();
    const run = requireRecord(manager, 'short-leash').runs.find((entry) => entry.outcome === 'fired');
    expect(run?.termination?.state).toBe('timed-out');
  });

  test('watchers.triggers.onExitStdin: the stdin mode changes how a child that reads stdin terminates', async () => {
    async function terminationWithStdin(onExitStdin: string | undefined): Promise<{
      readonly record: TriggerRecord;
      readonly launchedStdin: string | undefined;
    }> {
      const clock: Clock = { t: 1_000 };
      const host = new ModelledProcessHost(clock, { runsForMs: 0, exitCode: 0, needsStdin: true });
      const { manager } = createManager({
        config: { enabled: true, ...(onExitStdin !== undefined ? { onExitStdin } : {}) },
        actions: new RecordingExecutor(),
        clock,
        processHost: host,
      });
      await manager.create(onExitDefinition('needs-stdin'));
      clock.t = 2_000;
      await manager.pollProcesses();
      return { record: requireRecord(manager, 'needs-stdin'), launchedStdin: host.launched[0]?.stdin };
    }

    const withPipe = await terminationWithStdin('empty');
    expect(withPipe.launchedStdin).toBe('empty');
    const pipedRun = withPipe.record.runs.find((run) => run.outcome === 'fired');
    expect(pipedRun?.termination?.exitCode).toBe(0);
    expect(pipedRun?.termination?.reason).toBe('normal');

    // The shipped default closes stdin, so the same child takes EOF and fails.
    const shipped = await terminationWithStdin(undefined);
    expect(shipped.launchedStdin).toBe('none');
    const closedRun = shipped.record.runs.find((run) => run.outcome === 'fired');
    expect(closedRun?.termination?.exitCode).toBe(1);
    expect(closedRun?.termination?.reason).toBe('nonzero-exit');
    expect(closedRun?.termination?.stderrTail).toContain('EOF');
  });

  test('watchers.triggers.outputTailBytes: the termination payload carries exactly that much trailing output', async () => {
    const output = `${'a'.repeat(200)}${'Z'.repeat(16)}`;

    async function tailFor(outputTailBytes: number | undefined): Promise<string> {
      const clock: Clock = { t: 1_000 };
      const executor = new RecordingExecutor();
      const host = new ModelledProcessHost(clock, { runsForMs: 0, exitCode: 0, stdout: output });
      const { manager } = createManager({
        config: { enabled: true, ...(outputTailBytes !== undefined ? { outputTailBytes } : {}) },
        actions: executor,
        clock,
        processHost: host,
      });
      await manager.create(onExitDefinition('tail-check'));
      clock.t = 2_000;
      await manager.pollProcesses();
      const run = requireRecord(manager, 'tail-check').runs.find((entry) => entry.outcome === 'fired');
      const tail = run?.termination?.stdoutTail ?? '';
      // Whatever is retained is what the agent prompt shows.
      expect(executor.turns[0]?.prompt).toContain(tail);
      return tail;
    }

    const trimmed = await tailFor(16);
    expect(trimmed).toBe('Z'.repeat(16));

    // The shipped 8KB default keeps the whole 216-byte output.
    const shipped = await tailFor(undefined);
    expect(shipped).toBe(output);
    expect(shipped.length).toBe(216);
  });
});
