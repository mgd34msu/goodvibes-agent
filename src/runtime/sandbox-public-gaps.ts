import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  detectSandboxHostStatus,
  getSandboxConfigSnapshot,
  type ConfigManagerLike,
  type SandboxBackendProbe,
  type SandboxLaunchPlan,
  type SandboxProfile,
} from '@pellux/goodvibes-sdk/platform/runtime/sandbox';
export interface SandboxGuestBundle {
  readonly version: 1;
  readonly exportedAt: number;
  readonly guest: {
    readonly qemuBinary: string;
    readonly imagePath: string;
    readonly wrapperPath: string;
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly workspacePath: string;
    readonly sessionMode: string;
    readonly replJavaScriptCommand: string;
  };
  readonly nextSteps: readonly string[];
}

export interface SandboxQemuInitBundle {
  readonly directory: string;
  readonly wrapperPath: string;
  readonly guestBundlePath: string;
  readonly readmePath: string;
}

export interface SandboxQemuSetupBundle extends SandboxQemuInitBundle {
  readonly imagePath: string;
  readonly imageCreateScriptPath: string;
  readonly guestBootstrapScriptPath: string;
  readonly projectionPolicyPath: string;
  readonly sshConfigPath: string;
  readonly seedDirectory: string;
  readonly seedIsoPath: string;
  readonly sshKeyPath: string;
  readonly sshPublicKeyPath: string;
  readonly manifestPath: string;
}

export interface SandboxQemuSetupManifest {
  readonly version: 1;
  readonly createdAt: number;
  readonly wrapperPath: string;
  readonly imagePath: string;
  readonly imageCreateScriptPath: string;
  readonly guestBootstrapScriptPath: string;
  readonly projectionPolicyPath: string;
  readonly sshConfigPath: string;
  readonly seedDirectory: string;
  readonly seedIsoPath: string;
  readonly sshKeyPath: string;
  readonly sshPublicKeyPath: string;
  readonly recommendedSettings: {
    readonly backend: 'qemu';
    readonly qemuBinary: string;
    readonly wrapperPath: string;
    readonly imagePath: string;
    readonly guestHost: string;
    readonly guestPort: number;
    readonly guestUser: string;
    readonly guestWorkspacePath: string;
    readonly sessionMode: string;
    readonly replJavaScriptCommand: string;
  };
}

export interface SandboxProvisioningOptions {
  readonly surfaceRoot: string;
}

export interface WritableConfigManagerLike extends ConfigManagerLike {
  setDynamic(key: string, value: unknown): void;
}

export class AgentSandboxExternalizedError extends Error {
  readonly code = 'sandbox_externalized_to_tui';
  readonly action: string;

  constructor(action: string) {
    super(`Agent sandbox ${action} is externalized to GoodVibes TUI. Delegate build/sandbox/QEMU work to a GoodVibes TUI session instead.`);
    this.name = 'AgentSandboxExternalizedError';
    this.action = action;
  }
}

function sandboxExternalized(action: string): never {
  throw new AgentSandboxExternalizedError(action);
}

export function probeSandboxBackends(manager: ConfigManagerLike): SandboxBackendProbe {
  const host = detectSandboxHostStatus(manager);
  const config = getSandboxConfigSnapshot(manager);
  const qemuBinary = config.qemuBinary || 'qemu-system-x86_64';
  const qemuImage = config.qemuImagePath || '';
  const qemuExecWrapper = config.qemuExecWrapper || '';
  const qemuGuestHost = config.qemuGuestHost || '';
  const qemuProbe = spawnSync(qemuBinary, ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'buffer',
    timeout: 1500,
    windowsHide: true,
  });
  const qemuAvailable = qemuProbe.status === 0 || qemuProbe.status === 1;
  const qemuBlockedReason = host.windows && !host.runningInWsl
    ? 'QEMU sandboxing on Windows requires running GoodVibes inside WSL.'
    : '';
  const qemuDetail = qemuBlockedReason || (
    qemuAvailable
      ? `requires ${qemuBinary} on PATH`
      : `requires ${qemuBinary} on PATH (${qemuProbe.error instanceof Error ? qemuProbe.error.message : `exit ${qemuProbe.status ?? 'unknown'}`})`
  );
  const warnings: string[] = [];
  if (config.vmBackend === 'qemu' && !qemuAvailable) {
    warnings.push(`Requested sandbox backend "${config.vmBackend}" is unavailable; local process isolation will not be used unless sandbox.vmBackend is set to "local".`);
  }
  if (config.vmBackend === 'qemu' && !qemuImage) {
    warnings.push('QEMU backend selected without sandbox.qemuImagePath; sessions can be planned and reviewed, but guest execution remains disabled.');
  }
  if (config.vmBackend === 'qemu' && qemuImage && !qemuExecWrapper) {
    warnings.push('QEMU image is configured without sandbox.qemuExecWrapper; guest launch planning is wired, but command execution remains disabled until a host bridge is configured.');
  }
  if (config.vmBackend === 'qemu' && qemuExecWrapper && !qemuGuestHost) {
    warnings.push('QEMU wrapper is configured without sandbox.qemuGuestHost; host bridge mode is available, but real guest SSH transport remains disabled until the guest host is configured.');
  }
  if (config.vmBackend === 'qemu' && qemuExecWrapper && !existsSync(qemuExecWrapper)) {
    warnings.push(`Configured sandbox.qemuExecWrapper does not exist: ${qemuExecWrapper}`);
  }
  if (config.vmBackend === 'qemu' && qemuExecWrapper && existsSync(qemuExecWrapper) && !isExecutableFile(qemuExecWrapper)) {
    warnings.push(`Configured sandbox.qemuExecWrapper is not executable: ${qemuExecWrapper}`);
  }
  if (qemuBlockedReason) warnings.push(qemuBlockedReason);
  return {
    requestedBackend: config.vmBackend,
    resolvedBackend: config.vmBackend,
    backends: [
      { id: 'local', available: true, detail: 'host-local process isolation is available when explicitly selected' },
      { id: 'qemu', available: qemuAvailable && !qemuBlockedReason, detail: qemuDetail },
    ],
    warnings,
  };
}

export function buildSandboxLaunchPlan(
  profile: SandboxProfile,
  label: string,
  manager: ConfigManagerLike,
  workspaceRoot: string,
): SandboxLaunchPlan {
  const config = getSandboxConfigSnapshot(manager);
  const backendProbe = probeSandboxBackends(manager);
  const backend = backendProbe.resolvedBackend === 'qemu' ? 'qemu' : 'local';
  const safeWorkspaceRoot = resolve(workspaceRoot);
  if (backend === 'qemu') {
    void profile;
    void label;
    void config;
    void safeWorkspaceRoot;
    sandboxExternalized('QEMU launch planning');
  }
  return {
    backend: 'local',
    command: process.env.SHELL || 'bash',
    args: ['-lc', `echo "goodvibes sandbox ${profile.id}: ${label}"`],
    workspaceRoot: safeWorkspaceRoot,
    summary: buildCommandSummary(process.env.SHELL || 'bash', ['-lc', `echo "goodvibes sandbox ${profile.id}: ${label}"`]),
  };
}

export interface SandboxCommandPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly summary: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export interface SandboxCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function buildCommandSummary(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ').trim();
}

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function resolveSandboxCommandPlan(
  launchPlan: SandboxLaunchPlan,
  command: string,
  args: readonly string[],
  manager?: ConfigManagerLike,
): SandboxCommandPlan {
  if (launchPlan.backend === 'qemu') {
    void manager;
    sandboxExternalized('QEMU command planning');
  }
  return {
    command,
    args,
    summary: buildCommandSummary(command, args),
  };
}

export function executeSandboxCommand(
  launchPlan: SandboxLaunchPlan,
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly inheritHostEnv?: boolean;
    readonly timeoutMs?: number;
    readonly input?: string;
  } = {},
): SandboxCommandResult {
  void launchPlan;
  void command;
  void args;
  void options;
  sandboxExternalized('command execution');
}

export function executeSandboxManagedCommand(
  launchPlan: SandboxLaunchPlan,
  command: string,
  args: readonly string[],
  manager: ConfigManagerLike,
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly inheritHostEnv?: boolean;
    readonly timeoutMs?: number;
    readonly input?: string;
  } = {},
): SandboxCommandResult {
  void launchPlan;
  void command;
  void args;
  void manager;
  void options;
  sandboxExternalized('managed command execution');
}

function resolveWorkspacePath(workspaceRoot: string, pathArg: string): string {
  return resolve(workspaceRoot, pathArg);
}

export function scaffoldSandboxQemuInitBundle(
  manager: ConfigManagerLike,
  workspaceRoot: string,
  pathArg: string,
  _options: SandboxProvisioningOptions,
): SandboxQemuInitBundle {
  void manager;
  void workspaceRoot;
  void pathArg;
  void _options;
  sandboxExternalized('QEMU init bundle scaffolding');
}

export function scaffoldSandboxQemuSetupBundle(
  manager: ConfigManagerLike,
  workspaceRoot: string,
  pathArg: string,
  options: SandboxProvisioningOptions,
): SandboxQemuSetupBundle {
  void manager;
  void workspaceRoot;
  void pathArg;
  void options;
  sandboxExternalized('QEMU setup bundle scaffolding');
}

export function bootstrapSandboxQemuSetupBundle(
  manager: WritableConfigManagerLike,
  workspaceRoot: string,
  pathArg: string,
  _sizeGb: number,
  options: SandboxProvisioningOptions,
): SandboxQemuSetupBundle {
  void manager;
  void workspaceRoot;
  void pathArg;
  void _sizeGb;
  void options;
  sandboxExternalized('QEMU setup bootstrap');
}

export function inspectSandboxQemuSetupManifest(manifest: SandboxQemuSetupManifest): string {
  return [
    'QEMU sandbox setup manifest',
    `  wrapper: ${manifest.wrapperPath}`,
    `  image: ${manifest.imagePath}`,
    `  guest: ${manifest.recommendedSettings.guestUser}@${manifest.recommendedSettings.guestHost}:${manifest.recommendedSettings.guestPort}`,
    `  workspace: ${manifest.recommendedSettings.guestWorkspacePath}`,
  ].join('\n');
}

export function loadSandboxQemuSetupManifest(workspaceRoot: string, pathArg: string): SandboxQemuSetupManifest {
  return JSON.parse(readFileSync(resolveWorkspacePath(workspaceRoot, pathArg), 'utf8')) as SandboxQemuSetupManifest;
}

export function applySandboxQemuSetupManifest(manager: WritableConfigManagerLike, manifest: SandboxQemuSetupManifest): void {
  void manager;
  void manifest;
  sandboxExternalized('QEMU manifest application');
}

export function exportSandboxGuestBundle(
  manager: ConfigManagerLike,
  workspaceRoot: string,
  pathArg: string,
  _options: SandboxProvisioningOptions,
): { readonly path: string; readonly bundle: SandboxGuestBundle } {
  void manager;
  void workspaceRoot;
  void pathArg;
  void _options;
  sandboxExternalized('guest bundle export');
}

export function inspectSandboxGuestBundle(bundle: SandboxGuestBundle): string {
  return [
    'Sandbox guest bundle',
    `  wrapper: ${bundle.guest.wrapperPath}`,
    `  image: ${bundle.guest.imagePath || '(not configured)'}`,
    `  guest: ${bundle.guest.user}@${bundle.guest.host}:${bundle.guest.port}`,
    `  workspace: ${bundle.guest.workspacePath}`,
    ...bundle.nextSteps.map((step) => `  next: ${step}`),
  ].join('\n');
}

export function renderSandboxDoctor(manager: ConfigManagerLike): string {
  const probe = probeSandboxBackends(manager);
  return [
    'Sandbox doctor',
    `  backend: ${probe.resolvedBackend}`,
    ...probe.backends.map((backend) => `  ${backend.id}: ${backend.available ? 'available' : 'missing'} (${backend.detail})`),
    ...probe.warnings.map((warning) => `  warning: ${warning}`),
  ].join('\n');
}
