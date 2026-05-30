import { describe, expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildSandboxReview,
  AgentSandboxExternalizedError,
  getSandboxConfigSnapshot,
  inspectSandboxBundle,
  inspectSandboxProbe,
  listSandboxProfiles,
  renderSandboxProfiles,
  renderSandboxRecommendation,
  renderSandboxReview,
} from '@/runtime/index.ts';
import {
  buildSandboxLaunchPlan,
  executeSandboxCommand,
  executeSandboxManagedCommand,
  probeSandboxBackends,
  resolveSandboxCommandPlan,
} from '@/runtime/index.ts';
import { SandboxSessionRegistry } from '@/runtime/index.ts';

function makeManager(overrides: Partial<Record<string, unknown>> = {}) {
  const values = new Map<string, unknown>([
    ['sandbox.replIsolation', 'shared-vm'],
    ['sandbox.mcpIsolation', 'disabled'],
    ['sandbox.windowsMode', 'native-basic'],
    ['sandbox.vmBackend', 'local'],
    ['sandbox.qemuBinary', 'qemu-system-x86_64'],
    ['sandbox.qemuImagePath', ''],
    ['sandbox.qemuExecWrapper', ''],
    ['sandbox.qemuGuestHost', ''],
    ['sandbox.qemuGuestPort', 2222],
    ['sandbox.qemuGuestUser', 'goodvibes'],
    ['sandbox.qemuWorkspacePath', '/workspace'],
    ['sandbox.qemuSessionMode', 'attach'],
    ...Object.entries(overrides),
  ]);
  return {
    get(key: string) {
      return values.get(key);
    },
  };
}

const WORKSPACE_ROOT = process.cwd();

describe('sandbox manager', () => {
  test('builds config snapshot and review output', () => {
    const manager = makeManager();
    const snapshot = getSandboxConfigSnapshot(manager as never);
    expect(snapshot.replIsolation).toBe('shared-vm');
    expect(snapshot.mcpIsolation).toBe('disabled');
    expect(snapshot.qemuBinary).toBe('qemu-system-x86_64');
    expect(snapshot.qemuImagePath).toBe('');
    expect(snapshot.qemuExecWrapper).toBe('');
    expect(snapshot.qemuGuestPort).toBe(2222);
    expect(snapshot.qemuSessionMode).toBe('attach');

    const review = buildSandboxReview(manager as never);
    expect(review.config.vmBackend).toBe('local');
    expect(review.profiles.length).toBeGreaterThan(0);
    expect(renderSandboxReview(manager as never)).toContain('Sandbox Review');
  });

  test('renders recommendations and profiles', () => {
    const manager = makeManager({ 'sandbox.replIsolation': 'shared-vm' });
    expect(renderSandboxRecommendation(manager as never)).toContain('Sandbox Recommendation');
    expect(renderSandboxProfiles(manager as never)).toContain('Sandbox Profiles');
    const profiles = listSandboxProfiles(manager as never);
    expect(profiles.some((profile) => profile.id === 'eval-py')).toBe(true);
  });

  test('inspects sandbox probes and bundles', () => {
    expect(inspectSandboxProbe({
      version: 1,
      checkedAt: 1000,
      host: 'linux',
      currentBackend: 'qemu',
      replIsolation: 'per-runtime-vm',
      mcpIsolation: 'hybrid',
      windowsMode: 'native-basic',
      secureSandboxReady: true,
      recommendedCommand: '/sandbox set-repl per-runtime-vm',
    })).toContain('Sandbox Probe');

    expect(inspectSandboxBundle({
      version: 1,
      exportedAt: 1000,
      review: {
        reviewText: 'Sandbox Review',
        recommendationText: 'Sandbox Recommendation',
        profilesText: 'Sandbox Profiles',
      },
    })).toContain('Sandbox Bundle Review');
  });

  test('probes backends and builds launch plans', () => {
    const manager = makeManager({ 'sandbox.vmBackend': 'local' });
    const probe = probeSandboxBackends(manager as never);
    expect(probe.backends.some((entry) => entry.id === 'local' && entry.available)).toBe(true);

    const profile = listSandboxProfiles(manager as never).find((entry) => entry.id === 'eval-py');
    expect(profile).toBeDefined();
    const plan = buildSandboxLaunchPlan(profile!, 'Python eval', manager as never, WORKSPACE_ROOT);
    expect(plan.summary.length).toBeGreaterThan(0);
    expect(plan.workspaceRoot.length).toBeGreaterThan(0);
  });

  test('qemu launch planning is externalized to GoodVibes TUI', () => {
    const manager = makeManager({
      'sandbox.vmBackend': 'qemu',
      'sandbox.qemuBinary': 'bash',
      'sandbox.qemuImagePath': '/tmp/gv-sandbox.qcow2',
    });
    const profile = listSandboxProfiles(manager as never).find((entry) => entry.id === 'eval-py');
    expect(profile).toBeDefined();
    expect(() => buildSandboxLaunchPlan(profile!, 'Python eval', manager as never, WORKSPACE_ROOT)).toThrow(AgentSandboxExternalizedError);
  });

  test('resolves local sandbox commands but externalizes execution', () => {
    const commandPlan = resolveSandboxCommandPlan({
      backend: 'local',
      command: 'bash',
      args: ['-lc', 'true'],
      workspaceRoot: process.cwd(),
      summary: 'local',
    }, 'bash', ['-lc', 'printf sandbox-ok']);
    expect(commandPlan.command).toBe('bash');
    expect(commandPlan.summary).toContain('printf sandbox-ok');

    expect(() => executeSandboxCommand({
      backend: 'local',
      command: 'bash',
      args: ['-lc', 'true'],
      workspaceRoot: process.cwd(),
      summary: 'local',
    }, 'bash', ['-lc', 'printf sandbox-ok'])).toThrow(AgentSandboxExternalizedError);
  });

  test('sandbox sessions record verified startup state for local backends', async () => {
    const sessions = new SandboxSessionRegistry(WORKSPACE_ROOT);
    const session = await sessions.start('eval-js', 'JavaScript eval', makeManager() as never);
    expect(['running', 'planned', 'failed']).toContain(session.state);
    expect(session.startupStatus).toBeDefined();
    expect(session.startupDetail?.length).toBeGreaterThan(0);
  });

  test('sandbox sessions execute commands and retain last-run metadata', async () => {
    const sessions = new SandboxSessionRegistry(WORKSPACE_ROOT);
    const session = await sessions.start('eval-js', 'JavaScript eval', makeManager() as never);
    const result = sessions.execute(session.id, 'bash', ['-lc', 'printf session-ok'], makeManager() as never);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('session-ok');
    const updated = sessions.get(session.id);
    expect(updated?.executionCount).toBe(1);
    expect(updated?.lastExitStatus).toBe(0);
    expect(updated?.lastStdoutPreview).toContain('session-ok');
  });

  test('sandbox sessions expose planned qemu image startup detail when image is configured', async () => {
    const sessions = new SandboxSessionRegistry(WORKSPACE_ROOT);
    const session = await sessions.start('eval-js', 'JavaScript eval', makeManager({
      'sandbox.vmBackend': 'qemu',
      'sandbox.qemuBinary': 'bash',
      'sandbox.qemuImagePath': '/tmp/gv-sandbox.qcow2',
    }) as never);
    expect(session.state).toBe('planned');
    expect(session.startupStatus).toBe('planned');
    expect(session.startupDetail).toContain('/tmp/gv-sandbox.qcow2');
  });

  test('qemu wrapper-backed sessions can verify startup', async () => {
    const wrapperPath = join(tmpdir(), `gv-qemu-wrapper-${Date.now()}.sh`);
    writeFileSync(wrapperPath, '#!/usr/bin/env bash\nprintf sandbox-ready\n', 'utf-8');
    chmodSync(wrapperPath, 0o755);
    const sessions = new SandboxSessionRegistry(WORKSPACE_ROOT);
    const session = await sessions.start('eval-js', 'JavaScript eval', makeManager({
      'sandbox.vmBackend': 'qemu',
      'sandbox.qemuBinary': 'bash',
      'sandbox.qemuImagePath': '/tmp/gv-sandbox.qcow2',
      'sandbox.qemuExecWrapper': wrapperPath,
    }) as never);
    expect(session.state).toBe('running');
    expect(session.startupStatus).toBe('verified');
    expect(session.startupDetail).toContain(wrapperPath);
  });

  test('qemu command execution is externalized even with a prebuilt launch plan', () => {
    expect(() => resolveSandboxCommandPlan({
      backend: 'qemu',
      command: 'qemu-system-x86_64',
      args: [],
      workspaceRoot: WORKSPACE_ROOT,
      summary: 'qemu',
      imagePath: '/tmp/gv-sandbox.qcow2',
    }, 'bash', ['-lc', 'printf guest-ok'], makeManager() as never)).toThrow(AgentSandboxExternalizedError);
    expect(() => executeSandboxManagedCommand({
      backend: 'local',
      command: 'bash',
      args: [],
      workspaceRoot: WORKSPACE_ROOT,
      summary: 'local',
    }, 'bash', ['-lc', 'printf local-ok'], makeManager() as never)).toThrow(AgentSandboxExternalizedError);
  });

  test('qemu probe warns when wrapper path is missing or not executable', () => {
    const missingPath = join(tmpdir(), `gv-missing-wrapper-${Date.now()}.sh`);
    const missingProbe = probeSandboxBackends(makeManager({
      'sandbox.vmBackend': 'qemu',
      'sandbox.qemuImagePath': '/tmp/gv-sandbox.qcow2',
      'sandbox.qemuExecWrapper': missingPath,
    }) as never);
    expect(missingProbe.warnings.join('\n')).toContain('does not exist');

    const nonExecPath = join(tmpdir(), `gv-nonexec-wrapper-${Date.now()}.sh`);
    writeFileSync(nonExecPath, '#!/usr/bin/env bash\nexit 0\n', 'utf-8');
    chmodSync(nonExecPath, 0o644);
    const nonExecProbe = probeSandboxBackends(makeManager({
      'sandbox.vmBackend': 'qemu',
      'sandbox.qemuImagePath': '/tmp/gv-sandbox.qcow2',
      'sandbox.qemuExecWrapper': nonExecPath,
    }) as never);
    expect(nonExecProbe.warnings.join('\n')).toContain('not executable');
  });
});
