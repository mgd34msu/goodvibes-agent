/**
 * Tests for renderSettingsModal renderer.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SettingsModal, SETTINGS_CATEGORIES } from '../../input/settings-modal.ts';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { SecretsManager } from '../../config/secrets.ts';
import { ServiceRegistry } from '@pellux/goodvibes-sdk/platform/config';
import { SubscriptionManager } from '@pellux/goodvibes-sdk/platform/config';
import { createFeatureFlagManager } from '@/runtime/index.ts';
import type { FeatureFlagManager } from '@/runtime/index.ts';
import type { McpRegistry } from '@pellux/goodvibes-sdk/platform/mcp';
import { renderSettingsModal } from '../../renderer/settings-modal.ts';
import { lineToString, linesToText } from '../setup.ts';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

const W = 120;

function makeTmpDir(): string {
  const dir = makeProjectTempDir(`gv-settings-renderer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return dir;
}

function createConfigManager(root: string): ConfigManager {
  return new ConfigManager({ surfaceRoot: 'tui',
    workingDir: root,
    homeDir: root,
    configDir: join(root, '.goodvibes', 'global-tui'),
  });
}

describe('renderSettingsModal', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  let tmpDir: string;
  let cm: ConfigManager;
  let ffm: FeatureFlagManager;
  let modal: SettingsModal;
  let mcpRegistry: McpRegistry;
  let subscriptionManager: SubscriptionManager;
  let serviceRegistry: ServiceRegistry;

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
    mcpRegistry = {
      listServerSecurity: () => [
        {
          name: 'docs-server',
          connected: true,
          role: 'docs',
          trustMode: 'ask-on-risk',
          allowedPaths: ['/workspace/docs'],
          allowedHosts: [],
          schemaFreshness: 'fresh',
        },
      ],
      setServerTrustMode: () => {},
    } as unknown as McpRegistry;
    mkdirSync(join(tmpDir, '.goodvibes', 'tui'), { recursive: true });
    writeFileSync(join(tmpDir, '.goodvibes', 'tui', 'subscriptions.json'), JSON.stringify({
      version: 1,
      subscriptions: {
        openai: {
          provider: 'openai',
          accessToken: 'token',
          tokenType: 'Bearer',
          authMode: 'oauth',
          overrideAmbientApiKeys: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      pending: {},
    }, null, 2));
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, mcpRegistry);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns a non-empty Line[] array', () => {
    const lines = renderSettingsModal(modal, W);
    expect(lines).toEqual(expect.any(Array));
    expect(lines.length).toBeGreaterThan(0);
  });

  test('each line has correct terminal width', () => {
    const lines = renderSettingsModal(modal, W);
    for (const line of lines) {
      expect(line.length).toBe(W);
    }
  });

  test('title bar contains "Settings"', () => {
    const lines = renderSettingsModal(modal, W);
    const titleLine = lineToString(lines[0]);
    expect(titleLine).toContain('Settings');
  });

  test('footer contains navigation hints', () => {
    const lines = renderSettingsModal(modal, W);
    const footer = lineToString(lines[lines.length - 2]);
    expect(footer).toContain('Tab');
    expect(footer).toContain('Esc');
  });

  test('category rail and header show the active category count', () => {
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    // The SDK's 9 display.* CONFIG_SCHEMA keys (display.themeMode included).
    expect(texts).toContain('Display (9)');
  });

  test('category rail is grouped and opens with category focus', () => {
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    expect(modal.focusPane).toBe('categories');
    expect(texts).toContain('AGENT EXPERIENCE');
    expect(texts).toContain('  ▸ Display (9)');
    expect(texts).not.toContain('EXTERNAL RUNTIME CONNECTION');
    expect(texts).not.toContain('DELEGATION COMPATIBILITY');
    const interfaceLines = lines.filter(line => lineToString(line).includes('AGENT EXPERIENCE'));
    expect(interfaceLines.map(lineToString)).toEqual([
      expect.stringContaining('AGENT EXPERIENCE'),
    ]);
    const interfaceIndex = lineToString(interfaceLines[0]!).indexOf('AGENT EXPERIENCE');
    expect(interfaceLines[0]?.[interfaceIndex]).toEqual(expect.objectContaining({ bold: true }));
  });

  // The Agent Experience group alone (display/ui/behavior/agents/notifications/
  // permissions/policy/fetch/diagnostics) now exceeds a default 24-row terminal's
  // rail viewport, so later groups scroll out of view until the selection reaches
  // them, this exercises that the rail still reaches every group via scrolling.
  test('category rail scrolls to reveal later groups as selection moves down', () => {
    modal.categoryIndex = SETTINGS_CATEGORIES.indexOf('provider');
    let texts = linesToText(renderSettingsModal(modal, W)).join('\n');
    expect(texts).toContain('MODELS AND PROVIDERS');

    modal.categoryIndex = SETTINGS_CATEGORIES.indexOf('surfaces');
    texts = linesToText(renderSettingsModal(modal, W)).join('\n');
    expect(texts).toContain('CHANNELS AND TOOLS');
  });

  test('exposes daemon runtime settings, including the danger toggle', () => {
    const rendered: string[] = [];
    for (let index = 0; index < SETTINGS_CATEGORIES.length; index += 1) {
      rendered.push(linesToText(renderSettingsModal(modal, W, 40)).join('\n'));
      modal.nextCategory();
    }
    const text = rendered.join('\n');
    expect(text).toContain('DAEMON RUNTIME');
    expect(text).toContain('Control Plane');
    expect(text).toContain('HTTP Listener');
    expect(text).toContain('Service');
    expect(text).toContain('ADVANCED RUNTIME');
    expect(text).toContain('WRFC');
    expect(text).toContain('controlPlane.');
    expect(text).toContain('httpListener.');
    expect(text).toContain('service.');
    expect(text).toContain('wrfc.');
    expect(text).toContain('orchestration.');
    // Rendered, not hidden. The owner can see whether an inbound listener is on;
    // the confirmation gate is what stands between the Agent and turning it on.
    expect(text).toContain('Danger Zone');
    expect(text).toContain('danger.httpListener');
  });

  test('settings list shows setting keys', () => {
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    // display category should show stream, lineNumbers, etc.
    expect(texts.toLowerCase()).toMatch(/stream|linenumbers|theme/);
  });

  test('selected item has arrow indicator', () => {
    const lines = renderSettingsModal(modal, W);
    expect(lines.flat().filter(cell => cell.char === '▸').length).toBeGreaterThan(0);
  });

  test('description of selected setting is shown', () => {
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    // The first setting in display is 'display.stream' with description containing 'Stream'
    expect(texts).toMatch(/stream|Stream/);
  });

  test('selected setting surfaces resolved source metadata', () => {
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('Source');
  });

  test('selected conflicting setting surfaces conflict provenance', () => {
    const selected = modal.getSelected();
    expect(selected).toEqual(expect.objectContaining({
      setting: expect.objectContaining({ key: expect.any(String) }),
    }));
    selected!.conflict = true;
    modal.groups.set(modal.currentCategory, [selected!]);
    const lines = renderSettingsModal(modal, W, 40);
    const texts = linesToText(lines).join('\n');
    expect(texts.toLowerCase()).toContain('conflict');
  });

  test('selected synced setting surfaces synced provenance', () => {
    const selected = modal.getSelected();
    expect(selected).toEqual(expect.objectContaining({
      setting: expect.objectContaining({ key: expect.any(String) }),
    }));
    selected!.effectiveSource = 'synced';
    modal.groups.set(modal.currentCategory, [selected!]);
    const lines = renderSettingsModal(modal, W, 40);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('Source: synced');
  });

  test('footer shows [Enter] Confirm/[Esc] Cancel in editing mode', () => {
    modal.editingMode = true;
    const lines = renderSettingsModal(modal, W);
    const footer = lineToString(lines[lines.length - 2]);
    expect(footer).toContain('Confirm');
    expect(footer).toContain('Cancel');
  });

  test('edit cursor shown when in editing mode', () => {
    modal.editingMode = true;
    modal.editBuffer = 'test';
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    // Block cursor character
    expect(texts).toContain('test\u2588');
  });

  test('changing category shows different settings', () => {
    modal.nextCategory();
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('UI (3)');
  });

  test('mcp category renders server trust editing surface', () => {
    while (modal.currentCategory !== 'mcp') modal.nextCategory();
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('MCP (1)');
    expect(texts).toContain('docs-server');
    expect(texts).toContain('ask-on-risk');
  });

  test('mcp category renders explicit allow-all confirmation guidance', () => {
    while (modal.currentCategory !== 'mcp') modal.nextCategory();
    modal.editingMode = true;
    modal.mcpAllowAllConfirmationTarget = 'docs-server';
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('ALLOW ALL docs-server');
  });

  test('subscriptions category renders provider override state', () => {
    while (modal.currentCategory !== 'subscriptions') modal.nextCategory();
    modal.subscriptionEntries = [{
      provider: 'openai',
      state: 'active',
      tokenType: 'Bearer',
      oauthConfigured: true,
    }];
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('Subscriptions (1)');
    expect(texts).toContain('openai');
    expect(texts).toContain('active');
    expect(texts).toContain('ambient key ov');
  });

  test('subscriptions category renders explicit logout confirmation guidance when armed', () => {
    while (modal.currentCategory !== 'subscriptions') modal.nextCategory();
    modal.subscriptionEntries = [{
      provider: 'openai',
      state: 'active',
      tokenType: 'Bearer',
      oauthConfigured: true,
    }];
    modal.subscriptionLogoutConfirmationTarget = 'openai';
    const lines = renderSettingsModal(modal, W);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('Press Enter again to sign out openai');
  });

  test('works with narrow terminal width', () => {
    const narrowW = 60;
    const lines = renderSettingsModal(modal, narrowW);
    for (const line of lines) {
      expect(line.length).toBe(narrowW);
    }
  });
});
