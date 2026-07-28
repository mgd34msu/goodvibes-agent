/**
 * Tests for the payments settings category: money round-trips, the CVV
 * trade-off warning, the daemon.timezone picker dispatch, and the guard that
 * no settings surface ever renders a card-material-shaped value.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsModal, SETTINGS_CATEGORIES } from '../../input/settings-modal.ts';
import { ConfigManager, CONFIG_SCHEMA } from '@pellux/goodvibes-sdk/platform/config';
import { CVV_PROMPT_TRADEOFF_WARNING } from '@pellux/goodvibes-sdk/platform/payments';
import { SecretsManager } from '../../config/secrets.ts';
import { ServiceRegistry } from '@pellux/goodvibes-sdk/platform/config';
import { SubscriptionManager } from '@pellux/goodvibes-sdk/platform/config';
import { createFeatureFlagManager } from '@/runtime/index.ts';
import type { FeatureFlagManager } from '@/runtime/index.ts';
import type { McpRegistry } from '@pellux/goodvibes-sdk/platform/mcp';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `gv-settings-payments-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('SettingsModal payments category', () => {
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
    subscriptionManager = new SubscriptionManager(join(tmpDir, '.goodvibes', 'agent', 'subscriptions.json'));
    serviceRegistry = new ServiceRegistry(join(tmpDir, '.goodvibes', 'agent', 'services.json'), {
      secretsManager: new SecretsManager({ projectRoot: tmpDir, globalHome: tmpDir, configManager: cm }),
      subscriptionManager,
    });
    mcpRegistry = { listServerSecurity: () => [], setServerTrustMode: () => {} } as unknown as McpRegistry;
    mkdirSync(join(tmpDir, '.goodvibes', 'agent'), { recursive: true });
    modal.open(cm, ffm, subscriptionManager, serviceRegistry, mcpRegistry);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test('the payments category exists, is navigable, and lists every payments.* key including the four card-material fields', () => {
    expect(SETTINGS_CATEGORIES).toContain('payments');
    while (modal.currentCategory !== 'payments') modal.nextCategory();
    const keys = modal.currentItems.map((entry): string => entry.setting.key);
    expect(keys.sort()).toEqual([
      // Real CONFIG_SCHEMA keys
      'payments.billingAddress.city',
      'payments.billingAddress.country',
      'payments.billingAddress.line1',
      'payments.billingAddress.line2',
      'payments.billingAddress.name',
      'payments.billingAddress.postalCode',
      'payments.billingAddress.region',
      'payments.budget.dailyItemCents',
      'payments.budget.dailyOverageCents',
      'payments.budget.overageToleranceDailyAllowanceCents',
      'payments.budget.overageToleranceEnabled',
      'payments.budget.perPurchaseCeilingCents',
      'payments.budget.perPurchaseCeilingEnabled',
      'payments.currency',
      'payments.cvvHandling',
      'payments.defaultCardId',
      'payments.enabled',
      'payments.notifyChannels',
      'payments.shipping.preferredTier',
      'payments.shippingAddress.city',
      'payments.shippingAddress.country',
      'payments.shippingAddress.line1',
      'payments.shippingAddress.line2',
      'payments.shippingAddress.name',
      'payments.shippingAddress.postalCode',
      'payments.shippingAddress.region',
      'payments.windows.approvalMinutes',
      'payments.windows.vetoMinutes',
      // Synthetic card-material keys, injected by the modal (input/payments-config.ts).
      // CONFIG_SCHEMA deliberately declares none of these: card material lives
      // write-only in the daemon secret store and config holds only a
      // goodvibes:// reference. They are listed here so the person at the
      // terminal gets a visible set / not-set row and a masked edit path; the
      // primary entry point is the guided `/payments card` flow.
      'payments.cardCvv',
      'payments.cardExpiry',
      'payments.cardNumber',
      'payments.cardholderName',
    ].sort());
  });

  describe('money fields round-trip exactly', () => {
    test.each(['0.1', '0.29', '19.99', '1234.56'])('typing %s stores the exact cent value and re-editing shows it back', (typed) => {
      while (modal.currentCategory !== 'payments') modal.nextCategory();
      modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.budget.dailyItemCents');
      modal.activateSelected();
      expect(modal.editingMode).toBe(true);
      // A user typing "50" must never silently mean fifty cents: the edit
      // buffer starts in major units ("0.00"), not the raw stored integer.
      expect(modal.editBuffer).toBe('0.00');

      modal.editBuffer = typed;
      expect(modal.commitEdit()).toBe(true);

      const expectedCents = Math.round(Number(typed) * 100);
      expect(cm.get('payments.budget.dailyItemCents')).toBe(expectedCents);

      // Re-opening the field for edit shows the same major-units string back.
      modal.activateSelected();
      expect(modal.editBuffer).toBe(formatMajor(expectedCents));
      modal.cancelEdit();
    });

    // Every other payments.*Cents key drives the identical conversion code,
    // but each gets its own two-value assertion here rather than inheriting
    // dailyItemCents's — a wrong key name on any one of these would silently
    // read/write the wrong config path and only its own test would catch it.
    test.each([
      ['payments.budget.dailyOverageCents', '0.29', 29],
      ['payments.budget.perPurchaseCeilingCents', '19.99', 1999],
      ['payments.budget.overageToleranceDailyAllowanceCents', '1234.56', 123456],
    ])('%s: typing %s stores exactly %d cents', (key, typed, expectedCents) => {
      while (modal.currentCategory !== 'payments') modal.nextCategory();
      modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === key);
      modal.activateSelected();
      expect(modal.editBuffer).toBe('0.00');
      modal.editBuffer = typed as string;
      expect(modal.commitEdit()).toBe(true);
      expect(cm.get(key as 'payments.budget.dailyOverageCents')).toBe(expectedCents as number);
    });
  });

  test('a non-numeric or negative money entry is rejected, not silently coerced', () => {
    while (modal.currentCategory !== 'payments') modal.nextCategory();
    modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.budget.dailyItemCents');
    modal.activateSelected();
    modal.editBuffer = '-5';
    expect(modal.commitEdit()).toBe(false);
    expect(cm.get('payments.budget.dailyItemCents')).toBe(0);
  });

  test('a non-USD currency is honored in the money edit buffer conversion', () => {
    while (modal.currentCategory !== 'payments') modal.nextCategory();
    modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.currency');
    modal.activateSelected();
    modal.editBuffer = 'JPY';
    expect(modal.commitEdit()).toBe(true);

    modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.budget.dailyItemCents');
    modal.activateSelected();
    expect(modal.editBuffer).toBe('0'); // JPY has no minor unit
    modal.editBuffer = '500';
    expect(modal.commitEdit()).toBe(true);
    expect(cm.get('payments.budget.dailyItemCents')).toBe(500);
  });

  test('selecting daemon.timezone dispatches the picker instead of free-text edit', () => {
    while (modal.currentCategory !== 'daemon') modal.nextCategory();
    modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'daemon.timezone');
    modal.activateSelected();
    expect(modal.pendingSettingsPickerAction).toBe('daemon-timezone');
    expect(modal.editingMode).toBe(false);
  });

  describe('CVV trade-off warning', () => {
    test('selecting prompt surfaces the exact SDK warning string', () => {
      while (modal.currentCategory !== 'payments') modal.nextCategory();
      modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.cvvHandling');
      expect(modal.getSelected()?.currentValue).toBe('stored');
      expect(modal.lastSettingEffectMessage).toBeNull();

      modal.activateSelected(); // cycles the enum: stored -> prompt
      expect(cm.get('payments.cvvHandling')).toBe('prompt');
      expect(modal.lastSettingEffectMessage).toBe(CVV_PROMPT_TRADEOFF_WARNING);
    });

    test('switching back to stored shows no warning of any kind', () => {
      while (modal.currentCategory !== 'payments') modal.nextCategory();
      modal.selectedIndex = modal.currentItems.findIndex((entry) => entry.setting.key === 'payments.cvvHandling');
      modal.activateSelected(); // -> prompt
      modal.activateSelected(); // -> stored
      expect(cm.get('payments.cvvHandling')).toBe('stored');
      expect(modal.lastSettingEffectMessage).toBeNull();
    });
  });

  test('no CONFIG_SCHEMA key looks like raw card material (cvv/pan/cardNumber)', () => {
    const suspicious = CONFIG_SCHEMA
      .map((setting) => setting.key)
      .filter((key) => /cvv|\bpan\b|cardnumber/i.test(key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)))
      // cvvHandling is a MODE (stored/prompt), never the card verification
      // value itself — the schema's own docs say the number/CVV never appear
      // here at all, which this asserts structurally rather than trusting prose.
      .filter((key) => key !== 'payments.cvvHandling');
    expect(suspicious).toEqual([]);
  });
});

function formatMajor(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}
