/**
 * Unit tests for SettingsModal — network category (controlPlane / httpListener).
 *
 * Covers:
 *   - Network tab populated with controlPlane.* and httpListener.* entries
 *   - host field visibility gating (hidden unless hostMode === 'custom')
 *   - External runtime lifecycle/network rows are visible but locked for Agent
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON, SettingsModal, SETTINGS_CATEGORIES, isExternalDaemonOwnedSettingKey } from '../../input/settings-modal.ts';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { SecretsManager } from '../../config/secrets.ts';
import { ServiceRegistry } from '@pellux/goodvibes-sdk/platform/config';
import { SubscriptionManager } from '@pellux/goodvibes-sdk/platform/config';
import { createFeatureFlagManager } from '@/runtime/index.ts';
import type { FeatureFlagManager } from '@/runtime/index.ts';
import type { McpRegistry } from '@pellux/goodvibes-sdk/platform/mcp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `gv-net-modal-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

const emptyMcpRegistry: McpRegistry = {
  listServerSecurity: () => [],
  setServerTrustMode: () => {},
} as unknown as McpRegistry;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SettingsModal — network category', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  let tmpDir: string;
  let cm: ConfigManager;
  let ffm: FeatureFlagManager;
  let modal: SettingsModal;
  let subscriptionManager: SubscriptionManager;
  let serviceRegistry: ServiceRegistry;

  // Navigate to the network tab by index
  function openOnNetworkTab(): void {
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    const networkIdx = SETTINGS_CATEGORIES.indexOf('network');
    modal.categoryIndex = networkIdx;
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

  // ── Category registration ─────────────────────────────────────────────

  test('network is a registered category', () => {
    expect(SETTINGS_CATEGORIES).toContain('network');
  });

  test('network group is populated after open()', () => {
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    const items = modal.groups.get('network');
    expect(items).toBeDefined();
    expect(items!.length).toBeGreaterThan(0);
  });

  test('network group contains controlPlane.hostMode', () => {
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    const items = modal.groups.get('network') ?? [];
    const keys = items.map(e => e.setting.key);
    expect(keys).toContain('controlPlane.hostMode');
  });

  test('network group contains httpListener.hostMode', () => {
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    const items = modal.groups.get('network') ?? [];
    const keys = items.map(e => e.setting.key);
    expect(keys).toContain('httpListener.hostMode');
  });

  test('network group does NOT contain controlPlane.host when hostMode is local (default)', () => {
    openOnNetworkTab();
    // Default hostMode is 'local', so host should be hidden
    const visibleKeys = modal.currentItems.map(e => e.setting.key);
    expect(visibleKeys).not.toContain('controlPlane.host');
  });

  test('network group does NOT contain httpListener.host when hostMode is local (default)', () => {
    openOnNetworkTab();
    const visibleKeys = modal.currentItems.map(e => e.setting.key);
    expect(visibleKeys).not.toContain('httpListener.host');
  });

  test('controlPlane.host IS visible when controlPlane.hostMode is custom', () => {
    openOnNetworkTab();
    // Set hostMode to custom
    cm.setDynamic('controlPlane.hostMode', 'custom');
    // Reload groups so cached entry is updated
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    modal.categoryIndex = SETTINGS_CATEGORIES.indexOf('network');
    const visibleKeys = modal.currentItems.map(e => e.setting.key);
    expect(visibleKeys).toContain('controlPlane.host');
  });

  test('httpListener.host IS visible when httpListener.hostMode is custom', () => {
    openOnNetworkTab();
    cm.setDynamic('httpListener.hostMode', 'custom');
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    modal.categoryIndex = SETTINGS_CATEGORIES.indexOf('network');
    const visibleKeys = modal.currentItems.map(e => e.setting.key);
    expect(visibleKeys).toContain('httpListener.host');
  });

  // ── Agent external-daemon lock path ───────────────────────────────────

  test('lastSaveTriggeredRestart is null on fresh open', () => {
    openOnNetworkTab();
    expect(modal.lastSaveTriggeredRestart).toBeNull();
  });

  test('controlPlane.hostMode is locked and does not mutate from Agent settings', () => {
    openOnNetworkTab();
    const items = modal.currentItems;
    const cpHostModeIdx = items.findIndex(e => e.setting.key === 'controlPlane.hostMode');
    modal.selectedIndex = cpHostModeIdx;
    const before = cm.get('controlPlane.hostMode');
    modal.activateSelected();
    expect(cm.get('controlPlane.hostMode')).toBe(before);
    expect(modal.lastSaveTriggeredRestart).toBeNull();
    expect(modal.lastSettingEffectMessage).toBe(AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON);
  });

  test('httpListener.hostMode is locked and does not mutate from Agent settings', () => {
    openOnNetworkTab();
    const items = modal.currentItems;
    const httpHostModeIdx = items.findIndex(e => e.setting.key === 'httpListener.hostMode');
    modal.selectedIndex = httpHostModeIdx;
    const before = cm.get('httpListener.hostMode');
    modal.activateSelected();
    expect(cm.get('httpListener.hostMode')).toBe(before);
    expect(modal.lastSaveTriggeredRestart).toBeNull();
    expect(modal.lastSettingEffectMessage).toBe(AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON);
  });

  test('external runtime lock notice is cleared on close()', () => {
    openOnNetworkTab();
    const items = modal.currentItems;
    const idx = items.findIndex(e => e.setting.key === 'controlPlane.hostMode');
    modal.selectedIndex = idx;
    modal.activateSelected();
    expect(modal.lastSettingEffectMessage).toBe(AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON);
    modal.close();
    expect(modal.lastSettingEffectMessage).toBeNull();
    expect(modal.lastSaveTriggeredRestart).toBeNull();
  });

  test('external runtime lock notice is cleared on open()', () => {
    openOnNetworkTab();
    const items = modal.currentItems;
    const idx = items.findIndex(e => e.setting.key === 'controlPlane.hostMode');
    modal.selectedIndex = idx;
    modal.activateSelected();
    expect(modal.lastSettingEffectMessage).toBe(AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON);
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    expect(modal.lastSettingEffectMessage).toBeNull();
    expect(modal.lastSaveTriggeredRestart).toBeNull();
  });

  test('adjustSelected does not cycle external runtime controlPlane.hostMode values', () => {
    openOnNetworkTab();
    const items = modal.currentItems;
    const cpHostModeIdx = items.findIndex(e => e.setting.key === 'controlPlane.hostMode');
    modal.selectedIndex = cpHostModeIdx;

    const initial = cm.get('controlPlane.hostMode');
    modal.adjustSelected('right');
    expect(cm.get('controlPlane.hostMode')).toBe(initial);
    expect(modal.lastSettingEffectMessage).toBe(AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON);

    modal.adjustSelected('left');
    expect(cm.get('controlPlane.hostMode')).toBe(initial);
  });

  test('controlPlane.port is always visible', () => {
    openOnNetworkTab();
    const visibleKeys = modal.currentItems.map(e => e.setting.key);
    expect(visibleKeys).toContain('controlPlane.port');
  });

  test('httpListener.port is always visible', () => {
    openOnNetworkTab();
    const visibleKeys = modal.currentItems.map(e => e.setting.key);
    expect(visibleKeys).toContain('httpListener.port');
  });

  // ── web.* keys ───────────────────────────────────────────────────────────

  test('network group contains web.hostMode', () => {
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    const items = modal.groups.get('network') ?? [];
    const keys = items.map(e => e.setting.key);
    expect(keys).toContain('web.hostMode');
  });

  test('network group contains web.port', () => {
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    const items = modal.groups.get('network') ?? [];
    const keys = items.map(e => e.setting.key);
    expect(keys).toContain('web.port');
  });

  test('web.host is hidden when web.hostMode is local (default)', () => {
    openOnNetworkTab();
    const visibleKeys = modal.currentItems.map(e => e.setting.key);
    expect(visibleKeys).not.toContain('web.host');
  });

  test('web.host IS visible when web.hostMode is custom', () => {
    openOnNetworkTab();
    cm.setDynamic('web.hostMode', 'custom');
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry);
    modal.categoryIndex = SETTINGS_CATEGORIES.indexOf('network');
    const visibleKeys = modal.currentItems.map(e => e.setting.key);
    expect(visibleKeys).toContain('web.host');
  });

  test('web.hostMode is locked and does not mutate from Agent settings', () => {
    openOnNetworkTab();
    const items = modal.currentItems;
    const webHostModeIdx = items.findIndex(e => e.setting.key === 'web.hostMode');
    modal.selectedIndex = webHostModeIdx;
    const before = cm.get('web.hostMode');
    modal.activateSelected();
    expect(cm.get('web.hostMode')).toBe(before);
    expect(modal.lastSaveTriggeredRestart).toBeNull();
    expect(modal.lastSettingEffectMessage).toBe(AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON);
  });

  test('external runtime-owned network keys are marked locked', () => {
    openOnNetworkTab();
    const daemonOwnedEntries = modal.currentItems.filter((entry) => isExternalDaemonOwnedSettingKey(entry.setting.key));
    expect(daemonOwnedEntries.length).toBeGreaterThan(0);
    for (const entry of daemonOwnedEntries) {
      expect(entry.locked).toBe(true);
      expect(entry.lockReason).toBe(AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON);
    }
  });

  // ── M3: render-layer banner test ─────────────────────────────────────────

  test('render-layer: network tab description appears in renderSettingsModal output', () => {
    const { renderSettingsModal } = require('../../renderer/settings-modal.ts');
    openOnNetworkTab();
    const lines: unknown[] = renderSettingsModal(modal, 120, 30);
    // Flatten lines to text for inspection
    const text = lines
      .map((line: unknown) =>
        Array.isArray(line)
          ? (line as Array<{ text?: string; char?: string }>).map(s => s.text ?? s.char ?? '').join('')
          : ''
      )
      .join('\n');
    expect(text).toContain('external GoodVibes runtime');
  });

  test('render-layer: external runtime lock notice appears after a blocked change', () => {
    const { renderSettingsModal } = require('../../renderer/settings-modal.ts');
    openOnNetworkTab();
    const items = modal.currentItems;
    const cpHostModeIdx = items.findIndex(e => e.setting.key === 'controlPlane.hostMode');
    modal.selectedIndex = cpHostModeIdx;
    modal.activateSelected();
    expect(modal.lastSettingEffectMessage).toBe(AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON);
    const lines: unknown[] = renderSettingsModal(modal, 120, 30);
    const text = lines
      .map((line: unknown) =>
        Array.isArray(line)
          ? (line as Array<{ text?: string; char?: string }>).map(s => s.text ?? s.char ?? '').join('')
          : ''
      )
      .join('\n');
    expect(text).toContain('external GoodVibes runtime');
  });

  test('service settings are locked and do not call the setting apply handler', () => {
    const calls: Array<{ key: string; previousValue: unknown; value: unknown }> = [];
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, emptyMcpRegistry, undefined, {
      onSettingApplied: (change) => {
        calls.push(change);
        cm.setDynamic('service.enabled', true);
        return { message: 'unexpected daemon-owned mutation' };
      },
    });
    modal.categoryIndex = SETTINGS_CATEGORIES.indexOf('service');
    const idx = modal.currentItems.findIndex(e => e.setting.key === 'service.autostart');
    expect(idx).toBeGreaterThanOrEqual(0);
    modal.selectedIndex = idx;
    const before = cm.get('service.autostart');
    modal.activateSelected();

    expect(calls).toEqual([]);
    expect(cm.get('service.autostart')).toBe(before);
    expect(modal.lastSettingEffectMessage).toBe(AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON);
    const serviceEnabledEntry = modal.groups.get('service')?.find((entry) => entry.setting.key === 'service.enabled');
    expect(serviceEnabledEntry?.currentValue).toBe(false);
  });
});
