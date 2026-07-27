/**
 * Rendering tests for the payments settings category: the CVV trade-off
 * warning appears only when prompt is selected, money values render in major
 * units, and no settings surface ever renders a card-material-shaped value.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsModal, SETTINGS_CATEGORIES } from '../../input/settings-modal.ts';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { CVV_PROMPT_TRADEOFF_WARNING } from '@pellux/goodvibes-sdk/platform/payments';
import { SecretsManager } from '../../config/secrets.ts';
import { ServiceRegistry } from '@pellux/goodvibes-sdk/platform/config';
import { SubscriptionManager } from '@pellux/goodvibes-sdk/platform/config';
import { createFeatureFlagManager } from '@/runtime/index.ts';
import type { FeatureFlagManager } from '@/runtime/index.ts';
import type { McpRegistry } from '@pellux/goodvibes-sdk/platform/mcp';
import { renderSettingsModal } from '../../renderer/settings-modal.ts';
import { linesToText } from '../setup.ts';

const W = 140;

function makeTmpDir(): string {
  const dir = join(tmpdir(), `gv-settings-payments-renderer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createConfigManager(root: string): ConfigManager {
  return new ConfigManager({
    surfaceRoot: 'agent',
    workingDir: root,
    homeDir: root,
    configDir: join(root, '.goodvibes', 'global-agent'),
  });
}

describe('renderSettingsModal payments category', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  let tmpDir: string;
  let cm: ConfigManager;
  let ffm: FeatureFlagManager;
  let modal: SettingsModal;
  let mcpRegistry: McpRegistry;
  let subscriptionManager: SubscriptionManager;
  let serviceRegistry: ServiceRegistry;

  function reopen(): void {
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, mcpRegistry);
    while (modal.currentCategory !== 'payments') modal.nextCategory();
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.HOME = tmpDir;
    process.chdir(tmpDir);
    cm = createConfigManager(tmpDir);
    ffm = createFeatureFlagManager();
    modal = new SettingsModal();
    subscriptionManager = new SubscriptionManager(join(tmpDir, '.goodvibes', 'agent', 'subscriptions.json'));
    serviceRegistry = new ServiceRegistry(join(tmpDir, '.goodvibes', 'agent', 'services.json'), {
      secretsManager: new SecretsManager({ projectRoot: tmpDir, globalHome: tmpDir, configManager: cm }),
      subscriptionManager,
    });
    mcpRegistry = { listServerSecurity: () => [], setServerTrustMode: () => {} } as unknown as McpRegistry;
    mkdirSync(join(tmpDir, '.goodvibes', 'agent'), { recursive: true });
    reopen();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test('the payments category renders without crashing and shows its keys', () => {
    modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.budget.dailyItemCents');
    const texts = linesToText(renderSettingsModal(modal, W)).join('\n');
    expect(texts).toContain('Payments (14)');
    expect(texts).toContain('payments.budget.dailyItemCents');
    expect(texts).toContain('Daily Item Budget');
  });

  test('a money field renders in major units with the currency code, not a raw cent integer', () => {
    cm.setDynamic('payments.budget.dailyItemCents', 1999);
    reopen(); // reload modal.groups from the mutated config, same as resetSelected()'s test pattern
    const texts = linesToText(renderSettingsModal(modal, W)).join('\n');
    expect(texts).toContain('USD 19.99');
    expect(texts).not.toContain('1999');
  });

  test('payments.defaultCardId renders as a plain visible id, never masked like a secret', () => {
    // It refers to a card id from payments.cards.list; the card NUMBER, expiry
    // and CVV live in the daemon secret store and never in config, so this key
    // must never be treated as secret-shaped by the masking path a real secret
    // (surfaces.*.token, etc.) goes through.
    modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.defaultCardId');
    const emptyTexts = linesToText(renderSettingsModal(modal, W, 40)).join('\n');
    expect(emptyTexts).toContain('(empty)');

    cm.setDynamic('payments.defaultCardId', 'card_household_visa');
    reopen();
    modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.defaultCardId');
    const setTexts = linesToText(renderSettingsModal(modal, W, 40)).join('\n');
    expect(setTexts).toContain('card_household_visa');
    expect(setTexts).not.toMatch(/•{4,}/);
  });

  test('selecting prompt renders the exact SDK warning text in the context panel', () => {
    modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.cvvHandling');
    modal.activateSelected(); // enum cycle: stored -> prompt
    expect(cm.get('payments.cvvHandling')).toBe('prompt');

    const texts = linesToText(renderSettingsModal(modal, W, 40)).join('\n');
    expect(texts).toContain('DISABLES UNATTENDED PURCHASING');
    expect(texts).toContain(CVV_PROMPT_TRADEOFF_WARNING.slice(0, 40));
  });

  test('the default (stored) value renders no warning anywhere', () => {
    // The schema's own always-shown description text separately explains what
    // 'prompt' would do (for either value, as documentation) — that is not
    // this warning and stays out of this assertion. What must never appear
    // against the 'stored' default is the SDK's moment-of-selection warning
    // string itself.
    modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.cvvHandling');
    expect(modal.getSelected()?.currentValue).toBe('stored');
    const texts = linesToText(renderSettingsModal(modal, W, 40)).join('\n');
    expect(texts).not.toContain(CVV_PROMPT_TRADEOFF_WARNING.slice(0, 40));
  });

  test('no rendered category ever populates a setting entry for a cvv/pan/cardNumber-shaped key other than the handling mode', () => {
    // The schema-level guard (settings-modal-payments.test.ts) proves
    // CONFIG_SCHEMA carries no such key at all. This proves the renderer's
    // OWN populated groups — including any synthetic entries it injects,
    // like display.themeMode — carry none either.
    for (const category of SETTINGS_CATEGORIES) {
      if (category === 'flags' || category === 'mcp' || category === 'subscriptions') continue;
      const entries = modal.groups.get(category) ?? [];
      const suspicious = entries
        .map((entry) => entry.setting.key)
        .filter((key) => /cvv|\bpan\b|cardnumber/i.test(key))
        .filter((key) => key !== 'payments.cvvHandling');
      expect(suspicious).toEqual([]);
    }
  });
});
