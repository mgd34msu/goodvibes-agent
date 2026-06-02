/**
 * Regression tests for Agent settings boundaries around copied service-hosting
 * config. GoodVibes Agent connects to a GoodVibes host owned outside this product; the settings
 * workspace must not expose controls that imply it owns daemon, listener,
 * browser host, raw network, service, or WRFC lifecycle.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsModal, SETTINGS_CATEGORIES, isAgentHiddenSettingKey } from '../../input/settings-modal.ts';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { SecretsManager } from '../../config/secrets.ts';
import { ServiceRegistry } from '@pellux/goodvibes-sdk/platform/config';
import { SubscriptionManager } from '@pellux/goodvibes-sdk/platform/config';
import { createFeatureFlagManager } from '@/runtime/index.ts';
import type { FeatureFlagManager } from '@/runtime/index.ts';
import type { McpRegistry } from '@pellux/goodvibes-sdk/platform/mcp';
import { renderSettingsModal } from '../../renderer/settings-modal.ts';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `gv-agent-settings-boundary-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createConfigManager(root: string): ConfigManager {
  return new ConfigManager({
    surfaceRoot: 'tui',
    workingDir: root,
    homeDir: root,
    configDir: join(root, '.goodvibes', 'global-tui'),
  });
}

function lineText(line: unknown): string {
  if (!Array.isArray(line)) return '';
  return line.map((span: { text?: string; char?: string }) => span.text ?? span.char ?? '').join('');
}

const emptyMcpRegistry: McpRegistry = {
  listServerSecurity: () => [],
  setServerTrustMode: () => {},
} as unknown as McpRegistry;

describe('SettingsModal — Agent service-hosting boundaries', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  let tmpDir: string;
  let cm: ConfigManager;
  let ffm: FeatureFlagManager;
  let modal: SettingsModal;
  let subscriptionManager: SubscriptionManager;
  let serviceRegistry: ServiceRegistry;

  function openSettings(): void {
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
  }

  function visibleKeys(): Set<string> {
    const keys = new Set<string>();
    for (const entries of modal.groups.values()) {
      for (const entry of entries) keys.add(entry.setting.key);
    }
    return keys;
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.HOME = tmpDir;
    process.chdir(tmpDir);
    cm = createConfigManager(tmpDir);
    ffm = createFeatureFlagManager();
    modal = new SettingsModal();
    subscriptionManager = new SubscriptionManager(join(tmpDir, '.goodvibes', 'tui', 'subscriptions.json'));
    serviceRegistry = new ServiceRegistry(join(tmpDir, '.goodvibes', 'tui', 'services.json'), {
      secretsManager: new SecretsManager({ projectRoot: tmpDir, globalHome: tmpDir, configManager: cm }),
      subscriptionManager,
    });
    mkdirSync(join(tmpDir, '.goodvibes', 'tui'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test('service-hosting and network categories are not registered for Agent settings', () => {
    expect(SETTINGS_CATEGORIES).not.toContain('network');
    expect(SETTINGS_CATEGORIES).not.toContain('controlPlane');
    expect(SETTINGS_CATEGORIES).not.toContain('httpListener');
    expect(SETTINGS_CATEGORIES).not.toContain('web');
    expect(SETTINGS_CATEGORIES).not.toContain('service');
    expect(SETTINGS_CATEGORIES).not.toContain('runtime');
    expect(SETTINGS_CATEGORIES).not.toContain('danger');
    expect(SETTINGS_CATEGORIES).not.toContain('wrfc');
    expect(SETTINGS_CATEGORIES).not.toContain('orchestration');
  });

  test('runtime-hosting, raw network, and copied WRFC keys are policy-hidden', () => {
    for (const key of [
      'danger.daemon',
      'danger.httpListener',
      'controlPlane.hostMode',
      'controlPlane.port',
      'httpListener.hostMode',
      'httpListener.port',
      'web.hostMode',
      'web.port',
      'service.autostart',
      'network.outboundTls.mode',
      'network.remoteFetch.allowPrivateHosts',
      'runtime.companionChatLimiter.perSessionLimit',
      'runtime.eventBus.maxListeners',
      'orchestration.recursionEnabled',
      'wrfc.scoreThreshold',
      'ui.wrfcMessages',
    ]) {
      expect(isAgentHiddenSettingKey(key)).toBe(true);
    }
  });

  test('open() does not populate hidden runtime-hosting keys', () => {
    openSettings();
    const keys = visibleKeys();
    for (const key of [
      'danger.daemon',
      'controlPlane.hostMode',
      'httpListener.hostMode',
      'web.hostMode',
      'service.autostart',
      'network.outboundTls.mode',
      'runtime.eventBus.maxListeners',
      'orchestration.recursionEnabled',
      'wrfc.scoreThreshold',
      'ui.wrfcMessages',
    ]) {
      expect(keys.has(key)).toBe(false);
    }
  });

  test('selectTarget cannot navigate to hidden runtime-hosting keys', () => {
    openSettings();
    const before = modal.getSelected()?.setting.key;
    modal.selectTarget('danger.daemon');
    expect(modal.getSelected()?.setting.key).toBe(before);
    modal.selectTarget('controlPlane.port');
    expect(modal.getSelected()?.setting.key).toBe(before);
    modal.selectTarget('ui.wrfcMessages');
    expect(modal.getSelected()?.setting.key).toBe(before);
  });

  test('rendered settings workspace does not mention hidden runtime-hosting sections', () => {
    openSettings();
    const text = renderSettingsModal(modal, 120, 30).map(lineText).join('\n');
    expect(text).not.toContain('External Runtime Connection');
    expect(text).not.toContain('Runtime API');
    expect(text).not.toContain('Inbound Events');
    expect(text).not.toContain('Runtime Install');
    expect(text).not.toContain('Danger');
    expect(text).not.toContain('WRFC Delegation');
    expect(text).not.toContain('Agent Orchestration');
    expect(text).not.toContain('controlPlane.');
    expect(text).not.toContain('httpListener.');
    expect(text).not.toContain('service.');
    expect(text).not.toContain('wrfc.');
  });
});
