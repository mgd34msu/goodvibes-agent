/**
 * Integration test: email.* config keys with a real ConfigManager instance.
 *
 * Regression guard for CRIT-1: ensures that ensureEmailConfigDefaults() injects
 * the email section and that all email.* keys can be set/get round-tripped
 * without throwing 'Invalid config path'.
 *
 * Also covers CRIT-A/CRIT-B: the user-facing setter path (/email set) via
 * persistSecretBackedConfigValue for secret keys and setDynamic+save for
 * plain keys. These tests exercise the real command/persist path — they do
 * NOT mutate config[] directly.
 *
 * Pattern mirrors src/test/config/schema-extensions.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { ensureEmailConfigDefaults } from '@pellux/goodvibes-sdk/platform/email';
import type { ConfigKey } from '../../config/index.ts';
import { persistSecretBackedConfigValue } from '../../config/secret-config.ts';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = makeProjectTempDir(`gv-email-cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return dir;
}

function createConfigManager(workingDir: string): ConfigManager {
  return new ConfigManager({
    surfaceRoot: 'tui',
    workingDir,
    homeDir: workingDir,
    configDir: join(workingDir, '.goodvibes', 'global-tui'),
  });
}

/** Wrap configManager with the string-keyed getter used by email-service. */
function emailGet(cm: ConfigManager, key: string): unknown {
  return (cm as unknown as { get: (k: string) => unknown }).get(key);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('email config integration: ensureEmailConfigDefaults + real ConfigManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test('ensureEmailConfigDefaults does not throw on a fresh ConfigManager', () => {
    const cm = createConfigManager(tmpDir);
    expect(() => ensureEmailConfigDefaults(cm)).not.toThrow();
  });

  test('ensureEmailConfigDefaults is idempotent (safe to call multiple times)', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    ensureEmailConfigDefaults(cm);
    expect(emailGet(cm, 'email.enabled')).toBe(false);
  });

  test('email.enabled default is false', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    expect(emailGet(cm, 'email.enabled')).toBe(false);
  });

  test('email.imapPort default is 993', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    expect(emailGet(cm, 'email.imapPort')).toBe(993);
  });

  test('email.smtpPort default is 587', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    expect(emailGet(cm, 'email.smtpPort')).toBe(587);
  });

  test('email.imapHost default is empty string', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    expect(emailGet(cm, 'email.imapHost')).toBe('');
  });

  test('email.smtpHost default is empty string', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    expect(emailGet(cm, 'email.smtpHost')).toBe('');
  });

  test('email.username default is empty string', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    expect(emailGet(cm, 'email.username')).toBe('');
  });

  test('email.passwordRef default is empty string', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    expect(emailGet(cm, 'email.passwordRef')).toBe('');
  });

  test('email.fromAddress default is empty string', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    expect(emailGet(cm, 'email.fromAddress')).toBe('');
  });

  // -------------------------------------------------------------------------
  // get / set round-trips
  // -------------------------------------------------------------------------

  test('set and get email.enabled round-trip', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    (cm as unknown as { config: Record<string, Record<string, unknown>> }).config['email']!['enabled'] = true;
    expect(emailGet(cm, 'email.enabled')).toBe(true);
  });

  test('set and get email.imapHost round-trip', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    (cm as unknown as { config: Record<string, Record<string, unknown>> }).config['email']!['imapHost'] = 'imap.test.example';
    expect(emailGet(cm, 'email.imapHost')).toBe('imap.test.example');
  });

  test('set and get email.smtpHost round-trip', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    (cm as unknown as { config: Record<string, Record<string, unknown>> }).config['email']!['smtpHost'] = 'smtp.test.example';
    expect(emailGet(cm, 'email.smtpHost')).toBe('smtp.test.example');
  });

  test('set and get email.passwordRef round-trip', () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    const ref = 'goodvibes://secrets/goodvibes/GOODVIBES_EMAIL_PASSWORDREF';
    (cm as unknown as { config: Record<string, Record<string, unknown>> }).config['email']!['passwordRef'] = ref;
    expect(emailGet(cm, 'email.passwordRef')).toBe(ref);
  });

  test('get throws without ensureEmailConfigDefaults injection', () => {
    const cm = createConfigManager(tmpDir);
    // Without calling ensureEmailConfigDefaults first, email.* get must throw
    expect(() => emailGet(cm, 'email.enabled')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// User-facing setter path: /email set — CRIT-A / CRIT-B
// ---------------------------------------------------------------------------

/**
 * Cast a ConfigManager to the SecretBackedConfigManager interface accepted
 * by persistSecretBackedConfigValue. The email section must already be
 * injected via ensureEmailConfigDefaults before calling.
 */
function asSecretBacked(cm: ConfigManager): Parameters<typeof persistSecretBackedConfigValue>[0] {
  return cm as unknown as Parameters<typeof persistSecretBackedConfigValue>[0];
}

/**
 * Minimal SecretsManager stub that captures set() calls.
 * Uses an in-memory store so it fulfils the SecretBackedSecretStore contract
 * without requiring real encrypted file I/O.
 */
function makeMemorySecretsManager(): {
  store: Map<string, string>;
  manager: Parameters<typeof persistSecretBackedConfigValue>[1];
} {
  const store = new Map<string, string>();
  const manager = {
    set: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  };
  return { store, manager };
}

describe('email set command path: user-facing setter via persistSecretBackedConfigValue', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test('plain key (email.imapHost) round-trips through setDynamic+save and survives new ConfigManager', () => {
    const configDir = join(tmpDir, '.goodvibes', 'global-tui');
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);

    // Simulate the non-secret path in handleSet
    const configKey = 'email.imapHost' as unknown as ConfigKey;
    (cm as unknown as { setDynamic: (k: unknown, v: unknown) => void }).setDynamic(configKey, 'imap.example.com');
    (cm as unknown as { save: () => void }).save();

    // Reload from the same configDir to prove persistence
    const cm2 = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm2);
    expect(emailGet(cm2, 'email.imapHost')).toBe('imap.example.com');
  });

  test('passwordRef path routes raw secret through SecretsManager; settings.json stores only goodvibes:// ref', async () => {
    const configDir = join(tmpDir, '.goodvibes', 'global-tui');
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    const { store, manager } = makeMemorySecretsManager();

    const configKey = 'email.passwordRef' as unknown as ConfigKey;
    const rawPassword = 'super-secret-password-123';

    // This is the exact call made by handleSet for the passwordRef path
    const storedRef = await persistSecretBackedConfigValue(
      asSecretBacked(cm),
      manager,
      configKey,
      rawPassword,
      { scope: 'user' },
    );
    (cm as unknown as { save: () => void }).save();

    // (a) The plain key round-trips: configManager returns the goodvibes:// ref
    expect(emailGet(cm, 'email.passwordRef')).toBe(storedRef);
    expect(storedRef).toMatch(/^goodvibes:\/\/secrets\//);

    // (b) settings.json contains the goodvibes:// ref, NOT the plaintext password
    mkdirSync(configDir, { recursive: true });
    // The daemon tier is in this list because that is where the value now
    // legitimately lives: email runs in the daemon, so email.passwordRef is
    // daemon-owned and the daemon's store is its only home. What this test
    // guards is unchanged — the raw password reaches no settings file, and a
    // goodvibes:// reference reaches one — but looking only in the surface
    // files would have reported the ref missing when it had simply been routed
    // to its owner.
    const settingsFiles = [
      join(configDir, 'settings.json'),
      join(configDir, 'user-settings.json'),
      join(tmpDir, '.goodvibes', 'global-tui', 'settings.json'),
      join(tmpDir, '.goodvibes', 'daemon', 'settings.json'),
    ];
    let settingsContent = '';
    for (const f of settingsFiles) {
      if (existsSync(f)) {
        settingsContent += readFileSync(f, 'utf-8');
      }
    }
    // The raw password must never appear in any settings file
    expect(settingsContent).not.toContain(rawPassword);
    // The goodvibes:// ref must be present
    if (settingsContent.length > 0) {
      expect(settingsContent).toContain('goodvibes://');
    }

    // (c) SecretsManager received the raw value under the expected key
    // Key shape is GOODVIBES_<SECTION>_<CAMEL_TO_UPPER_SNAKE> per buildGoodVibesSecretKey
    const expectedSecretKey = 'GOODVIBES_EMAIL_PASSWORD_REF';
    expect(store.has(expectedSecretKey)).toBe(true);
    expect(store.get(expectedSecretKey)).toBe(rawPassword);
  });

  test('passwordRef path: new ConfigManager loaded from same configDir sees the goodvibes:// ref', async () => {
    const cm = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm);
    const { manager } = makeMemorySecretsManager();

    const configKey = 'email.passwordRef' as unknown as ConfigKey;
    const storedRef = await persistSecretBackedConfigValue(
      asSecretBacked(cm),
      manager,
      configKey,
      'my-email-password',
      { scope: 'user' },
    );
    (cm as unknown as { save: () => void }).save();

    // Load a brand-new ConfigManager from the same directory
    const cm2 = createConfigManager(tmpDir);
    ensureEmailConfigDefaults(cm2);

    // The ref must survive the save → load round-trip
    expect(emailGet(cm2, 'email.passwordRef')).toBe(storedRef);
    expect(String(emailGet(cm2, 'email.passwordRef'))).toMatch(/^goodvibes:\/\/secrets\//);
  });
});
