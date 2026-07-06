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

  test('service-hosting and network categories are registered for Agent settings', () => {
    expect(SETTINGS_CATEGORIES).toContain('network');
    expect(SETTINGS_CATEGORIES).toContain('controlPlane');
    expect(SETTINGS_CATEGORIES).toContain('httpListener');
    expect(SETTINGS_CATEGORIES).toContain('web');
    expect(SETTINGS_CATEGORIES).toContain('service');
    expect(SETTINGS_CATEGORIES).toContain('runtime');
    expect(SETTINGS_CATEGORIES).not.toContain('danger');
    expect(SETTINGS_CATEGORIES).toContain('wrfc');
    expect(SETTINGS_CATEGORIES).toContain('orchestration');
  });

  test('only raw danger toggles and internal WRFC message setting are policy-hidden', () => {
    for (const key of [
      'danger.httpListener',
      'ui.wrfcMessages',
    ]) {
      expect(isAgentHiddenSettingKey(key)).toBe(true);
    }
    for (const key of [
      'controlPlane.hostMode',
      'controlPlane.port',
      'httpListener.hostMode',
      'service.autostart',
      'network.outboundTls.mode',
      'runtime.eventBus.maxListeners',
      'orchestration.recursionEnabled',
      'wrfc.scoreThreshold',
    ]) {
      expect(isAgentHiddenSettingKey(key)).toBe(false);
    }
  });

  test('open() populates daemon runtime keys but keeps hidden danger keys out', () => {
    openSettings();
    const keys = visibleKeys();
    for (const key of [
      'controlPlane.hostMode',
      'httpListener.hostMode',
      'web.hostMode',
      'service.autostart',
      'network.outboundTls.mode',
      'runtime.eventBus.maxListeners',
      'orchestration.recursionEnabled',
      'wrfc.scoreThreshold',
    ]) {
      expect(keys.has(key)).toBe(true);
    }
    for (const key of [
      'danger.httpListener',
      'ui.wrfcMessages',
    ]) {
      expect(keys.has(key)).toBe(false);
    }
  });

  test('selectTarget navigates to daemon runtime keys but not hidden danger keys', () => {
    openSettings();
    modal.selectTarget('controlPlane.port');
    expect(modal.getSelected()?.setting.key).toBe('controlPlane.port');
    const before = modal.getSelected()?.setting.key;
    modal.selectTarget('danger.httpListener');
    expect(modal.getSelected()?.setting.key).toBe(before);
    modal.selectTarget('ui.wrfcMessages');
    expect(modal.getSelected()?.setting.key).toBe(before);
  });

  test('rendered settings workspace does not mention raw danger settings', () => {
    openSettings();
    const text = renderSettingsModal(modal, 120, 30).map(lineText).join('\n');
    expect(text).not.toContain('Danger');
    expect(text).not.toContain('danger.httpListener');
  });

  // The deprecated danger.daemon alias (and the settings-modal override-note
  // machinery it drove — SettingEntry.overrideNote, buildSettingOverrideNote)
  // was removed from the schema; see
  // docs/decisions/2026-07-05-daemon-by-default.md in the SDK. daemon.enabled
  // is now the single source of truth for this setting, so there is no longer
  // a precedence case for the modal to explain.
});
