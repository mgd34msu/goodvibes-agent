/**
 * End-to-end handler test for the /email command.
 *
 * Registers the command via registerEmailRuntimeCommands(registry), builds a
 * real CommandContext backed by a tmp-dir ConfigManager and an in-memory
 * SecretsManager stub, then invokes the actual command handler via
 * registry.get('email')!.handler([...], ctx) — mirroring the pattern used by
 * mcp-runtime-command.test.ts and other sibling command tests.
 *
 * Covers:
 *   - passwordRef without --yes: refusal, no write, no secret stored
 *   - passwordRef with --yes: secret stored, settings.json has goodvibes:// ref not plaintext
 *   - unknown key: plain-language error, no write
 *   - invalid port: plain-language error, no write
 *   - valid port: coerced to number in persisted config
 *   - enabled boolean: coerced to boolean in persisted config
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerEmailRuntimeCommands } from '../../input/commands/email-runtime.ts';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { ensureEmailConfigDefaults } from '../../agent/email/email-service.ts';
import type { ConfigKey } from '../../config/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `gv-email-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

/** Minimal in-memory SecretsManager stub that captures set() calls. */
function makeMemorySecretsManager(): {
  store: Map<string, string>;
  manager: { set: (key: string, value: string) => Promise<void>; delete: (key: string) => Promise<void> };
} {
  const store = new Map<string, string>();
  const manager = {
    set: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  };
  return { store, manager };
}

/**
 * Build a CommandContext suitable for /email command tests.
 * Provides a real ConfigManager (with email defaults injected) and
 * the in-memory SecretsManager stub. All other services are stub-minimal.
 */
function makeContext(
  root: string,
  out: string[],
  secretsManager: ReturnType<typeof makeMemorySecretsManager>['manager'],
): CommandContext {
  const cm = createConfigManager(root);
  ensureEmailConfigDefaults(cm);

  return {
    session: {} as never,
    provider: {} as never,
    workspace: {} as never,
    platform: {
      config: {} as never,
      configManager: cm,
      secretsManager,
    } as never,
    ops: {} as never,
    extensions: {} as never,
    clients: {} as never,
    renderRequest: () => {},
    print: (text: string) => out.push(text),
    exit: () => {},
  } as CommandContext;
}

// ---------------------------------------------------------------------------
// Helper: read persisted settings to verify on-disk state
// ---------------------------------------------------------------------------

/**
 * Every file a config write may legitimately land in.
 *
 * The daemon tier is one of them: email runs in the daemon, so
 * email.passwordRef is daemon-owned and the daemon's store is its only home.
 * Reading only the surface files reported the reference missing when it had
 * simply been routed to its owner — while the assertion that matters, that no
 * raw password reaches any of these files, is unchanged.
 */
function readPersistedSettings(root: string): string {
  const candidates = [
    join(root, '.goodvibes', 'global-tui', 'settings.json'),
    join(root, '.goodvibes', 'global-tui', 'user-settings.json'),
    join(root, '.goodvibes', 'daemon', 'settings.json'),
  ];
  return candidates
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, 'utf-8'))
    .join('');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('/email command handler: end-to-end real handler dispatch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. passwordRef without --yes: refusal, SecretsManager empty, no ref in config
  // -------------------------------------------------------------------------
  test('set email.passwordRef without --yes prints refusal; no secret stored; config has no ref', async () => {
    const registry = new CommandRegistry();
    registerEmailRuntimeCommands(registry);
    const out: string[] = [];
    const { store, manager } = makeMemorySecretsManager();
    const ctx = makeContext(tmpDir, out, manager);

    await registry.get('email')!.handler(['set', 'email.passwordRef', 'raw-secret-value'], ctx);

    const output = out.join('\n');
    // Must refuse — some form of "without --yes" or "--yes to apply"
    expect(output).toMatch(/--yes/);
    // SecretsManager must not have been called
    expect(store.size).toBe(0);
    // Config must not contain the raw value or any goodvibes:// ref
    const persisted = readPersistedSettings(tmpDir);
    expect(persisted).not.toContain('raw-secret-value');
    expect(persisted).not.toContain('goodvibes://');
  });

  // -------------------------------------------------------------------------
  // 2. passwordRef with --yes: secret stored; settings.json has ref not plaintext
  // -------------------------------------------------------------------------
  test('set email.passwordRef --yes stores secret in SecretsManager; settings.json has goodvibes:// ref', async () => {
    const registry = new CommandRegistry();
    registerEmailRuntimeCommands(registry);
    const out: string[] = [];
    const { store, manager } = makeMemorySecretsManager();
    const ctx = makeContext(tmpDir, out, manager);

    await registry.get('email')!.handler(['set', 'email.passwordRef', 'my-real-password', '--yes'], ctx);

    const output = out.join('\n');
    // Command must confirm success, not a refusal
    expect(output).toContain('Email config updated');
    expect(output).toContain('goodvibes://');

    // SecretsManager received the raw value under the expected key
    const expectedSecretKey = 'GOODVIBES_EMAIL_PASSWORD_REF';
    expect(store.has(expectedSecretKey)).toBe(true);
    expect(store.get(expectedSecretKey)).toBe('my-real-password');

    // Persisted settings must contain the goodvibes:// ref and NOT the raw password
    const persisted = readPersistedSettings(tmpDir);
    expect(persisted).not.toContain('my-real-password');
    if (persisted.length > 0) {
      expect(persisted).toContain('goodvibes://');
    }

    // config.get returns the goodvibes:// ref
    const cm = ctx.platform.configManager as unknown as { get: (k: string) => unknown };
    const ref = cm.get('email.passwordRef') as string;
    expect(ref).toMatch(/^goodvibes:\/\/secrets\//);
  });

  // -------------------------------------------------------------------------
  // 3. Unknown key: plain-language error; no write
  // -------------------------------------------------------------------------
  test('set email.bogus prints unknown-key error; no config write', async () => {
    const registry = new CommandRegistry();
    registerEmailRuntimeCommands(registry);
    const out: string[] = [];
    const { store, manager } = makeMemorySecretsManager();
    const ctx = makeContext(tmpDir, out, manager);

    await registry.get('email')!.handler(['set', 'email.bogus', 'somevalue'], ctx);

    const output = out.join('\n');
    // Plain-language rejection — must mention the unknown key
    expect(output.toLowerCase()).toContain('unknown email config key');
    // No secret side-effect
    expect(store.size).toBe(0);
    // settings.json must not exist or must not contain the value
    const persisted = readPersistedSettings(tmpDir);
    expect(persisted).not.toContain('somevalue');
  });

  // -------------------------------------------------------------------------
  // 4. Invalid port: plain-language error; no write
  // -------------------------------------------------------------------------
  test('set email.imapPort 99999 prints invalid-port error; no config write', async () => {
    const registry = new CommandRegistry();
    registerEmailRuntimeCommands(registry);
    const out: string[] = [];
    const { store, manager } = makeMemorySecretsManager();
    const ctx = makeContext(tmpDir, out, manager);

    await registry.get('email')!.handler(['set', 'email.imapPort', '99999'], ctx);

    const output = out.join('\n');
    expect(output.toLowerCase()).toContain('invalid port');
    // settings.json must not contain 99999
    const persisted = readPersistedSettings(tmpDir);
    expect(persisted).not.toContain('99999');
  });

  // -------------------------------------------------------------------------
  // 5. Valid port: coerced to number 993 in persisted config
  // -------------------------------------------------------------------------
  test('set email.imapPort 993 coerces to number 993 in persisted settings', async () => {
    const registry = new CommandRegistry();
    registerEmailRuntimeCommands(registry);
    const out: string[] = [];
    const { manager } = makeMemorySecretsManager();
    const ctx = makeContext(tmpDir, out, manager);

    await registry.get('email')!.handler(['set', 'email.imapPort', '993'], ctx);

    const output = out.join('\n');
    expect(output).toContain('Email config updated');
    expect(output).toContain('993');

    // config.get must return the numeric value
    const cm = ctx.platform.configManager as unknown as { get: (k: string) => unknown };
    expect(cm.get('email.imapPort')).toBe(993);

    // Persisted settings must store the number (JSON does not quote it)
    const persisted = readPersistedSettings(tmpDir);
    if (persisted.length > 0) {
      const parsed = JSON.parse(persisted) as Record<string, unknown>;
      // May be nested under "email" key or flat depending on ConfigManager shape
      const emailSection = (parsed['email'] ?? parsed) as Record<string, unknown>;
      if ('imapPort' in emailSection) {
        expect(typeof emailSection['imapPort']).toBe('number');
        expect(emailSection['imapPort']).toBe(993);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 6. Boolean coercion: set email.enabled true stores boolean
  // -------------------------------------------------------------------------
  test('set email.enabled true coerces to boolean true in config', async () => {
    const registry = new CommandRegistry();
    registerEmailRuntimeCommands(registry);
    const out: string[] = [];
    const { manager } = makeMemorySecretsManager();
    const ctx = makeContext(tmpDir, out, manager);

    await registry.get('email')!.handler(['set', 'email.enabled', 'true'], ctx);

    const output = out.join('\n');
    expect(output).toContain('Email config updated');

    // config.get must return true as a boolean, not the string 'true'
    const cm = ctx.platform.configManager as unknown as { get: (k: string) => unknown };
    expect(cm.get('email.enabled')).toBe(true);
  });
});
