/**
 * Receipt parity for the dissolved feature model.
 *
 * The Agent forks the SDK's runtime composition root and boot, so it must
 * produce the SAME receipts the SDK does:
 *
 * 1. Migration receipt, a populated legacy `featureFlags` config record
 *    dissolves onto the domain settings keys on ConfigManager load, the
 *    rewritten file is persisted immediately, and the one-line receipt is
 *    logged EXACTLY once (a second load stays silent).
 * 2. Announce-once receipts, the persisted per-install store makes each
 *    default-on announcement exactly once: the first contained exec run
 *    yields the one-time containment line, and boot collects the
 *    web-surface-URL line once. Ids and texts are pinned byte-identical to
 *    the SDK's so the shared store deduplicates across surfaces.
 */
import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { deriveFeatureStates } from '@pellux/goodvibes-sdk/platform/runtime/state';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import {
  FeatureAnnouncementStore,
  SANDBOX_CONTAINED_ANNOUNCEMENT_ID,
  SANDBOX_CONTAINED_ANNOUNCEMENT_TEXT,
  WEB_SURFACE_ANNOUNCEMENT_ID,
  collectStartupAnnouncements,
  createSandboxContainmentAnnouncer,
  featureAnnouncementsPath,
  type FeatureAnnouncement,
} from '@pellux/goodvibes-sdk/platform/runtime/feature-announcements';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

const MIGRATION_RECEIPT_PREFIX =
  'Settings migrated: legacy featureFlags entries now live on their domain settings keys';

const roots: string[] = [];

function makeConfigDir(): string {
  const root = makeProjectTempDir(`gv-feature-receipts-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const configDir = join(root, 'home', '.goodvibes', 'agent');
  mkdirSync(configDir, { recursive: true });
  roots.push(root);
  return configDir;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('legacy featureFlags migration receipt (agent boot parity)', () => {
  test('populated legacy config migrates onto domain keys with the receipt exactly once', () => {
    const configDir = makeConfigDir();
    const settingsPath = join(configDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      featureFlags: {
        'exec-sandbox': 'disabled',
        'permissions-policy-engine': 'enabled',
        'route-binding': 'disabled',
      },
      provider: { model: 'mock:mock-model' },
    }, null, 2) + '\n', 'utf-8');

    const infoSpy = spyOn(logger, 'info').mockImplementation(() => {});
    let config: ConfigManager;
    try {
      // The agent boots through the SDK ConfigManager, load() runs the
      // migration, persists the rewritten file, and logs the receipt.
      config = new ConfigManager({ surfaceRoot: 'agent', configDir });

      // Explicit legacy choices land on the real domain settings keys.
      expect(config.get('sandbox.enabled')).toBe(false);
      expect(config.get('permissions.engine')).toBe('policy-engine');
      expect(config.get('integrations.routeBinding')).toBe(false);
      // Untouched settings survive the rewrite.
      expect(config.get('provider.model')).toBe('mock:mock-model');

      // The rewritten file no longer contains a featureFlags record.
      const persisted = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      expect('featureFlags' in persisted).toBe(false);

      // The gate manager seed derives the migrated states from those keys.
      const derived = deriveFeatureStates(config);
      expect(derived['exec-sandbox']).toBe('disabled');
      expect(derived['permissions-policy-engine']).toBe('enabled');
      expect(derived['route-binding']).toBe('disabled');

      // Receipt exactly once.
      const receipts = infoSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].startsWith(MIGRATION_RECEIPT_PREFIX));
      expect(receipts.length).toBe(1);
      // The receipt names the keys the migration actually wrote.
      expect(String(receipts[0]![0])).toContain('sandbox.enabled');
      expect(String(receipts[0]![0])).toContain('permissions.engine');
      expect(String(receipts[0]![0])).toContain('integrations.routeBinding');
    } finally {
      infoSpy.mockRestore();
    }

    // A second load of the already-migrated file stays silent: the receipt
    // is a one-time migration event, not a boot banner.
    const secondSpy = spyOn(logger, 'info').mockImplementation(() => {});
    try {
      const reloaded = new ConfigManager({ surfaceRoot: 'agent', configDir });
      expect(reloaded.get('sandbox.enabled')).toBe(false);
      expect(reloaded.get('permissions.engine')).toBe('policy-engine');
      const receipts = secondSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].startsWith(MIGRATION_RECEIPT_PREFIX));
      expect(receipts.length).toBe(0);
    } finally {
      secondSpy.mockRestore();
    }
  });

  test('a config with no legacy record loads silently with no receipt', () => {
    const configDir = makeConfigDir();
    const infoSpy = spyOn(logger, 'info').mockImplementation(() => {});
    try {
      const config = new ConfigManager({ surfaceRoot: 'agent', configDir });
      expect(config.get('sandbox.enabled')).toBe(true);
      const receipts = infoSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].startsWith(MIGRATION_RECEIPT_PREFIX));
      expect(receipts.length).toBe(0);
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe('announce-once receipts (agent boot parity)', () => {
  test('announcement ids and texts stay byte-identical to the SDK contract', () => {
    // The store is shared per install across the daemon, the TUI, and this
    // Agent, identical ids/texts are what make "exactly once" hold across
    // surfaces. A drift here would double-announce.
    expect(WEB_SURFACE_ANNOUNCEMENT_ID).toBe('web-surface-url');
    expect(SANDBOX_CONTAINED_ANNOUNCEMENT_ID).toBe('exec-sandbox-contained');
    expect(SANDBOX_CONTAINED_ANNOUNCEMENT_TEXT).toBe('commands now run contained; escalations will ask');
  });

  test('the store records each announcement id exactly once, persisted across instances', () => {
    const configDir = makeConfigDir();
    const storePath = join(configDir, 'control-plane', 'feature-announcements.json');
    const store = new FeatureAnnouncementStore(storePath);
    expect(store.record('web-surface-url')).toBe(true);
    expect(store.record('web-surface-url')).toBe(false);
    // "Once" survives process restarts: a fresh instance reads the same file.
    const reopened = new FeatureAnnouncementStore(storePath);
    expect(reopened.has('web-surface-url')).toBe(true);
    expect(reopened.record('web-surface-url')).toBe(false);
  });

  test('the first contained exec run announces once; later runs stay silent', () => {
    const configDir = makeConfigDir();
    const store = new FeatureAnnouncementStore(join(configDir, 'control-plane', 'feature-announcements.json'));
    const announced: FeatureAnnouncement[] = [];
    const onSandboxedRun = createSandboxContainmentAnnouncer(store, (announcement) => announced.push(announcement));

    onSandboxedRun();
    onSandboxedRun();
    onSandboxedRun();

    expect(announced.length).toBe(1);
    expect(announced[0]).toEqual({
      id: 'exec-sandbox-contained',
      text: 'commands now run contained; escalations will ask',
    });
  });

  test('boot collects the web-surface line once per install and never again', () => {
    const configDir = makeConfigDir();
    const config = new ConfigManager({ surfaceRoot: 'agent', configDir });
    // web.enabled defaults true (default-on with announce-once receipts).
    expect(config.get('web.enabled')).toBe(true);
    const store = new FeatureAnnouncementStore(featureAnnouncementsPath(config));

    const first = collectStartupAnnouncements({ configManager: config, store });
    expect(first.length).toBe(1);
    expect(first[0]!.id).toBe('web-surface-url');
    expect(first[0]!.text).toContain('Web surface ready: ');
    expect(first[0]!.text).toContain(String(config.get('web.port')));

    // Second boot of ANY process of this install: silent.
    const second = collectStartupAnnouncements({ configManager: config, store });
    expect(second).toEqual([]);
  });

  test('the shared store lives under the control-plane config directory', () => {
    const configDir = makeConfigDir();
    const config = new ConfigManager({ surfaceRoot: 'agent', configDir });
    const path = featureAnnouncementsPath(config);
    expect(path.startsWith(config.getControlPlaneConfigDir())).toBe(true);
    expect(path.endsWith(join('control-plane', 'feature-announcements.json'))).toBe(true);
    expect(existsSync(path)).toBe(false); // nothing is written until the first announcement
  });
});
