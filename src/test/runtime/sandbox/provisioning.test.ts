import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AgentSandboxExternalizedError,
  applySandboxQemuSetupManifest,
  inspectSandboxQemuSetupManifest,
  scaffoldSandboxQemuSetupBundle,
} from '@/runtime/index.ts';

function makeManager(overrides: Partial<Record<string, unknown>> = {}) {
  const values = new Map<string, unknown>([
    ['sandbox.vmBackend', 'local'],
    ['sandbox.qemuBinary', 'qemu-system-x86_64'],
    ['sandbox.qemuImagePath', ''],
    ['sandbox.qemuExecWrapper', ''],
    ['sandbox.qemuGuestHost', '127.0.0.1'],
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
    setDynamic(key: string, value: unknown) {
      values.set(key, value);
    },
  };
}

describe('sandbox provisioning', () => {
  test('QEMU setup scaffolding is externalized to GoodVibes TUI', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gv-sandbox-provision-'));
    try {
      const manager = makeManager();
      expect(() => scaffoldSandboxQemuSetupBundle(manager as never, cwd, '.goodvibes/agent/sandbox', { surfaceRoot: 'agent' })).toThrow(AgentSandboxExternalizedError);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('QEMU manifests remain inspectable but cannot mutate Agent config', () => {
    const manifest = {
      version: 1,
      createdAt: 1000,
      wrapperPath: '/tmp/qemu-wrapper.sh',
      imagePath: '/tmp/goodvibes-sandbox.qcow2',
      imageCreateScriptPath: '/tmp/create-image.sh',
      guestBootstrapScriptPath: '/tmp/guest-bootstrap.sh',
      projectionPolicyPath: '/tmp/projection-policy.json',
      sshConfigPath: '/tmp/ssh-config',
      seedDirectory: '/tmp/seed',
      seedIsoPath: '/tmp/seed/nocloud.iso',
      sshKeyPath: '/tmp/keys/goodvibes_qemu_ed25519',
      sshPublicKeyPath: '/tmp/keys/goodvibes_qemu_ed25519.pub',
      recommendedSettings: {
        backend: 'qemu' as const,
        qemuBinary: 'qemu-system-x86_64',
        wrapperPath: '/tmp/qemu-wrapper.sh',
        imagePath: '/tmp/goodvibes-sandbox.qcow2',
        guestHost: '127.0.0.1',
        guestPort: 2222,
        guestUser: 'goodvibes',
        guestWorkspacePath: '/workspace',
        sessionMode: 'launch-per-command',
        replJavaScriptCommand: '/home/goodvibes/.bun/bin/bun',
      },
    };

    const target = makeManager();
    expect(inspectSandboxQemuSetupManifest(manifest)).toContain('QEMU sandbox setup manifest');
    expect(() => applySandboxQemuSetupManifest(target as never, manifest)).toThrow(AgentSandboxExternalizedError);
    expect(target.get('sandbox.vmBackend')).toBe('local');
  });

  test('QEMU setup bundle absolute targets are blocked before writing files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gv-sandbox-provision-workspace-'));
    const home = mkdtempSync(join(tmpdir(), 'gv-sandbox-provision-home-'));
    try {
      const manager = makeManager();
      const targetDir = join(home, '.goodvibes', 'agent', 'sandbox');
      expect(() => scaffoldSandboxQemuSetupBundle(manager as never, cwd, targetDir, { surfaceRoot: 'agent' })).toThrow(AgentSandboxExternalizedError);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
