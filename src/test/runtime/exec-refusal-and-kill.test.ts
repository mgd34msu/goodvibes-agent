/**
 * exec-refusal-and-kill.test.ts
 *
 * A command refused, and a command killed, through the agent's OWN exec
 * pipeline: the runtime graph from createRuntimeServices (this repo's
 * composition root), the tool registry composed the way bootstrap-core.ts
 * composes it (registerAllTools with the agent's owner-terminal posture, then
 * the agent's policy guard, platform-boundary guard and execution-safety
 * wrapper, in that order), the graph's permission manager with the agent's
 * permission safety guard installed on it, and the SDK's executeToolCalls, the
 * function the live Orchestrator calls for every tool call of a
 * main-conversation turn (permission check, then registry execute, with the
 * per-call cancel signal).
 *
 * The agent runs exec inside its sandbox, where only the workspace is
 * writable. Every file this test asserts on therefore lives INSIDE the agent's
 * workspace, so a guard that failed to refuse would really have written it.
 * The only destructive command is an `rm -rf` aimed at a directory this test
 * created inside that same temp workspace.
 *
 * The sandbox also gives commands their own PID namespace, so a PID the
 * command prints is not a host PID. Whether a command is still running is
 * answered on the host instead: each long command carries a unique token in
 * its own command line, and /proc is scanned for it.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { executeToolCalls, type ToolExecutionDeps } from '@pellux/goodvibes-sdk/platform/core';
import { ToolRegistry, registerAllTools } from '@pellux/goodvibes-sdk/platform/tools';
import type { ToolCall, ToolResult } from '@pellux/goodvibes-sdk/platform/types';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { AGENT_OWNER_TERMINAL_GUARD } from '../../runtime/agent-exec-posture.ts';
import { createRuntimeServices, type RuntimeServices } from '../../runtime/services.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { installPermissionManagerSafetyGuard } from '../../runtime/tool-permission-safety.ts';
import { installAgentPlatformBoundaryGuard } from '../../tools/agent-platform-boundary-policy.ts';
import { installAgentToolPolicyGuard } from '../../tools/agent-tool-policy-guard.ts';
import { installToolExecutionSafetyGuard } from '../../tools/tool-execution-safety.ts';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

/** What the owner said this turn; the platform-boundary guard reads it. */
const LAST_USER_MESSAGE = 'run the maintenance commands in the scratch folder';

/**
 * The agent's runtime graph over a fresh temp workspace and home. The home is
 * the temp root, so nothing derived from it (daemon home included) can point
 * at the machine's real one.
 */
function agentRuntime(prefix: string): { services: RuntimeServices; workspace: string } {
  const root = makeProjectTempDir(prefix);
  const workspace = join(root, 'workspace');
  const homeDir = join(root, 'home');
  const configDir = join(homeDir, '.goodvibes', 'agent');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  // Its own git toplevel, so checkpoint state stays inside the temp root
  // instead of the enclosing checkout (same reason as helpers/runtime-services).
  execFileSync('git', ['init', '-q'], { cwd: workspace, timeout: 30_000 });
  const services = createRuntimeServices({
    // Opt out: this process does not outlive the unawaited sweep.
    modelDiscovery: 'skip',
    runtimeBus: new RuntimeEventBus(),
    runtimeStore: createRuntimeStore(),
    configManager: new ConfigManager({ surfaceRoot: 'agent', workingDir: workspace, homeDir, configDir }),
    workingDir: workspace,
    homeDirectory: homeDir,
    getConversationTitle: () => 'exec-refusal-and-kill',
  });
  return { services, workspace };
}

/**
 * The agent's main-conversation tool pipeline, built in the same order
 * bootstrap-core.ts builds it. `configRouting` is left out on purpose: it
 * routes settings tools to the daemon, which this test must never reach; the
 * exec path does not read it.
 */
function composeAgentExecPipeline(services: RuntimeServices): ToolRegistry {
  const toolRegistry = new ToolRegistry();
  registerAllTools(toolRegistry, {
    resolveSessionId: () => 'exec-refusal-and-kill',
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    fileCache: services.fileCache,
    projectIndex: services.projectIndex,
    fileUndoManager: services.fileUndoManager,
    modeManager: services.modeManager,
    processManager: services.processManager,
    agentManager: services.agentManager,
    agentMessageBus: services.agentMessageBus,
    archetypeLoader: services.archetypeLoader,
    webSearchService: services.webSearchService,
    channelRegistry: services.channelPlugins,
    remoteRunnerRegistry: services.remoteRunnerRegistry,
    workflowServices: services.workflow,
    mcpRegistry: services.mcpRegistry,
    sessionOrchestration: services.sessionOrchestration,
    sandboxSessionRegistry: services.sandboxSessionRegistry,
    workingDirectory: services.workingDirectory,
    configManager: services.configManager,
    providerRegistry: services.providerRegistry,
    toolLLM: services.toolLLM,
    featureFlags: services.featureFlags,
    serviceRegistry: services.serviceRegistry,
    overflowHandler: services.overflowHandler,
    changeTracker: services.sessionChangeTracker,
    contextAccountingHolder: services.contextAccountingHolder,
    ownerTerminalGuard: AGENT_OWNER_TERMINAL_GUARD,
  });
  installAgentToolPolicyGuard(toolRegistry, { getLastUserMessage: () => LAST_USER_MESSAGE });
  installAgentPlatformBoundaryGuard(toolRegistry, () => LAST_USER_MESSAGE);
  installToolExecutionSafetyGuard(toolRegistry);
  installPermissionManagerSafetyGuard(services.permissionManager);
  return toolRegistry;
}

/** The per-call cancel seam the Orchestrator hands executeToolCalls. */
class CallSignals {
  private readonly controllers = new Map<string, AbortController>();
  open(callId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(callId, controller);
    return controller.signal;
  }
  close(callId: string): void {
    this.controllers.delete(callId);
  }
  cancel(callId: string): boolean {
    const controller = this.controllers.get(callId);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}

type Pipeline = {
  readonly workspace: string;
  readonly signals: CallSignals;
  run(call: ToolCall): Promise<ToolResult>;
};

function agentPipeline(prefix: string, permissionMode: 'allow-all' | 'plan'): Pipeline {
  const { services, workspace } = agentRuntime(prefix);
  // A mode that decides without asking: the ask path raises on the daemon.
  services.configManager.set('permissions.mode', permissionMode);
  const toolRegistry = composeAgentExecPipeline(services);
  const signals = new CallSignals();
  const deps: ToolExecutionDeps = {
    toolRegistry,
    permissionManager: services.permissionManager,
    hookDispatcher: null,
    runtimeBus: null,
    sessionId: 'exec-refusal-and-kill',
    emitterContext: () => {
      throw new Error('runtimeBus is null, so no emitter context is requested');
    },
    toolCallSignals: signals,
  };
  return {
    workspace,
    signals,
    async run(call) {
      const [result] = await executeToolCalls(deps, 'turn-exec-refusal-and-kill', [call]);
      if (!result) throw new Error('executeToolCalls returned no result');
      return result;
    },
  };
}

function execCall(id: string, args: Record<string, unknown>): ToolCall {
  return { id, name: 'exec', arguments: args };
}

/** Everything the model would read back from this result, as one string. */
function modelVisibleText(result: ToolResult): string {
  const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? '');
  return `${result.error ?? ''}\n${output}`;
}

/** Host PIDs whose command line carries `token` (this process excluded). */
function hostPidsCarrying(token: string): number[] {
  const pids: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      if (readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes(token)) pids.push(Number(entry));
    } catch {
      // exited between readdir and read
    }
  }
  return pids;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(25);
  }
  return predicate();
}

/** A victim directory and a marker path, both inside the agent's writable workspace. */
function scratch(workspace: string): { victim: string; victimFile: string; marker: string } {
  const victim = join(workspace, 'victim');
  mkdirSync(victim, { recursive: true });
  const victimFile = join(victim, 'keep.txt');
  writeFileSync(victimFile, 'still here\n');
  return { victim, victimFile, marker: join(workspace, 'marker-ran') };
}

/**
 * The positive control: the same pipeline, the same workspace, a command the
 * guards allow DOES write the marker. Without this, "marker absent" could mean
 * the sandbox cannot write there at all rather than "the command was refused".
 */
async function expectPipelineCanWrite(pipeline: Pipeline): Promise<void> {
  const probe = join(pipeline.workspace, 'control-probe');
  const result = await pipeline.run(execCall('control-probe', { commands: [{ cmd: `touch '${probe}'` }] }));
  expect(result.success).toBe(true);
  expect(existsSync(probe)).toBe(true);
}

describe('a command refused through the agent exec pipeline', () => {
  test('a background rm -rf is refused by the agent exec policy even though permission approved it, and never runs', async () => {
    // allow-all: the permission layer says yes, so the only thing between the
    // call and the shell is what the agent itself wraps around exec.
    const pipeline = agentPipeline('exec-refusal-policy', 'allow-all');
    await expectPipelineCanWrite(pipeline);
    const { victimFile, victim, marker } = scratch(pipeline.workspace);

    const result = await pipeline.run(execCall('refuse-background', {
      commands: [{ cmd: `rm -rf '${victim}'; touch '${marker}'`, background: true }],
    }));

    // The disk first: give a detached command, had one been started, time to
    // act, then check that nothing it would have done happened.
    await Bun.sleep(500);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(victimFile)).toBe(true);
    expect(readFileSync(victimFile, 'utf8')).toBe('still here\n');
    // Then what the model reads back: a refusal naming the rule.
    expect(result.success).toBe(false);
    expect(result.callId).toBe('refuse-background');
    expect(modelVisibleText(result)).toContain('GoodVibes Agent only runs foreground, serial command-line work');
  }, 20_000);

  test('typing into a tmux session the platform did not name is refused under the agent posture, and the command never runs', async () => {
    const pipeline = agentPipeline('exec-refusal-owner-terminal', 'allow-all');
    await expectPipelineCanWrite(pipeline);
    const { marker } = scratch(pipeline.workspace);
    // A private tmux socket name with no server behind it: even with the
    // posture off, this tmux call fails harmlessly and only the touch lands.
    const socket = `gv-exec-refusal-${process.pid}`;

    const result = await pipeline.run(execCall('refuse-owner-terminal', {
      commands: [{ cmd: `tmux -L ${socket} send-keys -t owner-main 'echo owned' Enter; touch '${marker}'` }],
    }));

    expect(existsSync(marker)).toBe(false);
    expect(result.success).toBe(false);
    expect(modelVisibleText(result)).toContain('the owner\'s terminal is untouchable');
  }, 20_000);

  test('in plan mode the agent permission layer refuses exec before it reaches the shell, with a structured denial', async () => {
    const pipeline = agentPipeline('exec-refusal-permission', 'plan');
    const { victim, victimFile, marker } = scratch(pipeline.workspace);

    const result = await pipeline.run(execCall('refuse-plan-mode', {
      commands: [{ cmd: `rm -rf '${victim}'; touch '${marker}'` }],
    }));

    expect(existsSync(marker)).toBe(false);
    expect(existsSync(victimFile)).toBe(true);
    expect(readFileSync(victimFile, 'utf8')).toBe('still here\n');
    expect(result.success).toBe(false);
    expect(result.denial?.reason).toBe('plan-mode');
    expect(modelVisibleText(result).trim().length).toBeGreaterThan(0);
  }, 20_000);
});

describe('a command killed through the agent exec pipeline', () => {
  test('a command past its timeout is killed: the process is gone, its later sentinel never appears, and the result says timed out', async () => {
    const pipeline = agentPipeline('exec-kill-timeout', 'allow-all');
    const started = join(pipeline.workspace, 'started');
    const sentinel = join(pipeline.workspace, 'sentinel-after-sleep');
    // Unique on this host, so the /proc scan finds only this command's sleep.
    const token = `3.${process.pid}${Date.now() % 100_000}`;

    const pending = pipeline.run(execCall('kill-timeout', {
      commands: [{ cmd: `touch '${started}'; sleep ${token}; touch '${sentinel}'`, timeout_ms: 1_000 }],
    }));
    expect(await waitFor(() => existsSync(started), 5_000)).toBe(true);
    expect(await waitFor(() => hostPidsCarrying(`sleep ${token}`).length > 0, 2_000)).toBe(true);

    const result = await pending;

    expect(result.success).toBe(false);
    expect(modelVisibleText(result)).toContain('timed out');
    expect(await waitFor(() => hostPidsCarrying(`sleep ${token}`).length === 0, 3_000)).toBe(true);
    // Past the point the sleep would have ended: nothing wrote the sentinel.
    await Bun.sleep(3_000);
    expect(existsSync(sentinel)).toBe(false);
  }, 20_000);

  test('cancelling the call through the per-call cancel seam kills the running command promptly', async () => {
    const pipeline = agentPipeline('exec-kill-cancel', 'allow-all');
    const started = join(pipeline.workspace, 'started');
    const sentinel = join(pipeline.workspace, 'sentinel-after-sleep');
    const token = `6.${process.pid}${Date.now() % 100_000}`;

    // A long own timeout, so only the cancel can stop it inside this window.
    const pending = pipeline.run(execCall('kill-cancel', {
      commands: [{ cmd: `touch '${started}'; sleep ${token}; touch '${sentinel}'`, timeout_ms: 30_000 }],
    }));
    expect(await waitFor(() => existsSync(started), 5_000)).toBe(true);
    expect(await waitFor(() => hostPidsCarrying(`sleep ${token}`).length > 0, 2_000)).toBe(true);

    const cancelledAt = Date.now();
    expect(pipeline.signals.cancel('kill-cancel')).toBe(true);
    const result = await pending;
    const settleMs = Date.now() - cancelledAt;

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    // Settled because of the cancel, not because the sleep ran out.
    expect(settleMs).toBeLessThan(3_000);
    expect(await waitFor(() => hostPidsCarrying(`sleep ${token}`).length === 0, 2_000)).toBe(true);
    // Past the point the sleep would have ended: nothing wrote the sentinel.
    await Bun.sleep(6_500);
    expect(existsSync(sentinel)).toBe(false);
  }, 30_000);
});
